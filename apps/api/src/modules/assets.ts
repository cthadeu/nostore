import type { FastifyInstance } from 'fastify';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { resolve, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { scanFile } from '../lib/scanner.ts';
import { AppError } from '../lib/domain.ts';

export async function assetRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate);
  app.post<{ Params: { kind: string } }>('/:kind', async (request, reply) => {
    const kind = request.params.kind;
    if (kind !== 'image' && kind !== 'digital') throw new AppError('INVALID_KIND', 'Tipo de arquivo inválido.');
    await mkdir(app.config.storageDir, { recursive: true });
    const key = randomUUID();
    const tempPath = resolve(app.config.storageDir, `${key}.upload`);
    const finalPath = resolve(app.config.storageDir, key);
    let persisted = false;
    try {
      const file = await request.file({ limits: { fileSize: kind === 'image' ? 8 * 1024 * 1024 : 100 * 1024 * 1024, files: 1, parts: 1 } });
      if (!file) throw new AppError('FILE_REQUIRED', 'Selecione um arquivo.');
      await pipeline(file.file, createWriteStream(tempPath, { flags: 'wx', mode: 0o600 }));
      if (file.file.truncated) throw new AppError('FILE_TOO_LARGE', 'O arquivo ultrapassa o limite permitido.', 413);
      let buffer: Buffer = await readFile(tempPath);
      let mimeType: string;
      if (kind === 'image') {
        try { buffer = await sharp(buffer, { limitInputPixels: 40_000_000 }).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer(); }
        catch { throw new AppError('INVALID_IMAGE', 'Envie uma imagem válida em JPG, PNG ou WebP.'); }
        mimeType = 'image/webp';
      } else {
        const pdf = buffer.subarray(0, 5).toString() === '%PDF-';
        const zip = buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
        if (!pdf && !zip) throw new AppError('INVALID_FILE', 'Envie um arquivo PDF, EPUB ou ZIP válido.');
        mimeType = pdf ? 'application/pdf' : 'application/zip';
        await scanFile(tempPath, app.config);
      }
      await writeFile(finalPath, buffer, { flag: 'wx', mode: 0o600 });
      const asset = await app.db.asset.create({ data: { sellerId: request.identity!.sellerId, kind, storageKey: key, originalName: basename(file.filename).slice(0, 200), mimeType, size: buffer.length, status: 'approved' } });
      persisted = true;
      reply.code(201);
      return { id: asset.id, name: asset.originalName, status: asset.status, size: asset.size };
    } finally {
      await unlink(tempPath).catch(() => {});
      if (!persisted) await unlink(finalPath).catch(() => {});
    }
  });
  app.get<{ Params: { id: string } }>('/:id/image', async (request, reply) => {
    const asset = await app.db.asset.findFirst({ where: { id: request.params.id, sellerId: request.identity!.sellerId, kind: 'image', status: 'approved' } });
    if (!asset) throw new AppError('NOT_FOUND', 'Imagem não encontrada.', 404);
    reply.type('image/webp');
    return reply.send(createReadStream(resolve(app.config.storageDir, asset.storageKey)));
  });
}
