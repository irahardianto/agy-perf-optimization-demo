import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { activePromotionsFor, discountFor, findBestPromotion, isActive } from '../src/pricing/promotions.js';

const ACTIVE = { startsAt: '2026-01-01T00:00:00.000Z', endsAt: '2030-12-31T23:59:59.000Z' };
const promo = (id, fields) => ({ id, name: `Promo ${id}`, type: 'percent', value: 10, minQuantity: 1, ...ACTIVE, skus: ['FM-000001'], ...fields });
const NOW = new Date('2026-11-11T11:11:00.000Z');

describe('isActive', () => {
  test('includes both ends of the window', () => {
    const p = promo('P1', { startsAt: '2026-11-11T00:00:00.000Z', endsAt: '2026-11-11T23:59:59.000Z' });
    assert.equal(isActive(p, new Date('2026-11-11T00:00:00.000Z')), true);
    assert.equal(isActive(p, new Date('2026-11-11T23:59:59.000Z')), true);
    assert.equal(isActive(p, new Date('2026-11-10T23:59:59.999Z')), false);
    assert.equal(isActive(p, new Date('2026-11-12T00:00:00.000Z')), false);
  });
});

describe('discountFor', () => {
  test('percent discounts are floored to whole cents', () => {
    assert.equal(discountFor(promo('P1', { type: 'percent', value: 15 }), 999, 3), 449);
  });

  test('fixed discounts apply per unit and never exceed the line total', () => {
    assert.equal(discountFor(promo('P1', { type: 'fixed', value: 250 }), 1_000, 3), 750);
    assert.equal(discountFor(promo('P1', { type: 'fixed', value: 2_500 }), 1_000, 2), 2_000);
  });
});

describe('findBestPromotion', () => {
  const line = { sku: 'FM-000001', quantity: 2, unitPriceCents: 10_000 };

  test('picks the largest discount among active promotions for the SKU', () => {
    const promotions = [
      promo('PROMO-0001', { value: 10 }),
      promo('PROMO-0002', { type: 'fixed', value: 1_500 }),
      promo('PROMO-0003', { value: 50, startsAt: '2031-01-01T00:00:00.000Z', endsAt: '2031-12-31T23:59:59.000Z' }),
      promo('PROMO-0004', { value: 40, skus: ['FM-000002'] }),
    ];
    const best = findBestPromotion(line, promotions, NOW);
    assert.equal(best.promotion.id, 'PROMO-0002');
    assert.equal(best.discountCents, 3_000);
  });

  test('breaks ties by the lowest promotion id', () => {
    const promotions = [promo('PROMO-0009', { value: 10 }), promo('PROMO-0003', { value: 10 }), promo('PROMO-0005', { value: 10 })];
    assert.equal(findBestPromotion(line, promotions, NOW).promotion.id, 'PROMO-0003');
  });

  test('respects the minimum quantity', () => {
    const promotions = [promo('PROMO-0001', { value: 30, minQuantity: 3 }), promo('PROMO-0002', { value: 5 })];
    assert.equal(findBestPromotion(line, promotions, NOW).promotion.id, 'PROMO-0002');
    assert.equal(findBestPromotion({ ...line, quantity: 3 }, promotions, NOW).promotion.id, 'PROMO-0001');
  });

  test('returns null when nothing applies', () => {
    assert.equal(findBestPromotion({ ...line, sku: 'FM-000999' }, [promo('PROMO-0001', {})], NOW), null);
    assert.equal(findBestPromotion(line, [], NOW), null);
  });
});

describe('activePromotionsFor', () => {
  test('lists active promotions for a SKU ordered by id, without the SKU list', () => {
    const promotions = [
      promo('PROMO-0007', { value: 20 }),
      promo('PROMO-0002', { type: 'fixed', value: 500, minQuantity: 2 }),
      promo('PROMO-0004', { startsAt: '2025-01-01T00:00:00.000Z', endsAt: '2025-12-31T23:59:59.000Z' }),
      promo('PROMO-0001', { skus: ['FM-000002'] }),
    ];
    assert.deepEqual(activePromotionsFor('FM-000001', promotions, NOW), [
      { id: 'PROMO-0002', name: 'Promo PROMO-0002', type: 'fixed', value: 500, minQuantity: 2, endsAt: ACTIVE.endsAt },
      { id: 'PROMO-0007', name: 'Promo PROMO-0007', type: 'percent', value: 20, minQuantity: 1, endsAt: ACTIVE.endsAt },
    ]);
  });
});
