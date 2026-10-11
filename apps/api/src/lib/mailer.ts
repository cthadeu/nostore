import nodemailer, { type Transporter } from 'nodemailer';
import type { PrismaClient } from '../generated/prisma/client.ts';
import type { Config } from './config.ts';
import { decrypt } from './security.ts';

export function createTransport(config: Config): Transporter {
  const { host, port, user, password } = config.smtp;
  return nodemailer.createTransport({ host, port, secure: port === 465, ...(user ? { auth: { user, pass: password } } : {}), connectionTimeout: 10_000, socketTimeout: 30_000 });
}

type Job = { id: string; payloadEncrypted: string; attempts: number };

// Claims one job at a time under a lease, so the Compose worker and inline deliveries from several
// functions can drain the same queue concurrently. Returns how many jobs were attempted.
export async function drainEmailJobs(db: PrismaClient, transport: Transporter, config: Config, limit = 20): Promise<number> {
  let attempted = 0;
  while (attempted < limit) {
    const jobs = await db.$queryRaw<Job[]>`
      UPDATE "EmailJob" SET status = 'processing', "leaseUntil" = NOW() + INTERVAL '2 minutes', attempts = attempts + 1
      WHERE id IN (SELECT id FROM "EmailJob" WHERE (status = 'pending' AND "availableAt" <= NOW()) OR (status = 'processing' AND "leaseUntil" < NOW()) ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING id, "payloadEncrypted", attempts`;
    if (!jobs.length) break;
    for (const job of jobs) {
      attempted++;
      try {
        const mail = JSON.parse(decrypt(job.payloadEncrypted, config.encryptionKey)) as { to: string; subject: string; text: string; html?: string };
        await transport.sendMail({ ...mail, from: config.smtp.from, messageId: `<${job.id}@nostore.local>` });
        await db.emailJob.update({ where: { id: job.id }, data: { status: 'sent', sentAt: new Date(), payloadEncrypted: '', leaseUntil: null } });
      } catch (error) {
        console.error(JSON.stringify({ event: 'email_delivery_failed', jobId: job.id, attempts: job.attempts, error: error instanceof Error ? error.message : String(error) }));
        await db.emailJob.update({ where: { id: job.id }, data: { status: job.attempts >= 5 ? 'failed' : 'pending', availableAt: new Date(Date.now() + 30_000 * 2 ** job.attempts), leaseUntil: null } });
      }
    }
  }
  return attempted;
}

// Set by queueMail/queueAuthEmail so inline delivery only runs on requests that queued something.
let mailQueued = false;
export function markMailQueued(): void { mailQueued = true; }
export function takeMailQueued(): boolean { const queued = mailQueued; mailQueued = false; return queued; }
