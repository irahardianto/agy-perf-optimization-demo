/**
 * @typedef {{ id: string, name: string, type: 'percent' | 'fixed', value: number, minQuantity: number,
 *   startsAt: string, endsAt: string, skus: string[] }} Promotion
 */

/** @param {Promotion} promotion @param {Date} now */
export function isActive(promotion, now) {
  return new Date(promotion.startsAt) <= now && now <= new Date(promotion.endsAt);
}

// NAIVE VARIANT (workshop demo): index promotions by SKU and, while we're at it, keep only the
// ones that are active. But "active" is decided once, when the index is built for a snapshot.
// A flash deal that starts (or ends) five minutes later is priced wrong until the next export.
const promotionIndexes = new WeakMap();

function activeIndexFor(promotions, now) {
  let index = promotionIndexes.get(promotions);
  if (index === undefined) {
    index = new Map();
    for (const promotion of promotions) {
      if (!isActive(promotion, now)) continue;
      for (const sku of new Set(promotion.skus)) {
        const list = index.get(sku);
        if (list === undefined) index.set(sku, [promotion]);
        else list.push(promotion);
      }
    }
    promotionIndexes.set(promotions, index);
  }
  return index;
}

/**
 * Discount (in cents) that a promotion gives on a line.
 * `percent` promotions take value% off the line; `fixed` promotions take `value` cents off each unit.
 * @param {Promotion} promotion
 */
export function discountFor(promotion, unitPriceCents, quantity) {
  const grossCents = unitPriceCents * quantity;
  if (promotion.type === 'percent') return Math.floor((grossCents * promotion.value) / 100);
  if (promotion.type === 'fixed') return Math.min(grossCents, promotion.value * quantity);
  return 0;
}

/**
 * Picks the promotion with the largest discount for a line (promotions don't stack).
 * Ties go to the lowest promotion id so results are deterministic.
 * @param {{ sku: string, quantity: number, unitPriceCents: number }} line
 * @param {Promotion[]} promotions
 * @param {Date} now
 * @returns {{ promotion: Promotion, discountCents: number } | null}
 */
export function findBestPromotion(line, promotions, now) {
  let best = null;
  for (const promotion of activeIndexFor(promotions, now).get(line.sku) ?? []) {
    if (line.quantity < promotion.minQuantity) continue;

    const discountCents = discountFor(promotion, line.unitPriceCents, line.quantity);
    if (
      best === null
      || discountCents > best.discountCents
      || (discountCents === best.discountCents && promotion.id < best.promotion.id)
    ) {
      best = { promotion, discountCents };
    }
  }
  return best;
}

/**
 * Active promotions that include the given SKU, ordered by id (for product detail pages).
 * @param {string} sku
 * @param {Promotion[]} promotions
 * @param {Date} now
 */
export function activePromotionsFor(sku, promotions, now) {
  return (activeIndexFor(promotions, now).get(sku) ?? [])
    .map(({ id, name, type, value, minQuantity, endsAt }) => ({ id, name, type, value, minQuantity, endsAt }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
