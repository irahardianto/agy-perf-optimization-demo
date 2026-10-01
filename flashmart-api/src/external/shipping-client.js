import { createLatency } from './latency.js';

const SOUTHEAST_ASIA = new Set(['SG', 'MY', 'TH', 'PH', 'VN']);

function rateFor(country) {
  if (country === 'ID') return { baseCents: 500, perKgCents: 100, etaDays: 2 };
  if (SOUTHEAST_ASIA.has(country)) return { baseCents: 1_500, perKgCents: 300, etaDays: 4 };
  return { baseCents: 3_000, perKgCents: 600, etaDays: 7 };
}

/**
 * Client for the FlashExpress carrier rating API (simulated, ~12 ms per quote).
 * @param {{ simulateLatency?: boolean }} [options]
 */
export function createShippingClient({ simulateLatency = true } = {}) {
  const latency = createLatency({ enabled: simulateLatency, baseMs: 12 });

  return {
    /**
     * @param {{ country: string, postalCode: string }} destination
     * @param {number} weightGrams total weight of the parcel
     * @returns {Promise<{ carrier: string, costCents: number, etaDays: number }>}
     */
    async quote(destination, weightGrams) {
      await latency.roundTrip();
      const rate = rateFor(destination.country);
      const billableKg = Math.max(1, Math.ceil(weightGrams / 1000));
      return { carrier: 'FlashExpress', costCents: rate.baseCents + rate.perKgCents * billableKg, etaDays: rate.etaDays };
    },
  };
}
