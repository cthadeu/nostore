import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import argon2 from 'argon2';
import { AppError } from '../lib/domain.ts';
import { token, hashToken, encrypt } from '../lib/security.ts';
import { MessageResponse } from '../lib/schemas.ts';
import type { Prisma } from '../generated/prisma/client.ts';

const Email = Type.String({ format: 'email', maxLength: 254 });
const Password = Type.String({ minLength: 12, maxLength: 128 });
const Token = Type.String({ pattern: '^[a-f0-9]{64}$' });
export async function queueAuthEmail(tx: Prisma.TransactionClient, app: FastifyInstance, user: { id: string; email: string }, kind: string) {
  const raw = token();
  await tx.authToken.create({ data: { tokenHash: hashToken(raw), userId: user.id, kind, expiresAt: new Date(Date.now() + (kind === 'verify' ? 24 : 1) * 3600_000) } });
  const link = `${app.config.origin}/${kind === 'verify' ? 'verificar-email' : 'redefinir-senha'}#token=${raw}`;
  await tx.emailJob.create({ data: { payloadEncrypted: encrypt(JSON.stringify({ to: user.email, subject: kind === 'verify' ? 'Confirme seu e-mail · nostore' : 'Redefina sua senha · nostore', text: `Olá!\n\n${kind === 'verify' ? 'Confirme seu e-mail para preparar suas primeiras vendas.' : 'Use o link para definir uma nova senha.'}\n\n${link}\n\nSe não foi você, ignore esta mensagem.\nnostore` }), app.config.encryptionKey) } });
}
async function createSession(app: FastifyInstance, userId: string, reply: FastifyReply) {
  const raw = token(), csrf = token();
  await app.db.session.create({ data: { tokenHash: hashToken(raw), csrfHash: hashToken(csrf), userId, expiresAt: new Date(Date.now() + 7 * 86400_000) } });
  const cookie = { path: '/', sameSite: 'lax' as const, secure: app.config.production, maxAge: 7 * 86400 };
  reply.setCookie('nostore_session', raw, { ...cookie, httpOnly: true });
  reply.setCookie('nostore_csrf', csrf, { ...cookie, httpOnly: false });
}
export async function authRoutes(server: FastifyInstance) {
  const app = server.withTypeProvider<TypeBoxTypeProvider>();
  const dummyHash = await argon2.hash(token());
  app.post('/register', { config: { rateLimit: { max: 8, timeWindow: '15 minutes' } }, schema: { body: Type.Object({ name: Type.String({ minLength: 2, maxLength: 100 }), email: Email, password: Password, acceptTerms: Type.Literal(true) }, { additionalProperties: false }), response: { 201: MessageResponse } } }, async (request, reply) => {
    const email = request.body.email.trim().toLowerCase();
    const passwordHash = await argon2.hash(request.body.password, { type: argon2.argon2id });
    const user = await app.db.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email, name: request.body.name.trim(), passwordHash, seller: { create: { displayName: request.body.name.trim() } } } });
      await queueAuthEmail(tx, app, user, 'verify');
      return user;
    });
    await createSession(app, user.id, reply);
    reply.code(201);
    return { message: 'Conta criada. Confira seu e-mail para confirmar o cadastro.' };
  });
  app.post('/login', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } }, schema: { body: Type.Object({ email: Email, password: Type.String({ minLength: 1, maxLength: 128 }) }, { additionalProperties: false }), response: { 200: MessageResponse } } }, async (request, reply) => {
    const user = await app.db.user.findUnique({ where: { email: request.body.email.trim().toLowerCase() } });
    const valid = await argon2.verify(user?.passwordHash ?? dummyHash, request.body.password);
    if (!user || !valid) throw new AppError('INVALID_CREDENTIALS', 'E-mail ou senha incorretos.', 401);
    if (request.cookies.nostore_session) await app.db.session.deleteMany({ where: { tokenHash: hashToken(request.cookies.nostore_session) } });
    await createSession(app, user.id, reply);
    return { message: 'Bem-vindo de volta.' };
  });
  app.post('/logout', { onRequest: app.authenticate, schema: { response: { 200: MessageResponse } } }, async (request, reply) => {
    await app.db.session.deleteMany({ where: { id: request.identity!.sessionId } });
    reply.clearCookie('nostore_session', { path: '/' });
    reply.clearCookie('nostore_csrf', { path: '/' });
    return { message: 'Sessão encerrada.' };
  });
  app.post('/verify-email', { schema: { body: Type.Object({ token: Token }, { additionalProperties: false }), response: { 200: MessageResponse } } }, async (request) => {
    await app.db.$transaction(async (tx) => {
      const found = await tx.authToken.findUnique({ where: { tokenHash: hashToken(request.body.token) } });
      if (!found || found.kind !== 'verify' || found.usedAt || found.expiresAt <= new Date()) throw new AppError('TOKEN_INVALID', 'Este link expirou ou já foi usado. Solicite outro.');
      const used = await tx.authToken.updateMany({ where: { id: found.id, usedAt: null }, data: { usedAt: new Date() } });
      if (!used.count) throw new AppError('TOKEN_INVALID', 'Este link já foi usado.');
      await tx.user.update({ where: { id: found.userId }, data: { emailVerifiedAt: new Date() } });
    });
    return { message: 'E-mail confirmado. Tudo pronto para continuar.' };
  });
  app.post('/resend-verification', { onRequest: app.authenticate, config: { rateLimit: { max: 3, timeWindow: '15 minutes' } }, schema: { response: { 200: MessageResponse } } }, async (request) => {
    const user = await app.db.user.findUniqueOrThrow({ where: { id: request.identity!.userId } });
    if (!user.emailVerifiedAt) await app.db.$transaction((tx) => queueAuthEmail(tx, app, user, 'verify'));
    return { message: 'Confira seu e-mail. Enviamos um novo link, se necessário.' };
  });
  app.post('/forgot-password', { config: { rateLimit: { max: 3, timeWindow: '15 minutes' } }, schema: { body: Type.Object({ email: Email }, { additionalProperties: false }), response: { 200: MessageResponse } } }, async (request) => {
    const user = await app.db.user.findUnique({ where: { email: request.body.email.trim().toLowerCase() } });
    if (user) await app.db.$transaction((tx) => queueAuthEmail(tx, app, user, 'reset'));
    return { message: 'Se houver uma conta com este e-mail, enviaremos as instruções.' };
  });
  app.post('/reset-password', { schema: { body: Type.Object({ token: Token, password: Password }, { additionalProperties: false }), response: { 200: MessageResponse } } }, async (request) => {
    const passwordHash = await argon2.hash(request.body.password, { type: argon2.argon2id });
    await app.db.$transaction(async (tx) => {
      const found = await tx.authToken.findUnique({ where: { tokenHash: hashToken(request.body.token) } });
      if (!found || found.kind !== 'reset' || found.usedAt || found.expiresAt <= new Date()) throw new AppError('TOKEN_INVALID', 'Este link expirou ou já foi usado.');
      const used = await tx.authToken.updateMany({ where: { id: found.id, usedAt: null }, data: { usedAt: new Date() } });
      if (!used.count) throw new AppError('TOKEN_INVALID', 'Este link já foi usado.');
      await tx.user.update({ where: { id: found.userId }, data: { passwordHash } });
      await tx.authToken.updateMany({ where: { userId: found.userId, kind: 'reset', usedAt: null }, data: { usedAt: new Date() } });
      await tx.session.deleteMany({ where: { userId: found.userId } });
    });
    return { message: 'Senha atualizada. Entre novamente na sua conta.' };
  });
}
