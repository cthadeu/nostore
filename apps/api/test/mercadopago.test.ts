import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { MercadoPagoClient, isoWithOffset, mapPaymentStatus } from '../src/lib/mercadopago.ts';

const settings = { clientId: '123', clientSecret: 'secret', webhookSecret: 'whsec' };

test('mapeia estados do Mercado Pago para o pedido', () => {
  assert.equal(mapPaymentStatus('approved'), 'paid'); assert.equal(mapPaymentStatus('authorized'), 'paid');
  assert.equal(mapPaymentStatus('rejected'), 'rejected'); assert.equal(mapPaymentStatus('cancelled'), 'rejected');
  assert.equal(mapPaymentStatus('refunded'), 'refunded'); assert.equal(mapPaymentStatus('charged_back'), 'refunded');
  assert.equal(mapPaymentStatus('pending'), 'pending'); assert.equal(mapPaymentStatus('in_process'), 'pending');
});

test('formata expiração com deslocamento explícito', () => {
  assert.equal(isoWithOffset(new Date('2026-10-12T03:00:00.000Z')), '2026-10-12T00:00:00.000-03:00');
});

test('valida a assinatura do webhook conforme o manifesto do Mercado Pago', () => {
  const client = new MercadoPagoClient(settings);
  const ts = String(Math.floor(Date.now() / 1000)), requestId = 'req-abc', dataId = '123456789';
  const v1 = createHmac('sha256', 'whsec').update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest('hex');
  assert.equal(client.verifyWebhookSignature({ signature: `ts=${ts},v1=${v1}`, requestId, dataId }), true);
  assert.equal(client.verifyWebhookSignature({ signature: `ts=${ts},v1=${v1}`, requestId, dataId: '987' }), false, 'outro id');
  assert.equal(client.verifyWebhookSignature({ signature: `ts=${ts},v1=${'0'.repeat(64)}`, requestId, dataId }), false, 'hash errado');
  assert.equal(client.verifyWebhookSignature({ signature: `ts=1000,v1=${v1}`, requestId, dataId }), false, 'timestamp antigo');
  assert.equal(new MercadoPagoClient({ ...settings, webhookSecret: undefined }).verifyWebhookSignature({ signature: `ts=${ts},v1=${v1}`, requestId, dataId }), false, 'sem segredo configurado');
});

test('monta URL de autorização e requisições de pagamento com split', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchStub: typeof fetch = async (input, init) => { calls.push({ url: String(input), init: init ?? {} }); return new Response(JSON.stringify({ id: 42, status: 'pending', status_detail: 'pending_waiting_transfer', point_of_interaction: { transaction_data: { qr_code: 'pixcode', qr_code_base64: 'YmFzZTY0', ticket_url: 'https://mp/ticket' } } }), { status: 201, headers: { 'content-type': 'application/json' } }); };
  const client = new MercadoPagoClient(settings, fetchStub);
  const url = new URL(client.authorizationUrl('https://nostore.test/cb', 'state123'));
  assert.equal(url.origin + url.pathname, 'https://auth.mercadopago.com/authorization');
  assert.equal(url.searchParams.get('client_id'), '123'); assert.equal(url.searchParams.get('response_type'), 'code'); assert.equal(url.searchParams.get('platform_id'), 'mp'); assert.equal(url.searchParams.get('state'), 'state123'); assert.equal(url.searchParams.get('redirect_uri'), 'https://nostore.test/cb');
  const payment = await client.createPayment('seller-token', { amountCents: 5240, feeCents: 250, description: 'Guia', orderId: 'order-1', notificationUrl: 'https://nostore.test/api/v1/webhooks/mercadopago', expiresAt: new Date('2026-10-12T03:00:00.000Z'), payer: { email: 'c@example.test', name: 'Ana Maria Silva', document: '52998224725' }, method: 'pix' }, 'order-1');
  assert.equal(payment.id, 42); assert.equal(payment.point_of_interaction?.transaction_data?.qr_code, 'pixcode');
  const call = calls[0]!; const headers = call.init.headers as Record<string, string>; const body = JSON.parse(String(call.init.body));
  assert.equal(call.url, 'https://api.mercadopago.com/v1/payments'); assert.equal(headers.authorization, 'Bearer seller-token'); assert.equal(headers['x-idempotency-key'], 'order-1');
  assert.equal(body.transaction_amount, 52.4); assert.equal(body.application_fee, 2.5); assert.equal(body.payment_method_id, 'pix'); assert.equal(body.external_reference, 'order-1');
  assert.deepEqual(body.payer, { email: 'c@example.test', first_name: 'Ana', last_name: 'Maria Silva', identification: { type: 'CPF', number: '52998224725' } });
  assert.equal(body.date_of_expiration, '2026-10-12T00:00:00.000-03:00');
  await client.createPayment('seller-token', { amountCents: 1000, feeCents: 50, description: 'x', orderId: 'order-2', notificationUrl: 'n', expiresAt: new Date(), payer: { email: 'c@example.test', name: 'Solo', document: '12345678000195' }, method: 'card', card: { token: 'tok', paymentMethodId: 'master', issuerId: '24' } }, 'order-2');
  const cardBody = JSON.parse(String(calls[1]!.init.body));
  assert.equal(cardBody.token, 'tok');
  await client.createPayment('seller-token', { amountCents: 1000, feeCents: 0, description: 'x', orderId: 'order-3', notificationUrl: 'n', expiresAt: new Date(), payer: { email: 'c@example.test', name: 'Solo', document: '52998224725' }, method: 'pix' }, 'order-3');
  assert.equal('application_fee' in JSON.parse(String(calls[2]!.init.body)), false, 'taxa zero não envia application_fee'); assert.equal(cardBody.installments, 1); assert.equal(cardBody.binary_mode, true); assert.equal(cardBody.issuer_id, 24); assert.equal(cardBody.payer.identification.type, 'CNPJ'); assert.equal(cardBody.payer.last_name, 'Solo');
});

test('erros HTTP do Mercado Pago viram exceções com status', async () => {
  const client = new MercadoPagoClient(settings, async () => new Response('{"message":"invalid token"}', { status: 401 }));
  await assert.rejects(client.getPayment('bad', '1'), (error: Error & { status?: number }) => error.status === 401 && /401/.test(error.message));
});
