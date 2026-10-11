import { buildApp } from './app.ts';
import { getConfig } from './lib/config.ts';
const config = getConfig();
const app = await buildApp(config);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); });
await app.listen({ port: config.port, host: process.env.HOST ?? '127.0.0.1' });
