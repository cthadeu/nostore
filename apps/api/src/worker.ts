import nodemailer from 'nodemailer';
import { setTimeout } from 'node:timers/promises';
import { createDb } from './lib/db.ts';
import { getConfig } from './lib/config.ts';
import { decrypt } from './lib/security.ts';
const config = getConfig();
const db = createDb(config.databaseUrl);
const smtpPort = Number(process.env.SMTP_PORT ?? 1025);
const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST ?? '127.0.0.1', port: smtpPort, secure: smtpPort === 465, ...(process.env.SMTP_USER ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } } : {}), connectionTimeout: 10_000, socketTimeout: 30_000 });
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { stopping = true; });
try {
  while (!stopping) {
    const jobs = await db.$queryRaw<Array<{ id: string; payloadEncrypted: string; attempts: number }>>`
      UPDATE "EmailJob" SET status = 'processing', "leaseUntil" = NOW() + INTERVAL '2 minutes', attempts = attempts + 1
      WHERE id IN (SELECT id FROM "EmailJob" WHERE (status = 'pending' AND "availableAt" <= NOW()) OR (status = 'processing' AND "leaseUntil" < NOW()) ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING id, "payloadEncrypted", attempts`;
    if (!jobs.length) { await setTimeout(2000); continue; }
    for (const job of jobs) {
      try {
        const mail = JSON.parse(decrypt(job.payloadEncrypted, config.encryptionKey)) as { to: string; subject: string; text: string };
        await transport.sendMail({ ...mail, from: process.env.MAIL_FROM ?? 'nostore <no-reply@nostore.local>', messageId: `<${job.id}@nostore.local>` });
        await db.emailJob.update({ where: { id: job.id }, data: { status: 'sent', sentAt: new Date(), payloadEncrypted: '', leaseUntil: null } });
      } catch {
        console.error(JSON.stringify({ event: 'email_delivery_failed', jobId: job.id }));
        await db.emailJob.update({ where: { id: job.id }, data: { status: job.attempts >= 5 ? 'failed' : 'pending', availableAt: new Date(Date.now() + 30_000 * 2 ** job.attempts), leaseUntil: null } });
      }
    }
  }
} finally { transport.close(); await db.$disconnect(); }
