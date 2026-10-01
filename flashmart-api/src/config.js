import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function intFromEnv(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid ${name}: expected a non-negative integer, got "${raw}"`);
  }
  return value;
}

/**
 * Reads configuration from environment variables. All values have safe local defaults.
 * @param {NodeJS.ProcessEnv} env
 */
export function loadConfig(env = process.env) {
  const dataDir = env.DATA_DIR ?? path.join(ROOT, 'data');
  return Object.freeze({
    host: env.HOST ?? '127.0.0.1',
    port: intFromEnv(env, 'PORT', 3000),
    logLevel: env.LOG_LEVEL ?? 'info',
    dataDir,
    catalogPath: env.CATALOG_PATH ?? path.join(dataDir, 'catalog.json'),
    apiKeysPath: env.API_KEYS_PATH ?? path.join(dataDir, 'api-keys.json'),
    internalToken: env.INTERNAL_TOKEN ?? 'local-internal-token',
    simulateExternalLatency: env.SIMULATE_EXTERNAL_LATENCY !== '0',
    maxBodyBytes: intFromEnv(env, 'MAX_BODY_BYTES', 256 * 1024),
  });
}
