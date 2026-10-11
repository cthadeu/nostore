import type { FastifyInstance } from 'fastify';
import type { Seller } from '../generated/prisma/client.ts';
import { AppError } from './domain.ts';
import { decrypt, encrypt } from './security.ts';
import { day } from './commerce.ts';
import type { MpTokens } from './mercadopago.ts';

type MpSeller = Pick<Seller, 'id' | 'mpAccessTokenEncrypted' | 'mpRefreshTokenEncrypted' | 'mpTokenExpiresAt' | 'gatewayStatus'>;

export function mpTokenFields(tokens: MpTokens, key: string) {
  return {
    mpUserId: String(tokens.user_id), mpPublicKey: tokens.public_key ?? undefined,
    mpAccessTokenEncrypted: encrypt(tokens.access_token, key), mpRefreshTokenEncrypted: tokens.refresh_token ? encrypt(tokens.refresh_token, key) : undefined,
    mpTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000), gatewayStatus: 'connected', mpConnectedAt: new Date(),
  };
}
// Seller credentials from OAuth; refreshed ahead of expiry so a checkout never meets a dead token.
export async function sellerAccessToken(app: FastifyInstance, seller: MpSeller): Promise<string> {
  if (!app.mp || seller.gatewayStatus !== 'connected' || !seller.mpAccessTokenEncrypted) throw new AppError('GATEWAY_NOT_CONNECTED', 'Conecte sua conta Mercado Pago em Configurações → Recebimento.', 409);
  const key = app.config.encryptionKey;
  const expiring = seller.mpTokenExpiresAt ? seller.mpTokenExpiresAt.getTime() - Date.now() < 7 * day : false;
  if (!expiring || !seller.mpRefreshTokenEncrypted) return decrypt(seller.mpAccessTokenEncrypted, key);
  const tokens = await app.mp.refreshToken(decrypt(seller.mpRefreshTokenEncrypted, key));
  await app.db.seller.update({ where: { id: seller.id }, data: mpTokenFields(tokens, key) });
  return tokens.access_token;
}
