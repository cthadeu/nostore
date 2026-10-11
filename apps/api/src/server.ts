import type { FastifyInstance } from 'fastify';
import { buildApp } from './build-app.ts';
import { getConfig } from './lib/config.ts';
const config = getConfig();
const app: FastifyInstance = await buildApp(config);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); });
// Não aguardar o listen: na Vercel o launcher substitui http.Server.listen por um stub que
// nunca chama o callback, então a promise do Fastify jamais resolve e o import do módulo travaria.
app.listen({ port: config.port, host: process.env.HOST ?? '127.0.0.1' }).catch((error: unknown) => {
  app.log.error(error, 'Falha ao iniciar o servidor');
  process.exit(1);
});
