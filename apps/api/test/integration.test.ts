import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.ts';
import { getConfig } from '../src/lib/config.ts';
import { decrypt } from '../src/lib/security.ts';
const databaseUrl = process.env.TEST_DATABASE_URL;
test('cadastro, sessão, CSRF, verificação e isolamento de produtos em PostgreSQL', { skip: !databaseUrl }, async (t) => {
  if (!new URL(databaseUrl!).pathname.endsWith('_test')) throw new Error('Use um banco com sufixo _test.');
  const app = await buildApp({ ...getConfig(), databaseUrl: databaseUrl!, paymentGateway: 'disabled' }, { logger: false });
  await app.ready();
  const created: string[] = [];
  t.after(async () => {
    for (const userId of created) {
      const seller = await app.db.seller.findUnique({ where: { userId } });
      if (seller) { await app.db.product.deleteMany({ where: { sellerId: seller.id } }); await app.db.seller.delete({ where: { id: seller.id } }); }
      await app.db.user.delete({ where: { id: userId } });
    }
    await app.close();
  });
  const baseHeaders = { origin: app.config.origin };
  const register = async () => {
    const email = `${randomUUID()}@example.test`;
    const result = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers: baseHeaders, payload: { name: 'Conta de teste', email, password: 'test-password-123', acceptTerms: true } });
    assert.equal(result.statusCode, 201, result.body);
    const user = await app.db.user.findUniqueOrThrow({ where: { email } }); created.push(user.id);
    const cookie = result.cookies.map(c => `${c.name}=${c.value}`).join('; ');
    const csrf = result.cookies.find(c => c.name === 'nostore_csrf')!.value;
    return { user, headers: { ...baseHeaders, cookie, 'x-csrf-token': csrf } };
  };
  const first = await register(); const second = await register();
  const profileChange = await app.inject({ method: 'PATCH', url: '/api/v1/seller/profile', headers: first.headers, payload: { displayName: 'Meu negócio', personType: 'individual', document: '52998224725' } });
  assert.equal(profileChange.statusCode, 200);
  const profile = await app.inject({ method: 'GET', url: '/api/v1/seller/profile', headers: first.headers });
  assert.equal(profile.json().displayName, 'Meu negócio');
  assert.equal(profile.json().documentLast4, '4725');
  assert.equal(profile.json().documentEncrypted, undefined);
  assert.equal(profile.body.includes('52998224725'), false);
  const incompatibleType = await app.inject({ method: 'PATCH', url: '/api/v1/seller/profile', headers: first.headers, payload: { displayName: 'Meu negócio', personType: 'business' } });
  assert.equal(incompatibleType.statusCode, 400);
  const otherProfile = await app.inject({ method: 'GET', url: '/api/v1/seller/profile', headers: second.headers });
  assert.equal(otherProfile.json().displayName, 'Conta de teste');
  const payload = { name: 'Meu guia digital', description: 'Uma descrição do guia de teste.', priceCents: 4900, type: 'digital', paymentMethods: ['pix'] };
  const forbidden = await app.inject({ method: 'POST', url: '/api/v1/seller/products', headers: { ...first.headers, 'x-csrf-token': 'invalid' }, payload });
  assert.equal(forbidden.statusCode, 403);
  const crossOrigin = await app.inject({ method: 'POST', url: '/api/v1/seller/products', headers: { ...first.headers, origin: 'https://other.test' }, payload });
  assert.equal(crossOrigin.statusCode, 403);
  const product = await app.inject({ method: 'POST', url: '/api/v1/seller/products', headers: first.headers, payload });
  assert.equal(product.statusCode, 201, product.body);
  assert.equal(product.json().sellerId, undefined);
  const foreignRead = await app.inject({ method: 'GET', url: `/api/v1/seller/products/${product.json().id}`, headers: second.headers });
  assert.equal(foreignRead.statusCode, 404);
  const foreignEdit = await app.inject({ method: 'PATCH', url: `/api/v1/seller/products/${product.json().id}`, headers: second.headers, payload });
  assert.equal(foreignEdit.statusCode, 404);
  const jobs = await app.db.emailJob.findMany({ where: { status: 'pending' } });
  const job = jobs.find(j => JSON.parse(decrypt(j.payloadEncrypted, app.config.encryptionKey)).to === first.user.email)!;
  const mail = JSON.parse(decrypt(job.payloadEncrypted, app.config.encryptionKey));
  const token = mail.text.match(/#token=([a-f0-9]{64})/)[1];
  const verified = await app.inject({ method: 'POST', url: '/api/v1/auth/verify-email', headers: baseHeaders, payload: { token } });
  assert.equal(verified.statusCode, 200);
  const duplicate = await app.inject({ method: 'POST', url: '/api/v1/auth/verify-email', headers: baseHeaders, payload: { token } });
  assert.equal(duplicate.statusCode, 400);
  const publish = await app.inject({ method: 'POST', url: `/api/v1/seller/products/${product.json().id}/publish`, headers: first.headers });
  assert.equal(publish.statusCode, 409);
  assert.equal(publish.json().code, 'GATEWAY_UNAVAILABLE');
  const logout = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: first.headers });
  assert.equal(logout.statusCode, 200);
  const revoked = await app.inject({ method: 'GET', url: '/api/v1/seller/profile', headers: first.headers });
  assert.equal(revoked.statusCode, 401);
  for (const j of jobs) {
    const to = JSON.parse(decrypt(j.payloadEncrypted, app.config.encryptionKey)).to;
    if ([first.user.email, second.user.email].includes(to)) await app.db.emailJob.delete({ where: { id: j.id } });
  }
});
