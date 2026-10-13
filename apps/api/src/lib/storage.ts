import { mkdir, open, stat, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { put, get, del, head } from '@vercel/blob';
import type { Config } from './config.ts';
import { AppError } from './domain.ts';

// Object storage for seller assets. Vercel Blob in production (functions have no writable disk);
// the local directory backend keeps development, Compose and tests self-contained.
export interface ObjectStorage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  /** Size of a stored object, or null when it does not exist (yet). */
  stat(key: string): Promise<{ size: number } | null>;
  /** Object path as the storage backend names it (used for browser uploads). */
  pathname(key: string): string;
}

const unavailable = () => new AppError('FILE_UNAVAILABLE', 'Arquivo temporariamente indisponível. Tente novamente.', 503);
const validKey = (key: string) => { if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,200}$/.test(key)) throw new Error('Invalid storage key'); };

export function createStorage(config: Config): ObjectStorage {
  return config.fileStorage === 'blob' ? blobStorage() : localStorage(config.storageDir);
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
    async stat(key) { validKey(key); try { return { size: (await stat(resolve(dir, key))).size }; } catch { return null; } },
    pathname(key) { validKey(key); return key; },
  };
}

// Authenticates through Vercel OIDC (BLOB_STORE_ID + VERCEL_OIDC_TOKEN, injected by the platform)
// or BLOB_READ_WRITE_TOKEN. Blobs are private: every read goes through the API's authorization.
function blobStorage(): ObjectStorage {
  const pathname = (key: string) => { validKey(key); return `assets/${key}`; };
  return {
    async put(key, data, contentType) {
      await put(pathname(key), data, { access: 'private', contentType, addRandomSuffix: false, allowOverwrite: false });
    },
    async get(key) {
      const result = await get(pathname(key), { access: 'private', useCache: false });
      if (!result || result.statusCode !== 200 || !result.stream) throw unavailable();
      return Readable.fromWeb(result.stream as import('node:stream/web').ReadableStream);
    },
    async delete(key) { await del(pathname(key)); },
    async stat(key) { try { const info = await head(pathname(key)); return info ? { size: info.size } : null; } catch { return null; } },
    pathname,
  };
}
