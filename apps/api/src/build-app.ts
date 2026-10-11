import Fastify from 'fastify';
import fp from 'fastify-plugin';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import multipart from '@fastify/multipart';
import type { FastifyRequest } from 'fastify';
import type { PrismaClient } from './generated/prisma/client.ts';
import type { Config } from './lib/config.ts';
import { createDb } from './lib/db.ts';
import { createStorage, type ObjectStorage } from './lib/storage.ts';
import { createTransport, drainEmailJobs, takeMailQueued } from './lib/mailer.ts';
import { MercadoPagoClient } from './lib/mercadopago.ts';
import { AppError } from './lib/domain.ts';
import { hashToken, matchesHash } from './lib/security.ts';
import { authRoutes } from './modules/auth.ts';
import { sellerRoutes } from './modules/seller.ts';
import { commerceRoutes } from './modules/commerce.ts';
import { gatewayRoutes } from './modules/gateway.ts';
import { webhookRoutes } from './modules/webhooks.ts';
import { assetRoutes } from './modules/assets.ts';

type Identity = { userId: string; sellerId: string; sessionId: string; csrfHash: string };
declare module 'fastify' {
  interface FastifyInstance { db: PrismaClient; config: Config; storage: ObjectStorage; mp: MercadoPagoClient | null; authenticate: (request: FastifyRequest) => Promise<void> }
  interface FastifyRequest { identity: Identity | null }
}
export async function buildApp(config: Config, options: { logger?: boolean; fetch?: typeof fetch; mercadoPagoApiBase?: string } = {}) {
  const app = Fastify({
    logger: options.logger === false ? false : { level: 'info', redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]'], serializers: { req: (req) => ({ method: req.method, url: req.url?.split('?')[0], id: req.id }) } },
    bodyLimit: 1024 * 1024, requestTimeout: 30_000, trustProxy: false,
    ajv: { customOptions: { removeAdditional: false } },
  });
  if (config.fileScan === 'off') app.log.warn('Varredura de arquivos desativada (FILE_SCAN=off): uploads são aceitos sem verificação antivírus.');
  if (config.production && config.paymentGateway === 'simulated') app.log.warn('Gateway de pagamento simulado ativo em produção (ALLOW_SIMULATED_PAYMENTS=true): nenhum valor é cobrado.');
  await app.register(helmet, { global: true });
  await app.register(cookie);
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  await app.register(swagger, { openapi: { info: { title: 'nostore API', version: '0.1.0' } } });
  await app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024, files: 1, fields: 0, parts: 1 } });
  await app.register(fp(async (server) => {
    const db = createDb(config.databaseUrl);
    server.decorate('db', db);
    server.decorate('config', config);
    server.decorate('storage', createStorage(config));
    server.decorate('mp', config.mercadoPago ? new MercadoPagoClient({ ...config.mercadoPago, apiBase: options.mercadoPagoApiBase }, options.fetch) : null);
    server.addHook('onClose', async () => { await db.$disconnect(); });
  }, { name: 'database' }));
  await app.register(fp(async (server) => {
    server.decorateRequest('identity', null);
    server.decorate('authenticate', async (request: FastifyRequest) => {
      const raw = request.cookies.nostore_session;
      if (!raw || raw.length !== 64) throw new AppError('UNAUTHENTICATED', 'Entre na sua conta para continuar.', 401);
      const session = await server.db.session.findUnique({ where: { tokenHash: hashToken(raw) }, include: { user: { include: { seller: true } } } });
      if (!session || session.expiresAt <= new Date() || !session.user.seller) throw new AppError('UNAUTHENTICATED', 'Sua sessão expirou. Entre novamente.', 401);
      request.identity = { userId: session.userId, sellerId: session.user.seller.id, sessionId: session.id, csrfHash: session.csrfHash };
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
        const csrf = request.headers['x-csrf-token'];
        if (typeof csrf !== 'string' || !matchesHash(csrf, session.csrfHash)) throw new AppError('CSRF_INVALID', 'Atualize a página e tente novamente.', 403);
      }
    });
  }, { name: 'authentication', dependencies: ['database'] }));
  if (config.mailDelivery === 'inline') {
    // No long-lived worker on serverless hosts, and background work after the response is frozen
    // with the function. Drain the queue before replying, only on requests that queued an e-mail.
    const transport = createTransport(config);
    app.addHook('onClose', async () => { transport.close(); });
    app.addHook('onSend', async (request, _reply, payload) => {
      if (!takeMailQueued()) return payload;
      try { await drainEmailJobs(app.db, transport, config); }
      catch (error) { request.log.error({ err: error }, 'E-mail queue drain failed'); }
      return payload;
    });
  }
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const origin = request.headers.origin;
    // Provider webhooks are server-to-server calls authenticated by signature, not by browser origin.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && origin !== config.origin && !request.url.startsWith('/api/v1/webhooks/')) throw new AppError('ORIGIN_INVALID', 'Origem da requisição não permitida.', 403);
  });
  app.setErrorHandler((error, request, reply) => {
    const err = error as { validation?: unknown; statusCode?: number; code?: string; message?: string };
    let status = error instanceof AppError ? error.statusCode : err.validation ? 400 : err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    let code = error instanceof AppError ? error.code : err.validation ? 'VALIDATION_ERROR' : 'REQUEST_ERROR';
    let message = error instanceof AppError ? error.message : err.validation ? 'Confira os campos informados.' : status < 500 ? 'Não foi possível processar a solicitação.' : 'Não foi possível concluir agora. Tente novamente.';
    if (err.code === 'P2002') { status = 409; code = 'CONFLICT'; message = 'Não foi possível concluir com os dados informados.'; }
    if (status === 500) request.log.error({ err: error, code: err.code ?? 'INTERNAL_ERROR' }, 'Request failed');
    reply.code(status).send({ code, message, requestId: request.id });
  });
  app.setNotFoundHandler((request, reply) => reply.code(404).send({ code: 'NOT_FOUND', message: 'Página não encontrada.', requestId: request.id }));
  app.get('/api/v1/health', async () => ({ status: 'ok' }));
  app.get('/api/v1/ready', async () => { await app.db.$queryRaw`SELECT 1`; return { status: 'ready' }; });
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(sellerRoutes, { prefix: '/api/v1/seller' });
  await app.register(assetRoutes, { prefix: '/api/v1/seller/assets' });
  await app.register(commerceRoutes, { prefix: '/api/v1' });
  await app.register(gatewayRoutes, { prefix: '/api/v1/seller/gateway' });
  await app.register(webhookRoutes, { prefix: '/api/v1/webhooks' });
  if (!config.production) app.get('/api/v1/openapi.json', async () => app.swagger());
  return app;
}
