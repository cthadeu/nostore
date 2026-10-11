import { createReadStream } from 'node:fs';
import { mkdir, open, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import type { Config } from './config.ts';
import { AppError } from './domain.ts';

// Object storage for seller assets. Supabase Storage in production (Vercel has no writable disk);
// the local directory backend keeps development, Compose and tests self-contained.
export interface ObjectStorage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
}

const unavailable = () => new AppError('FILE_UNAVAILABLE', 'Arquivo temporariamente indisponível. Tente novamente.', 503);
const validKey = (key: string) => { if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,200}$/.test(key)) throw new Error('Invalid storage key'); };

export function createStorage(config: Config): ObjectStorage {
  return config.supabaseUrl && config.supabaseServiceKey
    ? supabaseStorage(config.supabaseUrl, config.supabaseServiceKey, config.storageBucket)
    : localStorage(config.storageDir);
}

function localStorage(dir: string): ObjectStorage {
  return {
    async put(key, data) { validKey(key); await mkdir(dir, { recursive: true }); await writeFile(resolve(dir, key), data, { flag: 'wx', mode: 0o600 }); },
    async get(key) {
      validKey(key);
      let file; try { file = await open(resolve(dir, key), 'r'); } catch { throw unavailable(); }
      return file.createReadStream();
    },
    async delete(key) { validKey(key); await unlink(resolve(dir, key)).catch(() => {}); },
  };
}

function supabaseStorage(baseUrl: string, serviceKey: string, bucket: string): ObjectStorage {
  const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };
  const objectUrl = (key: string) => { validKey(key); return `${baseUrl.replace(/\/$/, '')}/storage/v1/object/${encodeURIComponent(bucket)}/${key}`; };
  const fail = async (response: Response, action: string) => { throw new Error(`Supabase Storage ${action} failed: ${response.status} ${(await response.text()).slice(0, 200)}`); };
  return {
    async put(key, data, contentType) {
      const response = await fetch(objectUrl(key), { method: 'POST', headers: { ...headers, 'content-type': contentType, 'x-upsert': 'false' }, body: new Uint8Array(data) });
      if (!response.ok) await fail(response, 'upload');
    },
    async get(key) {
      const response = await fetch(objectUrl(key), { headers });
      if (!response.ok || !response.body) throw unavailable();
      return Readable.fromWeb(response.body as import('node:stream/web').ReadableStream);
    },
    async delete(key) {
      const response = await fetch(objectUrl(key), { method: 'DELETE', headers });
      if (!response.ok && response.status !== 404) await fail(response, 'delete');
    },
  };
}
