import type { FastifyInstance } from 'fastify';
import type { Prisma } from '../generated/prisma/client.ts';
import { AppError } from './domain.ts';
import { assertTransition, type PaymentStatus } from './gateway.ts';
import { token } from './security.ts';
import { downloadDeadline, issueAccess, paymentConfirmedMail, queueMail } from './commerce.ts';

// Single place where an order changes payment state, whoever triggers it (simulator, card response,
// webhook or a seller refund): locks the order, validates the transition, updates order and attempt,
// and sends the buyer e-mails. Returns the order as stored afterwards.
export async function applyPaymentStatus(app: FastifyInstance, tx: Prisma.TransactionClient, orderId: string, next: PaymentStatus, detail?: string | null) {
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId}::uuid FOR UPDATE`;
  const order = await tx.order.findUnique({ where: { id: orderId }, include: { payment: true } });
  if (!order || !order.payment) throw new AppError('NOT_FOUND', 'Pedido não encontrado.', 404);
  if (order.status === next) {
    if (detail && detail !== order.payment.statusDetail) await tx.paymentAttempt.update({ where: { orderId }, data: { statusDetail: detail } });
    return order;
  }
  if (next === 'pending') return order;
  if (order.status === 'pending' && order.expiresAt <= new Date() && next === 'paid') throw new AppError('ORDER_EXPIRED', 'Este pedido expirou. Inicie outro checkout.', 409);
  assertTransition(order.status, next);
  const paid = next === 'paid';
  const updated = await tx.order.update({ where: { id: orderId }, data: { status: next, ...(paid ? { paidAt: new Date(), downloadUntil: downloadDeadline() } : {}) }, include: { payment: true } });
  await tx.paymentAttempt.update({ where: { orderId }, data: { status: next, ...(detail !== undefined ? { statusDetail: detail } : {}), ...(paid ? { pixQrCode: null, pixQrCodeBase64: null } : {}) } });
  const test = order.gateway === 'simulated';
  const facts = [{ label: 'Produto', value: order.productName }, { label: 'Pedido', value: order.id }];
  if (paid) {
    // One e-mail with the confirmation and a permanent link; digital orders also get a direct download URL.
    const raw = token();
    const link = await issueAccess(tx, orderId, app.config, raw, true);
    await queueMail(tx, app.config, order.buyerEmail, paymentConfirmedMail(order, link, order.productType === 'digital' ? `${app.config.origin}/api/v1/buyer/file?token=${raw}` : null));
  } else if (next === 'refunded') {
    await queueMail(tx, app.config, order.buyerEmail, { test, eyebrow: 'Reembolso', subject: 'Pagamento reembolsado', heading: 'Seu pagamento foi reembolsado.', paragraphs: ['O reembolso foi registrado e o acesso ao download deste pedido foi encerrado.'], facts });
  } else {
    await queueMail(tx, app.config, order.buyerEmail, { test, eyebrow: 'Pagamento', subject: 'Pagamento recusado', heading: 'O pagamento não foi aprovado.', paragraphs: ['Nenhum valor foi cobrado. Se quiser, inicie uma nova compra pelo link do produto.'], facts });
  }
  return updated;
}
