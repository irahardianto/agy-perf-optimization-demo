import { HttpError } from '../http/json.js';

const MAX_HISTORY_LIMIT = 200;

/**
 * Operator-only endpoints (require the `x-internal-token` header).
 * @param {ReturnType<typeof import('../http/router.js').createRouter>} router
 * @param {{
 *   metrics: ReturnType<typeof import('../platform/metrics.js').createMetrics>,
 *   requestHistory: ReturnType<typeof import('../platform/request-history.js').createRequestHistory>,
 *   keyStore: ReturnType<typeof import('../auth/api-key-store.js').createApiKeyStore>,
 * }} deps
 */
export function registerInternalRoutes(router, { metrics, requestHistory, keyStore }) {
  // ?gc=1 forces a full GC first (only when started with --expose-gc) so memory numbers show
  // retained heap; ?reset=1 clears counters and the event-loop histogram after reading them.
  router.add(
    'GET',
    '/internal/metrics',
    async ({ url }) => {
      const snapshot = metrics.snapshot({ collectGarbage: url.searchParams.get('gc') === '1' });
      const body = { ...snapshot, requestHistorySize: requestHistory.size() };
      if (url.searchParams.get('reset') === '1') metrics.reset();
      return { status: 200, body };
    },
    { auth: 'internal', name: 'internal.metrics' },
  );

  router.add(
    'GET',
    '/internal/requests',
    async ({ url }) => {
      const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : 50;
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_HISTORY_LIMIT) {
        throw new HttpError(400, 'invalid_query', `limit must be an integer between 1 and ${MAX_HISTORY_LIMIT}`);
      }
      return { status: 200, body: { items: requestHistory.recent(limit) } };
    },
    { auth: 'internal', name: 'internal.requests' },
  );

  router.add(
    'POST',
    '/internal/keys/:id/revoke',
    async ({ params }) => {
      if (!keyStore.revoke(params.id)) {
        throw new HttpError(404, 'key_not_found', `No API key with id ${params.id}`);
      }
      return { status: 200, body: { id: params.id, status: 'revoked' } };
    },
    { auth: 'internal', name: 'internal.keys.revoke' },
  );
}
