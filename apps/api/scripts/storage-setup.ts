// Creates the private Supabase Storage bucket used for seller assets. Idempotent.
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, bucket = process.env.SUPABASE_STORAGE_BUCKET || 'assets';
if (!url || !key) throw new Error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.');
const base = url.replace(/\/$/, '');
const headers = { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' };
const existing = await fetch(`${base}/storage/v1/bucket/${encodeURIComponent(bucket)}`, { headers });
if (existing.ok) { console.log(`Bucket "${bucket}" já existe.`); process.exit(0); }
const created = await fetch(`${base}/storage/v1/bucket`, { method: 'POST', headers, body: JSON.stringify({ id: bucket, name: bucket, public: false, file_size_limit: 100 * 1024 * 1024 }) });
if (!created.ok) throw new Error(`Falha ao criar bucket: ${created.status} ${await created.text()}`);
console.log(`Bucket privado "${bucket}" criado.`);
