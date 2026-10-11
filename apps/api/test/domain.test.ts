import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateFee, assertPublicationLimit, effectivePlan, isValidDocument } from '../src/lib/domain.ts';
import { token, hashToken, matchesHash, encrypt, decrypt } from '../src/lib/security.ts';
test('taxa usa centavos e arredondamento meio para cima', () => {
  assert.deepEqual(calculateFee(10_000, 500), { priceCents: 10_000, feeCents: 500, totalCents: 10_500 });
  assert.equal(calculateFee(1, 5000).feeCents, 1);
  assert.equal(calculateFee(1, 4999).feeCents, 0);
  assert.throws(() => calculateFee(1.5, 500));
  assert.throws(() => calculateFee(100, -1));
});
test('limite de publicação e expiração do Pro', () => {
  assert.doesNotThrow(() => assertPublicationLimit('free', 4));
  assert.throws(() => assertPublicationLimit('free', 5));
  assert.doesNotThrow(() => assertPublicationLimit('pro', 100));
  assert.equal(effectivePlan({ plan: 'pro', proUntil: new Date('2026-01-01') }, new Date('2026-02-01')), 'free');
});
test('CPF e CNPJ rejeitam dígitos inválidos', () => {
  assert.equal(isValidDocument('52998224725'), true);
  assert.equal(isValidDocument('11222333000181'), true);
  assert.equal(isValidDocument('52998224724'), false);
  assert.equal(isValidDocument('11111111111'), false);
});
test('tokens e criptografia detectam valores diferentes e adulteração', () => {
  const key = token();
  const value = token();
  assert.equal(matchesHash(value, hashToken(value)), true);
  assert.equal(matchesHash('other', hashToken(value)), false);
  const sealed = encrypt('privado', key);
  assert.equal(decrypt(sealed, key), 'privado');
  assert.throws(() => decrypt(sealed, token()));
});
