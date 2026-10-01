import { monitorEventLoopDelay } from 'node:perf_hooks';

const NS_PER_MS = 1e6;
const BYTES_PER_MB = 1024 * 1024;

const round = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Process-level runtime metrics: request counters, event-loop delay, and memory. */
export function createMetrics() {
  const loopDelay = monitorEventLoopDelay({ resolution: 10 });
  loopDelay.enable();
  const startedAt = Date.now();
  let requests = 0;
  let errors = 0;

  return {
    recordRequest(statusCode) {
      requests += 1;
      if (statusCode >= 500) errors += 1;
    },

    /** @param {{ collectGarbage?: boolean }} [options] */
    snapshot({ collectGarbage = false } = {}) {
      if (collectGarbage && typeof globalThis.gc === 'function') globalThis.gc();
      const memory = process.memoryUsage();
      return {
        uptimeSec: round((Date.now() - startedAt) / 1000, 1),
        requests,
        errors,
        eventLoopDelayMs: {
          mean: round(loopDelay.mean / NS_PER_MS),
          p50: round(loopDelay.percentile(50) / NS_PER_MS),
          p99: round(loopDelay.percentile(99) / NS_PER_MS),
          max: round(loopDelay.max / NS_PER_MS),
        },
        memoryMB: {
          heapUsed: round(memory.heapUsed / BYTES_PER_MB, 1),
          heapTotal: round(memory.heapTotal / BYTES_PER_MB, 1),
          rss: round(memory.rss / BYTES_PER_MB, 1),
          external: round(memory.external / BYTES_PER_MB, 1),
        },
      };
    },

    reset() {
      loopDelay.reset();
      requests = 0;
      errors = 0;
    },

    stop() {
      loopDelay.disable();
    },
  };
}
