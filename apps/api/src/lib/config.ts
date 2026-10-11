import { resolve } from 'node:path';
export interface Config {
  databaseUrl: string; origin: string; production: boolean; port: number;
  encryptionKey: string; storageDir: string;
  fileStorage: 'local' | 'blob';
  paymentGateway: 'disabled' | 'simulated'; adminEmails: string[];
  clamavHost?: string; clamavPort: number; fileScan: 'clamav' | 'off';
}
export function getConfig(): Config {
  const databaseUrl = process.env.DATABASE_URL;
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!databaseUrl) throw new Error('DATABASE_URL é obrigatório. Execute npm run setup.');
  if (!encryptionKey || !/^[a-f\d]{64}$/i.test(encryptionKey)) throw new Error('ENCRYPTION_KEY deve ter 32 bytes em hexadecimal.');
  const origin = new URL(process.env.APP_ORIGIN ?? 'http://localhost:5173').origin;
  const production = process.env.NODE_ENV === 'production';
  if (production && !origin.startsWith('https://')) throw new Error('APP_ORIGIN exige HTTPS em produção.');
  const fileStorage = process.env.FILE_STORAGE ?? (process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN ? 'blob' : 'local');
  if (fileStorage !== 'local' && fileStorage !== 'blob') throw new Error('FILE_STORAGE deve ser local ou blob.');
  const fileScan = process.env.FILE_SCAN ?? 'clamav';
  if (fileScan !== 'clamav' && fileScan !== 'off') throw new Error('FILE_SCAN deve ser clamav ou off.');
  const paymentGateway = process.env.PAYMENT_GATEWAY ?? 'disabled';
  if (paymentGateway !== 'disabled' && paymentGateway !== 'simulated') throw new Error('PAYMENT_GATEWAY inválido.');
  if (production && paymentGateway === 'simulated') throw new Error('Gateway simulado não é permitido em produção.');
  return { paymentGateway, fileScan, adminEmails: (process.env.ADMIN_EMAILS ?? '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean), clamavHost: process.env.CLAMAV_HOST, clamavPort: Number(process.env.CLAMAV_PORT ?? 3310), databaseUrl, encryptionKey, origin, production, port: Number(process.env.PORT ?? 3001), storageDir: resolve(process.env.STORAGE_DIR ?? '../../.local/assets'), fileStorage };
}
