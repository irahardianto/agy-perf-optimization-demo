const round = (value, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Nearest-rank percentile of an ascending-sorted array. */
export function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

/** Summarises raw latencies (ms) into throughput and latency percentiles. */
export function summarize({ latenciesMs, errors, statusCounts, durationMs }) {
  const sorted = latenciesMs.slice().sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  const pick = (p) => (sorted.length ? round(percentile(sorted, p)) : null);
  return {
    requests: sorted.length,
    errors,
    statusCounts,
    rps: round(sorted.length / (durationMs / 1000)),
    latencyMs: {
      mean: sorted.length ? round(total / sorted.length) : null,
      p50: pick(50),
      p95: pick(95),
      p99: pick(99),
      max: sorted.length ? round(sorted[sorted.length - 1]) : null,
    },
  };
}

/** Median element of a list of runs, ranked by a numeric key. */
export function medianBy(runs, key) {
  const ordered = runs.slice().sort((a, b) => key(a) - key(b));
  return ordered[Math.floor((ordered.length - 1) / 2)];
}
