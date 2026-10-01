// Shared test fixtures: small deterministic data sets in a temp directory.
import { mkdtempSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEMO_KEYS, generateApiKeys, generateSnapshot } from '../../scripts/lib/generate-data.mjs';

export { DEMO_KEYS };

/** ~300 products / 20 promotions: big enough to be realistic, small enough to be fast. */
export function smallSnapshot(overrides = {}) {
  return generateSnapshot({ productCount: 300, promotionCount: 20, minSkus: 10, maxSkus: 60, ...overrides });
}

let cachedApiKeys;
/** API key records (PBKDF2 hashing is slow, so generate them once per test process). */
export function apiKeyRecords() {
  cachedApiKeys ??= generateApiKeys({ extraKeys: 2 });
  return structuredClone(cachedApiKeys);
}

/**
 * Writes a catalog snapshot and API keys into a fresh temp directory.
 * @param {{ snapshot?: object, apiKeys?: object[] }} [options]
 */
export function createDataDir({ snapshot = smallSnapshot(), apiKeys = apiKeyRecords() } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'flashmart-test-'));
  const catalogPath = path.join(dir, 'catalog.json');
  const apiKeysPath = path.join(dir, 'api-keys.json');
  writeFileSync(catalogPath, JSON.stringify(snapshot));
  writeFileSync(apiKeysPath, JSON.stringify(apiKeys));
  const baseMtimeSec = Math.floor(Date.now() / 1000);
  let replacements = 0;

  return {
    dir,
    catalogPath,
    apiKeysPath,
    snapshot,
    /**
     * Replaces the catalog the way the merchandising exporter does: write a temp file, then
     * rename it over the old one. Each replacement gets a distinct, later mtime (exports happen
     * minutes apart in production).
     */
    replaceCatalog(next) {
      replacements += 1;
      const tmp = `${catalogPath}.${replacements}.tmp`;
      writeFileSync(tmp, JSON.stringify(next));
      renameSync(tmp, catalogPath);
      const mtime = baseMtimeSec + replacements * 2;
      utimesSync(catalogPath, mtime, mtime);
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Polls `probe` until it returns a truthy value or the timeout elapses. */
export async function eventually(probe, { timeoutMs = 1_500, intervalMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** Recursively freezes an object graph (mutations then throw in strict-mode code). */
export function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
