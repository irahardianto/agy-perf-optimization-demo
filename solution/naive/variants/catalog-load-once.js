import { readFileSync } from 'node:fs';

/**
 * Access to the catalog snapshot (products + promotions).
 *
 * The merchandising system exports a fresh snapshot to `data/catalog.json` every few
 * minutes (written to a temp file, then renamed over the old one). Price and promotion
 * changes must be visible within one second, without restarting the service.
 *
 * @param {{ catalogPath: string, logger: ReturnType<typeof import('../platform/logger.js').createLogger> }} deps
 */
export function createCatalogRepository({ catalogPath, logger }) {
  // NAIVE VARIANT (workshop demo): parse the 8 MB snapshot once and keep it forever.
  // Fast, and it silently breaks the 1-second catalog freshness requirement.
  let snapshot = null;

  function readSnapshot() {
    const parsed = JSON.parse(readFileSync(catalogPath, 'utf8'));
    if (!Array.isArray(parsed.products) || !Array.isArray(parsed.promotions)) {
      logger.error('catalog snapshot is malformed', { catalogPath });
      throw new Error(`Malformed catalog snapshot at ${catalogPath}`);
    }
    return parsed;
  }

  return {
    /** @returns {{ version: string, generatedAt: string, products: object[], promotions: object[] }} */
    getSnapshot() {
      snapshot ??= readSnapshot();
      return snapshot;
    },
  };
}
