import type { FastifyInstance, FastifyReply } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { randomUUID } from 'node:crypto';
import { AppError, calculateFee, isValidDocument } from '../lib/domain.ts';
import { decrypt, encrypt, hashToken, token } from '../lib/security.ts';
import { gatewayFor } from '../lib/gateway.ts';
import { authorizeOrder, currentFee, day, downloadDeadline, isAdmin, issueAccess, paymentConfirmedMail, publicOrder, queueMail } from '../lib/commerce.ts';
import { AccessBody, Address, CheckoutInput, FeeResponse, OrderResponse } from '../lib/commerce-schemas.ts';
import { IdParams, MessageResponse } from '../lib/schemas.ts';

export async function commerceRoutes(server: FastifyInstance) {
  const app = server.withTypeProvider<TypeBoxTypeProvider>();
  await app.register(async scoped => {
    const seller = scoped.withTypeProvider<TypeBoxTypeProvider>();
    seller.addHook('onRequest', app.authenticate);
    seller.get('/seller/fee', { schema: { response: { 200: FeeResponse } } }, async () => {
      const fee = await currentFee(app.db);
      return { ...fee, createdAt: fee.createdAt.toISOString() };
    });
    seller.get('/seller/orders', { schema: { querystring: Type.Object({
      page: Type.Integer({ minimum: 1, default: 1 }), limit: Type.Integer({ minimum: 1, maximum: 50, default: 20 }),
      productId: Type.Optional(Type.String({ format: 'uuid' })),
      status: Type.Optional(Type.Union(['pending', 'paid', 'rejected', 'refunded', 'expired'].map(v => Type.Literal(v)))),
    }), response: { 200: Type.Object({ items: Type.Array(Type.Intersect([OrderResponse, Type.Object({ buyerName: Type.String(), buyerEmail: Type.String() })])), total: Type.Integer(), paidCount: Type.Integer(), grossCents: Type.Integer(), feeCents: Type.Integer(), sellerCents: Type.Integer() }) } } }, async request => {
      const { page, limit, productId, status } = request.query;
      const base = { sellerId: request.identity!.sellerId, ...(productId ? { productId } : {}) };
      const where = { ...base, ...(status === 'expired' ? { status: 'pending', expiresAt: { lte: new Date() } } : status === 'pending' ? { status, expiresAt: { gt: new Date() } } : status ? { status } : {}) };
      const [items, total, sums] = await Promise.all([
        app.db.order.findMany({ where, include: { payment: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit }),
        app.db.order.count({ where }),
        app.db.order.aggregate({ where: { ...base, status: 'paid' }, _count: true, _sum: { totalCents: true, feeCents: true, priceCents: true } }),
      ]);
      return { items: items.map(o => ({ ...publicOrder(o), buyerName: o.buyerName, buyerEmail: o.buyerEmail })), total, paidCount: sums._count, grossCents: sums._sum.totalCents ?? 0, feeCents: sums._sum.feeCents ?? 0, sellerCents: sums._sum.priceCents ?? 0 };
    });
    seller.get('/seller/orders/:id', { schema: { params: IdParams, response: { 200: Type.Intersect([OrderResponse, Type.Object({ buyerName: Type.String(), buyerEmail: Type.String(), address: Type.Union([Address, Type.Null()]) })]) } } }, async request => {
      const order = await app.db.order.findFirst({ where: { id: request.params.id, sellerId: request.identity!.sellerId }, include: { payment: true } });
      if (!order) throw new AppError('NOT_FOUND', 'Pedido não encontrado.', 404);
      return { ...publicOrder(order), buyerName: order.buyerName, buyerEmail: order.buyerEmail, address: order.addressEncrypted ? JSON.parse(decrypt(order.addressEncrypted, app.config.encryptionKey)) : null };
    });
    seller.post('/seller/orders/:id/simulate', { schema: { params: IdParams, body: Type.Object({ outcome: Type.Union([Type.Literal('paid'), Type.Literal('rejected'), Type.Literal('refunded')]) }, { additionalProperties: false }), response: { 200: OrderResponse } } }, async request => {
      const gateway = gatewayFor(app.config);
      return app.db.$transaction(async tx => {
        const id = request.params.id;
        await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${id}::uuid FOR UPDATE`;
        const order = await tx.order.findFirst({ where: { id, sellerId: request.identity!.sellerId }, include: { payment: true } });
        if (!order || order.gateway !== gateway.name || !order.payment) throw new AppError('NOT_FOUND', 'Pedido de teste não encontrado.', 404);
        if (order.status === 'pending' && order.expiresAt <= new Date()) throw new AppError('ORDER_EXPIRED', 'Este pedido expirou. Inicie outro checkout.', 409);
        const status = gateway.simulate(order.status, request.body.outcome);
        if (order.status === status) return publicOrder(order);
        const paid = status === 'paid';
        const updated = await tx.order.update({ where: { id }, data: { status, ...(paid ? { paidAt: new Date(), downloadUntil: downloadDeadline() } : {}) }, include: { payment: true } });
        await tx.paymentAttempt.update({ where: { orderId: id }, data: { status } });
        if (paid) {
          // One e-mail with the confirmation and a permanent link; digital orders also get a direct download URL.
          const raw = token();
          const link = await issueAccess(tx, id, app.config, raw, true);
          const mail = paymentConfirmedMail(order, link, order.productType === 'digital' ? `${app.config.origin}/api/v1/buyer/file?token=${raw}` : null);
          await queueMail(tx, app.config, order.buyerEmail, mail.subject, mail.text);
        } else {
          await queueMail(tx, app.config, order.buyerEmail, status === 'refunded' ? '[Teste] Pagamento reembolsado' : '[Teste] Pagamento recusado', `Pedido: ${order.productName}. ${status === 'refunded' ? 'O reembolso foi simulado e o acesso ao download foi revogado.' : 'O pagamento foi recusado na simulação. Você pode iniciar uma nova compra.'} Nenhum valor foi movimentado.`);
        }
        return publicOrder(updated);
      });
    });
    await seller.register(async adminScoped => {
      const admin = adminScoped.withTypeProvider<TypeBoxTypeProvider>();
      admin.addHook('preHandler', async request => {
        const user = await app.db.user.findUniqueOrThrow({ where: { id: request.identity!.userId } });
        if (!isAdmin(app.config, user)) throw new AppError('FORBIDDEN', 'Esta configuração exige uma conta administradora com e-mail confirmado.', 403);
      });
      admin.get('/admin/fee', { schema: { response: { 200: Type.Object({ current: FeeResponse, history: Type.Array(FeeResponse) }) } } }, async () => {
        const fees = await app.db.feePolicy.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20 });
        const history = fees.map(f => ({ ...f, createdAt: f.createdAt.toISOString() }));
        return { current: history[0]!, history };
      });
      admin.post('/admin/fee', { schema: { body: Type.Object({ basisPoints: Type.Integer({ minimum: 0, maximum: 10000 }), previousId: Type.String({ format: 'uuid' }) }, { additionalProperties: false }), response: { 201: FeeResponse } } }, async (request, reply) => {
        const fee = await app.db.$transaction(async tx => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(730001)::text`;
          const previous = await currentFee(tx);
          if (previous.id !== request.body.previousId) throw new AppError('FEE_CHANGED', 'A taxa foi alterada por outra sessão. Atualize a página.', 409);
          return tx.feePolicy.create({ data: { basisPoints: request.body.basisPoints, createdBy: request.identity!.userId, createdAt: new Date(Math.max(Date.now(), previous.createdAt.getTime() + 1)) } });
        });
        reply.code(201);
        return { ...fee, createdAt: fee.createdAt.toISOString() };
      });
    });
  });

  const CheckoutResponse = Type.Object({ publicId: Type.String(), version: Type.String(), name: Type.String(), description: Type.String(), type: Type.String(), sellerName: Type.String(), imageUrl: Type.String(), paymentMethods: Type.Array(Type.String()), priceCents: Type.Integer(), feeCents: Type.Integer(), totalCents: Type.Integer(), feePolicy: FeeResponse, gateway: Type.String(), shippingDays: Type.Union([Type.Integer(), Type.Null()]) });
  app.get('/checkout/:id', { schema: { params: IdParams, response: { 200: CheckoutResponse } } }, async request => {
    const gateway = gatewayFor(app.config);
    const [product, fee] = await Promise.all([
      app.db.product.findFirst({ where: { publicId: request.params.id, status: 'active', seller: { moderationStatus: 'active' } }, include: { seller: true } }), currentFee(app.db),
    ]);
    if (!product) throw new AppError('NOT_FOUND', 'Este produto não está disponível para compra.', 404);
    return { publicId: product.publicId, version: product.updatedAt.toISOString(), name: product.name, description: product.description, type: product.type, sellerName: product.seller.displayName, imageUrl: `/api/v1/checkout/${product.publicId}/image`, paymentMethods: product.paymentMethods, ...calculateFee(product.priceCents, fee.basisPoints), feePolicy: { ...fee, createdAt: fee.createdAt.toISOString() }, gateway: gateway.name, shippingDays: product.shippingDays };
  });
  app.get('/checkout/:id/image', { schema: { params: IdParams } }, async (request, reply) => {
    const product = await app.db.product.findFirst({ where: { publicId: request.params.id, status: 'active', seller: { moderationStatus: 'active' } } });
    const asset = product?.imageAssetId ? await app.db.asset.findFirst({ where: { id: product.imageAssetId, sellerId: product.sellerId, kind: 'image', status: 'approved' } }) : null;
    if (!asset) throw new AppError('NOT_FOUND', 'Imagem não encontrada.', 404);
    return reply.type('image/webp').send(await app.storage.get(asset.storageKey));
  });
  app.post('/checkout/orders', { config: { rateLimit: { max: 15, timeWindow: '1 minute' } }, schema: { body: CheckoutInput, response: { 201: Type.Object({ order: OrderResponse, accessUrl: Type.String() }) } } }, async (request, reply) => {
    const gateway = gatewayFor(app.config);
    const input = request.body;
    input.buyerName = input.buyerName.trim(); input.buyerEmail = input.buyerEmail.trim().toLowerCase();
    if (input.buyerName.length < 2 || !isValidDocument(input.buyerDocument)) throw new AppError('BUYER_INVALID', 'Informe nome e CPF/CNPJ válidos.');
    const keyHash = hashToken(input.checkoutToken);
    const requestHash = hashToken(JSON.stringify(input));
    const result = await app.db.$transaction(async tx => {
      // Same checkout token is serialized even across concurrent retries.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${keyHash}, 0))::text`;
      const existing = await tx.order.findUnique({ where: { checkoutKeyHash: keyHash }, include: { payment: true } });
      if (existing) {
        if (existing.requestHash !== requestHash) throw new AppError('CHECKOUT_CONFLICT', 'Os dados desta compra mudaram. Inicie um novo checkout.', 409);
        return { order: publicOrder(existing), accessUrl: `${app.config.origin}/pedido#token=${input.checkoutToken}` };
      }
      const candidate = await tx.product.findUnique({ where: { publicId: input.productId } });
      if (!candidate) throw new AppError('NOT_FOUND', 'Produto indisponível.', 404);
      await tx.$queryRaw`SELECT id FROM "Seller" WHERE id = ${candidate.sellerId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(730001)::text`;
      const product = await tx.product.findUniqueOrThrow({ where: { id: candidate.id }, include: { seller: { include: { user: true } } } });
      if (product.status !== 'active' || product.seller.moderationStatus !== 'active' || !product.seller.user.emailVerifiedAt) throw new AppError('PRODUCT_UNAVAILABLE', 'Produto indisponível.', 409);
      const fee = await currentFee(tx);
      if (fee.id !== input.feePolicyId || product.updatedAt.toISOString() !== input.productVersion) throw new AppError('PRICE_CHANGED', 'As condições do produto mudaram. Atualize o checkout antes de continuar.', 409);
      if (!product.paymentMethods.includes(input.method)) throw new AppError('METHOD_INVALID', 'Forma de pagamento indisponível.');
      if (product.type === 'physical' && !input.address) throw new AppError('ADDRESS_REQUIRED', 'Informe o endereço de entrega.');
      if (product.type === 'digital' && (!product.digitalAssetId || !await tx.asset.findFirst({ where: { id: product.digitalAssetId, sellerId: product.sellerId, status: 'approved', kind: 'digital' } }))) throw new AppError('FILE_UNAVAILABLE', 'Arquivo indisponível para venda.', 409);
      const id = randomUUID();
      const amounts = calculateFee(product.priceCents, fee.basisPoints);
      const payment = gateway.create({ orderId: id, ...amounts, sellerCents: amounts.priceCents, method: input.method });
      const order = await tx.order.create({ data: {
        id, sellerId: product.sellerId, productId: product.id, productName: product.name, productType: product.type,
        digitalAssetId: product.type === 'digital' ? product.digitalAssetId : null,
        buyerName: input.buyerName, buyerEmail: input.buyerEmail, buyerDocumentEncrypted: encrypt(input.buyerDocument, app.config.encryptionKey),
        addressEncrypted: product.type === 'physical' ? encrypt(JSON.stringify(input.address), app.config.encryptionKey) : null,
        ...amounts, feePolicyId: fee.id, feeBasisPoints: fee.basisPoints, gateway: gateway.name, checkoutKeyHash: keyHash, requestHash,
        expiresAt: new Date(Date.now() + 30 * 60_000),
        payment: { create: { gateway: gateway.name, reference: payment.reference, status: payment.status, method: input.method } },
      }, include: { payment: true } });
      const accessUrl = await issueAccess(tx, id, app.config, input.checkoutToken);
      await queueMail(tx, app.config, input.buyerEmail, '[Teste] Pedido recebido', `Seu pedido de ${product.name} foi criado e aguarda aprovação simulada pelo vendedor. Nenhum valor será cobrado.\nPedido: ${id}\nAcompanhe: ${accessUrl}`);
      return { order: publicOrder(order), accessUrl };
    });
    reply.code(201); return result;
  });
  // The access link is exchanged via POST, then the browser removes the fragment.
  app.post('/buyer/session', { schema: { body: AccessBody, response: { 200: MessageResponse } } }, async (request, reply) => {
    const order = await authorizeOrder(app.db, request.body.token);
    const raw = token();
    await app.db.buyerSession.create({ data: { orderId: order.id, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + day) } });
    reply.setCookie('nostore_buyer', raw, { path: '/api/v1/buyer', httpOnly: true, secure: app.config.production, sameSite: 'strict', maxAge: day / 1000 });
    return { message: 'Acesso autorizado.' };
  });
  const BuyerBody = Type.Object({ token: Type.Optional(Type.String({ pattern: '^[a-f0-9]{64}$' })) }, { additionalProperties: false });
  async function buyerOrder(raw: string | undefined, cookie: string | undefined) {
    if (raw) return authorizeOrder(app.db, raw);
    const session = cookie && /^[a-f0-9]{64}$/.test(cookie) ? await app.db.buyerSession.findUnique({ where: { tokenHash: hashToken(cookie) } }) : null;
    if (!session || session.expiresAt <= new Date()) throw new AppError('ACCESS_INVALID', 'Acesso expirado. Solicite outro link pelo e-mail da compra.', 401);
    return app.db.order.findUniqueOrThrow({ where: { id: session.orderId }, include: { payment: true } });
  }
  app.post('/buyer/order', { schema: { body: BuyerBody, response: { 200: OrderResponse } } }, async request => publicOrder(await buyerOrder(request.body.token, request.cookies.nostore_buyer)));
  app.post('/buyer/renew-access', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } }, schema: { body: Type.Object({ orderId: Type.String({ format: 'uuid' }), email: Type.String({ format: 'email', maxLength: 254 }) }, { additionalProperties: false }), response: { 200: MessageResponse } } }, async request => {
    await app.db.$transaction(async tx => {
      const order = await tx.order.findFirst({ where: { id: request.body.orderId, buyerEmail: request.body.email.trim().toLowerCase() } });
      if (!order) return;
      const paid = order.status === 'paid';
      const link = await issueAccess(tx, order.id, app.config, token(), paid);
      await queueMail(tx, app.config, order.buyerEmail, `${order.gateway === 'simulated' ? '[Teste] ' : ''}Novo acesso ao pedido`, `Pedido: ${order.id}\nAcesse seu pedido: ${link}\n${paid ? 'Este link é permanente.' : 'Este link vale por 24 horas.'}`);
    });
    return { message: 'Se os dados corresponderem a uma compra, enviaremos um novo link por e-mail.' };
  });
  app.post('/buyer/download-ticket', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { body: BuyerBody, response: { 201: Type.Object({ url: Type.String(), expiresIn: Type.Integer() }) } } }, async (request, reply) => {
    const raw = token();
    const order = await buyerOrder(request.body.token, request.cookies.nostore_buyer);
    await app.db.$transaction(async tx => {
      if (order.status !== 'paid' || !order.digitalAssetId || !order.downloadUntil || order.downloadUntil <= new Date()) throw new AppError('DOWNLOAD_FORBIDDEN', 'O download não está disponível para este pedido.', 403);
      await tx.downloadTicket.create({ data: { orderId: order.id, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + 60_000) } });
    });
    reply.code(201); return { url: `/api/v1/buyer/download?ticket=${raw}`, expiresIn: 60 };
  });
  app.get('/buyer/download', { schema: { querystring: Type.Object({ ticket: Type.String({ pattern: '^[a-f0-9]{64}$' }) }, { additionalProperties: false }) } }, async (request, reply) => {
    const asset = await app.db.$transaction(async tx => {
      const ticket = await tx.downloadTicket.findUnique({ where: { tokenHash: hashToken(request.query.ticket) } });
      if (!ticket) throw new AppError('DOWNLOAD_EXPIRED', 'Link de download inválido ou expirado.', 403);
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${ticket.orderId}::uuid FOR UPDATE`;
      const order = await tx.order.findUniqueOrThrow({ where: { id: ticket.orderId } });
      if (order.status !== 'paid' || !order.digitalAssetId || !order.downloadUntil || order.downloadUntil <= new Date()) throw new AppError('DOWNLOAD_FORBIDDEN', 'O download não está disponível para este pedido.', 403);
      const asset = await tx.asset.findFirst({ where: { id: order.digitalAssetId, sellerId: order.sellerId, kind: 'digital', status: 'approved' } });
      if (!asset) throw new AppError('FILE_UNAVAILABLE', 'Arquivo indisponível. Entre em contato com o vendedor.', 409);
      const claimed = await tx.downloadTicket.updateMany({ where: { id: ticket.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
      if (!claimed.count) throw new AppError('DOWNLOAD_EXPIRED', 'Este link expirou ou já foi utilizado. Gere outro na página do pedido.', 403);
      return asset;
    });
    return sendAsset(reply, asset);
  });
  // Permanent download link sent by e-mail: the access token identifies a paid digital order.
  app.get('/buyer/file', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { querystring: Type.Object({ token: Type.String({ pattern: '^[a-f0-9]{64}$' }) }, { additionalProperties: false }) } }, async (request, reply) => {
    const order = await authorizeOrder(app.db, request.query.token);
    if (order.status !== 'paid' || !order.digitalAssetId || !order.downloadUntil || order.downloadUntil <= new Date()) throw new AppError('DOWNLOAD_FORBIDDEN', 'O download não está disponível para este pedido.', 403);
    const asset = await app.db.asset.findFirst({ where: { id: order.digitalAssetId, sellerId: order.sellerId, kind: 'digital', status: 'approved' } });
    if (!asset) throw new AppError('FILE_UNAVAILABLE', 'Arquivo indisponível. Entre em contato com o vendedor.', 409);
    return sendAsset(reply, asset);
  });
  async function sendAsset(reply: FastifyReply, asset: { storageKey: string; originalName: string; size: number }) {
    const file = await app.storage.get(asset.storageKey);
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(asset.originalName).replace(/'/g, '%27')}`).header('Content-Length', asset.size).header('Referrer-Policy', 'no-referrer').type('application/octet-stream');
    return reply.send(file);
  }
}
