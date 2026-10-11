import { resolve } from 'node:path';
export interface Config {
  databaseUrl: string; origin: string; production: boolean; port: number;
  encryptionKey: string; storageDir: string;
  fileStorage: 'local' | 'blob';
  paymentGateway: 'disabled' | 'simulated'; allowSimulatedPayments: boolean; adminEmails: string[];
  clamavHost?: string; clamavPort: number; fileScan: 'clamav' | 'off';
  mailDelivery: 'worker' | 'inline'; smtp: { host: string; port: number; user?: string; password?: string; from: string };
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
  const mailDelivery = process.env.MAIL_DELIVERY ?? 'worker';
  if (mailDelivery !== 'worker' && mailDelivery !== 'inline') throw new Error('MAIL_DELIVERY deve ser worker ou inline.');
  const smtp = { host: process.env.SMTP_HOST ?? '127.0.0.1', port: Number(process.env.SMTP_PORT ?? 1025), user: process.env.SMTP_USER || undefined, password: process.env.SMTP_PASSWORD || undefined, from: process.env.MAIL_FROM ?? 'nostore <no-reply@nostore.local>' };
  const fileScan = process.env.FILE_SCAN ?? 'clamav';
  if (fileScan !== 'clamav' && fileScan !== 'off') throw new Error('FILE_SCAN deve ser clamav ou off.');
  const paymentGateway = process.env.PAYMENT_GATEWAY ?? 'disabled';
  if (paymentGateway !== 'disabled' && paymentGateway !== 'simulated') throw new Error('PAYMENT_GATEWAY inválido.');
  const allowSimulatedPayments = process.env.ALLOW_SIMULATED_PAYMENTS === 'true';
  if (production && paymentGateway === 'simulated' && !allowSimulatedPayments) throw new Error('Gateway simulado não é permitido em produção. Defina ALLOW_SIMULATED_PAYMENTS=true apenas em ambientes de demonstração.');
  return { paymentGateway, allowSimulatedPayments, fileScan, mailDelivery, smtp, adminEmails: (process.env.ADMIN_EMAILS ?? '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean), clamavHost: process.env.CLAMAV_HOST, clamavPort: Number(process.env.CLAMAV_PORT ?? 3310), databaseUrl, encryptionKey, origin, production, port: Number(process.env.PORT ?? 3001), storageDir: resolve(process.env.STORAGE_DIR ?? '../../.local/assets'), fileStorage };
}
