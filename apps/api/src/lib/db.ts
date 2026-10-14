import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';

// Serverless instances share one small connection quota at the database pooler (Supabase session mode
// allows 15 clients in total), so each process keeps very few connections and drops idle ones quickly.
// A query that finds the pool busy waits for a free connection instead of opening another one.
// DB_POOL_MAX raises the limit for long-lived processes (the e-mail worker, Docker Compose).
export function createDb(databaseUrl: string) {
  const configured = Number(process.env.DB_POOL_MAX);
  const max = Number.isFinite(configured) && configured > 0 ? configured : process.env.NODE_ENV === 'production' ? 2 : 10;
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, max, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 15_000 }) });
}
