import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Prisma } from '../generated/prisma/client.ts';
import { ZipFile } from 'yazl';
import { buyerStamp, stampPdf } from '../lib/pdf-stamp.ts';
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
          await queueMail(tx, app.config, order.buyerEmail, mail);
        } else {
          await queueMail(tx, app.config, order.buyerEmail, status === 'refunded'
            ? { test: true, eyebrow: 'Reembolso', subject: 'Pagamento reembolsado', heading: 'Seu pagamento foi reembolsado.', paragraphs: ['O reembolso foi registrado e o acesso ao download deste pedido foi encerrado.'], facts: [{ label: 'Produto', value: order.productName }, { label: 'Pedido', value: order.id }] }
            : { test: true, eyebrow: 'Pagamento', subject: 'Pagamento recusado', heading: 'O pagamento não foi aprovado.', paragraphs: ['Nenhum valor foi movimentado. Se quiser, inicie uma nova compra pelo link do produto.'], facts: [{ label: 'Produto', value: order.productName }, { label: 'Pedido', value: order.id }] });
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
      const product = await tx.product.findUniqueOrThrow({ where: { id: candidate.id }, include: { seller: { include: { user: true } }, files: { orderBy: { position: 'asc' } } } });
      if (product.status !== 'active' || product.seller.moderationStatus !== 'active' || !product.seller.user.emailVerifiedAt) throw new AppError('PRODUCT_UNAVAILABLE', 'Produto indisponível.', 409);
      const fee = await currentFee(tx);
      if (fee.id !== input.feePolicyId || product.updatedAt.toISOString() !== input.productVersion) throw new AppError('PRICE_CHANGED', 'As condições do produto mudaram. Atualize o checkout antes de continuar.', 409);
      if (!product.paymentMethods.includes(input.method)) throw new AppError('METHOD_INVALID', 'Forma de pagamento indisponível.');
      if (product.type === 'physical' && !input.address) throw new AppError('ADDRESS_REQUIRED', 'Informe o endereço de entrega.');
      if (product.type === 'digital' && (!product.files.length || await tx.asset.count({ where: { id: { in: product.files.map(f => f.assetId) }, sellerId: product.sellerId, status: 'approved', kind: 'digital' } }) !== product.files.length)) throw new AppError('FILE_UNAVAILABLE', 'Arquivo indisponível para venda.', 409);
      const id = randomUUID();
      const amounts = calculateFee(product.priceCents, fee.basisPoints);
      const payment = gateway.create({ orderId: id, ...amounts, sellerCents: amounts.priceCents, method: input.method });
      const order = await tx.order.create({ data: {
        id, sellerId: product.sellerId, productId: product.id, productName: product.name, productType: product.type,
        files: { create: product.type === 'digital' ? product.files.map(f => ({ assetId: f.assetId, position: f.position })) : [] },
        stampBuyer: product.type === 'digital' && product.stampBuyer,
        buyerName: input.buyerName, buyerEmail: input.buyerEmail, buyerDocumentEncrypted: encrypt(input.buyerDocument, app.config.encryptionKey),
        addressEncrypted: product.type === 'physical' ? encrypt(JSON.stringify(input.address), app.config.encryptionKey) : null,
        ...amounts, feePolicyId: fee.id, feeBasisPoints: fee.basisPoints, gateway: gateway.name, checkoutKeyHash: keyHash, requestHash,
        expiresAt: new Date(Date.now() + 30 * 60_000),
        payment: { create: { gateway: gateway.name, reference: payment.reference, status: payment.status, method: input.method } },
      }, include: { payment: true } });
      const accessUrl = await issueAccess(tx, id, app.config, input.checkoutToken);
      await queueMail(tx, app.config, input.buyerEmail, { test: gateway.name === 'simulated', eyebrow: 'Pedido recebido', subject: 'Pedido recebido', heading: 'Recebemos seu pedido.', paragraphs: ['Ele aguarda a confirmação do pagamento. Avisaremos por e-mail assim que for aprovado.'], facts: [{ label: 'Produto', value: product.name }, { label: 'Pedido', value: id }], action: { label: 'Acompanhar pedido', url: accessUrl }, note: 'Este link de acompanhamento vale por 24 horas.' });
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
    return app.db.order.findUniqueOrThrow({ where: { id: session.orderId }, include: { payment: true, files: true } });
  }
  app.post('/buyer/order', { schema: { body: BuyerBody, response: { 200: OrderResponse } } }, async request => publicOrder(await buyerOrder(request.body.token, request.cookies.nostore_buyer)));
  app.post('/buyer/renew-access', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } }, schema: { body: Type.Object({ orderId: Type.String({ format: 'uuid' }), email: Type.String({ format: 'email', maxLength: 254 }) }, { additionalProperties: false }), response: { 200: MessageResponse } } }, async request => {
    await app.db.$transaction(async tx => {
      const order = await tx.order.findFirst({ where: { id: request.body.orderId, buyerEmail: request.body.email.trim().toLowerCase() } });
      if (!order) return;
      const paid = order.status === 'paid';
      const link = await issueAccess(tx, order.id, app.config, token(), paid);
      await queueMail(tx, app.config, order.buyerEmail, { test: order.gateway === 'simulated', eyebrow: 'Acesso ao pedido', subject: 'Novo acesso ao pedido', heading: 'Aqui está o seu novo link.', paragraphs: [paid ? 'Este link é permanente: guarde este e-mail para acessar o pedido e os arquivos sempre que precisar.' : 'Este link vale por 24 horas.'], facts: [{ label: 'Produto', value: order.productName }, { label: 'Pedido', value: order.id }], action: { label: 'Acessar pedido', url: link } });
    });
    return { message: 'Se os dados corresponderem a uma compra, enviaremos um novo link por e-mail.' };
  });
  app.post('/buyer/download-ticket', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { body: BuyerBody, response: { 201: Type.Object({ url: Type.String(), expiresIn: Type.Integer() }) } } }, async (request, reply) => {
    const raw = token();
    const order = await buyerOrder(request.body.token, request.cookies.nostore_buyer);
    await app.db.$transaction(async tx => {
      if (order.status !== 'paid' || !order.files.length || !order.downloadUntil || order.downloadUntil <= new Date()) throw new AppError('DOWNLOAD_FORBIDDEN', 'O download não está disponível para este pedido.', 403);
      await tx.downloadTicket.create({ data: { orderId: order.id, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + 60_000) } });
    });
    reply.code(201); return { url: `/api/v1/buyer/download?ticket=${raw}`, expiresIn: 60 };
  });
  app.get('/buyer/download', { schema: { querystring: Type.Object({ ticket: Type.String({ pattern: '^[a-f0-9]{64}$' }) }, { additionalProperties: false }) } }, async (request, reply) => {
    const { order, assets } = await app.db.$transaction(async tx => {
      const ticket = await tx.downloadTicket.findUnique({ where: { tokenHash: hashToken(request.query.ticket) } });
      if (!ticket) throw new AppError('DOWNLOAD_EXPIRED', 'Link de download inválido ou expirado.', 403);
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${ticket.orderId}::uuid FOR UPDATE`;
      const order = await tx.order.findUniqueOrThrow({ where: { id: ticket.orderId }, include: { files: true } });
      if (order.status !== 'paid' || !order.files.length || !order.downloadUntil || order.downloadUntil <= new Date()) throw new AppError('DOWNLOAD_FORBIDDEN', 'O download não está disponível para este pedido.', 403);
      const assets = await orderAssets(tx, order);
      const claimed = await tx.downloadTicket.updateMany({ where: { id: ticket.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
      if (!claimed.count) throw new AppError('DOWNLOAD_EXPIRED', 'Este link expirou ou já foi utilizado. Gere outro na página do pedido.', 403);
      return { order, assets };
    });
    return sendBundle(reply, order, assets);
  });
  // Permanent download link sent by e-mail: the access token identifies a paid digital order.
  app.get('/buyer/file', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { querystring: Type.Object({ token: Type.String({ pattern: '^[a-f0-9]{64}$' }) }, { additionalProperties: false }) } }, async (request, reply) => {
    const order = await authorizeOrder(app.db, request.query.token);
    if (order.status !== 'paid' || !order.files.length || !order.downloadUntil || order.downloadUntil <= new Date()) throw new AppError('DOWNLOAD_FORBIDDEN', 'O download não está disponível para este pedido.', 403);
    return sendBundle(reply, order, await orderAssets(app.db, order));
  });
  // Resolves the files bought with an order, in bundle order, and fails if any is no longer approved.
  async function orderAssets(db: Pick<Prisma.TransactionClient, 'asset'>, order: { sellerId: string; files: { assetId: string; position: number }[] }) {
    const ids = order.files.map(f => f.assetId);
    const assets = ids.length ? await db.asset.findMany({ where: { id: { in: ids }, sellerId: order.sellerId, kind: 'digital', status: 'approved' } }) : [];
    if (!ids.length || assets.length !== ids.length) throw new AppError('FILE_UNAVAILABLE', 'Arquivo indisponível. Entre em contato com o vendedor.', 409);
    const byId = new Map(assets.map(a => [a.id, a]));
    return [...order.files].sort((a, b) => a.position - b.position).map(f => byId.get(f.assetId)!);
  }
  const disposition = (name: string) => `attachment; filename*=UTF-8''${encodeURIComponent(name).replace(/'/g, '%27')}`;
  type Deliverable = { storageKey: string; originalName: string; size: number; mimeType: string };
  // When the product asks for it, PDFs get the buyer's name and document stamped on every page.
  // Other formats pass through untouched; a PDF that cannot be parsed is delivered as uploaded.
  async function deliverable(order: { id: string; stampBuyer: boolean; buyerName: string; buyerDocumentEncrypted: string }, asset: Deliverable): Promise<{ body: Buffer | import('node:stream').Readable; size?: number }> {
    const stream = await app.storage.get(asset.storageKey);
    if (!order.stampBuyer || asset.mimeType !== 'application/pdf') return { body: stream, size: asset.size };
    const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(chunk as Buffer);
    const original = Buffer.concat(chunks);
    try {
      const stamped = Buffer.from(await stampPdf(original, buyerStamp({ name: order.buyerName, document: decrypt(order.buyerDocumentEncrypted, app.config.encryptionKey) })));
      return { body: stamped, size: stamped.length };
    } catch (error) {
      app.log.warn({ err: error, orderId: order.id, storageKey: asset.storageKey }, 'PDF stamping failed; delivering the original file');
      return { body: original, size: original.length };
    }
  }
  // A single file is sent as is; a bundle is streamed as one ZIP (stored, the files are already compressed formats).
  async function sendBundle(reply: FastifyReply, order: { id: string; productName: string; stampBuyer: boolean; buyerName: string; buyerDocumentEncrypted: string }, assets: Deliverable[]) {
    reply.header('Referrer-Policy', 'no-referrer').type('application/octet-stream');
    if (assets.length === 1) {
      const asset = assets[0]!;
      const { body, size } = await deliverable(order, asset);
      reply.header('Content-Disposition', disposition(asset.originalName));
      if (size !== undefined) reply.header('Content-Length', size);
      return reply.send(body);
    }
    const zip = new ZipFile();
    const names = new Set<string>();
    for (const asset of assets) {
      let name = asset.originalName.replace(/[\\/]+/g, '_').trim() || 'arquivo';
      for (let n = 2; names.has(name); n++) name = asset.originalName.replace(/(\.[^.]*)?$/, `-${n}$1`);
      names.add(name);
      const { body } = await deliverable(order, asset);
      if (Buffer.isBuffer(body)) zip.addBuffer(body, name, { compress: false }); else zip.addReadStream(body, name, { compress: false });
    }
    zip.end();
    reply.header('Content-Disposition', disposition(`${order.productName.replace(/[\\/]+/g, '_').trim() || 'pacote'}.zip`));
    return reply.send(zip.outputStream);
  }
}
