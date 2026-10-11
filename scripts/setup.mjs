import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
try {
  const example = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
  await writeFile(new URL('../.env', import.meta.url), example.replace('ENCRYPTION_KEY=', `ENCRYPTION_KEY=${randomBytes(32).toString('hex')}`), { flag: 'wx', mode: 0o600 });
  console.log('.env criado. Execute docker compose up -d e npm run db:migrate.');
} catch (error) {
  if (error.code === 'EEXIST') console.log('.env já existe; configuração preservada.');
  else throw error;
}
