import type { FastifyInstance } from 'fastify';
import type { Prisma, Order, Product, Seller, Shipment } from '../generated/prisma/client.ts';
import { AppError } from './domain.ts';
import { decrypt, token } from './security.ts';
import { issueAccess, queueMail } from './commerce.ts';
import { sellerOrigin, sellerShippingToken, type OriginAddress } from './me-account.ts';
import { assertShippingError, mapTrackingStatus, mentionsAgency, meErrorMessage, type MeParcel, type MeParty, type MeQuote } from './melhorenvio.ts';

// Shipping for physical products: quotes at checkout, labels bought with the seller's Melhor Envio
// wallet after payment, tracking sync and the buyer's "shipped" e-mail. Manual postings share the
// same Shipment record with a carrier and tracking code typed by the seller.
export type ShipmentView = { mode: string; status: string; carrier: string | null; service: string | null; trackingCode: string | null; trackingUrl: string | null; labelUrl: string | null; postedAt: string | null; deliveredAt: string | null; error: string | null };
type SellerForShipping = Pick<Seller, 'id' | 'displayName' | 'documentEncrypted' | 'originPhone' | 'originAddressEncrypted' | 'meAccessTokenEncrypted' | 'meRefreshTokenEncrypted' | 'meTokenExpiresAt' | 'shippingStatus'> & { user: { email: string; name: string } };
type ProductParcel = Pick<Product, 'id' | 'type' | 'shippingMode' | 'weightGrams' | 'widthCm' | 'heightCm' | 'lengthCm' | 'priceCents'>;

export const shipsWithMelhorEnvio = (product: Pick<Product, 'type' | 'shippingMode'>) => product.type === 'physical' && product.shippingMode === 'melhorenvio';
export function parcelOf(product: ProductParcel): MeParcel | null {
  if (!product.weightGrams || !product.widthCm || !product.heightCm || !product.lengthCm) return null;
  return { weightGrams: product.weightGrams, widthCm: product.widthCm, heightCm: product.heightCm, lengthCm: product.lengthCm, insuranceCents: product.priceCents };
}
export function trackingUrl(carrier: string | null | undefined, code: string | null | undefined, meCode?: string | null): string | null {
  if (meCode) return `https://www.melhorrastreio.com.br/rastreio/${encodeURIComponent(meCode)}`;
  if (!code) return null;
  const name = (carrier ?? '').toLowerCase();
  if (name.includes('correios')) return `https://rastreamento.correios.com.br/app/index.php?objetos=${encodeURIComponent(code)}`;
  if (name.includes('jadlog')) return `https://www.jadlog.com.br/siteInstitucional/tracking.jad?cte=${encodeURIComponent(code)}`;
  return null;
}
export function shipmentView(shipment: Shipment | null | undefined): ShipmentView | null {
  if (!shipment) return null;
  return { mode: shipment.mode, status: shipment.status, carrier: shipment.carrier, service: shipment.service, trackingCode: shipment.trackingCode, trackingUrl: trackingUrl(shipment.carrier, shipment.trackingCode, shipment.mode === 'melhorenvio' ? shipment.trackingCode : null), labelUrl: shipment.labelUrl, postedAt: shipment.postedAt?.toISOString() ?? null, deliveredAt: shipment.deliveredAt?.toISOString() ?? null, error: shipment.error };
}

// Quotes are cached briefly per product and destination so the checkout can re-validate the chosen
// option at order time without a second round trip to the carrier for every retry.
const quoteCache = new Map<string, { at: number; quotes: MeQuote[] }>();
const QUOTE_TTL = 10 * 60_000;
export const normalizePostalCode = (value: string) => value.replace(/\D/g, '');
export async function quoteShipping(app: FastifyInstance, product: ProductParcel, seller: SellerForShipping, toPostalCode: string): Promise<MeQuote[]> {
  const cep = normalizePostalCode(toPostalCode);
  if (!/^\d{8}$/.test(cep)) throw new AppError('POSTAL_CODE_INVALID', 'Informe um CEP válido com 8 dígitos.');
  const parcel = parcelOf(product);
  const origin = sellerOrigin(seller, app.config.encryptionKey);
  if (!parcel || !origin) throw new AppError('SHIPPING_UNAVAILABLE', 'Este produto ainda não tem frete configurado.', 409);
  const key = `${product.id}:${origin.postalCode}:${cep}`;
  const cached = quoteCache.get(key);
  if (cached && Date.now() - cached.at < QUOTE_TTL) return cached.quotes;
  let quotes: MeQuote[];
  try { quotes = await app.me!.calculate(await sellerShippingToken(app, seller), { fromPostalCode: origin.postalCode, toPostalCode: cep, productId: product.id, parcel }); }
  catch (error) { app.log.error({ err: error, productId: product.id }, 'Melhor Envio quote failed'); throw new AppError('SHIPPING_ERROR', 'Não foi possível calcular o frete agora. Tente novamente em instantes.', 502); }
  quotes.sort((a, b) => a.priceCents - b.priceCents || a.deliveryDays - b.deliveryDays);
  quoteCache.set(key, { at: Date.now(), quotes });
  return quotes;
}
export async function resolveQuote(app: FastifyInstance, product: ProductParcel, seller: SellerForShipping, toPostalCode: string, serviceId: number): Promise<MeQuote> {
  const quote = (await quoteShipping(app, product, seller, toPostalCode)).find(q => q.serviceId === serviceId);
  if (!quote) throw new AppError('SHIPPING_UNAVAILABLE', 'A opção de frete escolhida não está mais disponível. Escolha outra.', 409);
  return quote;
}

type OrderForLabel = Order & { seller: SellerForShipping; product: ProductParcel & { name: string }; shipment: Shipment | null };
function sellerParty(seller: SellerForShipping, origin: OriginAddress, key: string): MeParty {
  return { name: seller.displayName, phone: seller.originPhone ?? '', email: seller.user.email, document: seller.documentEncrypted ? decrypt(seller.documentEncrypted, key) : '', address: origin.street, number: origin.number, complement: origin.complement, district: origin.district, city: origin.city, state: origin.state, postalCode: origin.postalCode };
}
function buyerParty(order: Order, key: string): MeParty {
  const address = JSON.parse(decrypt(order.addressEncrypted ?? '', key)) as OriginAddress;
  return { name: order.buyerName, phone: '', email: order.buyerEmail, document: decrypt(order.buyerDocumentEncrypted, key), address: address.street, number: address.number, complement: address.complement, district: address.district, city: address.city, state: address.state, postalCode: address.postalCode };
}
async function ensureShipment(db: Prisma.TransactionClient | FastifyInstance['db'], order: Order) {
  return db.shipment.upsert({ where: { orderId: order.id }, update: {}, create: { orderId: order.id, mode: order.shippingMode, carrier: order.shippingCarrier, service: order.shippingServiceName, priceCents: order.shippingCents } });
}
export async function createShipmentForPaidOrder(tx: Prisma.TransactionClient, order: Order) {
  if (order.productType !== 'physical') return null;
  return ensureShipment(tx, order);
}
// Cart → purchase → label → print, resuming from wherever a previous attempt stopped.
export async function buyLabel(app: FastifyInstance, order: OrderForLabel): Promise<Shipment> {
  if (order.status !== 'paid' || order.productType !== 'physical') throw new AppError('SHIPMENT_INVALID', 'A etiqueta só pode ser comprada para pedidos físicos pagos.', 409);
  if (order.shippingMode !== 'melhorenvio' || !order.shippingServiceId) throw new AppError('SHIPMENT_INVALID', 'Este pedido não usa o Melhor Envio. Informe a postagem manualmente.', 409);
  if (!app.me) throw new AppError('SHIPPING_UNAVAILABLE', 'A integração com o Melhor Envio não está habilitada.', 409);
  const key = app.config.encryptionKey;
  const origin = sellerOrigin(order.seller, key);
  if (!origin) throw new AppError('ORIGIN_REQUIRED', 'Cadastre o endereço de origem em Configurações → Envio.', 409);
  const parcel = parcelOf(order.product);
  if (!parcel) throw new AppError('PARCEL_REQUIRED', 'Informe peso e dimensões do produto antes de comprar a etiqueta.', 409);
  let shipment = order.shipment ?? await ensureShipment(app.db, order);
  if (['generated', 'posted', 'delivered'].includes(shipment.status)) return shipment;
  if (shipment.status === 'canceled') throw new AppError('SHIPMENT_INVALID', 'A etiqueta deste pedido foi cancelada. Informe a postagem manualmente.', 409);
  const accessToken = await sellerShippingToken(app, order.seller);
  const fail = async (step: string, error: unknown, status?: string): Promise<never> => {
    app.log.error({ err: error, orderId: order.id, step }, 'Melhor Envio label step failed');
    shipment = await app.db.shipment.update({ where: { id: shipment.id }, data: { status: status ?? 'failed', error: meErrorMessage(error).slice(0, 500) } });
    return assertShippingError(error, 'O Melhor Envio recusou a operação.');
  };
  try {
    if (!shipment.meOrderId) {
      const input = { serviceId: order.shippingServiceId, from: sellerParty(order.seller, origin, key), to: buyerParty(order, key), product: { name: order.productName, priceCents: order.priceCents }, parcel };
      let cart;
      try { cart = await app.me.insertCart(accessToken, input); }
      catch (error) {
        if (!mentionsAgency(error)) throw error;
        // Some carriers need a drop-off agency: pick the first one in the seller's city for that company.
        const quote = await resolveQuote(app, order.product, order.seller, buyerParty(order, key).postalCode, order.shippingServiceId);
        const agencies = await app.me.agencies(accessToken, { companyId: quote.carrierId, state: origin.state, city: origin.city });
        if (!agencies.length) throw error;
        cart = await app.me.insertCart(accessToken, { ...input, agencyId: agencies[0]!.id });
      }
      shipment = await app.db.shipment.update({ where: { id: shipment.id }, data: { meOrderId: cart.id, meProtocol: cart.protocol ?? null, status: 'pending', error: null, priceCents: cart.price !== undefined ? Math.round(Number(cart.price) * 100) : shipment.priceCents } });
    }
  } catch (error) { return fail('cart', error); }
  if (shipment.status === 'pending') {
    try { await app.me.checkout(accessToken, [shipment.meOrderId!]); shipment = await app.db.shipment.update({ where: { id: shipment.id }, data: { status: 'purchased', error: null } }); }
    catch (error) { return fail('checkout', error); }
  }
  try {
    const generated = await app.me.generate(accessToken, [shipment.meOrderId!]);
    const result = generated[shipment.meOrderId!];
    if (result && result.status === false) throw new AppError('SHIPPING_ERROR', result.message ?? 'O Melhor Envio não gerou a etiqueta.', 502);
    const [printed, tracking] = await Promise.all([app.me.print(accessToken, [shipment.meOrderId!]).catch(() => null), app.me.tracking(accessToken, [shipment.meOrderId!]).catch(() => null)]);
    const info = tracking?.[shipment.meOrderId!];
    shipment = await app.db.shipment.update({ where: { id: shipment.id }, data: { status: 'generated', error: null, labelUrl: printed?.url ?? shipment.labelUrl, trackingCode: info?.tracking ?? info?.melhorenvio_tracking ?? shipment.trackingCode, lastSyncAt: new Date() } });
  } catch (error) { return fail('generate', error, 'purchased'); }
  return shipment;
}
export async function printLabel(app: FastifyInstance, shipment: Shipment, seller: SellerForShipping): Promise<string> {
  if (!app.me || !shipment.meOrderId) throw new AppError('SHIPMENT_INVALID', 'Etiqueta indisponível para este pedido.', 409);
  try { const { url } = await app.me.print(await sellerShippingToken(app, seller), [shipment.meOrderId]); await app.db.shipment.update({ where: { id: shipment.id }, data: { labelUrl: url } }); return url; }
  catch (error) { return assertShippingError(error, 'Não foi possível obter a etiqueta.'); }
}
// Re-reads the carrier status; the first time a label shows as posted the buyer gets the shipped e-mail.
export async function syncShipment(app: FastifyInstance, shipment: Shipment, order: Order, seller: SellerForShipping): Promise<Shipment> {
  if (!app.me || !shipment.meOrderId || ['delivered', 'canceled'].includes(shipment.status)) return shipment;
  let info;
  try { info = (await app.me.tracking(await sellerShippingToken(app, seller), [shipment.meOrderId]))[shipment.meOrderId]; }
  catch (error) { app.log.warn({ err: error, shipmentId: shipment.id }, 'Melhor Envio tracking failed'); return shipment; }
  if (!info) return shipment;
  const mapped = mapTrackingStatus(info.status);
  const data: Prisma.ShipmentUpdateInput = { lastSyncAt: new Date(), trackingCode: info.tracking ?? info.melhorenvio_tracking ?? shipment.trackingCode };
  const wasPosted = Boolean(shipment.postedAt);
  if (info.posted_at) data.postedAt = new Date(info.posted_at);
  if (info.delivered_at) data.deliveredAt = new Date(info.delivered_at);
  if (mapped && mapped !== 'failed' && (mapped !== 'purchased' || shipment.status === 'pending')) data.status = mapped;
  if (mapped === 'posted' && !info.posted_at && !shipment.postedAt) data.postedAt = new Date();
  const updated = await app.db.shipment.update({ where: { id: shipment.id }, data });
  if (!wasPosted && updated.postedAt) await app.db.$transaction(tx => notifyShipped(app, tx, order, updated));
  return updated;
}
export async function markPosted(app: FastifyInstance, order: Order, shipment: Shipment | null, input: { carrier?: string; trackingCode?: string }): Promise<Shipment> {
  if (order.status !== 'paid' || order.productType !== 'physical') throw new AppError('SHIPMENT_INVALID', 'Só pedidos físicos pagos podem ser marcados como postados.', 409);
  const current = shipment ?? await ensureShipment(app.db, order);
  if (current.postedAt) return current;
  if (current.mode === 'manual' && !input.trackingCode?.trim()) throw new AppError('TRACKING_REQUIRED', 'Informe o código de rastreio da postagem.');
  return app.db.$transaction(async tx => {
    const updated = await tx.shipment.update({ where: { id: current.id }, data: { status: 'posted', postedAt: new Date(), carrier: input.carrier?.trim() || current.carrier, trackingCode: input.trackingCode?.trim() || current.trackingCode, error: null } });
    await notifyShipped(app, tx, order, updated);
    return updated;
  });
}
export async function cancelLabel(app: FastifyInstance, shipment: Shipment, seller: SellerForShipping, reason: string): Promise<Shipment> {
  if (!app.me || !shipment.meOrderId) throw new AppError('SHIPMENT_INVALID', 'Não há etiqueta para cancelar.', 409);
  if (['posted', 'delivered'].includes(shipment.status)) throw new AppError('SHIPMENT_INVALID', 'Uma etiqueta já postada não pode ser cancelada.', 409);
  try { await app.me.cancel(await sellerShippingToken(app, seller), shipment.meOrderId, reason || 'Cancelado pelo vendedor'); }
  catch (error) { return assertShippingError(error, 'O Melhor Envio não cancelou a etiqueta.'); }
  return app.db.shipment.update({ where: { id: shipment.id }, data: { status: 'canceled', error: null } });
}
async function notifyShipped(app: FastifyInstance, tx: Prisma.TransactionClient, order: Order, shipment: Shipment) {
  const raw = token();
  const link = await issueAccess(tx, order.id, app.config, raw, true);
  const url = trackingUrl(shipment.carrier, shipment.trackingCode, shipment.mode === 'melhorenvio' ? shipment.trackingCode : null);
  await queueMail(tx, app.config, order.buyerEmail, {
    test: order.gateway === 'simulated', eyebrow: 'Produto enviado', subject: 'Seu pedido foi enviado', heading: 'Seu pedido está a caminho.',
    paragraphs: [shipment.carrier ? `O vendedor postou seu pedido pela ${shipment.carrier}.` : 'O vendedor postou seu pedido.', 'Acompanhe a entrega pelo código de rastreio abaixo.'],
    facts: [{ label: 'Produto', value: order.productName }, { label: 'Pedido', value: order.id }, ...(shipment.carrier ? [{ label: 'Transportadora', value: shipment.carrier }] : []), ...(shipment.trackingCode ? [{ label: 'Rastreio', value: shipment.trackingCode }] : [])],
    action: url ? { label: 'Rastrear envio', url } : { label: 'Ver pedido', url: link },
    secondary: url ? { label: 'Página do pedido', url: link } : undefined,
  });
}
export const sellerForShippingInclude = { user: { select: { email: true, name: true } } } as const;
