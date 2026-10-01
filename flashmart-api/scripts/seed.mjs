#!/usr/bin/env node
// Generates the local catalog snapshot and API key store under data/.
// Usage: node scripts/seed.mjs [--products 12000] [--promotions 300] [--force]
// Without --products/--promotions, existing data keeps its size (defaults: 12000 / 300).
import { mkdirSync, writeFileSync, renameSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { generateSnapshot, generateApiKeys } from './lib/generate-data.mjs';
import { ensureGitRepo } from './lib/git-repo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const GENERATOR_VERSION = 1;
const DEFAULT_SIZE = Object.freeze({ products: 12_000, promotions: 300 });

function countFrom(value, name) {
  if (value === undefined || value === '') return undefined;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1) throw new Error(`${name} must be a positive integer (got "${value}")`);
  return count;
}

/** The manifest of the data already on disk, or null if data/ is missing or incomplete. */
function currentManifest(dataDir) {
  const manifestPath = path.join(dataDir, '.seed.json');
  if (![manifestPath, path.join(dataDir, 'catalog.json'), path.join(dataDir, 'api-keys.json')].every(existsSync)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Generates data/ unless matching data already exists. Without explicit sizes (arguments or the
 * CATALOG_SIZE / PROMOTION_COUNT variables) the size of existing data is kept, so a deliberately
 * smaller catalog is never silently regenerated at full size.
 */
export function seed({ dataDir = path.join(ROOT, 'data'), productCount, promotionCount, force = false, quiet = false } = {}) {
  const current = currentManifest(dataDir);
  const reusable = current?.generator === GENERATOR_VERSION ? current : null;
  const products = countFrom(productCount, 'product count') ?? countFrom(process.env.CATALOG_SIZE, 'CATALOG_SIZE')
    ?? reusable?.products ?? DEFAULT_SIZE.products;
  const promotions = countFrom(promotionCount, 'promotion count') ?? countFrom(process.env.PROMOTION_COUNT, 'PROMOTION_COUNT')
    ?? reusable?.promotions ?? DEFAULT_SIZE.promotions;
  const manifestPath = path.join(dataDir, '.seed.json');
  const wanted = { products, promotions, generator: GENERATOR_VERSION };

  if (!force && reusable && reusable.products === products && reusable.promotions === promotions) {
    if (!quiet) console.log(`data/ already seeded (${products} products, ${promotions} promotions) — use --force to regenerate`);
    return { skipped: true, ...wanted };
  }

  mkdirSync(dataDir, { recursive: true });
  const started = performance.now();
  const snapshot = generateSnapshot({ productCount: products, promotionCount: promotions });
  writeAtomic(path.join(dataDir, 'catalog.json'), JSON.stringify(snapshot));
  writeAtomic(path.join(dataDir, 'api-keys.json'), JSON.stringify(generateApiKeys(), null, 2));
  writeAtomic(manifestPath, JSON.stringify(wanted));
  if (!quiet) {
    console.log(`seeded data/ with ${products} products and ${promotions} promotions in ${Math.round(performance.now() - started)} ms`);
  }
  return { skipped: false, ...wanted };
}

// Same pattern the merchandising exporter uses: write to a temp file, then rename over the target.
function writeAtomic(target, contents) {
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, contents);
  renameSync(tmp, target);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const { values } = parseArgs({
      options: {
        products: { type: 'string' },
        promotions: { type: 'string' },
        force: { type: 'boolean', default: false },
      },
    });
    seed({ productCount: values.products, promotionCount: values.promotions, force: values.force });
    try {
      ensureGitRepo(ROOT);
    } catch {
      // git availability is reported by `npm run doctor`
    }
  } catch (error) {
    console.error(`seed failed: ${error.message}`);
    console.error('Usage: node scripts/seed.mjs [--products 12000] [--promotions 300] [--force]');
    process.exit(1);
  }
}
