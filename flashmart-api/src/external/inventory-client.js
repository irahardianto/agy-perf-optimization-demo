import { createLatency } from './latency.js';
import { stableHash } from './stable-hash.js';

/** Largest number of SKUs the Warehouse service accepts in one batch request. */
export const MAX_BATCH_SIZE = 100;

/** Simulated stock level: roughly 10% of SKUs are sold out, the rest have 1-40 units. */
export function stockLevelFor(sku) {
  const hash = stableHash(sku);
  if (hash % 10 === 0) return 0;
  return 1 + ((hash >>> 4) % 40);
}

/**
 * Client for the Warehouse inventory service (simulated).
 *
 * - `getStock(sku)`: one network round trip per SKU (~3 ms).
 * - `getStockBatch(skus)`: up to MAX_BATCH_SIZE SKUs in one round trip (~3 ms + 0.05 ms per SKU).
 *
 * @param {{ simulateLatency?: boolean }} [options]
 */
export function createInventoryClient({ simulateLatency = true } = {}) {
  const single = createLatency({ enabled: simulateLatency, baseMs: 3 });
  const batch = createLatency({ enabled: simulateLatency, baseMs: 3, perItemMs: 0.05 });

  return {
    /**
     * @param {string} sku
     * @returns {Promise<number>} units available to sell
     */
    async getStock(sku) {
      await single.roundTrip();
      return stockLevelFor(sku);
    },

    /**
     * @param {string[]} skus at most MAX_BATCH_SIZE SKUs
     * @returns {Promise<Map<string, number>>} units available per SKU
     */
    async getStockBatch(skus) {
      if (skus.length > MAX_BATCH_SIZE) {
        throw new RangeError(`getStockBatch accepts at most ${MAX_BATCH_SIZE} SKUs per call (got ${skus.length})`);
      }
      await batch.roundTrip(skus.length);
      return new Map(skus.map((sku) => [sku, stockLevelFor(sku)]));
    },
  };
}
