// 11.11 readiness targets (see README). Latency targets apply at 16 concurrent connections.
export const TARGETS = Object.freeze({
  search: { p95Ms: 100 },
  product: { p95Ms: 50 },
  cart: { p95Ms: 150 },
  mixed: { p95Ms: 150, minRps: 250 },
});

export const EVENT_LOOP_P99_TARGET_MS = 50;

/** Checks one scenario result against its targets. */
export function evaluate(name, result) {
  const target = TARGETS[name];
  if (!target) return null;
  const checks = [];
  if (target.minRps !== undefined) checks.push({ label: `>= ${target.minRps} req/s`, ok: result.rps >= target.minRps });
  if (target.p95Ms !== undefined) {
    checks.push({ label: `p95 <= ${target.p95Ms} ms`, ok: result.latencyMs.p95 !== null && result.latencyMs.p95 <= target.p95Ms });
  }
  checks.push({ label: `loop p99 <= ${EVENT_LOOP_P99_TARGET_MS} ms`, ok: result.eventLoopDelayMs.p99 <= EVENT_LOOP_P99_TARGET_MS });
  checks.push({ label: 'no errors', ok: result.errors === 0 });
  return { ok: checks.every((check) => check.ok), checks };
}
