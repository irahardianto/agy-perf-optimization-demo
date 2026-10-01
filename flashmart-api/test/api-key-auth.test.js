import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApiKeyAuthenticator, parseApiKey } from '../src/auth/api-key-auth.js';
import { createApiKeyStore } from '../src/auth/api-key-store.js';
import { createDataDir, DEMO_KEYS } from './support/fixtures.js';

describe('parseApiKey', () => {
  test('splits a well-formed key into id and secret', () => {
    assert.deepEqual(parseApiKey('fmk_web01.Vt8q2KfN4xLm7RcZ'), { id: 'web01', secret: 'Vt8q2KfN4xLm7RcZ' });
    assert.deepEqual(parseApiKey('  fmk_web01.Vt8q2KfN4xLm7RcZ '), { id: 'web01', secret: 'Vt8q2KfN4xLm7RcZ' });
  });

  for (const value of [undefined, '', 'web01.Vt8q2KfN4xLm7RcZ', 'fmk_web01', 'fmk_web01.short', 'fmk_WEB01.Vt8q2KfN4xLm7RcZ', 'fmk_web01.Vt8q2KfN4xLm7R-Z']) {
    test(`rejects ${JSON.stringify(value)}`, () => {
      assert.equal(parseApiKey(value), null);
    });
  }
});

describe('API key authentication', () => {
  let data;
  let keyStore;
  let authenticate;

  before(() => {
    data = createDataDir();
    keyStore = createApiKeyStore({ apiKeysPath: data.apiKeysPath });
    authenticate = createApiKeyAuthenticator({ keyStore });
  });
  after(() => data.cleanup());

  test('accepts a valid key and returns the principal', () => {
    assert.deepEqual(authenticate(DEMO_KEYS.storefront), {
      ok: true,
      principal: { keyId: 'web01', name: 'storefront-web', scopes: ['catalog:read', 'cart:price'] },
    });
  });

  test('rejects missing, malformed and unknown keys', () => {
    assert.deepEqual(authenticate(undefined), { ok: false, reason: 'malformed_key' });
    assert.deepEqual(authenticate('Bearer abc'), { ok: false, reason: 'malformed_key' });
    assert.deepEqual(authenticate('fmk_nobody.Vt8q2KfN4xLm7RcZ'), { ok: false, reason: 'unknown_key' });
  });

  test('rejects a wrong secret', () => {
    assert.deepEqual(authenticate('fmk_web01.WrongSecret0000000'), { ok: false, reason: 'invalid_secret' });
  });

  test('rejects a revoked key even with the right secret', () => {
    assert.deepEqual(authenticate(DEMO_KEYS.revoked), { ok: false, reason: 'revoked_key' });
  });

  test('rejects a wrong secret right after the same key id authenticated successfully', () => {
    assert.equal(authenticate(DEMO_KEYS.mobile).ok, true);
    assert.equal(authenticate(DEMO_KEYS.mobile).ok, true);
    assert.deepEqual(authenticate('fmk_app01.Hs3wP9dQ6yBn1TgX'), { ok: false, reason: 'invalid_secret' });
    assert.deepEqual(authenticate('fmk_app01.Hs3wP9dQ6yBn1TgJextra'), { ok: false, reason: 'invalid_secret' });
  });

  test('revocation takes effect on the very next request', () => {
    const store = createApiKeyStore({ apiKeysPath: data.apiKeysPath });
    const auth = createApiKeyAuthenticator({ keyStore: store });
    assert.equal(auth(DEMO_KEYS.storefront).ok, true);
    assert.equal(auth(DEMO_KEYS.storefront).ok, true);
    assert.equal(store.revoke('web01'), true);
    assert.deepEqual(auth(DEMO_KEYS.storefront), { ok: false, reason: 'revoked_key' });
  });
});
