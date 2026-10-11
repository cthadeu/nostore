import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { AppError, effectivePlan, assertPublicationLimit, isValidDocument } from '../lib/domain.ts';
import { gatewayFor } from '../lib/gateway.ts';
import { isAdmin } from '../lib/commerce.ts';
import { scanFile } from '../lib/scanner.ts';
import { encrypt } from '../lib/security.ts';
import { IdParams, ProductInput, ProductResponse, MessageResponse } from '../lib/schemas.ts';

export async function sellerRoutes(server: FastifyInstance) {
  const app = server.withTypeProvider<TypeBoxTypeProvider>();
  // Digital products are bundles of files kept in order.
  const withFiles = { files: { orderBy: { position: 'asc' as const }, include: { asset: { select: { originalName: true, size: true } } } } };
  const present = <T extends { updatedAt: Date; files: { assetId: string; asset: { originalName: string; size: number } }[] }>(product: T) => ({ ...product, digitalAssetIds: product.files.map(f => f.assetId), digitalFiles: product.files.map(f => ({ id: f.assetId, name: f.asset.originalName, size: f.asset.size })), updatedAt: product.updatedAt.toISOString() });
  app.addHook('onRequest', app.authenticate);
  app.get('/profile', async (request) => {
    const seller = await app.db.seller.findUniqueOrThrow({ where: { id: request.identity!.sellerId }, include: { user: true } });
    return { id: seller.id, name: seller.user.name, email: seller.user.email, emailVerified: Boolean(seller.user.emailVerifiedAt), displayName: seller.displayName, personType: seller.personType, documentLast4: seller.documentLast4, plan: effectivePlan(seller), gatewayStatus: seller.gatewayStatus, gatewayAccount: seller.mpUserId, paymentGateway: app.config.paymentGateway, isAdmin: isAdmin(app.config, seller.user) };
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
      app.db.product.findMany({ where, include: withFiles, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (request.query.page - 1) * request.query.limit, take: request.query.limit }),
      app.db.product.count({ where }), app.db.product.count({ where: { ...where, status: 'active' } }),
    ]);
    return { items: items.map(present), total, activeCount };
  });
  app.get('/products/:id', { schema: { params: IdParams, response: { 200: ProductResponse } } }, async (request) => {
    const product = await app.db.product.findFirst({ where: { id: request.params.id, sellerId: request.identity!.sellerId }, include: withFiles });
    if (!product) throw new AppError('NOT_FOUND', 'Produto não encontrado.', 404);
    return present(product);
  });
  async function validateAssets(sellerId: string, imageAssetId: string | null | undefined, digitalAssetIds: string[]) {
    if (imageAssetId && !await app.db.asset.findFirst({ where: { id: imageAssetId, sellerId, kind: 'image' } })) throw new AppError('ASSET_INVALID', 'Arquivo não disponível para esta conta.');
    if (new Set(digitalAssetIds).size !== digitalAssetIds.length) throw new AppError('ASSET_INVALID', 'Arquivo repetido no pacote.');
    if (digitalAssetIds.length && await app.db.asset.count({ where: { id: { in: digitalAssetIds }, sellerId, kind: 'digital' } }) !== digitalAssetIds.length) throw new AppError('ASSET_INVALID', 'Arquivo não disponível para esta conta.');
  }
  const fileRows = (ids: string[]) => ids.map((assetId, position) => ({ assetId, position }));
  app.post('/products', { schema: { body: ProductInput, response: { 201: ProductResponse } } }, async (request, reply) => {
    const sellerId = request.identity!.sellerId;
    const { digitalAssetIds = [], ...body } = request.body;
    await validateAssets(sellerId, body.imageAssetId, digitalAssetIds);
    const product = await app.db.product.create({ data: { ...body, name: body.name.trim(), sellerId, files: { create: fileRows(digitalAssetIds) } }, include: withFiles });
    reply.code(201);
    return present(product);
  });
  app.patch('/products/:id', { schema: { params: IdParams, body: ProductInput, response: { 200: ProductResponse } } }, async (request) => {
    const sellerId = request.identity!.sellerId;
    const { digitalAssetIds = [], ...body } = request.body;
    await validateAssets(sellerId, body.imageAssetId, digitalAssetIds);
    return app.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Seller" WHERE id = ${sellerId}::uuid FOR UPDATE`;
      const product = await tx.product.findFirst({ where: { id: request.params.id, sellerId } });
      if (!product) throw new AppError('NOT_FOUND', 'Produto não encontrado.', 404);
      if (product.status === 'active') throw new AppError('PAUSE_FIRST', 'Pause o produto antes de editar.', 409);
      const updated = await tx.product.update({ where: { id: product.id }, data: { ...body, files: { deleteMany: {}, create: fileRows(digitalAssetIds) } }, include: withFiles });
      return present(updated);
    });
  });
  app.post('/products/:id/publish', { schema: { params: IdParams, response: { 200: MessageResponse } } }, async (request) => {
    gatewayFor(app.config);
    const candidate = await app.db.product.findFirst({ where: { id: request.params.id, sellerId: request.identity!.sellerId }, include: withFiles });
    for (const file of candidate?.files ?? []) {
      const asset = await app.db.asset.findFirst({ where: { id: file.assetId, sellerId: request.identity!.sellerId, kind: 'digital' } });
      if (asset && asset.status === 'quarantined') {
        await scanFile(await app.storage.get(asset.storageKey), app.config);
        await app.db.asset.update({ where: { id: asset.id }, data: { status: 'approved' } });
      }
    }
    await app.db.$transaction(async (tx) => {
      const sellerId = request.identity!.sellerId;
      await tx.$queryRaw`SELECT id FROM "Seller" WHERE id = ${sellerId}::uuid FOR UPDATE`;
      const seller = await tx.seller.findUniqueOrThrow({ where: { id: sellerId }, include: { user: true } });
      const product = await tx.product.findFirst({ where: { id: request.params.id, sellerId }, include: withFiles });
      if (!product) throw new AppError('NOT_FOUND', 'Produto não encontrado.', 404);
      if (seller.moderationStatus !== 'active') throw new AppError('SELLER_SUSPENDED', 'Esta conta não pode publicar produtos.', 403);
      if (app.config.paymentGateway === 'mercadopago' && seller.gatewayStatus !== 'connected') throw new AppError('GATEWAY_NOT_CONNECTED', 'Conecte sua conta Mercado Pago em Configurações → Recebimento antes de publicar.', 409);
      if (product.status === 'active') return;
      assertPublicationLimit(effectivePlan(seller), await tx.product.count({ where: { sellerId, status: 'active' } }));
      if (!seller.user.emailVerifiedAt) throw new AppError('EMAIL_UNVERIFIED', 'Confirme seu e-mail antes de publicar.', 409);
      if (!product.name.trim() || product.description.trim().length < 10) throw new AppError('PRODUCT_INCOMPLETE', 'Complete os dados do produto.', 409);
      if (!product.imageAssetId || !await tx.asset.findFirst({ where: { id: product.imageAssetId, sellerId, kind: 'image', status: 'approved' } })) throw new AppError('IMAGE_REQUIRED', 'Adicione uma imagem ao produto.', 409);
      const fileIds = product.files.map(f => f.assetId);
      if (product.type === 'digital' && (!fileIds.length || await tx.asset.count({ where: { id: { in: fileIds }, sellerId, kind: 'digital', status: 'approved' } }) !== fileIds.length)) throw new AppError('DIGITAL_FILE_REQUIRED', 'Adicione um arquivo digital aprovado.', 409);
      if (product.type === 'physical' && !product.shippingDays) throw new AppError('SHIPPING_REQUIRED', 'Informe o prazo de postagem.', 409);
      await tx.product.update({ where: { id: product.id }, data: { status: 'active' } });
    // Publications serialize on the seller row; allow for remote-database latency under concurrency.
    }, { maxWait: 10_000, timeout: 20_000 });
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
