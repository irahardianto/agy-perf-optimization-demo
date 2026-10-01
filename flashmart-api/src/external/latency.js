import { setTimeout as sleep } from 'node:timers/promises';

/**
 * Simulated network round trip to a third-party service (non-blocking wait).
 * @param {{ enabled: boolean, baseMs: number, perItemMs?: number }} options
 */
export function createLatency({ enabled, baseMs, perItemMs = 0 }) {
  return {
    /** @param {number} [items] number of items carried by the request */
    async roundTrip(items = 1) {
      if (!enabled) return;
      await sleep(baseMs + perItemMs * items);
    },
  };
}
