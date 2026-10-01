import { HttpError } from '../http/json.js';

export const SORT_OPTIONS = Object.freeze(['relevance', 'price_asc', 'price_desc', 'rating']);
export const MAX_LIMIT = 50;

// Field weights for relevance scoring.
const WEIGHTS = Object.freeze({ name: 3, brand: 2, tags: 1, description: 0.5 });

/** Lowercases, strips diacritics and splits text into alphanumeric tokens. */
export function tokenize(text) {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function scoreProduct(product, terms) {
  const nameTokens = tokenize(product.name);
  const brandTokens = tokenize(product.brand);
  const tagTokens = product.tags.flatMap(tokenize);
  const descriptionTokens = tokenize(product.description);

  let score = 0;
  for (const term of terms) {
    if (nameTokens.includes(term)) score += WEIGHTS.name;
    if (brandTokens.includes(term)) score += WEIGHTS.brand;
    if (tagTokens.includes(term)) score += WEIGHTS.tags;
    if (descriptionTokens.includes(term)) score += WEIGHTS.description;
  }
  return score;
}

const bySku = (a, b) => (a.product.sku < b.product.sku ? -1 : a.product.sku > b.product.sku ? 1 : 0);

const COMPARATORS = {
  relevance: (a, b) => b.score - a.score || b.product.rating - a.product.rating || bySku(a, b),
  price_asc: (a, b) => a.product.priceCents - b.product.priceCents || bySku(a, b),
  price_desc: (a, b) => b.product.priceCents - a.product.priceCents || bySku(a, b),
  rating: (a, b) => b.product.rating - a.product.rating || b.product.reviewCount - a.product.reviewCount || bySku(a, b),
};

function toSummary({ product, score }) {
  return {
    sku: product.sku,
    name: product.name,
    brand: product.brand,
    category: product.category,
    priceCents: product.priceCents,
    currency: product.currency,
    rating: product.rating,
    reviewCount: product.reviewCount,
    score,
  };
}

/**
 * Full-text product search with filters, sorting and pagination.
 * @param {object[]} products
 * @param {{ q: string, category?: string, minPriceCents?: number, maxPriceCents?: number, sort: string, limit: number, offset: number }} params
 */
export function searchProducts(products, params) {
  const terms = tokenize(params.q);
  const sort = params.sort === 'relevance' && terms.length === 0 ? 'rating' : params.sort;

  const matches = [];
  for (const product of products) {
    if (params.category && product.category !== params.category) continue;
    if (params.minPriceCents !== undefined && product.priceCents < params.minPriceCents) continue;
    if (params.maxPriceCents !== undefined && product.priceCents > params.maxPriceCents) continue;
    const score = terms.length > 0 ? scoreProduct(product, terms) : 0;
    if (terms.length > 0 && score === 0) continue;
    matches.push({ product, score });
  }

  matches.sort(COMPARATORS[sort]);
  return {
    total: matches.length,
    sort,
    items: matches.slice(params.offset, params.offset + params.limit).map(toSummary),
  };
}

function optionalCents(query, name) {
  const raw = query.get(name);
  if (raw === null || raw === '') return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new HttpError(400, 'invalid_query', `${name} must be a non-negative integer (cents)`);
  }
  return value;
}

/**
 * Validates and normalizes search query-string parameters.
 * @param {URLSearchParams} query
 */
export function parseSearchParams(query) {
  const q = (query.get('q') ?? '').trim();
  if (q.length > 100) throw new HttpError(400, 'invalid_query', 'q must be at most 100 characters');

  const sort = query.get('sort') ?? 'relevance';
  if (!SORT_OPTIONS.includes(sort)) {
    throw new HttpError(400, 'invalid_query', `sort must be one of: ${SORT_OPTIONS.join(', ')}`);
  }

  const limit = query.has('limit') ? Number(query.get('limit')) : 20;
  const offset = query.has('offset') ? Number(query.get('offset')) : 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new HttpError(400, 'invalid_query', `limit must be an integer between 1 and ${MAX_LIMIT}`);
  }
  if (!Number.isInteger(offset) || offset < 0 || offset > 10_000) {
    throw new HttpError(400, 'invalid_query', 'offset must be an integer between 0 and 10000');
  }

  const minPriceCents = optionalCents(query, 'minPrice');
  const maxPriceCents = optionalCents(query, 'maxPrice');
  if (minPriceCents !== undefined && maxPriceCents !== undefined && minPriceCents > maxPriceCents) {
    throw new HttpError(400, 'invalid_query', 'minPrice must not exceed maxPrice');
  }

  const category = query.get('category') || undefined;
  return { q, category, minPriceCents, maxPriceCents, sort, limit, offset };
}
