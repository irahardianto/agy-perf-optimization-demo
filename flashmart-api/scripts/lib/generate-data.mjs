// Deterministic fixture generator for the FlashMart catalog snapshot and API keys.
// Used by `npm run setup` (full-size data) and by the test suite (small data).
import { pbkdf2Sync } from 'node:crypto';

export const CATEGORIES = {
  audio: { nouns: ['Earbuds', 'Headphones', 'Speaker', 'Soundbar', 'Turntable', 'Microphone'], adjectives: ['Wireless', 'Noise-Cancelling', 'Portable', 'Studio', 'Bass', 'Hi-Fi'], tags: ['bluetooth', 'wireless', 'anc', 'hi-res', 'portable'] },
  phones: { nouns: ['Smartphone', 'Phone Case', 'Charger', 'Power Bank', 'Screen Protector'], adjectives: ['5G', 'Ultra', 'Pro', 'Lite', 'Fast-Charge'], tags: ['android', 'usb-c', 'fast-charging', 'dual-sim', 'magsafe'] },
  laptops: { nouns: ['Laptop', 'Ultrabook', 'Docking Station', 'Laptop Stand', 'Keyboard'], adjectives: ['Gaming', 'Thin', 'Pro', 'Business', '14-inch'], tags: ['ssd', 'backlit', 'thunderbolt', 'lightweight', 'oled'] },
  wearables: { nouns: ['Smartwatch', 'Fitness Band', 'Smart Ring', 'Sports Watch'], adjectives: ['GPS', 'Waterproof', 'AMOLED', 'Slim'], tags: ['heart-rate', 'sleep-tracking', 'gps', 'waterproof', 'nfc'] },
  home: { nouns: ['Air Purifier', 'Robot Vacuum', 'Smart Bulb', 'Humidifier', 'Tower Fan'], adjectives: ['Smart', 'Quiet', 'Compact', 'HEPA'], tags: ['smart-home', 'wifi', 'energy-saving', 'voice-control', 'quiet'] },
  kitchen: { nouns: ['Blender', 'Air Fryer', 'Rice Cooker', 'Coffee Maker', 'Kettle'], adjectives: ['Digital', 'Stainless', 'Multi-Function', 'Cordless'], tags: ['bpa-free', 'dishwasher-safe', 'stainless-steel', 'timer', 'non-stick'] },
  beauty: { nouns: ['Hair Dryer', 'Serum', 'Face Mask', 'Trimmer', 'Sunscreen'], adjectives: ['Ionic', 'Hydrating', 'Organic', 'SPF50'], tags: ['vegan', 'cruelty-free', 'sensitive-skin', 'travel-size', 'fragrance-free'] },
  fashion: { nouns: ['Sneakers', 'Backpack', 'Jacket', 'Sunglasses', 'T-Shirt'], adjectives: ['Running', 'Waterproof', 'Classic', 'Oversized'], tags: ['cotton', 'unisex', 'breathable', 'recycled', 'limited-edition'] },
  sports: { nouns: ['Yoga Mat', 'Dumbbell Set', 'Bike Helmet', 'Treadmill', 'Jump Rope'], adjectives: ['Adjustable', 'Anti-Slip', 'Foldable', 'Pro'], tags: ['home-gym', 'outdoor', 'lightweight', 'durable', 'training'] },
  toys: { nouns: ['Building Blocks', 'RC Car', 'Puzzle', 'Plush Toy', 'Mini Drone'], adjectives: ['Educational', 'Mini', 'Remote-Control', 'Deluxe'], tags: ['stem', 'ages-8-plus', 'rechargeable', 'gift', 'family'] },
  gaming: { nouns: ['Controller', 'Gaming Mouse', 'Headset', 'Mechanical Keyboard', 'Gaming Chair'], adjectives: ['RGB', 'Wireless', 'Ergonomic', 'Pro'], tags: ['rgb', 'low-latency', 'esports', 'hot-swappable', 'wireless'] },
  cameras: { nouns: ['Action Camera', 'Mirrorless Camera', 'Tripod', 'Lens', 'Webcam'], adjectives: ['4K', 'Stabilized', 'Wide-Angle', 'Compact'], tags: ['4k', 'image-stabilization', 'vlogging', 'wifi', 'weather-sealed'] },
};

const BRANDS = [
  'Sonora', 'Voltix', 'Northwind', 'Kirana', 'Lumio', 'Aerodyne', 'Pixelforge', 'Tidal Nine', 'Borneo Labs', 'Solaris',
  'Nimbus', 'Garuda', 'Orbitra', 'Maple & Co', 'Zenko', 'Arcadia', 'Helix', 'Komodo', 'Quanta', 'Ember',
  'Vantage', 'Lotus', 'Ironbark', 'Sakura', 'Driftwood', 'Cobalt', 'Monsoon', 'Atlas', 'Nova', 'Pulse',
];

const DESCRIPTION_TEMPLATES = [
  (p) => `The ${p.brand} ${p.noun} brings ${p.adjective.toLowerCase()} performance to everyday life, backed by a ${p.warranty}-month warranty.`,
  (p) => `A ${p.adjective.toLowerCase()} ${p.noun.toLowerCase()} from ${p.brand}, designed for people who want dependable quality without the premium price.`,
  (p) => `Upgrade to the ${p.adjective} ${p.noun} by ${p.brand}: thoughtfully engineered, tested for durability, and ready for the 11.11 sale.`,
  (p) => `${p.brand}'s best-selling ${p.noun.toLowerCase()} now comes in ${p.color}, with ${p.adjective.toLowerCase()} design and free returns within 30 days.`,
];

const COLORS = ['black', 'white', 'silver', 'navy', 'forest green', 'rose gold', 'charcoal', 'sand'];

// SEC-112: API key secrets are hashed with PBKDF2-HMAC-SHA512. Parameters were set by
// the security review and must not be weakened without security sign-off.
export const KDF = Object.freeze({ digest: 'sha512', iterations: 10_000, keyLength: 32 });

/** Mulberry32: tiny deterministic PRNG so every machine generates identical data. */
export function createRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
    sample(list, count) {
      const copy = list.slice();
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy.slice(0, count);
    },
  };
}

export function skuFor(index) {
  return `FM-${String(index + 1).padStart(6, '0')}`;
}

export function generateProducts({ productCount, seed = 1111 }) {
  const rng = createRng(seed);
  const categoryNames = Object.keys(CATEGORIES);
  const products = new Array(productCount);
  for (let i = 0; i < productCount; i += 1) {
    const category = categoryNames[i % categoryNames.length];
    const vocab = CATEGORIES[category];
    const brand = rng.pick(BRANDS);
    const noun = rng.pick(vocab.nouns);
    const adjective = rng.pick(vocab.adjectives);
    const color = rng.pick(COLORS);
    const warranty = rng.pick([6, 12, 12, 24]);
    const model = `${String.fromCharCode(65 + rng.int(0, 25))}${rng.int(100, 999)}`;
    products[i] = {
      sku: skuFor(i),
      name: `${brand} ${adjective} ${noun} ${model}`,
      brand,
      category,
      description: rng.pick(DESCRIPTION_TEMPLATES)({ brand, noun, adjective, color, warranty }),
      priceCents: rng.int(299, 149_999),
      currency: 'USD',
      rating: Math.round((2.5 + rng.next() * 2.5) * 10) / 10,
      reviewCount: rng.int(0, 25_000),
      weightGrams: rng.int(50, 12_000),
      tags: rng.sample(vocab.tags, rng.int(2, 4)),
      attributes: { color, warrantyMonths: warranty },
      updatedAt: new Date(Date.UTC(2026, 8, 1 + (i % 25), 8, 0, 0)).toISOString(),
    };
  }
  return products;
}

export function generatePromotions({ products, promotionCount, seed = 1212, minSkus = 150, maxSkus = 1_200 }) {
  const rng = createRng(seed);
  const promotions = new Array(promotionCount);
  const allSkus = products.map((p) => p.sku);
  for (let i = 0; i < promotionCount; i += 1) {
    const roll = rng.next();
    // ~70% active, ~15% expired, ~15% scheduled for later.
    const window = roll < 0.7
      ? { startsAt: '2026-01-01T00:00:00.000Z', endsAt: '2030-12-31T23:59:59.000Z' }
      : roll < 0.85
        ? { startsAt: '2025-01-01T00:00:00.000Z', endsAt: '2025-12-31T23:59:59.000Z' }
        : { startsAt: '2031-01-01T00:00:00.000Z', endsAt: '2031-12-31T23:59:59.000Z' };
    const type = rng.next() < 0.65 ? 'percent' : 'fixed';
    const skuCount = Math.min(allSkus.length, rng.int(minSkus, maxSkus));
    promotions[i] = {
      id: `PROMO-${String(i + 1).padStart(4, '0')}`,
      name: type === 'percent' ? `11.11 Deal ${i + 1}` : `Flash Voucher ${i + 1}`,
      type,
      value: type === 'percent' ? rng.pick([5, 10, 15, 20, 25, 30]) : rng.pick([100, 250, 500, 1_000, 2_500]),
      minQuantity: rng.pick([1, 1, 1, 2, 3]),
      ...window,
      skus: rng.sample(allSkus, skuCount),
    };
  }
  return promotions;
}

export function generateSnapshot({ productCount = 12_000, promotionCount = 300, seed = 1111, minSkus, maxSkus } = {}) {
  const products = generateProducts({ productCount, seed });
  const promotions = generatePromotions({ products, promotionCount, seed: seed + 101, minSkus, maxSkus });
  return {
    version: `snapshot-${seed}-${productCount}-${promotionCount}`,
    generatedAt: '2026-09-28T00:00:00.000Z',
    products,
    promotions,
  };
}

export function hashSecret(secret, saltHex, iterations = KDF.iterations) {
  return pbkdf2Sync(secret, Buffer.from(saltHex, 'hex'), iterations, KDF.keyLength, KDF.digest).toString('hex');
}

/**
 * Demo API keys. Format sent by clients: `fmk_<id>.<secret>`.
 * Only hashes are persisted; the plaintext demo keys are documented in the README.
 */
export const DEMO_KEYS = Object.freeze({
  storefront: 'fmk_web01.Vt8q2KfN4xLm7RcZ',
  mobile: 'fmk_app01.Hs3wP9dQ6yBn1TgJ',
  revoked: 'fmk_old01.Qe5rT7uY9iO1pA3s',
});

export function generateApiKeys({ seed = 1313, extraKeys = 12 } = {}) {
  const rng = createRng(seed);
  const salt = () => Array.from({ length: 16 }, () => rng.int(0, 255).toString(16).padStart(2, '0')).join('');
  const records = [];
  const add = (plaintext, name, status) => {
    const [prefixed, secret] = plaintext.split('.');
    const id = prefixed.slice('fmk_'.length);
    const s = salt();
    records.push({
      id,
      name,
      status,
      scopes: ['catalog:read', 'cart:price'],
      salt: s,
      iterations: KDF.iterations,
      hash: hashSecret(secret, s),
      createdAt: '2026-06-01T00:00:00.000Z',
    });
  };
  add(DEMO_KEYS.storefront, 'storefront-web', 'active');
  add(DEMO_KEYS.mobile, 'mobile-app', 'active');
  add(DEMO_KEYS.revoked, 'legacy-partner', 'revoked');
  for (let i = 0; i < extraKeys; i += 1) {
    const id = `ptn${String(i + 1).padStart(2, '0')}`;
    const secret = Array.from({ length: 16 }, () => 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[rng.int(0, 55)]).join('');
    add(`fmk_${id}.${secret}`, `partner-${i + 1}`, rng.next() < 0.8 ? 'active' : 'revoked');
  }
  return records;
}
