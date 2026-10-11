import type { Prisma, Order } from '../generated/prisma/client.ts';
import type { Config } from './config.ts';
import { encrypt, hashToken, token } from './security.ts';
import { AppError } from './domain.ts';

export const day = 86_400_000;
export function downloadDeadline() { const date = new Date(); date.setUTCFullYear(date.getUTCFullYear() + 1); return date; }
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
}
export async function issueAccess(tx: Prisma.TransactionClient, orderId: string, config: Config, raw = token()) {
  await tx.accessGrant.create({ data: { orderId, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + day) } });
  return `${config.origin}/pedido#token=${raw}`;
}
export async function authorizeOrder(tx: Prisma.TransactionClient, raw: string) {
  const grant = await tx.accessGrant.findUnique({ where: { tokenHash: hashToken(raw) } });
  if (!grant || grant.expiresAt <= new Date()) throw new AppError('ACCESS_INVALID', 'Link inválido ou expirado. Solicite outro link pelo e-mail da compra.', 401);
  return tx.order.findUniqueOrThrow({ where: { id: grant.orderId }, include: { payment: true } });
}
