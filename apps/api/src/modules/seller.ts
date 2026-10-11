import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { AppError, effectivePlan, assertPublicationLimit, isValidDocument } from '../lib/domain.ts';
import { gatewayFor } from '../lib/gateway.ts';
import { isAdmin } from '../lib/commerce.ts';
import { scanFile } from '../lib/scanner.ts';
import { resolve } from 'node:path';
import { encrypt } from '../lib/security.ts';
import { IdParams, ProductInput, ProductResponse, MessageResponse } from '../lib/schemas.ts';

export async function sellerRoutes(server: FastifyInstance) {
  const app = server.withTypeProvider<TypeBoxTypeProvider>();
  app.addHook('onRequest', app.authenticate);
  app.get('/profile', async (request) => {
    const seller = await app.db.seller.findUniqueOrThrow({ where: { id: request.identity!.sellerId }, include: { user: true } });
    return { id: seller.id, name: seller.user.name, email: seller.user.email, emailVerified: Boolean(seller.user.emailVerifiedAt), displayName: seller.displayName, personType: seller.personType, documentLast4: seller.documentLast4, plan: effectivePlan(seller), gatewayStatus: seller.gatewayStatus, paymentGateway: app.config.paymentGateway, isAdmin: isAdmin(app.config, seller.user) };
  });
  app.patch('/profile', { schema: { body: Type.Object({ displayName: Type.String({ minLength: 2, maxLength: 100 }), personType: Type.Union([Type.Literal('individual'), Type.Literal('business')]), document: Type.Optional(Type.String({ minLength: 11, maxLength: 14 })) }, { additionalProperties: false }), response: { 200: MessageResponse } } }, async (request) => {
    const { document, ...profile } = request.body;
    profile.displayName = profile.displayName.trim();
    if (profile.displayName.length < 2) throw new AppError('NAME_INVALID', 'Informe um nome de vendedor com pelo menos 2 caracteres.');
    if (document && (!isValidDocument(document) || document.length !== (profile.personType === 'individual' ? 11 : 14))) throw new AppError('DOCUMENT_INVALID', 'Informe um CPF ou CNPJ válido para o tipo de pessoa.');
    await app.db.$transaction(async tx => {
      const sellerId = request.identity!.sellerId;
      await tx.$queryRaw`SELECT id FROM "Seller" WHERE id = ${sellerId}::uuid FOR UPDATE`;
      const existing = await tx.seller.findUniqueOrThrow({ where: { id: sellerId } });
      if (existing.documentEncrypted && existing.personType !== profile.personType && !document) throw new AppError('DOCUMENT_REQUIRED', 'Informe o documento correspondente ao novo tipo de pessoa.');
      await tx.seller.update({ where: { id: sellerId }, data: { ...profile, ...(document ? { documentEncrypted: encrypt(document, app.config.encryptionKey), documentLast4: document.slice(-4) } : {}) } });
    });
    return { message: 'Perfil atualizado.' };
  });
  app.get('/products', { schema: { querystring: Type.Object({ page: Type.Integer({ minimum: 1, default: 1 }), limit: Type.Integer({ minimum: 1, maximum: 50, default: 12 }) }), response: { 200: Type.Object({ items: Type.Array(ProductResponse), total: Type.Integer(), activeCount: Type.Integer() }) } } }, async (request) => {
    const where = { sellerId: request.identity!.sellerId };
    const [items, total, activeCount] = await Promise.all([
      app.db.product.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (request.query.page - 1) * request.query.limit, take: request.query.limit }),
      app.db.product.count({ where }), app.db.product.count({ where: { ...where, status: 'active' } }),
    ]);
    return { items: items.map((item) => ({ ...item, updatedAt: item.updatedAt.toISOString() })), total, activeCount };
  });
  app.get('/products/:id', { schema: { params: IdParams, response: { 200: ProductResponse } } }, async (request) => {
    const product = await app.db.product.findFirst({ where: { id: request.params.id, sellerId: request.identity!.sellerId } });
    if (!product) throw new AppError('NOT_FOUND', 'Produto não encontrado.', 404);
    return { ...product, updatedAt: product.updatedAt.toISOString() };
  });
  async function validateAssets(sellerId: string, imageAssetId?: string | null, digitalAssetId?: string | null) {
    for (const [id, kind] of [[imageAssetId, 'image'], [digitalAssetId, 'digital']] as const) {
      if (id && !await app.db.asset.findFirst({ where: { id, sellerId, kind } })) throw new AppError('ASSET_INVALID', 'Arquivo não disponível para esta conta.');
    }
  }
  app.post('/products', { schema: { body: ProductInput, response: { 201: ProductResponse } } }, async (request, reply) => {
    const sellerId = request.identity!.sellerId;
    await validateAssets(sellerId, request.body.imageAssetId, request.body.digitalAssetId);
    const product = await app.db.product.create({ data: { ...request.body, name: request.body.name.trim(), sellerId } });
    reply.code(201);
    return { ...product, updatedAt: product.updatedAt.toISOString() };
  });
  app.patch('/products/:id', { schema: { params: IdParams, body: ProductInput, response: { 200: ProductResponse } } }, async (request) => {
    const sellerId = request.identity!.sellerId;
    await validateAssets(sellerId, request.body.imageAssetId, request.body.digitalAssetId);
    return app.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Seller" WHERE id = ${sellerId}::uuid FOR UPDATE`;
      const product = await tx.product.findFirst({ where: { id: request.params.id, sellerId } });
      if (!product) throw new AppError('NOT_FOUND', 'Produto não encontrado.', 404);
      if (product.status === 'active') throw new AppError('PAUSE_FIRST', 'Pause o produto antes de editar.', 409);
      const updated = await tx.product.update({ where: { id: product.id }, data: request.body });
      return { ...updated, updatedAt: updated.updatedAt.toISOString() };
    });
  });
  app.post('/products/:id/publish', { schema: { params: IdParams, response: { 200: MessageResponse } } }, async (request) => {
    gatewayFor(app.config);
    const candidate = await app.db.product.findFirst({ where: { id: request.params.id, sellerId: request.identity!.sellerId } });
    if (candidate?.digitalAssetId) {
      const asset = await app.db.asset.findFirst({ where: { id: candidate.digitalAssetId, sellerId: request.identity!.sellerId, kind: 'digital' } });
      if (asset && asset.status === 'quarantined') {
        await scanFile(resolve(app.config.storageDir, asset.storageKey), app.config);
        await app.db.asset.update({ where: { id: asset.id }, data: { status: 'approved' } });
      }
    }
    await app.db.$transaction(async (tx) => {
      const sellerId = request.identity!.sellerId;
      await tx.$queryRaw`SELECT id FROM "Seller" WHERE id = ${sellerId}::uuid FOR UPDATE`;
      const seller = await tx.seller.findUniqueOrThrow({ where: { id: sellerId }, include: { user: true } });
      const product = await tx.product.findFirst({ where: { id: request.params.id, sellerId } });
      if (!product) throw new AppError('NOT_FOUND', 'Produto não encontrado.', 404);
      if (seller.moderationStatus !== 'active') throw new AppError('SELLER_SUSPENDED', 'Esta conta não pode publicar produtos.', 403);
      if (product.status === 'active') return;
      assertPublicationLimit(effectivePlan(seller), await tx.product.count({ where: { sellerId, status: 'active' } }));
      if (!seller.user.emailVerifiedAt) throw new AppError('EMAIL_UNVERIFIED', 'Confirme seu e-mail antes de publicar.', 409);
      if (!product.name.trim() || product.description.trim().length < 10) throw new AppError('PRODUCT_INCOMPLETE', 'Complete os dados do produto.', 409);
      if (!product.imageAssetId || !await tx.asset.findFirst({ where: { id: product.imageAssetId, sellerId, kind: 'image', status: 'approved' } })) throw new AppError('IMAGE_REQUIRED', 'Adicione uma imagem ao produto.', 409);
      if (product.type === 'digital' && (!product.digitalAssetId || !await tx.asset.findFirst({ where: { id: product.digitalAssetId, sellerId, kind: 'digital', status: 'approved' } }))) throw new AppError('DIGITAL_FILE_REQUIRED', 'Adicione um arquivo digital aprovado.', 409);
      if (product.type === 'physical' && !product.shippingDays) throw new AppError('SHIPPING_REQUIRED', 'Informe o prazo de postagem.', 409);
      await tx.product.update({ where: { id: product.id }, data: { status: 'active' } });
    });
    return { message: 'Produto publicado.' };
  });
  app.post('/products/:id/pause', { schema: { params: IdParams, response: { 200: MessageResponse } } }, async (request) => {
    await app.db.$transaction(async tx => {
      const sellerId = request.identity!.sellerId;
      await tx.$queryRaw`SELECT id FROM "Seller" WHERE id = ${sellerId}::uuid FOR UPDATE`;
      const updated = await tx.product.updateMany({ where: { id: request.params.id, sellerId, status: 'active' }, data: { status: 'paused' } });
      if (!updated.count) throw new AppError('NOT_ACTIVE', 'Produto ativo não encontrado.', 404);
    });
    return { message: 'Produto pausado.' };
  });
}
