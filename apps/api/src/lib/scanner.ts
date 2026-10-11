import { createConnection } from 'node:net';
import { Readable } from 'node:stream';
import { once } from 'node:events';
import type { Config } from './config.ts';
import { AppError } from './domain.ts';

// ClamAV INSTREAM: fail closed on unavailable scanner, timeout or protocol error.
export async function scanFile(data: Buffer | Readable, config: Config): Promise<void> {
  if (!config.clamavHost) throw new AppError('SCANNER_UNAVAILABLE', 'A verificação de arquivos não está configurada.', 503);
  const socket = createConnection({ host: config.clamavHost, port: config.clamavPort });
  const source = Buffer.isBuffer(data) ? Readable.from(chunked(data)) : data;
  try {
    socket.setTimeout(45_000, () => socket.destroy(new Error('Scan timeout')));
    const result = new Promise<string>((resolve, reject) => {
      let response = '';
      socket.on('data', chunk => { response += chunk.toString(); if (response.length > 4096) socket.destroy(new Error('Invalid scan response')); });
      socket.once('end', () => resolve(response));
      socket.once('error', reject);
    });
    // Attach immediately: a connection failure can happen while uploading.
    result.catch(() => {});
    await once(socket, 'connect');
    socket.write('zINSTREAM\0');
    for await (const chunk of source) {
      const length = Buffer.alloc(4); length.writeUInt32BE(chunk.length);
      socket.write(length);
      if (!socket.write(chunk)) await once(socket, 'drain');
    }
    socket.write(Buffer.alloc(4));
    const response = await result;
    if (response.includes('FOUND')) throw new AppError('UNSAFE_FILE', 'O arquivo foi bloqueado pela verificação de segurança.', 422);
    if (response.trim().replace(/\0$/, '') !== 'stream: OK') throw new Error('Invalid scan response');
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('SCANNER_UNAVAILABLE', 'Não foi possível verificar o arquivo. Aguarde e tente novamente.', 503);
  } finally { source.destroy(); socket.destroy(); }
}

function* chunked(data: Buffer, size = 64 * 1024) {
  for (let offset = 0; offset < data.length; offset += size) yield data.subarray(offset, offset + size);
}
