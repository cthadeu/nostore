import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { AppError } from '../lib/domain.ts';
import { encrypt, hashToken, token } from '../lib/security.ts';
import { meTokenFields, sellerOrigin } from '../lib/me-account.ts';
import { buyLabel, cancelLabel, markPosted, printLabel, quoteShipping, sellerForShippingInclude, shipmentView, shipsWithMelhorEnvio, syncShipment } from '../lib/shipping.ts';
import { Address } from '../lib/commerce-schemas.ts';
import { IdParams, MessageResponse } from '../lib/schemas.ts';

const QuoteView = Type.Object({ serviceId: Type.Integer(), name: Type.String(), carrier: Type.String(), priceCents: Type.Integer(), deliveryDays: Type.Integer() });
const ShipmentResponse = Type.Object({ mode: Type.String(), status: Type.String(), carrier: Type.Union([Type.String(), Type.Null()]), service: Type.Union([Type.String(), Type.Null()]), trackingCode: Type.Union([Type.String(), Type.Null()]), trackingUrl: Type.Union([Type.String(), Type.Null()]), labelUrl: Type.Union([Type.String(), Type.Null()]), postedAt: Type.Union([Type.String(), Type.Null()]), deliveredAt: Type.Union([Type.String(), Type.Null()]), error: Type.Union([Type.String(), Type.Null()]) });
const OriginResponse = Type.Object({ shippingStatus: Type.String(), phone: Type.Union([Type.String(), Type.Null()]), address: Type.Union([Address, Type.Null()]) });

export async function shippingRoutes(server: FastifyInstance) {
  const app = server.withTypeProvider<TypeBoxTypeProvider>();
  const redirectUri = `${app.config.origin}/api/v1/seller/shipping/callback`;
  const settingsUrl = (result: string) => `${app.config.origin}/configuracoes?shipping=${result}#envio`;
  const unavailable = () => new AppError('SHIPPING_UNAVAILABLE', 'A integração com o Melhor Envio não está habilitada neste ambiente.', 409);

  // Public: freight options for a product and destination postal code.
  app.post('/checkout/:id/shipping-quotes', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } }, schema: { params: IdParams, body: Type.Object({ postalCode: Type.String({ minLength: 8, maxLength: 9 }) }, { additionalProperties: false }), response: { 200: Type.Object({ quotes: Type.Array(QuoteView) }) } } }, async request => {
    const product = await app.db.product.findFirst({ where: { publicId: request.params.id, status: 'active', seller: { moderationStatus: 'active' } }, include: { seller: { include: sellerForShippingInclude } } });
    if (!product || !shipsWithMelhorEnvio(product)) throw new AppError('NOT_FOUND', 'Este produto não calcula frete.', 404);
    if (!app.me) throw unavailable();
    const quotes = await quoteShipping(app, product, product.seller, request.body.postalCode);
    return { quotes: quotes.map(q => ({ serviceId: q.serviceId, name: q.name, carrier: q.carrier, priceCents: q.priceCents, deliveryDays: q.deliveryDays })) };
  });

  // OAuth callback reached by a browser redirect; authenticated by the one-time state token.
  app.get('/seller/shipping/callback', { schema: { querystring: Type.Object({ code: Type.Optional(Type.String()), state: Type.Optional(Type.String()), error: Type.Optional(Type.String()) }) } }, async (request, reply) => {
    const { code, state, error } = request.query;
    if (!app.me || error || !code || !state || !/^[a-f0-9]{64}$/.test(state)) return reply.redirect(settingsUrl(error ? 'denied' : 'error'));
    const claimed = await app.db.$transaction(async tx => {
      const found = await tx.authToken.findUnique({ where: { tokenHash: hashToken(state) } });
      if (!found || found.kind !== 'me_oauth' || found.expiresAt <= new Date()) return null;
      const used = await tx.authToken.updateMany({ where: { id: found.id, usedAt: null }, data: { usedAt: new Date() } });
      return used.count ? found : null;
    });
    if (!claimed) return reply.redirect(settingsUrl('error'));
    try {
      const tokens = await app.me.exchangeCode(code, redirectUri);
      await app.db.seller.update({ where: { userId: claimed.userId }, data: meTokenFields(tokens, app.config.encryptionKey) });
    } catch (err) { request.log.error({ err, userId: claimed.userId }, 'Melhor Envio OAuth exchange failed'); return reply.redirect(settingsUrl('error')); }
    return reply.redirect(settingsUrl('connected'));
  });

  // Scheduled: refresh tracking for shipments in flight (Vercel cron sends Authorization: Bearer CRON_SECRET).
  app.get('/internal/shipments/sync', async (request, reply) => {
    if (!app.config.cronSecret || request.headers.authorization !== `Bearer ${app.config.cronSecret}`) return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'Não autorizado.' });
    const stale = new Date(Date.now() - 6 * 3600_000);
    const shipments = await app.db.shipment.findMany({ where: { mode: 'melhorenvio', status: { in: ['purchased', 'generated', 'posted'] }, OR: [{ lastSyncAt: null }, { lastSyncAt: { lt: stale } }] }, include: { order: { include: { seller: { include: sellerForShippingInclude } } } }, take: 50, orderBy: { lastSyncAt: 'asc' } });
    let synced = 0;
    for (const shipment of shipments) { try { await syncShipment(app, shipment, shipment.order, shipment.order.seller); synced++; } catch (err) { request.log.warn({ err, shipmentId: shipment.id }, 'shipment sync failed'); } }
    return { synced, total: shipments.length };
  });

  await app.register(async scoped => {
    const seller = scoped.withTypeProvider<TypeBoxTypeProvider>();
    seller.addHook('onRequest', app.authenticate);
    seller.get('/seller/shipping/connect', { schema: { response: { 200: Type.Object({ url: Type.String() }) } } }, async request => {
      if (!app.me) throw unavailable();
      const state = token();
      await app.db.authToken.create({ data: { tokenHash: hashToken(state), userId: request.identity!.userId, kind: 'me_oauth', expiresAt: new Date(Date.now() + 15 * 60_000) } });
      return { url: app.me.authorizationUrl(redirectUri, state) };
    });
    seller.post('/seller/shipping/disconnect', { schema: { response: { 200: MessageResponse } } }, async request => {
      await app.db.seller.update({ where: { id: request.identity!.sellerId }, data: { shippingStatus: 'not_connected', meUserId: null, meAccessTokenEncrypted: null, meRefreshTokenEncrypted: null, meTokenExpiresAt: null, meConnectedAt: null } });
      return { message: 'Conta Melhor Envio desconectada. Produtos físicos com frete calculado deixam de aceitar novas compras até reconectar.' };
    });
    seller.get('/seller/shipping/origin', { schema: { response: { 200: OriginResponse } } }, async request => {
      const s = await app.db.seller.findUniqueOrThrow({ where: { id: request.identity!.sellerId } });
      return { shippingStatus: s.shippingStatus, phone: s.originPhone, address: sellerOrigin(s, app.config.encryptionKey) };
    });
    seller.put('/seller/shipping/origin', { schema: { body: Type.Object({ phone: Type.String({ minLength: 10, maxLength: 20 }), address: Address }, { additionalProperties: false }), response: { 200: MessageResponse } } }, async request => {
      const phone = request.body.phone.replace(/\D/g, '');
      if (phone.length < 10 || phone.length > 11) throw new AppError('PHONE_INVALID', 'Informe um telefone com DDD.');
      await app.db.seller.update({ where: { id: request.identity!.sellerId }, data: { originPhone: phone, originAddressEncrypted: encrypt(JSON.stringify(request.body.address), app.config.encryptionKey) } });
      return { message: 'Endereço de origem salvo.' };
    });

    const loadOrder = async (orderId: string, sellerId: string) => {
      const order = await app.db.order.findFirst({ where: { id: orderId, sellerId }, include: { seller: { include: sellerForShippingInclude }, product: true, shipment: true } });
      if (!order) throw new AppError('NOT_FOUND', 'Pedido não encontrado.', 404);
      return order;
    };
    seller.get('/seller/orders/:id/shipment', { schema: { params: IdParams, response: { 200: Type.Union([ShipmentResponse, Type.Null()]) } } }, async request => {
      const order = await loadOrder(request.params.id, request.identity!.sellerId);
      if (!order.shipment) return null;
      return shipmentView(order.shipment.mode === 'melhorenvio' ? await syncShipment(app, order.shipment, order, order.seller) : order.shipment);
    });
    seller.post('/seller/orders/:id/shipment/buy', { schema: { params: IdParams, response: { 200: ShipmentResponse } } }, async request => {
      const order = await loadOrder(request.params.id, request.identity!.sellerId);
      return shipmentView(await buyLabel(app, order))!;
    });
    seller.post('/seller/orders/:id/shipment/print', { schema: { params: IdParams, response: { 200: Type.Object({ url: Type.String() }) } } }, async request => {
      const order = await loadOrder(request.params.id, request.identity!.sellerId);
      if (!order.shipment) throw new AppError('NOT_FOUND', 'Etiqueta não encontrada.', 404);
      return { url: await printLabel(app, order.shipment, order.seller) };
    });
    seller.post('/seller/orders/:id/shipment/posted', { schema: { params: IdParams, body: Type.Object({ carrier: Type.Optional(Type.String({ maxLength: 60 })), trackingCode: Type.Optional(Type.String({ maxLength: 60 })) }, { additionalProperties: false }), response: { 200: ShipmentResponse } } }, async request => {
      const order = await loadOrder(request.params.id, request.identity!.sellerId);
      return shipmentView(await markPosted(app, order, order.shipment, request.body))!;
    });
    seller.post('/seller/orders/:id/shipment/cancel', { schema: { params: IdParams, body: Type.Object({ reason: Type.Optional(Type.String({ maxLength: 250 })) }, { additionalProperties: false }), response: { 200: ShipmentResponse } } }, async request => {
      const order = await loadOrder(request.params.id, request.identity!.sellerId);
      if (!order.shipment) throw new AppError('NOT_FOUND', 'Etiqueta não encontrada.', 404);
      return shipmentView(await cancelLabel(app, order.shipment, order.seller, request.body.reason ?? ''))!;
    });
  });
}
