import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { buildApp } from '../src/app.ts';
import { getConfig } from '../src/lib/config.ts';
import { token, hashToken, decrypt } from '../src/lib/security.ts';
import { gatewayFor } from '../src/lib/gateway.ts';
import { scanFile } from '../src/lib/scanner.ts';
import { writeFile } from 'node:fs/promises';
const databaseUrl = process.env.TEST_DATABASE_URL;

test('venda simulada: publicação, taxa, idempotência, isolamento, entrega e revogação', { skip: !databaseUrl }, async t => {
  if (!new URL(databaseUrl!).pathname.endsWith('_test')) throw new Error('Use um banco com sufixo _test.');
  const storageDir = await mkdtemp(join(tmpdir(), 'nostore-commerce-'));
  // Test double for the ClamAV wire protocol; the browser test uses the real daemon.
  const scanner = createServer(socket => {
    let buffer = Buffer.alloc(0), started = false, infected = false;
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!started) { if (buffer.length < 10) return; buffer = buffer.subarray(10); started = true; }
      while (buffer.length >= 4) {
        const length = buffer.readUInt32BE(0);
        if (buffer.length < length + 4) return;
        if (!length) { socket.end(infected ? 'stream: Eicar-Test-Signature FOUND\0' : 'stream: OK\0'); return; }
        if (buffer.subarray(4, length + 4).toString().includes('EICAR')) infected = true;
        buffer = buffer.subarray(length + 4);
      }
    });
  });
  await new Promise<void>(resolve => scanner.listen(0, '127.0.0.1', resolve));
  const address = scanner.address() as { port: number };
  const adminEmail = `${randomUUID()}@example.test`;
  const buyerEmail = `${randomUUID()}@example.test`;
  const config = { ...getConfig(), databaseUrl: databaseUrl!, storageDir, paymentGateway: 'simulated' as const, adminEmails: [adminEmail], clamavHost: '127.0.0.1', clamavPort: address.port };
  assert.throws(() => gatewayFor({ ...config, production: true }), { code: 'GATEWAY_UNAVAILABLE' });
  const app = await buildApp(config, { logger: false }); await app.ready();
  const userIds: string[] = [];
  t.after(async () => {
    const sellers = await app.db.seller.findMany({ where: { userId: { in: userIds } } });
    const ids = sellers.map(s => s.id);
    await app.db.order.deleteMany({ where: { sellerId: { in: ids } } });
    await app.db.product.deleteMany({ where: { sellerId: { in: ids } } });
    await app.db.asset.deleteMany({ where: { sellerId: { in: ids } } });
    await app.db.feePolicy.deleteMany({ where: { createdBy: { in: userIds } } });
    await app.db.seller.deleteMany({ where: { id: { in: ids } } });
    await app.db.user.deleteMany({ where: { id: { in: userIds } } });
    const jobs = await app.db.emailJob.findMany({ where: { status: 'pending' } });
    for (const job of jobs) {
      const mail = JSON.parse(decrypt(job.payloadEncrypted, config.encryptionKey));
      if ([adminEmail, buyerEmail, otherEmail].includes(mail.to)) await app.db.emailJob.delete({ where: { id: job.id } });
    }
    await app.close(); await new Promise<void>(resolve => scanner.close(() => resolve())); await rm(storageDir, { recursive: true, force: true });
  });
  const base = { origin: config.origin };
  const register = async (email: string) => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: base, payload: { name: 'Vendedor Teste', email, password: 'commerce-test-password', acceptTerms: true } });
    assert.equal(res.statusCode, 201, res.body);
    const user = await app.db.user.findUniqueOrThrow({ where: { email } }); userIds.push(user.id);
    await app.db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    return { ...base, cookie: res.cookies.map(c => `${c.name}=${c.value}`).join('; '), 'x-csrf-token': res.cookies.find(c => c.name === 'nostore_csrf')!.value };
  };
  const otherEmail = `${randomUUID()}@example.test`;
  const admin = await register(adminEmail), other = await register(otherEmail);
  const post = (url: string, payload: object, headers: Record<string, string> = base) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers, payload });
  const get = (url: string, headers: Record<string, string> = base) => app.inject({ method: 'GET', url: `/api/v1${url}`, headers });
  const upload = async (kind: string, filename: string, data: Buffer) => {
    const boundary = `boundary-${randomUUID()}`;
    return app.inject({ method: 'POST', url: `/api/v1/seller/assets/${kind}`, headers: { ...admin, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`), data, Buffer.from(`\r\n--${boundary}--\r\n`)]) });
  };
  const image = await upload('image', 'cover.png', await sharp({ create: { width: 2, height: 2, channels: 3, background: '#a9cbb7' } }).png().toBuffer());
  assert.equal(image.statusCode, 201, image.body);
  const digital = await upload('digital', 'guia.pdf', Buffer.from('%PDF-1.4\nprimeira versão\n%%EOF'));
  assert.equal(digital.statusCode, 201, digital.body);
  assert.equal(digital.json().status, 'approved');
  const infected = await upload('digital', 'infected.pdf', Buffer.from('%PDF-1.4 EICAR'));
  assert.equal(infected.statusCode, 422);
  const filePath = join(storageDir, 'scan-test'); await writeFile(filePath, 'test');
  await assert.rejects(scanFile(filePath, { ...config, clamavHost: undefined }), { code: 'SCANNER_UNAVAILABLE' });
  const draftInput = { name: 'Guia digital', description: 'Primeira edição do guia digital.', priceCents: 4990, type: 'digital', paymentMethods: ['pix', 'card'], imageAssetId: image.json().id, digitalAssetId: digital.json().id };
  const product = (await post('/seller/products', draftInput, admin)).json();
  assert.equal((await get(`/checkout/${product.publicId}`)).statusCode, 404);
  assert.equal((await post(`/seller/products/${product.id}/publish`, {}, admin)).statusCode, 200);
  const oldOffer = (await get(`/checkout/${product.publicId}`)).json();
  assert.equal((await post('/admin/fee', { basisPoints: 500, previousId: oldOffer.feePolicy.id }, other)).statusCode, 403);
  const fee = await post('/admin/fee', { basisPoints: 500, previousId: oldOffer.feePolicy.id }, admin);
  assert.equal(fee.statusCode, 201, fee.body);
  assert.equal((await post('/admin/fee', { basisPoints: 700, previousId: oldOffer.feePolicy.id }, admin)).statusCode, 409);
  let offer = (await get(`/checkout/${product.publicId}`)).json();
  assert.equal(offer.feeCents, 250); assert.equal(offer.totalCents, 5240);
  const checkoutToken = token();
  const input = { productId: product.publicId, productVersion: offer.version, feePolicyId: offer.feePolicy.id, checkoutToken, buyerName: 'Comprador Teste', buyerEmail, buyerDocument: '52998224725', method: 'pix', acceptSimulation: true };
  assert.equal((await post('/checkout/orders', { ...input, feePolicyId: oldOffer.feePolicy.id })).statusCode, 409);
  assert.equal((await post('/checkout/orders', { ...input, totalCents: 1 })).statusCode, 400);
  const purchases = await Promise.all([post('/checkout/orders', input), post('/checkout/orders', input)]);
  for (const r of purchases) assert.equal(r.statusCode, 201, r.body);
  const order = purchases[0]!.json().order;
  assert.equal(order.id, purchases[1]!.json().order.id);
  assert.equal((await post('/checkout/orders', { ...input, buyerName: 'Mudou' })).statusCode, 409);
  assert.equal((await get(`/seller/orders/${order.id}`, other)).statusCode, 404);
  assert.equal((await post(`/seller/orders/${order.id}/simulate`, { outcome: 'paid' })).statusCode, 401);
  assert.equal((await post(`/seller/orders/${order.id}/simulate`, { outcome: 'paid' }, other)).statusCode, 404);
  assert.equal((await post('/buyer/order', { token: token() })).statusCode, 401);
  assert.equal((await post('/buyer/download-ticket', { token: checkoutToken })).statusCode, 403);
  const approvals = await Promise.all([post(`/seller/orders/${order.id}/simulate`, { outcome: 'paid' }, admin), post(`/seller/orders/${order.id}/simulate`, { outcome: 'paid' }, admin)]);
  for (const r of approvals) assert.equal(r.statusCode, 200, r.body);
  const mails = (await app.db.emailJob.findMany({ where: { status: 'pending' } })).map(j => JSON.parse(decrypt(j.payloadEncrypted, config.encryptionKey))).filter(m => m.to === buyerEmail);
  assert.equal(mails.length, 3, 'pedido, pagamento e acesso: sem duplicatas na aprovação');
  assert.equal((await post('/buyer/order', { token: checkoutToken })).json().downloadable, true);
  const exchange = await post('/buyer/session', { token: checkoutToken });
  assert.equal(exchange.statusCode, 200);
  const buyerCookie = exchange.cookies.find(c => c.name === 'nostore_buyer')!;
  assert.equal(buyerCookie.httpOnly, true);
  assert.equal(buyerCookie.path, '/api/v1/buyer');
  assert.equal((await post('/buyer/order', {}, { ...base, cookie: `nostore_buyer=${buyerCookie.value}` })).json().id, order.id);
  const grant = await app.db.accessGrant.findUniqueOrThrow({ where: { tokenHash: hashToken(checkoutToken) } });
  assert.equal((await get('/seller/orders', admin)).json().paidCount, 1);
  const expiredTicket = (await post('/buyer/download-ticket', { token: checkoutToken })).json();
  await app.db.downloadTicket.updateMany({ where: { orderId: order.id }, data: { expiresAt: new Date(0) } });
  assert.equal((await app.inject({ method: 'GET', url: expiredTicket.url })).statusCode, 403);
  const ticket = (await post('/buyer/download-ticket', { token: checkoutToken })).json();
  const download = await app.inject({ method: 'GET', url: ticket.url });
  assert.equal(download.statusCode, 200, download.body); assert.ok(download.body.includes('primeira versão'));
  assert.ok(String(download.headers['content-disposition']).startsWith('attachment;'));
  assert.equal((await app.inject({ method: 'GET', url: ticket.url })).statusCode, 403);
  // Future product/fee edits never mutate acquired version or commercial snapshots.
  await post(`/seller/products/${product.id}/pause`, {}, admin);
  assert.equal((await get(`/checkout/${product.publicId}`)).statusCode, 404);
  const nextFile = (await upload('digital', 'v2.pdf', Buffer.from('%PDF-1.4\nsegunda versão'))).json();
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/v1/seller/products/${product.id}`, headers: admin, payload: { ...draftInput, digitalAssetId: nextFile.id, priceCents: 9900 } })).statusCode, 200);
  await post('/admin/fee', { basisPoints: 1000, previousId: fee.json().id }, admin);
  const oldDownload = (await post('/buyer/download-ticket', { token: checkoutToken })).json();
  assert.ok((await app.inject({ method: 'GET', url: oldDownload.url })).body.includes('primeira versão'));
  const stored = await app.db.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(stored.totalCents, 5240); assert.equal(stored.digitalAssetId, digital.json().id);
  assert.notEqual(stored.buyerDocumentEncrypted, '52998224725');
  const ticketBeforeRefund = (await post('/buyer/download-ticket', { token: checkoutToken })).json();
  assert.equal((await post(`/seller/orders/${order.id}/simulate`, { outcome: 'refunded' }, admin)).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: ticketBeforeRefund.url })).statusCode, 403);
  assert.equal((await post('/buyer/download-ticket', { token: checkoutToken })).statusCode, 403);
  assert.equal((await post(`/seller/orders/${order.id}/simulate`, { outcome: 'paid' }, admin)).statusCode, 409);
  assert.equal((await get('/seller/orders', admin)).json().paidCount, 0);
  await app.db.accessGrant.update({ where: { id: grant.id }, data: { expiresAt: new Date(0) } });
  assert.equal((await post('/buyer/order', { token: checkoutToken })).statusCode, 401);
  assert.equal((await post('/buyer/renew-access', { orderId: order.id, email: buyerEmail })).statusCode, 200);
  // Both methods use the adapter. Expired payments cannot be approved.
  await post(`/seller/products/${product.id}/publish`, {}, admin);
  offer = (await get(`/checkout/${product.publicId}`)).json();
  const card = (await post('/checkout/orders', { ...input, checkoutToken: token(), method: 'card', feePolicyId: offer.feePolicy.id, productVersion: offer.version })).json().order;
  assert.equal((await post(`/seller/orders/${card.id}/simulate`, { outcome: 'rejected' }, admin)).statusCode, 200);
  const expired = (await post('/checkout/orders', { ...input, checkoutToken: token(), feePolicyId: offer.feePolicy.id, productVersion: offer.version })).json().order;
  await app.db.order.update({ where: { id: expired.id }, data: { expiresAt: new Date(0) } });
  assert.equal((await post(`/seller/orders/${expired.id}/simulate`, { outcome: 'paid' }, admin)).statusCode, 409);
  const physicalProduct = (await post('/seller/products', { ...draftInput, name: 'Produto físico', type: 'physical', digitalAssetId: null, shippingDays: 3 }, admin)).json();
  await post(`/seller/products/${physicalProduct.id}/publish`, {}, admin);
  const physicalOffer = (await get(`/checkout/${physicalProduct.publicId}`)).json();
  const physicalInput = { ...input, productId: physicalProduct.publicId, productVersion: physicalOffer.version, feePolicyId: physicalOffer.feePolicy.id, checkoutToken: token() };
  assert.equal((await post('/checkout/orders', physicalInput)).statusCode, 400);
  const shippingAddress = { postalCode: '01001000', street: 'Praça da Sé', number: '10', district: 'Sé', city: 'São Paulo', state: 'SP' };
  const physicalResult = await post('/checkout/orders', { ...physicalInput, address: shippingAddress });
  assert.equal(physicalResult.statusCode, 201, physicalResult.body);
  const physicalOrder = physicalResult.json().order;
  assert.equal((await get(`/seller/orders/${physicalOrder.id}`, admin)).json().address.city, 'São Paulo');
  assert.equal((await post('/buyer/order', { token: physicalInput.checkoutToken })).json().address, undefined);
  await post(`/seller/orders/${physicalOrder.id}/simulate`, { outcome: 'paid' }, admin);
  assert.equal((await post('/buyer/download-ticket', { token: physicalInput.checkoutToken })).statusCode, 403);
  await post(`/seller/products/${physicalProduct.id}/pause`, {}, admin);
  // Concurrent publications respect the free plan's five active products.
  const extras = [];
  for (let i = 0; i < 5; i++) extras.push((await post('/seller/products', { ...draftInput, name: `Extra ${i}` }, admin)).json());
  const published = await Promise.all(extras.map(p => post(`/seller/products/${p.id}/publish`, {}, admin)));
  assert.equal(published.filter(p => p.statusCode === 200).length, 4);
  assert.equal(published.filter(p => p.json().code === 'PRODUCT_LIMIT').length, 1);
});
