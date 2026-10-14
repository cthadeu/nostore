import type { FastifyInstance } from 'fastify';
import type { Seller } from '../generated/prisma/client.ts';
import { AppError } from './domain.ts';
import { decrypt, encrypt } from './security.ts';
import { day } from './commerce.ts';
import type { MeTokens } from './melhorenvio.ts';

type MeSeller = Pick<Seller, 'id' | 'meAccessTokenEncrypted' | 'meRefreshTokenEncrypted' | 'meTokenExpiresAt' | 'shippingStatus'>;
export interface OriginAddress { postalCode: string; street: string; number: string; complement?: string; district: string; city: string; state: string }

export function meTokenFields(tokens: MeTokens, key: string) {
  return {
    meAccessTokenEncrypted: encrypt(tokens.access_token, key), meRefreshTokenEncrypted: tokens.refresh_token ? encrypt(tokens.refresh_token, key) : undefined,
    meTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000), shippingStatus: 'connected', meConnectedAt: new Date(),
  };
}
// Melhor Envio tokens last 30 days; refresh a few days early so quotes and labels never hit a dead token.
export async function sellerShippingToken(app: FastifyInstance, seller: MeSeller): Promise<string> {
  if (!app.me || seller.shippingStatus !== 'connected' || !seller.meAccessTokenEncrypted) throw new AppError('SHIPPING_NOT_CONNECTED', 'Conecte sua conta Melhor Envio em Configurações → Envio.', 409);
  const key = app.config.encryptionKey;
  const expiring = seller.meTokenExpiresAt ? seller.meTokenExpiresAt.getTime() - Date.now() < 3 * day : false;
  if (!expiring || !seller.meRefreshTokenEncrypted) return decrypt(seller.meAccessTokenEncrypted, key);
  const tokens = await app.me.refreshToken(decrypt(seller.meRefreshTokenEncrypted, key));
  await app.db.seller.update({ where: { id: seller.id }, data: meTokenFields(tokens, key) });
  return tokens.access_token;
}
export function sellerOrigin(seller: Pick<Seller, 'originAddressEncrypted'>, key: string): OriginAddress | null {
  if (!seller.originAddressEncrypted) return null;
  try { return JSON.parse(decrypt(seller.originAddressEncrypted, key)) as OriginAddress; } catch { return null; }
}
