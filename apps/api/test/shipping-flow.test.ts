import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { buildApp } from '../src/build-app.ts';
import { getConfig } from '../src/lib/config.ts';
import { decrypt, token } from '../src/lib/security.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;

// Fake Melhor Envio: OAuth, quotes, cart, checkout, label generation, print, tracking and cancel.
function fakeMelhorEnvio() {
  const orders = new Map<string, { status: string; tracking?: string; posted_at?: string | null; delivered_at?: string | null }>();
  const calls: { method: string; path: string; body: unknown; auth?: string; ua?: string }[] = [];
  let failCartWithAgency = true;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); const method = init?.method ?? 'GET'; const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname, body, auth: headers.authorization, ua: headers['user-agent'] });
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    if (url.pathname === '/oauth/token') return json(200, { token_type: 'Bearer', expires_in: 2592000, access_token: `me-${body.grant_type}`, refresh_token: 'me-refresh' });
    if (headers.authorization !== 'Bearer me-authorization_code') return json(401, { message: 'Unauthenticated.' });
    if (url.pathname === '/api/v2/me/shipment/calculate') return json(200, [
      { id: 1, name: 'PAC', price: '20.00', delivery_time: 8, company: { id: 1, name: 'Correios' } },
      { id: 2, name: 'SEDEX', price: '35.50', delivery_time: 2, company: { id: 1, name: 'Correios' } },
      { id: 3, name: '.Package', price: '18.00', delivery_time: 5, company: { id: 2, name: 'Jadlog' } },
      { id: 4, name: 'Mini', error: 'Dimensões excedem o limite', company: { id: 1, name: 'Correios' } },
    ]);
    if (url.pathname === '/api/v2/me/cart' && method === 'POST') {
      if (body.service === 3 && failCartWithAgency && !body.agency) { failCartWithAgency = false; return json(422, { message: 'Os dados fornecidos são inválidos.', errors: { agency: ['O campo agency é obrigatório.'] } }); }
      const id = `cart-${orders.size + 1}-${randomUUID().slice(0, 8)}`; orders.set(id, { status: 'pending' }); return json(201, { id, protocol: `ORD-${orders.size}`, price: body.service === 3 ? '18.00' : '20.00' });
    }
    if (url.pathname === '/api/v2/me/shipment/agencies') return json(200, [{ id: 501, name: 'Agência Centro' }]);
    if (url.pathname === '/api/v2/me/shipment/checkout') { for (const id of body.orders) { const o = orders.get(id); if (o) o.status = 'released'; } return json(200, { purchase: { id: 'p1', protocol: 'PUR-1', total: '18.00', status: 'paid' } }); }
    if (url.pathname === '/api/v2/me/shipment/generate') { const out: Record<string, unknown> = {}; for (const id of body.orders) { const o = orders.get(id); if (o) { o.status = 'generated'; o.tracking = `ME${id.slice(-4).toUpperCase()}BR`; } out[id] = { status: true, message: 'Envio gerado com sucesso' }; } return json(200, out); }
    if (url.pathname === '/api/v2/me/shipment/print') return json(200, { url: `https://sandbox.melhorenvio.com.br/imprimir/${body.orders[0]}` });
    if (url.pathname === '/api/v2/me/shipment/tracking') { const out: Record<string, unknown> = {}; for (const id of body.orders) { const o = orders.get(id); if (o) out[id] = { id, protocol: 'ORD', status: o.status, tracking: o.tracking ?? null, melhorenvio_tracking: o.tracking ?? null, posted_at: o.posted_at ?? null, delivered_at: o.delivered_at ?? null }; } return json(200, out); }
    if (url.pathname === '/api/v2/me/shipment/cancel') { const o = orders.get(body.order.id); if (o) o.status = 'canceled'; return json(200, { [body.order.id]: { canceled: true } }); }
    return json(404, { message: `unexpected ${method} ${url.pathname}` });
  };
  return { fetchImpl, calls, orders, post(id: string) { const o = orders.get(id)!; o.status = 'posted'; o.posted_at = new Date().toISOString(); }, deliver(id: string) { const o = orders.get(id)!; o.status = 'delivered'; o.delivered_at = new Date().toISOString(); } };
}

test('Melhor Envio: conexão, origem, cotação no checkout, etiqueta, rastreio e postagem manual', { skip: !databaseUrl }, async t => {
  if (!new URL(databaseUrl!).pathname.endsWith('_test')) throw new Error('Use um banco com sufixo _test.');
  const storageDir = await mkdtemp(join(tmpdir(), 'nostore-ship-'));
  const me = fakeMelhorEnvio();
  const config = { ...getConfig(), databaseUrl: databaseUrl!, storageDir, fileStorage: 'local' as const, fileScan: 'off' as const, paymentGateway: 'simulated' as const, allowSimulatedPayments: true, production: false, melhorEnvio: { clientId: 'me-app', clientSecret: 'me-secret', env: 'sandbox' as const, userAgent: 'nostore (teste@nostore.test)' }, cronSecret: 'cron-secret', adminEmails: [] as string[] };
  const app = await buildApp(config, { logger: false, fetch: me.fetchImpl, melhorEnvioApiBase: 'https://me.test/api/v2' });
  await app.ready();
  const sellerEmail = `${randomUUID()}@example.test`, buyerEmail = `${randomUUID()}@example.test`;
  const userIds: string[] = [];
  t.after(async () => {
    const sellers = await app.db.seller.findMany({ where: { userId: { in: userIds } } }); const ids = sellers.map(s => s.id);
    await app.db.order.deleteMany({ where: { sellerId: { in: ids } } }); await app.db.product.deleteMany({ where: { sellerId: { in: ids } } }); await app.db.asset.deleteMany({ where: { sellerId: { in: ids } } });
    await app.db.seller.deleteMany({ where: { id: { in: ids } } }); await app.db.user.deleteMany({ where: { id: { in: userIds } } });
    await app.db.emailJob.deleteMany({ where: { status: 'pending' } });
    await app.close(); await rm(storageDir, { recursive: true, force: true });
  });
  const base = { origin: config.origin };
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: base, payload: { name: 'Vendedor Envio', email: sellerEmail, password: 'commerce-test-password', acceptTerms: true } });
  assert.equal(res.statusCode, 201, res.body);
  const user = await app.db.user.findUniqueOrThrow({ where: { email: sellerEmail } }); userIds.push(user.id);
  await app.db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
  const seller = { ...base, cookie: res.cookies.map(c => `${c.name}=${c.value}`).join('; '), 'x-csrf-token': res.cookies.find(c => c.name === 'nostore_csrf')!.value };
  const post = (url: string, payload: object, headers: Record<string, string> = base) => app.inject({ method: 'POST', url: `/api/v1${url}`, headers, payload });
  const put = (url: string, payload: object, headers: Record<string, string> = base) => app.inject({ method: 'PUT', url: `/api/v1${url}`, headers, payload });
  const get = (url: string, headers: Record<string, string> = base) => app.inject({ method: 'GET', url: `/api/v1${url}`, headers });
  await post('/seller/profile', {}, seller); // no-op warmup for CSRF path
  assert.equal((await app.inject({ method: 'PATCH', url: '/api/v1/seller/profile', headers: seller, payload: { displayName: 'Loja Envio', personType: 'individual', document: '52998224725' } })).statusCode, 200);

  // Product with parcel data and calculated freight: publishing is gated until everything is in place.
  const boundary = `b-${randomUUID()}`; const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#a9cbb7' } }).png().toBuffer();
  const image = await app.inject({ method: 'POST', url: '/api/v1/seller/assets/image', headers: { ...seller, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="c.png"\r\nContent-Type: image/png\r\n\r\n`), png, Buffer.from(`\r\n--${boundary}--\r\n`)]) });
  const input = { name: 'Caneca', description: 'Caneca de cerâmica enviada pelo Melhor Envio.', priceCents: 5000, type: 'physical', shippingDays: 2, shippingMode: 'melhorenvio', weightGrams: 400, widthCm: 12, heightCm: 10, lengthCm: 12, paymentMethods: ['pix'], imageAssetId: image.json().id, digitalAssetIds: [] };
  const product = (await post('/seller/products', input, seller)).json();
  assert.equal(product.shippingMode, 'melhorenvio'); assert.equal(product.weightGrams, 400);
  let publish = await post(`/seller/products/${product.id}/publish`, {}, seller);
  assert.equal(publish.json().code, 'SHIPPING_NOT_CONNECTED', publish.body);
  const connect = (await get('/seller/shipping/connect', seller)).json();
  const state = new URL(connect.url).searchParams.get('state')!;
  assert.ok(connect.url.startsWith('https://sandbox.melhorenvio.com.br/oauth/authorize?'));
  const callback = await get(`/seller/shipping/callback?code=abc&state=${state}`);
  assert.equal(callback.statusCode, 302); assert.ok(String(callback.headers.location).includes('shipping=connected'));
  assert.equal((await get('/seller/profile', seller)).json().shippingStatus, 'connected');
  publish = await post(`/seller/products/${product.id}/publish`, {}, seller);
  assert.equal(publish.json().code, 'ORIGIN_REQUIRED', publish.body);
  const origin = { phone: '(11) 98888-7777', address: { postalCode: '01001000', street: 'Praça da Sé', number: '1', district: 'Sé', city: 'São Paulo', state: 'SP' } };
  assert.equal((await put('/seller/shipping/origin', origin, seller)).statusCode, 200);
  assert.deepEqual((await get('/seller/shipping/origin', seller)).json().address, origin.address);
  assert.equal((await post(`/seller/products/${product.id}/publish`, {}, seller)).statusCode, 200);
  const incomplete = (await post('/seller/products', { ...input, name: 'Sem medidas', weightGrams: null }, seller)).json();
  assert.equal((await post(`/seller/products/${incomplete.id}/publish`, {}, seller)).json().code, 'PARCEL_REQUIRED');

  // Checkout: quotes by postal code, freight added to the total, chosen service snapshotted on the order.
  const offer = (await get(`/checkout/${product.publicId}`)).json();
  assert.equal(offer.shippingMode, 'melhorenvio');
  assert.equal((await post(`/checkout/${product.publicId}/shipping-quotes`, { postalCode: '123' })).statusCode, 400);
  const quotes = (await post(`/checkout/${product.publicId}/shipping-quotes`, { postalCode: '20010-000' })).json().quotes;
  assert.deepEqual(quotes.map((q: { serviceId: number }) => q.serviceId), [3, 1, 2], 'ordenado por preço, serviço com erro descartado');
  assert.equal(me.calls.filter(c => c.path.endsWith('/calculate')).length, 1);
  await post(`/checkout/${product.publicId}/shipping-quotes`, { postalCode: '20010000' });
  assert.equal(me.calls.filter(c => c.path.endsWith('/calculate')).length, 1, 'cotação em cache');
  const address = { postalCode: '20010000', street: 'Rua da Assembleia', number: '10', district: 'Centro', city: 'Rio de Janeiro', state: 'RJ' };
  const checkoutToken = token();
  const common = { productId: product.publicId, productVersion: offer.version, feePolicyId: offer.feePolicy.id, buyerName: 'Comprador Caneca', buyerEmail, buyerDocument: '52998224725', method: 'pix', address, acceptSimulation: true };
  assert.equal((await post('/checkout/orders', { ...common, checkoutToken })).json().code, 'SHIPPING_REQUIRED');
  assert.equal((await post('/checkout/orders', { ...common, checkoutToken, shippingServiceId: 99 })).json().code, 'SHIPPING_UNAVAILABLE');
  const created = await post('/checkout/orders', { ...common, checkoutToken, shippingServiceId: 3 });
  assert.equal(created.statusCode, 201, created.body);
  const order = created.json().order;
  assert.equal(order.shippingCents, 1800); assert.equal(order.totalCents, offer.totalCents + 1800); assert.deepEqual(order.shipping, { serviceId: 3, service: '.Package', carrier: 'Jadlog', deliveryDays: 5 });
  assert.equal(order.shipment, null);
  assert.equal((await post(`/seller/orders/${order.id}/shipment/buy`, {}, seller)).json().code, 'SHIPMENT_INVALID', 'sem pagamento não há etiqueta');
  assert.equal((await post(`/seller/orders/${order.id}/simulate`, { outcome: 'paid' }, seller)).statusCode, 200);
  const paid = (await get(`/seller/orders/${order.id}`, seller)).json();
  assert.equal(paid.shipment.status, 'pending'); assert.equal(paid.shipment.mode, 'melhorenvio');
  const confirmation = (await app.db.emailJob.findMany({ where: { status: 'pending' } })).map(j => JSON.parse(decrypt(j.payloadEncrypted, config.encryptionKey))).find(m => m.to === buyerEmail && m.subject.includes('Pagamento confirmado'));
  assert.ok(confirmation && confirmation.text.includes('Jadlog · .Package'), 'e-mail de confirmação informa a transportadora');

  // Label: the first cart attempt fails asking for an agency; the retry with an agency succeeds.
  const bought = await post(`/seller/orders/${order.id}/shipment/buy`, {}, seller);
  assert.equal(bought.statusCode, 200, bought.body);
  assert.equal(bought.json().status, 'generated'); assert.ok(bought.json().labelUrl.includes('/imprimir/')); assert.match(bought.json().trackingCode, /^ME.*BR$/);
  assert.ok(me.calls.some(c => c.path.endsWith('/agencies')), 'agência consultada');
  const cartCalls = me.calls.filter(c => c.path === '/api/v2/me/cart');
  assert.equal(cartCalls.length, 2); assert.equal((cartCalls[1]!.body as { agency: number }).agency, 501);
  const cartBody = cartCalls[1]!.body as { from: { name: string; phone: string; document: string }; to: { name: string; postal_code: string; document: string }; products: { unitary_value: string }[] };
  assert.equal(cartBody.from.name, 'Loja Envio'); assert.equal(cartBody.from.phone, '11988887777'); assert.equal(cartBody.to.postal_code, '20010000'); assert.equal(cartBody.to.name, 'Comprador Caneca'); assert.equal(cartBody.products[0]!.unitary_value, '50.00');
  assert.equal(me.calls.every(c => !c.path.startsWith('/api/v2') || c.ua === config.melhorEnvio.userAgent), true, 'User-Agent em todas as chamadas');
  assert.equal((await post(`/seller/orders/${order.id}/shipment/buy`, {}, seller)).json().status, 'generated', 'comprar de novo é idempotente');
  assert.equal(me.calls.filter(c => c.path.endsWith('/checkout')).length, 1);
  const printed = await post(`/seller/orders/${order.id}/shipment/print`, {}, seller);
  assert.ok(printed.json().url.includes('/imprimir/'));

  // Tracking: when the carrier reports the posting, the buyer is told once.
  const meOrderId = (await app.db.shipment.findUniqueOrThrow({ where: { orderId: order.id } })).meOrderId!;
  const before = await app.db.emailJob.count({ where: { status: 'pending' } });
  assert.equal((await get(`/seller/orders/${order.id}/shipment`, seller)).json().status, 'generated');
  assert.equal(await app.db.emailJob.count({ where: { status: 'pending' } }), before, 'nada postado, nenhum e-mail');
  me.post(meOrderId);
  const synced = (await get(`/seller/orders/${order.id}/shipment`, seller)).json();
  assert.equal(synced.status, 'posted'); assert.ok(synced.postedAt);
  const shippedMails = (await app.db.emailJob.findMany({ where: { status: 'pending' } })).map(j => JSON.parse(decrypt(j.payloadEncrypted, config.encryptionKey))).filter(m => m.to === buyerEmail && m.subject.includes('enviado'));
  assert.equal(shippedMails.length, 1); assert.ok(shippedMails[0].text.includes('melhorrastreio.com.br'));
  await get(`/seller/orders/${order.id}/shipment`, seller);
  assert.equal((await app.db.emailJob.findMany({ where: { status: 'pending' } })).map(j => JSON.parse(decrypt(j.payloadEncrypted, config.encryptionKey))).filter(m => m.to === buyerEmail && m.subject.includes('enviado')).length, 1, 'e-mail de envio não repete');
  assert.equal((await post(`/seller/orders/${order.id}/shipment/cancel`, {}, seller)).json().code, 'SHIPMENT_INVALID', 'postado não cancela');
  const buyerView = (await post('/buyer/order', { token: checkoutToken })).json();
  assert.equal(buyerView.shipment.status, 'posted'); assert.equal(buyerView.shipment.trackingCode, synced.trackingCode); assert.equal(buyerView.shippingCents, 1800);
  me.deliver(meOrderId);
  assert.equal((await get(`/seller/orders/${order.id}/shipment`, seller)).json().status, 'delivered');

  // Cron sync: protected by the secret.
  assert.equal((await get('/internal/shipments/sync')).statusCode, 401);
  assert.equal((await get('/internal/shipments/sync', { authorization: 'Bearer cron-secret' })).statusCode, 200);

  // Manual shipping: product without calculated freight, posting requires a tracking code.
  const manual = (await post('/seller/products', { ...input, name: 'Caneca manual', shippingMode: 'manual', weightGrams: null, widthCm: null, heightCm: null, lengthCm: null }, seller)).json();
  assert.equal((await post(`/seller/products/${manual.id}/publish`, {}, seller)).statusCode, 200);
  const manualOffer = (await get(`/checkout/${manual.publicId}`)).json();
  assert.equal(manualOffer.shippingMode, 'manual');
  assert.equal((await post(`/checkout/${manual.publicId}/shipping-quotes`, { postalCode: '20010000' })).statusCode, 404);
  const manualToken = token();
  const manualOrder = (await post('/checkout/orders', { ...common, productId: manual.publicId, productVersion: manualOffer.version, feePolicyId: manualOffer.feePolicy.id, checkoutToken: manualToken })).json().order;
  assert.equal(manualOrder.shippingCents, 0); assert.equal(manualOrder.totalCents, manualOffer.totalCents);
  await post(`/seller/orders/${manualOrder.id}/simulate`, { outcome: 'paid' }, seller);
  assert.equal((await post(`/seller/orders/${manualOrder.id}/shipment/buy`, {}, seller)).json().code, 'SHIPMENT_INVALID');
  assert.equal((await post(`/seller/orders/${manualOrder.id}/shipment/posted`, { carrier: 'Correios' }, seller)).json().code, 'TRACKING_REQUIRED');
  const posted = (await post(`/seller/orders/${manualOrder.id}/shipment/posted`, { carrier: 'Correios', trackingCode: 'AA123456789BR' }, seller)).json();
  assert.equal(posted.status, 'posted'); assert.match(posted.trackingUrl, /correios/);
  assert.equal((await post('/buyer/order', { token: manualToken })).json().shipment.trackingCode, 'AA123456789BR');
});
