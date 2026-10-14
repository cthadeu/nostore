import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MelhorEnvioClient, mapTrackingStatus, meErrorMessage, MeError } from '../src/lib/melhorenvio.ts';
import { trackingUrl } from '../src/lib/shipping.ts';

const settings = { clientId: '77', clientSecret: 'secret', env: 'sandbox' as const, userAgent: 'nostore (contato@nostore.com.br)' };

test('mapeia estados de rastreio do Melhor Envio', () => {
  assert.equal(mapTrackingStatus('released'), 'purchased'); assert.equal(mapTrackingStatus('generated'), 'generated');
  assert.equal(mapTrackingStatus('posted'), 'posted'); assert.equal(mapTrackingStatus('delivered'), 'delivered');
  assert.equal(mapTrackingStatus('canceled'), 'canceled'); assert.equal(mapTrackingStatus('undelivered'), 'failed'); assert.equal(mapTrackingStatus('whatever'), null);
});

test('monta links de rastreio por transportadora', () => {
  assert.match(trackingUrl('Correios', 'AA123456789BR')!, /rastreamento\.correios\.com\.br.*AA123456789BR/);
  assert.match(trackingUrl('Jadlog', '123')!, /jadlog\.com\.br/);
  assert.match(trackingUrl('Qualquer', 'x', 'ME1')!, /melhorrastreio\.com\.br\/rastreio\/ME1/);
  assert.equal(trackingUrl('Outra', 'x'), null); assert.equal(trackingUrl('Correios', null), null);
});

test('URL de autorização, cotação e carrinho usam os campos da API', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchStub: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    const url = String(input);
    if (url.endsWith('/me/shipment/calculate')) return new Response(JSON.stringify([
      { id: 1, name: 'PAC', price: '21.50', custom_price: '19.90', delivery_time: 8, custom_delivery_time: 7, company: { id: 1, name: 'Correios' } },
      { id: 2, name: 'SEDEX', price: '35.10', delivery_time: 3, company: { id: 1, name: 'Correios' } },
      { id: 3, name: '.Package', error: 'Peso excede o limite', company: { id: 2, name: 'Jadlog' } },
    ]), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/me/cart')) return new Response(JSON.stringify({ id: 'cart-uuid', protocol: 'ORD-1', price: '19.90' }), { status: 201 });
    return new Response('{}', { status: 200 });
  };
  const client = new MelhorEnvioClient(settings, fetchStub);
  const auth = new URL(client.authorizationUrl('https://nostore.test/cb', 'st'));
  assert.equal(auth.origin + auth.pathname, 'https://sandbox.melhorenvio.com.br/oauth/authorize');
  assert.equal(auth.searchParams.get('client_id'), '77'); assert.equal(auth.searchParams.get('response_type'), 'code'); assert.ok(auth.searchParams.get('scope')!.includes('shipping-calculate'));
  const quotes = await client.calculate('tok', { fromPostalCode: '01001-000', toPostalCode: '20010000', productId: 'p1', parcel: { widthCm: 20, heightCm: 10, lengthCm: 30, weightGrams: 1500, insuranceCents: 5000 } });
  assert.deepEqual(quotes.map(q => [q.serviceId, q.priceCents, q.deliveryDays, q.carrier]), [[1, 1990, 7, 'Correios'], [2, 3510, 3, 'Correios']], 'serviço com erro é descartado; custom_price prevalece');
  const calc = calls.find(c => c.url.endsWith('/me/shipment/calculate'))!; const body = JSON.parse(String(calc.init.body)); const headers = calc.init.headers as Record<string, string>;
  assert.equal(body.from.postal_code, '01001000'); assert.deepEqual(body.products[0], { id: 'p1', width: 20, height: 10, length: 30, weight: 1.5, insurance_value: 50, quantity: 1 });
  assert.equal(headers['user-agent'], settings.userAgent); assert.equal(headers.authorization, 'Bearer tok');
  const party = { name: 'Loja', phone: '(11) 99999-9999', email: 'l@x.test', document: '52998224725', address: 'Rua A', number: '10', district: 'Centro', city: 'São Paulo', state: 'SP', postalCode: '01001-000' };
  const cart = await client.insertCart('tok', { serviceId: 1, from: party, to: { ...party, name: 'Comprador', document: '12345678000195' }, product: { name: 'Camiseta', priceCents: 5000 }, parcel: { widthCm: 20, heightCm: 10, lengthCm: 30, weightGrams: 1500, insuranceCents: 5000 } });
  assert.equal(cart.id, 'cart-uuid');
  const cartBody = JSON.parse(String(calls.find(c => c.url.endsWith('/me/cart'))!.init.body));
  assert.equal(cartBody.service, 1); assert.equal(cartBody.from.phone, '11999999999'); assert.equal(cartBody.from.document, '52998224725'); assert.equal(cartBody.to.company_document, '12345678000195'); assert.equal(cartBody.to.document, undefined);
  assert.deepEqual(cartBody.products, [{ name: 'Camiseta', quantity: 1, unitary_value: '50.00' }]); assert.deepEqual(cartBody.volumes, [{ height: 10, width: 20, length: 30, weight: 1.5 }]);
  assert.equal(cartBody.options.insurance_value, '50.00'); assert.equal(cartBody.options.non_commercial, true);
});

test('erros de validação viram mensagens legíveis', () => {
  const error = new MeError('Melhor Envio POST /me/cart -> 422', 422, { message: 'Os dados fornecidos são inválidos.', errors: { 'to.postal_code': ['CEP inválido.'] } });
  assert.equal(meErrorMessage(error), 'Os dados fornecidos são inválidos. CEP inválido.');
});
