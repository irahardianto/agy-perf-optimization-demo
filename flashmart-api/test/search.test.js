import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { HttpError } from '../src/http/json.js';
import { parseSearchParams, searchProducts, tokenize } from '../src/catalog/search.js';
import { smallSnapshot } from './support/fixtures.js';

const PRODUCTS = [
  { sku: 'FM-000001', name: 'Sonora Wireless Earbuds A100', brand: 'Sonora', category: 'audio', description: 'Compact wireless earbuds with deep bass.', tags: ['bluetooth', 'wireless'], priceCents: 4_999, currency: 'USD', rating: 4.5, reviewCount: 120 },
  { sku: 'FM-000002', name: 'Voltix Studio Headphones B200', brand: 'Voltix', category: 'audio', description: 'Over-ear headphones for wireless listening.', tags: ['hi-res'], priceCents: 12_999, currency: 'USD', rating: 4.8, reviewCount: 300 },
  { sku: 'FM-000003', name: 'Kirana Rice Cooker C300', brand: 'Kirana', category: 'kitchen', description: 'Fluffy rice every time.', tags: ['timer', 'non-stick'], priceCents: 3_499, currency: 'USD', rating: 4.1, reviewCount: 80 },
  { sku: 'FM-000004', name: 'Wireless Charger D400', brand: 'Lumio', category: 'phones', description: 'Fast wireless charging pad.', tags: ['usb-c', 'wireless'], priceCents: 1_999, currency: 'USD', rating: 4.5, reviewCount: 500 },
  { sku: 'FM-000005', name: 'Café Crème Coffee Maker E500', brand: 'Nimbus', category: 'kitchen', description: 'Barista-style espresso at home.', tags: ['timer'], priceCents: 8_999, currency: 'USD', rating: 3.9, reviewCount: 45 },
];

const params = (overrides) => ({ q: '', sort: 'relevance', limit: 20, offset: 0, ...overrides });
const skus = (result) => result.items.map((item) => item.sku);

// Top-5 results (sku:score) on the deterministic generated catalog, captured from the reference implementation.
const GOLDEN = {
  wirelessEarbuds: { total: 43, top: ['FM-000229:7', 'FM-000181:7', 'FM-000265:4.5', 'FM-000107:4.5', 'FM-000263:4.5'] },
  smartByPrice: { total: 23, top: ['FM-000245:3.5', 'FM-000280:3.5', 'FM-000137:4.5', 'FM-000113:3.5', 'FM-000101:1'] },
  gamingBrowse: { total: 25, top: ['FM-000107:0', 'FM-000143:0', 'FM-000287:0', 'FM-000155:0', 'FM-000035:0'] },
};

describe('tokenize', () => {
  test('lowercases, strips diacritics and splits on non-alphanumerics', () => {
    assert.deepEqual(tokenize('Café Crème, Hi-Res!  USB-C'), ['cafe', 'creme', 'hi', 'res', 'usb', 'c']);
  });

  test('returns no tokens for blank input', () => {
    assert.deepEqual(tokenize('  --  '), []);
  });
});

describe('searchProducts', () => {
  test('scores name > brand > tags > description and breaks ties by rating, then SKU', () => {
    const result = searchProducts(PRODUCTS, params({ q: 'wireless' }));
    assert.deepEqual(skus(result), ['FM-000001', 'FM-000004', 'FM-000002']);
    assert.deepEqual(result.items.map((item) => item.score), [4.5, 4.5, 0.5]);
    assert.equal(result.total, 3);
    assert.equal(result.sort, 'relevance');
  });

  test('adds up scores across query terms', () => {
    const result = searchProducts(PRODUCTS, params({ q: 'wireless earbuds' }));
    assert.deepEqual(skus(result), ['FM-000001', 'FM-000004', 'FM-000002']);
    assert.deepEqual(result.items.map((item) => item.score), [8, 4.5, 0.5]);
  });

  test('matches brand names and accent-insensitive terms', () => {
    assert.deepEqual(skus(searchProducts(PRODUCTS, params({ q: 'kirana' }))), ['FM-000003']);
    assert.deepEqual(skus(searchProducts(PRODUCTS, params({ q: 'CAFE' }))), ['FM-000005']);
  });

  test('applies category and price filters', () => {
    const result = searchProducts(PRODUCTS, params({ q: 'wireless', category: 'audio', maxPriceCents: 10_000 }));
    assert.deepEqual(skus(result), ['FM-000001']);
  });

  test('sorts by price and paginates without changing the total', () => {
    const page1 = searchProducts(PRODUCTS, params({ sort: 'price_asc', limit: 2 }));
    const page2 = searchProducts(PRODUCTS, params({ sort: 'price_asc', limit: 2, offset: 2 }));
    assert.deepEqual(skus(page1), ['FM-000004', 'FM-000003']);
    assert.deepEqual(skus(page2), ['FM-000001', 'FM-000005']);
    assert.equal(page1.total, 5);
    assert.equal(page2.total, 5);
  });

  test('falls back to rating order when there is no query text', () => {
    const result = searchProducts(PRODUCTS, params({ q: '' }));
    assert.equal(result.sort, 'rating');
    assert.deepEqual(skus(result), ['FM-000002', 'FM-000004', 'FM-000001', 'FM-000003', 'FM-000005']);
  });

  test('returns summaries, not full product records', () => {
    const [item] = searchProducts(PRODUCTS, params({ q: 'rice' })).items;
    assert.deepEqual(Object.keys(item).sort(), ['brand', 'category', 'currency', 'name', 'priceCents', 'rating', 'reviewCount', 'score', 'sku']);
  });

  // Golden results on the deterministic generated catalog: ranking must not drift.
  test('keeps ranking stable on the generated catalog', () => {
    const { products } = smallSnapshot();
    const top = (q, extra = {}) => {
      const result = searchProducts(products, params({ q, limit: 5, ...extra }));
      return { total: result.total, top: result.items.map((item) => `${item.sku}:${item.score}`) };
    };
    assert.deepEqual(top('wireless earbuds'), GOLDEN.wirelessEarbuds);
    assert.deepEqual(top('smart', { sort: 'price_desc' }), GOLDEN.smartByPrice);
    assert.deepEqual(top('', { category: 'gaming' }), GOLDEN.gamingBrowse);
  });
});

describe('parseSearchParams', () => {
  const parse = (query) => parseSearchParams(new URLSearchParams(query));

  test('applies defaults', () => {
    assert.deepEqual(parse(''), { q: '', category: undefined, minPriceCents: undefined, maxPriceCents: undefined, sort: 'relevance', limit: 20, offset: 0 });
  });

  test('parses all supported parameters', () => {
    assert.deepEqual(parse('q=%20earbuds%20&category=audio&minPrice=100&maxPrice=5000&sort=price_asc&limit=5&offset=10'), {
      q: 'earbuds', category: 'audio', minPriceCents: 100, maxPriceCents: 5000, sort: 'price_asc', limit: 5, offset: 10,
    });
  });

  for (const [query, why] of [
    [`q=${'x'.repeat(101)}`, 'q too long'],
    ['sort=newest', 'unknown sort'],
    ['limit=0', 'limit below 1'],
    ['limit=51', 'limit above 50'],
    ['offset=-1', 'negative offset'],
    ['minPrice=1.5', 'fractional cents'],
    ['minPrice=500&maxPrice=100', 'min above max'],
  ]) {
    test(`rejects ${why}`, () => {
      assert.throws(() => parse(query), (error) => error instanceof HttpError && error.status === 400 && error.code === 'invalid_query');
    });
  }
});
