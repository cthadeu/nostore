import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { Readable } from 'node:stream';
import { issueSignedToken } from '@vercel/blob';
import { handleUploadPresigned } from '@vercel/blob/client';
import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { scanFile } from '../lib/scanner.ts';
import { AppError } from '../lib/domain.ts';
import { detectDigitalMimeType, DIGITAL_FILE_HINT, DIGITAL_HEAD_BYTES, DIGITAL_MEDIA_TYPES } from '../lib/file-types.ts';

// Serverless request bodies are capped at 4.5 MB, so images go through the API while digital files
// are uploaded by the browser straight to the object store with a presigned URL (start → presign →
// complete). The local disk backend keeps the direct API upload.
const IMAGE_LIMIT = 4 * 1024 * 1024, DIGITAL_LIMIT = 100 * 1024 * 1024;
async function readHead(stream: Readable, bytes: number): Promise<Buffer> {
  const chunks: Buffer[] = []; let total = 0;
  for await (const chunk of stream) { chunks.push(chunk as Buffer); total += (chunk as Buffer).length; if (total >= bytes) break; }
  stream.destroy();
  return Buffer.concat(chunks).subarray(0, bytes);
}
export async function assetRoutes(server: FastifyInstance) {
  const app = server.withTypeProvider<TypeBoxTypeProvider>();
  app.addHook('onRequest', app.authenticate);
  const directUploads = () => app.config.fileStorage === 'blob' && Boolean(process.env.BLOB_WEBHOOK_PUBLIC_KEY);
  app.post('/digital/start', { schema: { body: Type.Object({ name: Type.String({ minLength: 1, maxLength: 255 }), size: Type.Integer({ minimum: 1, maximum: DIGITAL_LIMIT }), contentType: Type.String({ maxLength: 120 }) }, { additionalProperties: false }) } }, async (request, reply) => {
    if (!directUploads()) return { mode: 'api', maxApiBytes: IMAGE_LIMIT };
    const key = randomUUID();
    const asset = await app.db.asset.create({ data: { sellerId: request.identity!.sellerId, kind: 'digital', storageKey: key, originalName: basename(request.body.name).slice(0, 200), mimeType: request.body.contentType || 'application/octet-stream', size: request.body.size, status: 'uploading' } });
    reply.code(201);
    return { mode: 'direct', id: asset.id, pathname: app.storage.pathname(key) };
  });
  // Called by the browser SDK: issues a short-lived token bound to one pending asset of this seller.
  app.post('/digital/presign', async request => {
    const sellerId = request.identity!.sellerId;
    return handleUploadPresigned({
      body: request.body as Parameters<typeof handleUploadPresigned>[0]['body'], request: request.raw,
      getSignedToken: async (pathname, clientPayload) => {
        const asset = clientPayload ? await app.db.asset.findFirst({ where: { id: clientPayload, sellerId, kind: 'digital', status: 'uploading' } }) : null;
        if (!asset || pathname !== app.storage.pathname(asset.storageKey)) throw new AppError('ASSET_INVALID', 'Envio não autorizado.', 403);
        const token = await issueSignedToken({ pathname, operations: ['put'], maximumSizeInBytes: DIGITAL_LIMIT, allowedContentTypes: DIGITAL_MEDIA_TYPES, validUntil: Date.now() + 30 * 60_000 });
        return { token };
      },
    });
  });
  app.post('/digital/:id/complete', { schema: { params: Type.Object({ id: Type.String({ format: 'uuid' }) }) } }, async request => {
    const asset = await app.db.asset.findFirst({ where: { id: request.params.id, sellerId: request.identity!.sellerId, kind: 'digital', status: 'uploading' } });
    if (!asset) throw new AppError('NOT_FOUND', 'Envio não encontrado.', 404);
    const info = await app.storage.stat(asset.storageKey);
    if (!info) throw new AppError('UPLOAD_INCOMPLETE', 'O arquivo ainda não chegou ao armazenamento. Tente novamente.', 409);
    const head = await readHead(await app.storage.get(asset.storageKey), DIGITAL_HEAD_BYTES);
    const mimeType = detectDigitalMimeType(head, asset.originalName);
    if (!mimeType) { await app.storage.delete(asset.storageKey); await app.db.asset.delete({ where: { id: asset.id } }); throw new AppError('INVALID_FILE', `Envie um arquivo ${DIGITAL_FILE_HINT} válido.`); }
    if (app.config.fileScan !== 'off') await scanFile(await app.storage.get(asset.storageKey), app.config);
    const updated = await app.db.asset.update({ where: { id: asset.id }, data: { status: 'approved', size: info.size, mimeType } });
    return { id: updated.id, name: updated.originalName, status: updated.status, size: updated.size };
  });
  app.post<{ Params: { kind: string } }>('/:kind', async (request, reply) => {
    const kind = request.params.kind;
    if (kind !== 'image' && kind !== 'digital') throw new AppError('INVALID_KIND', 'Tipo de arquivo inválido.');
    const file = await request.file({ limits: { fileSize: kind === 'image' ? IMAGE_LIMIT : DIGITAL_LIMIT, files: 1, parts: 1 } });
    if (!file) throw new AppError('FILE_REQUIRED', 'Selecione um arquivo.');
    const chunks: Buffer[] = [];
    try { for await (const chunk of file.file) chunks.push(chunk as Buffer); }
    catch (error) {
      if ((error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') throw new AppError('FILE_TOO_LARGE', 'O arquivo ultrapassa o limite permitido.', 413);
      throw error;
    }
    if (file.file.truncated) throw new AppError('FILE_TOO_LARGE', 'O arquivo ultrapassa o limite permitido.', 413);
    let buffer: Buffer = Buffer.concat(chunks);
    let mimeType: string;
    if (kind === 'image') {
      try { buffer = await sharp(buffer, { limitInputPixels: 40_000_000 }).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer(); }
      catch { throw new AppError('INVALID_IMAGE', 'Envie uma imagem válida em JPG, PNG ou WebP.'); }
      mimeType = 'image/webp';
    } else {
      const detected = detectDigitalMimeType(buffer.subarray(0, DIGITAL_HEAD_BYTES), file.filename);
      if (!detected) throw new AppError('INVALID_FILE', `Envie um arquivo ${DIGITAL_FILE_HINT} válido.`);
      mimeType = detected;
      await scanFile(buffer, app.config);
    }
    const key = randomUUID();
    await app.storage.put(key, buffer, mimeType);
    let asset;
    try { asset = await app.db.asset.create({ data: { sellerId: request.identity!.sellerId, kind, storageKey: key, originalName: basename(file.filename).slice(0, 200), mimeType, size: buffer.length, status: 'approved' } }); }
    catch (error) { await app.storage.delete(key); throw error; }
    reply.code(201);
    return { id: asset.id, name: asset.originalName, status: asset.status, size: asset.size };
  });
  app.get<{ Params: { id: string } }>('/:id/image', async (request, reply) => {
    const asset = await app.db.asset.findFirst({ where: { id: request.params.id, sellerId: request.identity!.sellerId, kind: 'image', status: 'approved' } });
    if (!asset) throw new AppError('NOT_FOUND', 'Imagem não encontrada.', 404);
    reply.type('image/webp');
    return reply.send(await app.storage.get(asset.storageKey));
  });
}
