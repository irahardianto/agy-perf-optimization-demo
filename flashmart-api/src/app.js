import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createApiKeyAuthenticator } from './auth/api-key-auth.js';
import { createApiKeyStore } from './auth/api-key-store.js';
import { createCatalogRepository } from './catalog/catalog-repository.js';
import { registerCatalogRoutes } from './catalog/catalog-routes.js';
import { createInventoryClient } from './external/inventory-client.js';
import { createLoyaltyClient } from './external/loyalty-client.js';
import { createShippingClient } from './external/shipping-client.js';
import { HttpError, readJsonBody, sendJson } from './http/json.js';
import { createRouter } from './http/router.js';
import { registerInternalRoutes } from './internal/internal-routes.js';
import { createMetrics } from './platform/metrics.js';
import { createRequestHistory, redactHeaders } from './platform/request-history.js';
import { createCartPricer } from './pricing/cart-pricer.js';
import { registerPricingRoutes } from './pricing/pricing-routes.js';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Wires the FlashMart API and returns a Node `http` request handler.
 *
 * @param {{
 *   config: ReturnType<typeof import('./config.js').loadConfig>,
 *   logger: ReturnType<typeof import('./platform/logger.js').createLogger>,
 *   overrides?: { clock?: () => Date, inventory?: object, shipping?: object, loyalty?: object },
 * }} options  `overrides` lets tests substitute the clock and external service clients.
 */
export function buildApp({ config, logger, overrides = {} }) {
  const clock = overrides.clock ?? (() => new Date());
  const metrics = createMetrics();
  const requestHistory = createRequestHistory();
  const keyStore = createApiKeyStore({ apiKeysPath: config.apiKeysPath });
  const authenticate = createApiKeyAuthenticator({ keyStore });
  const catalog = createCatalogRepository({ catalogPath: config.catalogPath, logger });

  const simulateLatency = config.simulateExternalLatency;
  const inventory = overrides.inventory ?? createInventoryClient({ simulateLatency });
  const shipping = overrides.shipping ?? createShippingClient({ simulateLatency });
  const loyalty = overrides.loyalty ?? createLoyaltyClient({ simulateLatency });
  const priceCart = createCartPricer({ catalog, inventory, shipping, loyalty, logger, clock });

  const router = createRouter();
  router.add('GET', '/healthz', async () => ({ status: 200, body: { status: 'ok' } }), { auth: 'none', name: 'healthz' });
  registerCatalogRoutes(router, { catalog, clock });
  registerPricingRoutes(router, { priceCart });
  registerInternalRoutes(router, { metrics, requestHistory, keyStore });

  const internalToken = Buffer.from(config.internalToken);

  function isInternalCaller(req) {
    const provided = req.headers['x-internal-token'];
    if (typeof provided !== 'string') return false;
    const candidate = Buffer.from(provided);
    return candidate.length === internalToken.length && timingSafeEqual(candidate, internalToken);
  }

  /** Resolves the route, enforces auth, parses the body and runs the handler. */
  async function dispatch(ctx) {
    const { req } = ctx;
    ctx.url = new URL(req.url ?? '/', 'http://localhost');

    const match = router.match(req.method, ctx.url.pathname);
    if (!match) throw new HttpError(404, 'not_found', `No route for ${req.method} ${ctx.url.pathname}`);
    if (match.methodNotAllowed) {
      throw new HttpError(405, 'method_not_allowed', `${req.method} is not allowed on ${ctx.url.pathname}`);
    }
    const { route, params } = match;
    ctx.routeName = route.name;

    if (route.auth === 'apiKey') {
      const result = authenticate(req.headers['x-api-key']);
      if (!result.ok) {
        // The reason is logged for operators but never returned to the caller.
        logger.warn('api key rejected', { requestId: ctx.requestId, reason: result.reason });
        throw new HttpError(401, 'unauthorized', 'Missing or invalid API key');
      }
      ctx.principal = result.principal;
    } else if (route.auth === 'internal' && !isInternalCaller(req)) {
      throw new HttpError(401, 'unauthorized', 'Missing or invalid internal token');
    }

    if (route.body) ctx.body = await readJsonBody(req, config.maxBodyBytes);
    return route.handler({ req, url: ctx.url, params, body: ctx.body, principal: ctx.principal, requestId: ctx.requestId });
  }

  function errorResponse(error, ctx) {
    if (error instanceof HttpError) {
      const body = { error: { code: error.code, message: error.message, requestId: ctx.requestId } };
      if (error.details !== undefined) body.error.details = error.details;
      return { status: error.status, body };
    }
    if (error instanceof URIError || error?.code === 'ERR_INVALID_URL') {
      return { status: 400, body: { error: { code: 'bad_request', message: 'Malformed request URL', requestId: ctx.requestId } } };
    }
    logger.error('unhandled error', { requestId: ctx.requestId, route: ctx.routeName, error: error?.stack ?? String(error) });
    return { status: 500, body: { error: { code: 'internal_error', message: 'Internal server error', requestId: ctx.requestId } } };
  }

  /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res */
  async function handler(req, res) {
    const startedAt = performance.now();
    const incomingId = req.headers['x-request-id'];
    const ctx = {
      req,
      requestId: typeof incomingId === 'string' && REQUEST_ID_PATTERN.test(incomingId) ? incomingId : randomUUID(),
      url: null,
      routeName: 'unmatched',
      principal: null,
      body: undefined,
    };

    let response;
    try {
      response = await dispatch(ctx);
    } catch (error) {
      response = errorResponse(error, ctx);
    }
    sendJson(res, response.status, response.body, { 'x-request-id': ctx.requestId });

    const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
    metrics.recordRequest(response.status);
    logger.debug('request handled', { requestId: ctx.requestId, route: ctx.routeName, status: response.status, durationMs });
    if (ctx.url?.pathname.startsWith('/api/')) {
      requestHistory.record({
        id: ctx.requestId,
        at: new Date().toISOString(),
        method: req.method,
        path: `${ctx.url.pathname}${ctx.url.search}`,
        route: ctx.routeName,
        status: response.status,
        durationMs,
        client: ctx.principal?.name ?? null,
        headers: redactHeaders(req.headers),
        body: ctx.body,
      });
    }
  }

  return {
    handler,
    close() {
      metrics.stop();
    },
    /** Internal collaborators, exposed for tests and tooling. */
    deps: { catalog, keyStore, metrics, requestHistory, priceCart },
  };
}
