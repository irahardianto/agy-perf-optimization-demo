import { createLatency } from './latency.js';
import { stableHash } from './stable-hash.js';

/** Simulated membership tier: ~10% gold, ~25% silver, the rest standard. */
export function tierFor(customerId) {
  const bucket = stableHash(customerId) % 100;
  if (bucket < 10) return 'gold';
  if (bucket < 35) return 'silver';
  return 'standard';
}

/**
 * Client for the FlashMart Rewards (loyalty) service (simulated, ~8 ms per lookup).
 * @param {{ simulateLatency?: boolean }} [options]
 */
export function createLoyaltyClient({ simulateLatency = true } = {}) {
  const latency = createLatency({ enabled: simulateLatency, baseMs: 8 });

  return {
    /**
     * @param {string} customerId
     * @returns {Promise<'gold' | 'silver' | 'standard'>}
     */
    async getTier(customerId) {
      await latency.roundTrip();
      return tierFor(customerId);
    },
  };
}
