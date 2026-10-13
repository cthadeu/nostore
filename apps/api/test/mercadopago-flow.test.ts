import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { buildApp } from '../src/build-app.ts';
import { getConfig } from '../src/lib/config.ts';
import { token } from '../src/lib/security.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;

// Fake Mercado Pago: just enough of OAuth, Payments and Refunds to drive the real routes end to end.
function fakeMercadoPago() {
  const payments = new Map<number, Record<string, unknown>>();
  let nextId = 1000;
  const calls: { method: string; path: string; body: unknown; auth?: string }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); const method = init?.method ?? 'GET'; const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname, body, auth: headers.authorization });
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    if (url.pathname === '/oauth/token') return json(200, { access_token: `seller-${body.grant_type}`, refresh_token: 'refresh-1', expires_in: 180 * 86400, user_id: 555, public_key: 'TEST-public-key', live_mode: false });
    if (url.pathname === '/v1/payments' && method === 'POST') {
      if (headers.authorization !== 'Bearer seller-authorization_code') return json(401, { message: 'invalid token' });
      const id = nextId++;
      const approved = body.token === 'tok-approved';
      const payment = { id, status: body.payment_method_id === 'pix' ? 'pending' : approved ? 'approved' : 'rejected', status_detail: body.payment_method_id === 'pix' ? 'pending_waiting_transfer' : approved ? 'accredited' : 'cc_rejected_other_reason', external_reference: body.external_reference, date_of_expiration: body.date_of_expiration, point_of_interaction: body.payment_method_id === 'pix' ? { transaction_data: { qr_code: `pix-${id}`, qr_code_base64: 'QUJD', ticket_url: `https://mp.test/ticket/${id}` } } : undefined };
      payments.set(id, payment); return json(201, payment);
    }
    const get = url.pathname.match(/^\/v1\/payments\/(\d+)$/);
    if (get && method === 'GET') { const p = payments.get(Number(get[1])); return p ? json(200, p) : json(404, { message: 'not found' }); }
    const refund = url.pathname.match(/^\/v1\/payments\/(\d+)\/refunds$/);
    if (refund && method === 'POST') { const p = payments.get(Number(refund[1])); if (!p) return json(404, {}); p.status = 'refunded'; return json(201, { id: 1, status: 'approved' }); }
    return json(404, { message: `unexpected ${method} ${url.pathname}` });
  };
  return { fetchImpl, payments, calls, pay(id: number) { const p = payments.get(id)!; p.status = 'approved'; p.status_detail = 'accredited'; } };
}

test('Mercado Pago: OAuth do vendedor, Pix via webhook, cartão aprovado e reembolso', { skip: !databaseUrl }, async t => {
  if (!new URL(databaseUrl!).pathname.endsWith('_test')) throw new Error('Use um banco com sufixo _test.');
  const storageDir = await mkdtemp(join(tmpdir(), 'nostore-mp-'));
  const mp = fakeMercadoPago();
  const webhookSecret = 'whsec-test';
  const config = { ...getConfig(), databaseUrl: databaseUrl!, storageDir, fileStorage: 'local' as const, fileScan: 'off' as const, paymentGateway: 'mercadopago' as const, mercadoPago: { clientId: 'app-1', clientSecret: 'secret', webhookSecret }, adminEmails: [] as string[] };
  const app = await buildApp(config, { logger: false, fetch: mp.fetchImpl, mercadoPagoApiBase: 'https://api.mp.test' });
  await app.ready();
  const sellerEmail = `${randomUUID()}@example.test`, buyerEmail = `${randomUUID()}@example.test`;
  const userIds: string[] = [];
  t.after(async () => {
    const sellers = await app.db.seller.findMany({ where: { userId: { in: userIds } } }); const ids = sellers.map(s => s.id);
    await app.db.order.deleteMany({ where: { sellerId: { in: ids } } }); await app.db.product.deleteMany({ where: { sellerId: { in: ids } } }); await app.db.asset.deleteMany({ where: { sellerId: { in: ids } } });
    await app.db.gatewayEvent.deleteMany({ where: { provider: 'mercadopago' } });
    await app.db.seller.deleteMany({ where: { id: { in: ids } } }); await app.db.user.deleteMany({ where: { id: { in: userIds } } });
    await app.db.emailJob.deleteMany({ where: { status: 'pending' } });
    await app.close(); await rm(storageDir, { recursive: true, force: true });
  });
  const base = { origin: config.origin };
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: base, payload: { name: 'Vendedor MP', email: sellerEmail, password: 'commerce-test-password', acceptTerms: true } });
  assert.equal(res.statusCode, 201, res.body);
  const user = await app.db.user.findUniqueOrThrow({ where: { email: sellerEmail } }); userIds.push(user.id);
  await app.db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
  const seller = { ...base, cookie: res.cookies.map(c => `${c.name}=${c.value}`).join('; '), 'x-csrf-token': res.cookies.find(c => c.name === 'nostore_csrf')!.value };
  const post = (url: string, payload: object, headers: Record<string, string> = base) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers, payload });
  const get = (url: string, headers: Record<string, string> = base) => app.inject({ method: 'GET', url: `/api/v1${url}`, headers });

  // Publishing requires the Mercado Pago account; the OAuth callback stores the seller credentials.
  const image = await (async () => { const boundary = `b-${randomUUID()}`; const data = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#a9cbb7' } }).png().toBuffer(); return app.inject({ method: 'POST', url: '/api/v1/seller/assets/image', headers: { ...seller, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="c.png"\r\nContent-Type: image/png\r\n\r\n`), data, Buffer.from(`\r\n--${boundary}--\r\n`)]) }); })();
  assert.equal(image.statusCode, 201, image.body);
  const product = (await post('/seller/products', { name: 'Camiseta', description: 'Produto físico vendido pelo Mercado Pago.', priceCents: 5000, type: 'physical', shippingDays: 3, paymentMethods: ['pix', 'card'], imageAssetId: image.json().id, digitalAssetIds: [] }, seller)).json();
  const blocked = await post(`/seller/products/${product.id}/publish`, {}, seller);
  assert.equal(blocked.statusCode, 409); assert.equal(blocked.json().code, 'GATEWAY_NOT_CONNECTED');
  const connect = await get('/seller/gateway/connect', seller);
  assert.equal(connect.statusCode, 200, connect.body);
  const authUrl = new URL(connect.json().url); const state = authUrl.searchParams.get('state')!;
  assert.equal(authUrl.searchParams.get('redirect_uri'), `${config.origin}/api/v1/seller/gateway/callback`);
  const bad = await get(`/seller/gateway/callback?code=abc&state=${'0'.repeat(64)}`);
  assert.equal(bad.statusCode, 302); assert.ok(bad.headers.location?.toString().includes('gateway=error'));
  const callback = await get(`/seller/gateway/callback?code=abc&state=${state}`);
  assert.equal(callback.statusCode, 302); assert.ok(callback.headers.location?.toString().includes('gateway=connected'), String(callback.headers.location));
  assert.equal((await get(`/seller/gateway/callback?code=abc&state=${state}`)).headers.location?.toString().includes('gateway=error'), true, 'state só vale uma vez');
  const profile = (await get('/seller/profile', seller)).json();
  assert.equal(profile.gatewayStatus, 'connected'); assert.equal(profile.gatewayAccount, '555');
  assert.equal((await post(`/seller/products/${product.id}/publish`, {}, seller)).statusCode, 200);

  // Pix: the order is created pending with the QR code; the signed webhook confirms the payment.
  const offer = (await get(`/checkout/${product.publicId}`)).json();
  assert.equal(offer.gateway, 'mercadopago'); assert.equal(offer.publicKey, 'TEST-public-key');
  const address = { postalCode: '01001000', street: 'Praça da Sé', number: '10', district: 'Sé', city: 'São Paulo', state: 'SP' };
  const pixToken = token();
  const input = { productId: product.publicId, productVersion: offer.version, feePolicyId: offer.feePolicy.id, buyerName: 'Comprador Pix', buyerEmail, buyerDocument: '52998224725', method: 'pix', address };
  const pixOrder = await post('/checkout/orders', { ...input, checkoutToken: pixToken });
  assert.equal(pixOrder.statusCode, 201, pixOrder.body);
  const created = pixOrder.json().order;
  assert.equal(created.status, 'pending'); assert.equal(created.pix.qrCode, 'pix-1000'); assert.equal(created.pix.qrCodeBase64, 'QUJD');
  const paymentCall = mp.calls.find(c => c.path === '/v1/payments' && c.method === 'POST')!;
  assert.equal((paymentCall.body as { application_fee?: number }).application_fee, offer.feeCents > 0 ? offer.feeCents / 100 : undefined, 'application_fee só vai quando há taxa'); assert.equal((paymentCall.body as { transaction_amount: number }).transaction_amount, offer.totalCents / 100);
  assert.equal((await post('/checkout/orders', { ...input, checkoutToken: pixToken })).json().order.id, created.id, 'retentativa não cria outro pagamento');
  assert.equal(mp.calls.filter(c => c.path === '/v1/payments' && c.method === 'POST').length, 1);
  const webhook = (dataId: string, secret = webhookSecret, requestId = randomUUID()) => {
    const ts = String(Math.floor(Date.now() / 1000));
    const v1 = createHmac('sha256', secret).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest('hex');
    return app.inject({ method: 'POST', url: `/api/v1/webhooks/mercadopago?data.id=${dataId}&type=payment`, headers: { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId, 'content-type': 'application/json' }, payload: { action: 'payment.updated', type: 'payment', data: { id: dataId } } });
  };
  assert.equal((await webhook('1000', 'wrong-secret')).statusCode, 401, 'assinatura inválida é rejeitada');
  assert.equal((await webhook('1000')).statusCode, 200);
  assert.equal((await post('/buyer/order', { token: pixToken })).json().status, 'pending', 'pagamento ainda pendente no provedor');
  mp.pay(1000);
  const requestId = randomUUID();
  assert.equal((await webhook('1000', webhookSecret, requestId)).statusCode, 200);
  const paid = (await post('/buyer/order', { token: pixToken })).json();
  assert.equal(paid.status, 'paid'); assert.equal(paid.pix, null);
  assert.equal((await webhook('1000', webhookSecret, requestId)).statusCode, 200, 'mesmo request id é idempotente');
  assert.equal((await webhook('999999')).statusCode, 200, 'pagamento desconhecido é ignorado');
  const events = await app.db.gatewayEvent.findMany({ where: { provider: 'mercadopago' } });
  assert.deepEqual(events.map(e => e.status).sort(), ['ignored', 'processed', 'processed']);

  // Card: approved synchronously (binary mode) or rejected with a clear error.
  const rejected = await post('/checkout/orders', { ...input, method: 'card', card: { token: 'tok-declined', paymentMethodId: 'master', issuerId: '24' }, checkoutToken: token(), buyerEmail });
  assert.equal(rejected.statusCode, 402, rejected.body); assert.equal(rejected.json().code, 'PAYMENT_REJECTED');
  const cardToken = token();
  const approved = await post('/checkout/orders', { ...input, method: 'card', card: { token: 'tok-approved', paymentMethodId: 'master' }, checkoutToken: cardToken });
  assert.equal(approved.statusCode, 201, approved.body); assert.equal(approved.json().order.status, 'paid'); assert.equal(approved.json().order.statusDetail, 'accredited');
  assert.equal((await post('/checkout/orders', { ...input, method: 'card', checkoutToken: token() })).statusCode, 400, 'cartão sem token é recusado');
  assert.equal((await post('/seller/orders/x/simulate', { outcome: 'paid' }, seller)).statusCode, 400, 'simulação não existe com gateway real');

  // Refund through the provider.
  const cardOrder = approved.json().order;
  const refund = await post(`/seller/orders/${cardOrder.id}/refund`, {}, seller);
  assert.equal(refund.statusCode, 200, refund.body); assert.equal(refund.json().status, 'refunded');
  assert.ok(mp.calls.some(c => c.path === '/v1/payments/1002/refunds' && c.method === 'POST'));
  assert.equal((await post(`/seller/orders/${cardOrder.id}/refund`, {}, seller)).statusCode, 409, 'não reembolsa duas vezes');
  const mails = await app.db.emailJob.count({ where: { status: 'pending' } });
  assert.ok(mails >= 4, 'pedido recebido, confirmações e reembolso enfileirados');
});
