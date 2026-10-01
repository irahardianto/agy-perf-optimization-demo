import { HttpError } from '../http/json.js';
import { activePromotionsFor } from '../pricing/promotions.js';
import { parseSearchParams, searchProducts } from './search.js';

/**
 * @param {ReturnType<typeof import('../http/router.js').createRouter>} router
 * @param {{ catalog: ReturnType<typeof import('./catalog-repository.js').createCatalogRepository>, clock: () => Date }} deps
 */
export function registerCatalogRoutes(router, { catalog, clock }) {
  // Registered before /api/products/:sku so "search" is not treated as a SKU.
  router.add(
    'GET',
    '/api/products/search',
    async ({ url }) => {
      const params = parseSearchParams(url.searchParams);
      const { products } = catalog.getSnapshot();
      return { status: 200, body: searchProducts(products, params) };
    },
    { name: 'products.search' },
  );

  router.add(
    'GET',
    '/api/products/:sku',
    async ({ params }) => {
      const { products, promotions } = catalog.getSnapshot();
      const product = products.find((candidate) => candidate.sku === params.sku);
      if (!product) {
        throw new HttpError(404, 'product_not_found', `No product with SKU ${params.sku}`);
      }
      return { status: 200, body: { ...product, deals: activePromotionsFor(product.sku, promotions, clock()) } };
    },
    { name: 'products.get' },
  );
}
