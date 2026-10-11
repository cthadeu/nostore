import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { applyPaymentStatus } from '../lib/payments.ts';
import { mapPaymentStatus } from '../lib/mercadopago.ts';
import { sellerAccessToken } from '../lib/mp-account.ts';

// Mercado Pago notifications: signature-checked, stored once per request id, then the payment is
// re-read from the API (never trusted from the notification body) and the order state follows it.
export async function webhookRoutes(server: FastifyInstance) {
  const app = server.withTypeProvider<TypeBoxTypeProvider>();
  app.post('/mercadopago', { config: { rateLimit: { max: 600, timeWindow: '1 minute' } }, schema: { querystring: Type.Object({ 'data.id': Type.Optional(Type.String()), type: Type.Optional(Type.String()), topic: Type.Optional(Type.String()), id: Type.Optional(Type.String()) }) } }, async (request, reply) => {
    if (!app.mp) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Webhook inativo.' });
    const body = (request.body ?? {}) as { action?: string; type?: string; data?: { id?: string | number } };
    const dataId = request.query['data.id'] ?? (body.data?.id !== undefined ? String(body.data.id) : request.query.id);
    const requestId = String(request.headers['x-request-id'] ?? '');
    if (!app.mp.verifyWebhookSignature({ signature: String(request.headers['x-signature'] ?? ''), requestId, dataId })) {
      request.log.warn({ requestId }, 'Mercado Pago webhook rejected: invalid signature');
      return reply.code(401).send({ code: 'SIGNATURE_INVALID', message: 'Assinatura inválida.' });
    }
    const topic = body.type ?? request.query.type ?? request.query.topic ?? 'unknown';
    const event = await app.db.gatewayEvent.upsert({ where: { provider_requestId: { provider: 'mercadopago', requestId } }, update: {}, create: { provider: 'mercadopago', requestId, topic, action: body.action ?? null, resourceId: dataId ?? null, payload: JSON.stringify({ query: request.query, body }).slice(0, 10_000) } });
    if (event.status === 'processed') return { received: true };
    if (topic !== 'payment' || !dataId) { await app.db.gatewayEvent.update({ where: { id: event.id }, data: { status: 'ignored', processedAt: new Date() } }); return { received: true }; }
    try {
      const attempt = await app.db.paymentAttempt.findUnique({ where: { providerPaymentId: dataId }, include: { order: { include: { seller: true } } } });
      if (!attempt) { await app.db.gatewayEvent.update({ where: { id: event.id }, data: { status: 'ignored', error: 'payment not found', processedAt: new Date() } }); return { received: true }; }
      const payment = await app.mp.getPayment(await sellerAccessToken(app, attempt.order.seller), dataId);
      if (String(payment.id) !== dataId || (payment.external_reference && payment.external_reference !== attempt.orderId)) throw new Error('payment does not match order');
      await app.db.$transaction(tx => applyPaymentStatus(app, tx, attempt.orderId, mapPaymentStatus(payment.status), payment.status_detail ?? null));
      await app.db.gatewayEvent.update({ where: { id: event.id }, data: { status: 'processed', processedAt: new Date() } });
      return { received: true };
    } catch (error) {
      request.log.error({ err: error, requestId, dataId }, 'Mercado Pago webhook processing failed');
      await app.db.gatewayEvent.update({ where: { id: event.id }, data: { status: 'failed', error: error instanceof Error ? error.message.slice(0, 500) : String(error) } });
      return reply.code(500).send({ code: 'WEBHOOK_FAILED', message: 'Falha ao processar. O Mercado Pago tentará novamente.' });
    }
  });
}
