import { findBestPromotion } from './promotions.js';

/** Loyalty discount (basis points) applied to the merchandise total after promotions. */
export const LOYALTY_DISCOUNT_BPS = Object.freeze({ gold: 200, silver: 100, standard: 0 });

const sumOf = (lines, pick) => lines.reduce((total, line) => total + pick(line), 0);

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
 *
 * @param {{
 *   catalog: { getSnapshot(): { products: object[], promotions: object[] } },
 *   inventory: { getStock(sku: string): Promise<number>, getStockBatch(skus: string[]): Promise<Map<string, number>> },
 *   shipping: { quote(destination: object, weightGrams: number): Promise<{ carrier: string, costCents: number, etaDays: number }> },
 *   loyalty: { getTier(customerId: string): Promise<'gold' | 'silver' | 'standard'> },
 *   logger: { debug(msg: string, fields?: object): void },
 *   clock?: () => Date,
 * }} deps
 */
export function createCartPricer({ catalog, inventory, shipping, loyalty, logger, clock = () => new Date() }) {
  /**
   * @param {{ customerId: string, destination: { country: string, postalCode: string }, items: { sku: string, quantity: number }[] }} cart
   */
  return async function priceCart(cart) {
    const now = clock();
    const { products, promotions } = catalog.getSnapshot();

    const lines = [];
    for (const item of cart.items) {
      const found = products.find((product) => product.sku === item.sku);
      if (!found) {
        lines.push(unavailableLine(item));
        continue;
      }
      // Price a private copy so this request can never modify shared catalog data.
      const product = JSON.parse(JSON.stringify(found));
      const available = await inventory.getStock(product.sku);
      const line = priceLine(product, item.quantity, available, promotions, now);
      logger.debug(`priced line ${JSON.stringify(line)} for product ${JSON.stringify(product)}`);
      lines.push(line);
    }

    // Only lines we can actually fulfil are shipped and charged.
    const shippable = lines.filter((line) => line.status === 'ok');
    const weightGrams = sumOf(shippable, (line) => line.weightGrams * line.quantity);
    const quote = shippable.length > 0 ? await shipping.quote(cart.destination, weightGrams) : null;
    const customerTier = await loyalty.getTier(cart.customerId);

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
      shipping: quote ? { ...quote, weightGrams } : null,
      totalCents: afterPromotionsCents - loyaltyDiscountCents + shippingCents,
      pricedAt: now.toISOString(),
    };
  };
}
