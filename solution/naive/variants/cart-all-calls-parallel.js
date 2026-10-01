import { MAX_BATCH_SIZE } from '../external/inventory-client.js';
import { findBestPromotion } from './promotions.js';

/** Loyalty discount (basis points) applied to the merchandise total after promotions. */
export const LOYALTY_DISCOUNT_BPS = Object.freeze({ gold: 200, silver: 100, standard: 0 });

const sumOf = (lines, pick) => lines.reduce((total, line) => total + pick(line), 0);

async function fetchStock(inventory, skus) {
  const batches = [];
  for (let start = 0; start < skus.length; start += MAX_BATCH_SIZE) {
    batches.push(inventory.getStockBatch(skus.slice(start, start + MAX_BATCH_SIZE)));
  }
  const stock = new Map();
  for (const batch of await Promise.all(batches)) {
    for (const [sku, units] of batch) stock.set(sku, units);
  }
  return stock;
}

function unavailableLine(item) {
  return {
    sku: item.sku,
    name: null,
    quantity: item.quantity,
    available: 0,
    status: 'not_found',
    unitPriceCents: 0,
    weightGrams: 0,
    promotionId: null,
    discountCents: 0,
    lineTotalCents: 0,
  };
}

function priceLine(product, quantity, available, promotions, now) {
  const inStock = available >= quantity;
  const best = inStock
    ? findBestPromotion({ sku: product.sku, quantity, unitPriceCents: product.priceCents }, promotions, now)
    : null;
  const discountCents = best?.discountCents ?? 0;
  return {
    sku: product.sku,
    name: product.name,
    quantity,
    available,
    status: inStock ? 'ok' : 'insufficient_stock',
    unitPriceCents: product.priceCents,
    weightGrams: product.weightGrams,
    promotionId: best?.promotion.id ?? null,
    discountCents,
    lineTotalCents: inStock ? product.priceCents * quantity - discountCents : 0,
  };
}

/**
 * Prices a cart: catalog price, live stock, best promotion per line, shipping for the
 * in-stock lines, and the customer's loyalty discount.
 * @param {object} deps
 */
export function createCartPricer({ catalog, inventory, shipping, loyalty, logger, clock = () => new Date() }) {
  return async function priceCart(cart) {
    const now = clock();
    const { products, promotions } = catalog.getSnapshot();

    // NAIVE VARIANT (workshop demo): fire every external call at once with Promise.all.
    // The shipping quote can't wait for stock here, so it is quoted on the weight of ALL lines,
    // including out-of-stock ones that will never ship (and it is requested even when nothing ships).
    const found = cart.items.map((item) => products.find((product) => product.sku === item.sku));
    const knownSkus = found.filter(Boolean).map((product) => product.sku);
    const allLinesWeight = cart.items.reduce((total, item, i) => total + (found[i] ? found[i].weightGrams * item.quantity : 0), 0);
    const [stock, quote, customerTier] = await Promise.all([
      fetchStock(inventory, knownSkus),
      knownSkus.length > 0 ? shipping.quote(cart.destination, allLinesWeight) : null,
      loyalty.getTier(cart.customerId),
    ]);

    const lines = cart.items.map((item, i) => {
      if (!found[i]) return unavailableLine(item);
      const product = found[i];
      const line = priceLine(product, item.quantity, stock.get(product.sku) ?? 0, promotions, now);
      logger.debug(`priced line ${JSON.stringify(line)} for product ${JSON.stringify(product)}`);
      return line;
    });

    const shippable = lines.filter((line) => line.status === 'ok');
    const merchandiseSubtotalCents = sumOf(shippable, (line) => line.unitPriceCents * line.quantity);
    const promotionDiscountCents = sumOf(shippable, (line) => line.discountCents);
    const afterPromotionsCents = merchandiseSubtotalCents - promotionDiscountCents;
    const loyaltyDiscountCents = Math.floor((afterPromotionsCents * LOYALTY_DISCOUNT_BPS[customerTier]) / 10_000);
    const shippingCents = quote?.costCents ?? 0;

    return {
      currency: 'USD',
      customerTier,
      lines,
      merchandiseSubtotalCents,
      promotionDiscountCents,
      loyaltyDiscountCents,
      shipping: quote ? { ...quote, weightGrams: allLinesWeight } : null,
      totalCents: afterPromotionsCents - loyaltyDiscountCents + shippingCents,
      pricedAt: now.toISOString(),
    };
  };
}
