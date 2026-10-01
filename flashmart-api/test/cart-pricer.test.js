import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createCartPricer } from '../src/pricing/cart-pricer.js';
import { createLogger } from '../src/platform/logger.js';
import { deepFreeze } from './support/fixtures.js';

const WINDOW_2026_2030 = { startsAt: '2026-01-01T00:00:00.000Z', endsAt: '2030-12-31T23:59:59.000Z' };
const WINDOW_2031 = { startsAt: '2031-01-01T00:00:00.000Z', endsAt: '2031-12-31T23:59:59.000Z' };

function catalogSnapshot() {
  return {
    version: 'test-1',
    generatedAt: '2026-09-28T00:00:00.000Z',
    products: [
      { sku: 'FM-000001', name: 'Alpha Earbuds', brand: 'Sonora', category: 'audio', priceCents: 10_000, weightGrams: 200, currency: 'USD', tags: ['wireless'], attributes: { color: 'black' } },
      { sku: 'FM-000002', name: 'Beta Speaker', brand: 'Voltix', category: 'audio', priceCents: 25_000, weightGrams: 1_500, currency: 'USD', tags: ['portable'], attributes: { color: 'navy' } },
      { sku: 'FM-000003', name: 'Gamma Cable', brand: 'Lumio', category: 'phones', priceCents: 1_999, weightGrams: 50, currency: 'USD', tags: ['usb-c'], attributes: { color: 'white' } },
    ],
    promotions: [
      { id: 'PROMO-0001', name: 'Audio 10%', type: 'percent', value: 10, minQuantity: 1, ...WINDOW_2026_2030, skus: ['FM-000001', 'FM-000002'] },
      { id: 'PROMO-0002', name: 'Speaker voucher', type: 'fixed', value: 3_000, minQuantity: 2, ...WINDOW_2026_2030, skus: ['FM-000002'] },
      { id: 'PROMO-0003', name: 'Cable half price (2031)', type: 'percent', value: 50, minQuantity: 1, ...WINDOW_2031, skus: ['FM-000003'] },
      { id: 'PROMO-0004', name: 'Expired earbuds deal', type: 'percent', value: 40, minQuantity: 1, startsAt: '2025-01-01T00:00:00.000Z', endsAt: '2025-12-31T23:59:59.000Z', skus: ['FM-000001'] },
    ],
  };
}

function fakes({ stock = {}, tier = 'standard' } = {}) {
  const shippingQuotes = [];
  return {
    shippingQuotes,
    inventory: {
      async getStock(sku) {
        return stock[sku] ?? 10;
      },
      async getStockBatch(skus) {
        return new Map(skus.map((sku) => [sku, stock[sku] ?? 10]));
      },
    },
    shipping: {
      async quote(destination, weightGrams) {
        shippingQuotes.push({ destination, weightGrams });
        return { carrier: 'FlashExpress', costCents: 700, etaDays: 2 };
      },
    },
    loyalty: {
      async getTier() {
        return tier;
      },
    },
  };
}

function pricerFor({ snapshot = catalogSnapshot(), clock = () => new Date('2026-11-11T11:11:00.000Z'), ...options } = {}) {
  const deps = fakes(options);
  const priceCart = createCartPricer({
    catalog: { getSnapshot: () => snapshot },
    inventory: deps.inventory,
    shipping: deps.shipping,
    loyalty: deps.loyalty,
    logger: createLogger({ level: 'silent' }),
    clock,
  });
  return { priceCart, ...deps, snapshot };
}

const cart = (items, extra = {}) => ({ customerId: 'cust-0001', destination: { country: 'ID', postalCode: '10110' }, items, ...extra });

describe('priceCart', () => {
  test('applies the best active promotion per line and totals the cart', async () => {
    const { priceCart } = pricerFor();
    const summary = await priceCart(cart([{ sku: 'FM-000001', quantity: 2 }, { sku: 'FM-000002', quantity: 2 }]));

    assert.deepEqual(summary.lines.map(({ sku, status, promotionId, discountCents, lineTotalCents }) => ({ sku, status, promotionId, discountCents, lineTotalCents })), [
      { sku: 'FM-000001', status: 'ok', promotionId: 'PROMO-0001', discountCents: 2_000, lineTotalCents: 18_000 },
      { sku: 'FM-000002', status: 'ok', promotionId: 'PROMO-0002', discountCents: 6_000, lineTotalCents: 44_000 },
    ]);
    assert.equal(summary.merchandiseSubtotalCents, 70_000);
    assert.equal(summary.promotionDiscountCents, 8_000);
    assert.equal(summary.loyaltyDiscountCents, 0);
    assert.deepEqual(summary.shipping, { carrier: 'FlashExpress', costCents: 700, etaDays: 2, weightGrams: 3_400 });
    assert.equal(summary.totalCents, 62_700);
    assert.equal(summary.currency, 'USD');
    assert.equal(summary.customerTier, 'standard');
    assert.equal(summary.pricedAt, '2026-11-11T11:11:00.000Z');
  });

  test('applies the loyalty discount after promotions', async () => {
    const { priceCart } = pricerFor({ tier: 'gold' });
    const summary = await priceCart(cart([{ sku: 'FM-000001', quantity: 2 }, { sku: 'FM-000002', quantity: 2 }]));
    assert.equal(summary.customerTier, 'gold');
    assert.equal(summary.loyaltyDiscountCents, 1_240); // 2% of 62,000
    assert.equal(summary.totalCents, 61_460);
  });

  test('keeps line order and marks unknown SKUs as not_found', async () => {
    const { priceCart } = pricerFor();
    const summary = await priceCart(cart([{ sku: 'FM-999999', quantity: 1 }, { sku: 'FM-000003', quantity: 1 }]));
    assert.deepEqual(summary.lines.map((line) => [line.sku, line.status, line.lineTotalCents]), [
      ['FM-999999', 'not_found', 0],
      ['FM-000003', 'ok', 1_999],
    ]);
  });

  test('charges and ships only the lines that are in stock', async () => {
    const { priceCart, shippingQuotes } = pricerFor({ stock: { 'FM-000002': 1 } });
    const summary = await priceCart(cart([{ sku: 'FM-000001', quantity: 2 }, { sku: 'FM-000002', quantity: 2 }]));

    const speaker = summary.lines[1];
    assert.equal(speaker.status, 'insufficient_stock');
    assert.equal(speaker.available, 1);
    assert.equal(speaker.lineTotalCents, 0);
    assert.equal(speaker.promotionId, null);
    // Only the earbuds (2 x 200 g) are shipped: out-of-stock lines must not add weight.
    assert.deepEqual(shippingQuotes.map((q) => q.weightGrams), [400]);
    assert.equal(summary.shipping.weightGrams, 400);
    assert.equal(summary.merchandiseSubtotalCents, 20_000);
    assert.equal(summary.totalCents, 18_000 + 700);
  });

  test('does not request a shipping quote when nothing can be shipped', async () => {
    const { priceCart, shippingQuotes } = pricerFor({ stock: { 'FM-000001': 0 } });
    const summary = await priceCart(cart([{ sku: 'FM-000001', quantity: 1 }, { sku: 'FM-999999', quantity: 1 }]));
    assert.equal(summary.shipping, null);
    assert.equal(shippingQuotes.length, 0);
    assert.equal(summary.totalCents, 0);
  });

  test('evaluates promotion windows at request time, not when the catalog was loaded', async () => {
    let now = new Date('2030-12-31T23:00:00.000Z');
    const { priceCart } = pricerFor({ clock: () => now });
    const items = [{ sku: 'FM-000001', quantity: 1 }, { sku: 'FM-000003', quantity: 2 }];

    const before = await priceCart(cart(items));
    assert.deepEqual(before.lines.map((line) => line.promotionId), ['PROMO-0001', null]);

    now = new Date('2031-06-01T00:00:00.000Z'); // same snapshot, later clock
    const after = await priceCart(cart(items));
    assert.deepEqual(after.lines.map((line) => line.promotionId), [null, 'PROMO-0003']);
    assert.equal(after.lines[1].discountCents, 1_999);
  });

  test('never mutates the shared catalog snapshot', async () => {
    const snapshot = deepFreeze(catalogSnapshot());
    const pristine = JSON.stringify(snapshot);
    const { priceCart } = pricerFor({ snapshot, tier: 'silver' });
    for (let i = 0; i < 3; i += 1) {
      await priceCart(cart([{ sku: 'FM-000001', quantity: 3 }, { sku: 'FM-000002', quantity: 2 }, { sku: 'FM-000003', quantity: 1 }]));
    }
    assert.equal(JSON.stringify(snapshot), pristine);
  });
});
