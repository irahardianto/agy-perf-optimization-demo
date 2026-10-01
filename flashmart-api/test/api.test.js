import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/platform/logger.js';
import { activePromotionsFor } from '../src/pricing/promotions.js';
import { createDataDir, DEMO_KEYS, eventually, smallSnapshot } from './support/fixtures.js';

const INTERNAL_TOKEN = 'test-internal-token';
const NOW = new Date('2026-11-11T11:11:00.000Z');

describe('FlashMart API (HTTP)', () => {
  let data;
  let app;
  let server;
  let baseUrl;

  before(async () => {
    data = createDataDir();
    const config = loadConfig({ DATA_DIR: data.dir, INTERNAL_TOKEN, SIMULATE_EXTERNAL_LATENCY: '0', LOG_LEVEL: 'silent' });
    app = buildApp({ config, logger: createLogger({ level: 'silent' }), overrides: { clock: () => NOW } });
    server = http.createServer(app.handler);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    app.close();
    data.cleanup();
  });

  async function call(method, path, { key = DEMO_KEYS.storefront, headers = {}, body } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { ...(key ? { 'x-api-key': key } : {}), ...headers },
      body,
    });
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
  }

  const internal = (method, path) => call(method, path, { key: null, headers: { 'x-internal-token': INTERNAL_TOKEN } });
  const postCart = (payload, headers = { 'content-type': 'application/json' }) =>
    call('POST', '/api/cart/price', { headers, body: typeof payload === 'string' ? payload : JSON.stringify(payload) });

  test('GET /healthz needs no API key', async () => {
    const res = await call('GET', '/healthz', { key: null });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { status: 'ok' });
  });

  test('rejects /api requests without a valid, active API key', async () => {
    for (const key of [null, 'nonsense', 'fmk_web01.WrongSecret0000000', DEMO_KEYS.revoked]) {
      const res = await call('GET', '/api/products/search?q=earbuds', { key });
      assert.equal(res.status, 401, `key ${key}`);
      assert.equal(res.body.error.code, 'unauthorized');
    }
  });

  test('searches products', async () => {
    const res = await call('GET', '/api/products/search?q=wireless&limit=5');
    assert.equal(res.status, 200);
    assert.equal(res.body.sort, 'relevance');
    assert.ok(res.body.total > 0);
    assert.ok(res.body.items.length > 0 && res.body.items.length <= 5);
    assert.ok(res.headers.get('x-request-id'));
  });

  test('validates search parameters', async () => {
    const res = await call('GET', '/api/products/search?limit=500');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'invalid_query');
  });

  test('returns product details with the deals active right now', async () => {
    const product = data.snapshot.products.find((p) => activePromotionsFor(p.sku, data.snapshot.promotions, NOW).length >= 2);
    const res = await call('GET', `/api/products/${product.sku}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.sku, product.sku);
    assert.equal(res.body.priceCents, product.priceCents);
    assert.deepEqual(res.body.deals, activePromotionsFor(product.sku, data.snapshot.promotions, NOW));
  });

  test('returns 404 for an unknown SKU', async () => {
    const res = await call('GET', '/api/products/FM-999999');
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'product_not_found');
  });

  test('prices a cart', async () => {
    const [a, b] = data.snapshot.products;
    const res = await postCart({
      customerId: 'cust-0042',
      destination: { country: 'SG', postalCode: '018956' },
      items: [{ sku: a.sku, quantity: 1 }, { sku: b.sku, quantity: 2 }],
    });
    assert.equal(res.status, 200);
    const summary = res.body;
    assert.deepEqual(summary.lines.map((line) => line.sku), [a.sku, b.sku]);
    assert.ok(['gold', 'silver', 'standard'].includes(summary.customerTier));
    assert.equal(
      summary.totalCents,
      summary.merchandiseSubtotalCents - summary.promotionDiscountCents - summary.loyaltyDiscountCents + (summary.shipping?.costCents ?? 0),
    );
    assert.equal(summary.pricedAt, NOW.toISOString());
  });

  test('rejects invalid carts with details', async () => {
    const res = await postCart({ customerId: '', destination: { country: 'XX', postalCode: '1' }, items: [{ sku: 'nope', quantity: 0 }] });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'invalid_cart');
    assert.equal(res.body.error.details.length, 5);
  });

  test('requires a JSON body', async () => {
    assert.equal((await postCart('{}', { 'content-type': 'text/plain' })).status, 415);
    const malformed = await postCart('{"customerId":', { 'content-type': 'application/json' });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.error.code, 'invalid_json');
  });

  test('answers 404 for unknown routes and 405 for unsupported methods', async () => {
    assert.equal((await call('GET', '/api/nothing-here')).status, 404);
    assert.equal((await call('DELETE', '/api/products/search')).status, 405);
  });

  test('protects internal endpoints with the internal token', async () => {
    assert.equal((await call('GET', '/internal/metrics', { key: null })).status, 401);
    assert.equal((await call('GET', '/internal/metrics', { key: null, headers: { 'x-internal-token': 'wrong' } })).status, 401);
    const res = await internal('GET', '/internal/metrics');
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.requestHistorySize, 'number');
    assert.equal(typeof res.body.eventLoopDelayMs.p99, 'number');
  });

  test('records recent API requests with credentials redacted', async () => {
    await call('GET', '/api/products/search?q=history-probe');
    const res = await internal('GET', '/internal/requests?limit=5');
    assert.equal(res.status, 200);
    const entry = res.body.items.find((item) => item.path.includes('history-probe'));
    assert.ok(entry, 'request not found in history');
    assert.equal(entry.status, 200);
    assert.equal(entry.headers['x-api-key'], '[redacted]');
    assert.equal(entry.client, 'storefront-web');
  });

  test('revokes API keys immediately', async () => {
    assert.equal((await call('GET', '/api/products/search?q=cable', { key: DEMO_KEYS.mobile })).status, 200);
    assert.equal((await internal('POST', '/internal/keys/app01/revoke')).status, 200);
    assert.equal((await call('GET', '/api/products/search?q=cable', { key: DEMO_KEYS.mobile })).status, 401);
    assert.equal((await internal('POST', '/internal/keys/nobody/revoke')).status, 404);
  });

  // Keep last: replaces the catalog for the rest of the suite.
  test('serves catalog updates within one second, including in search results', async () => {
    const next = smallSnapshot();
    next.version = 'api-v2';
    next.products[0] = { ...next.products[0], name: 'Zephyrine Quasar Blender Z900', priceCents: 12_345 };
    data.replaceCatalog(next);
    const { sku } = next.products[0];

    const priced = await eventually(async () => (await call('GET', `/api/products/${sku}`)).body.priceCents === 12_345);
    assert.ok(priced, 'product details did not reflect the new snapshot within 1.5 s');
    const found = await eventually(async () => (await call('GET', '/api/products/search?q=zephyrine')).body.items[0]?.sku === sku);
    assert.ok(found, 'search results did not reflect the new snapshot within 1.5 s');
  });
});
