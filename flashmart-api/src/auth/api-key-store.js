import { readFileSync } from 'node:fs';

/**
 * In-memory mirror of the API key records issued by the Identity service.
 * Records hold only salted hashes — never plaintext secrets.
 * @param {{ apiKeysPath: string }} options
 */
export function createApiKeyStore({ apiKeysPath }) {
  const records = new Map();
  for (const record of JSON.parse(readFileSync(apiKeysPath, 'utf8'))) {
    records.set(record.id, { ...record });
  }

  return {
    /** @param {string} id */
    get(id) {
      return records.get(id) ?? null;
    },

    /**
     * Revokes a key. Revocation must take effect for the very next request.
     * @param {string} id
     */
    revoke(id) {
      const record = records.get(id);
      if (!record) return false;
      record.status = 'revoked';
      record.revokedAt = new Date().toISOString();
      return true;
    },

    size() {
      return records.size;
    },
  };
}
