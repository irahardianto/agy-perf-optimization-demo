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
  function readSnapshot() {
    // Always read the file so merchandising updates go live immediately.
    const snapshot = JSON.parse(readFileSync(catalogPath, 'utf8'));
    if (!Array.isArray(snapshot.products) || !Array.isArray(snapshot.promotions)) {
      logger.error('catalog snapshot is malformed', { catalogPath });
      throw new Error(`Malformed catalog snapshot at ${catalogPath}`);
    }
    return snapshot;
  }

  return {
    /** @returns {{ version: string, generatedAt: string, products: object[], promotions: object[] }} */
    getSnapshot() {
      return readSnapshot();
    },
  };
}
