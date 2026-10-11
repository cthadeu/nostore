import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { AppError } from '../lib/domain.ts';
import { hashToken, token } from '../lib/security.ts';
import { mpTokenFields } from '../lib/mp-account.ts';
import { MessageResponse } from '../lib/schemas.ts';

// Seller ↔ Mercado Pago linking by OAuth. The callback is reached by a browser redirect from
// Mercado Pago, so it is authenticated by the one-time state token rather than by the session.
export async function gatewayRoutes(server: FastifyInstance) {
  const app = server.withTypeProvider<TypeBoxTypeProvider>();
  const redirectUri = `${app.config.origin}/api/v1/seller/gateway/callback`;
  const settingsUrl = (result: string) => `${app.config.origin}/configuracoes?gateway=${result}#recebimento`;
  const unavailable = () => new AppError('GATEWAY_UNAVAILABLE', 'A conexão com o Mercado Pago não está habilitada neste ambiente.', 409);

  app.get('/connect', { onRequest: app.authenticate, schema: { response: { 200: Type.Object({ url: Type.String() }) } } }, async request => {
    if (!app.mp) throw unavailable();
    const state = token();
    await app.db.authToken.create({ data: { tokenHash: hashToken(state), userId: request.identity!.userId, kind: 'mp_oauth', expiresAt: new Date(Date.now() + 15 * 60_000) } });
    return { url: app.mp.authorizationUrl(redirectUri, state) };
  });
  app.get('/callback', { schema: { querystring: Type.Object({ code: Type.Optional(Type.String()), state: Type.Optional(Type.String()), error: Type.Optional(Type.String()) }) } }, async (request, reply) => {
    const { code, state, error } = request.query;
    if (!app.mp || error || !code || !state || !/^[a-f0-9]{64}$/.test(state)) return reply.redirect(settingsUrl(error ? 'denied' : 'error'));
    const claimed = await app.db.$transaction(async tx => {
      const found = await tx.authToken.findUnique({ where: { tokenHash: hashToken(state) } });
      if (!found || found.kind !== 'mp_oauth' || found.expiresAt <= new Date()) return null;
      const used = await tx.authToken.updateMany({ where: { id: found.id, usedAt: null }, data: { usedAt: new Date() } });
      return used.count ? found : null;
    });
    if (!claimed) return reply.redirect(settingsUrl('error'));
    try {
      const tokens = await app.mp.exchangeCode(code, redirectUri);
      await app.db.seller.update({ where: { userId: claimed.userId }, data: mpTokenFields(tokens, app.config.encryptionKey) });
    } catch (err) {
      request.log.error({ err, userId: claimed.userId }, 'Mercado Pago OAuth exchange failed');
      return reply.redirect(settingsUrl('error'));
    }
    return reply.redirect(settingsUrl('connected'));
  });
  app.post('/disconnect', { onRequest: app.authenticate, schema: { response: { 200: MessageResponse } } }, async request => {
    await app.db.seller.update({ where: { id: request.identity!.sellerId }, data: { gatewayStatus: 'not_connected', mpUserId: null, mpPublicKey: null, mpAccessTokenEncrypted: null, mpRefreshTokenEncrypted: null, mpTokenExpiresAt: null, mpConnectedAt: null } });
    return { message: 'Conta Mercado Pago desconectada. Produtos ativos deixam de aceitar novas compras até reconectar.' };
  });
}
