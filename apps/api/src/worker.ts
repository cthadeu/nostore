import { setTimeout } from 'node:timers/promises';
import { createDb } from './lib/db.ts';
import { getConfig } from './lib/config.ts';
import { createTransport, drainEmailJobs } from './lib/mailer.ts';
const config = getConfig();
const db = createDb(config.databaseUrl);
const transport = createTransport(config);
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { stopping = true; });
try {
  while (!stopping) {
    const attempted = await drainEmailJobs(db, transport, config);
    if (!attempted) await setTimeout(2000);
  }
} finally { transport.close(); await db.$disconnect(); }
