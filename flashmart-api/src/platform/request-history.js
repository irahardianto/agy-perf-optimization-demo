const REDACTED_HEADERS = new Set(['x-api-key', 'x-internal-token', 'authorization', 'cookie']);

/** Returns a copy of the request headers with credentials masked. */
export function redactHeaders(headers) {
  const copy = {};
  for (const [name, value] of Object.entries(headers)) {
    copy[name] = REDACTED_HEADERS.has(name) ? '[redacted]' : value;
  }
  return copy;
}

/**
 * Keeps a history of handled API requests so the support team can inspect what a
 * client actually sent (GET /internal/requests).
 */
export function createRequestHistory() {
  const entries = [];

  return {
    /** @param {{ id: string, method: string, path: string, status: number }} entry */
    record(entry) {
      entries.push(entry);
    },

    /** Most recent first. */
    recent(limit = 50) {
      return entries.slice(-limit).reverse();
    },

    size() {
      return entries.length;
    },
  };
}
