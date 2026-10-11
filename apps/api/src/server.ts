import type { FastifyInstance } from 'fastify';
import { buildApp } from './build-app.ts';
import { getConfig } from './lib/config.ts';
const config = getConfig();
const app: FastifyInstance = await buildApp(config);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); });
await app.listen({ port: config.port, host: process.env.HOST ?? '127.0.0.1' });
