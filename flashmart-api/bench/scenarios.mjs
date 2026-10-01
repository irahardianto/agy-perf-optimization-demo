// Request mixes used by the benchmark and the profiler. Deterministic so runs are comparable.
import { DEMO_KEYS, skuFor } from '../scripts/lib/generate-data.mjs';

export const SCENARIO_NAMES = Object.freeze(['search', 'product', 'cart', 'mixed']);

const SEARCH_QUERIES = [
  'q=wireless+earbuds',
  'q=gaming+mouse&sort=rating',
  'q=air+fryer',
  'q=smartwatch+gps&limit=10',
  'q=noise-cancelling+headphones',
  'q=robot+vacuum&sort=price_asc',
  'q=running+sneakers',
  'q=mechanical+keyboard+rgb',
  'q=rice+cooker&maxPrice=20000',
  'q=4k+action+camera',
  'category=audio&sort=price_asc',
  'q=power+bank+usb-c',
  'q=yoga+mat&sort=price_desc',
  'category=gaming&sort=rating&limit=24',
  'q=sunscreen+spf50',
  'q=smart+bulb&offset=20',
];

const COUNTRIES = ['ID', 'SG', 'MY', 'TH', 'PH', 'VN', 'AU', 'US'];

// Storefront traffic shape: 50% search, 30% product pages, 20% cart pricing.
const MIX = ['search', 'product', 'search', 'cart', 'product', 'search', 'product', 'search', 'cart', 'search'];

/**
 * @param {{ productCount: number }} options
 * @returns {Record<string, (sequence: number) => { method: string, path: string, headers: Record<string, string>, body?: string }>}
 */
export function createScenarios({ productCount }) {
  const headers = { 'x-api-key': DEMO_KEYS.storefront };
  const jsonHeaders = { ...headers, 'content-type': 'application/json' };
  // Stride through the catalog so requests touch products from every part of the snapshot.
  const skuAt = (i) => skuFor((i * 7919) % productCount);

  const carts = Array.from({ length: 64 }, (_, c) => {
    const size = 2 + (c % 7); // 2-8 lines
    const skus = new Set();
    for (let k = 0; skus.size < size; k += 1) skus.add(skuAt(c * 17 + k * 131 + 1));
    return JSON.stringify({
      customerId: `cust-${String((c * 37) % 5000).padStart(4, '0')}`,
      destination: { country: COUNTRIES[c % COUNTRIES.length], postalCode: String(10_000 + c * 211) },
      items: [...skus].map((sku, k) => ({ sku, quantity: 1 + ((c + k) % 3) })),
    });
  });

  const scenarios = {
    search: (i) => ({ method: 'GET', path: `/api/products/search?${SEARCH_QUERIES[i % SEARCH_QUERIES.length]}`, headers }),
    product: (i) => ({ method: 'GET', path: `/api/products/${skuAt(i)}`, headers }),
    cart: (i) => ({ method: 'POST', path: '/api/cart/price', headers: jsonHeaders, body: carts[i % carts.length] }),
  };
  scenarios.mixed = (i) => scenarios[MIX[i % MIX.length]](i);
  return scenarios;
}
