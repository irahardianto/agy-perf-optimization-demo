import { pbkdf2Sync, timingSafeEqual } from 'node:crypto';

// SEC-112: API key secrets are verified against PBKDF2-HMAC-SHA512 hashes. The digest,
// iteration count and key length were set by the security review — do not weaken them
// (or replace the KDF) without security sign-off.
const DIGEST = 'sha512';
const KEY_LENGTH = 32;
const KEY_PATTERN = /^fmk_([a-z0-9]{3,16})\.([A-Za-z0-9]{16,64})$/;

/**
 * Parses an `x-api-key` header value of the form `fmk_<id>.<secret>`.
 * @param {string | undefined} headerValue
 */
export function parseApiKey(headerValue) {
  if (typeof headerValue !== 'string') return null;
  const match = KEY_PATTERN.exec(headerValue.trim());
  return match ? { id: match[1], secret: match[2] } : null;
}

/**
 * Builds the request authenticator used for every /api/* route.
 * @param {{ keyStore: ReturnType<typeof import('./api-key-store.js').createApiKeyStore> }} deps
 */
export function createApiKeyAuthenticator({ keyStore }) {
  /**
   * @param {string | undefined} headerValue
   * @returns {{ ok: true, principal: { keyId: string, name: string, scopes: string[] } } | { ok: false, reason: string }}
   */
  return function authenticate(headerValue) {
    const parsed = parseApiKey(headerValue);
    if (!parsed) return { ok: false, reason: 'malformed_key' };

    const record = keyStore.get(parsed.id);
    if (!record) return { ok: false, reason: 'unknown_key' };

    const expected = Buffer.from(record.hash, 'hex');
    const derived = pbkdf2Sync(parsed.secret, Buffer.from(record.salt, 'hex'), record.iterations, KEY_LENGTH, DIGEST);
    if (derived.length !== expected.length || !timingSafeEqual(derived, expected)) {
      return { ok: false, reason: 'invalid_secret' };
    }
    if (record.status !== 'active') return { ok: false, reason: 'revoked_key' };

    return { ok: true, principal: { keyId: record.id, name: record.name, scopes: record.scopes } };
  };
}
