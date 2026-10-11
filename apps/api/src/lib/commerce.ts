import type { Prisma, Order } from '../generated/prisma/client.ts';
import type { Config } from './config.ts';
import { encrypt, hashToken, token } from './security.ts';
import { AppError } from './domain.ts';
import { markMailQueued } from './mailer.ts';

export const day = 86_400_000;
// Downloads do not expire on their own; a refund revokes them by changing the order status.
export const forever = () => new Date('9999-12-31T00:00:00Z');
export function downloadDeadline() { return forever(); }
export const currentFee = (db: Pick<Prisma.TransactionClient, 'feePolicy'>) => db.feePolicy.findFirstOrThrow({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
export const isAdmin = (config: Config, user: { email: string; emailVerifiedAt: Date | null }) => Boolean(user.emailVerifiedAt && config.adminEmails.includes(user.email));
export const orderStatus = (order: { status: string; expiresAt: Date }) => order.status === 'pending' && order.expiresAt <= new Date() ? 'expired' : order.status;
export const publicOrder = (order: Order & { payment: { method: string } | null }) => ({
  id: order.id, productName: order.productName, productType: order.productType,
  priceCents: order.priceCents, feeCents: order.feeCents, totalCents: order.totalCents,
  status: orderStatus(order), gateway: order.gateway, method: order.payment?.method ?? '',
  createdAt: order.createdAt.toISOString(), expiresAt: order.expiresAt.toISOString(),
  downloadable: order.status === 'paid' && order.productType === 'digital' && Boolean(order.downloadUntil && order.downloadUntil > new Date()),
});
export async function queueMail(tx: Prisma.TransactionClient, config: Config, to: string, subject: string, text: string) {
  await tx.emailJob.create({ data: { payloadEncrypted: encrypt(JSON.stringify({ to, subject, text }), config.encryptionKey) } });
  markMailQueued();
}
// Pending orders get a 24h link; paid orders get a permanent one, sent by e-mail, that always reopens the order page.
export async function issueAccess(tx: Prisma.TransactionClient, orderId: string, config: Config, raw = token(), permanent = false) {
  await tx.accessGrant.create({ data: { orderId, tokenHash: hashToken(raw), expiresAt: permanent ? forever() : new Date(Date.now() + day) } });
  return `${config.origin}/pedido#token=${raw}`;
}
export function paymentConfirmedMail(order: { id: string; productName: string; productType: string; gateway: string }, link: string, downloadUrl: string | null) {
  const tag = order.gateway === 'simulated' ? '[Teste] ' : '';
  const lines = [`Pagamento confirmado: ${order.productName}.`];
  if (order.gateway === 'simulated') lines.push('Pagamento simulado: nenhum valor foi cobrado.');
  lines.push(`Pedido: ${order.id}`);
  if (order.productType === 'digital') lines.push('', 'Seu arquivo está disponível para download. Guarde este e-mail: o link é permanente e pode ser usado sempre que precisar.', `Baixar arquivo: ${downloadUrl}`, `Página do pedido: ${link}`);
  else lines.push('', 'O vendedor foi avisado e vai preparar o envio.', `Acompanhe seu pedido: ${link}`);
  return { subject: `${tag}${order.productType === 'digital' ? 'Seu arquivo está disponível' : 'Pagamento confirmado'}`, text: lines.join('\n') };
}
export async function authorizeOrder(tx: Prisma.TransactionClient, raw: string) {
  const grant = await tx.accessGrant.findUnique({ where: { tokenHash: hashToken(raw) } });
  if (!grant || grant.expiresAt <= new Date()) throw new AppError('ACCESS_INVALID', 'Link inválido ou expirado. Solicite outro link pelo e-mail da compra.', 401);
  return tx.order.findUniqueOrThrow({ where: { id: grant.orderId }, include: { payment: true, files: true } });
}
