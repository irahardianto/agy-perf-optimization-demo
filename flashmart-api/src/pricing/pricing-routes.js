import { validateCartRequest } from './cart-validation.js';

/**
 * @param {ReturnType<typeof import('../http/router.js').createRouter>} router
 * @param {{ priceCart: ReturnType<typeof import('./cart-pricer.js').createCartPricer> }} deps
 */
export function registerPricingRoutes(router, { priceCart }) {
  router.add(
    'POST',
    '/api/cart/price',
    async ({ body }) => {
      const cart = validateCartRequest(body);
      return { status: 200, body: await priceCart(cart) };
    },
    { name: 'cart.price', body: true },
  );
}
