import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { after, describe, test } from 'node:test';
import { createCatalogRepository } from '../src/catalog/catalog-repository.js';
import { createLogger } from '../src/platform/logger.js';
import { createDataDir, eventually, smallSnapshot } from './support/fixtures.js';

const logger = createLogger({ level: 'silent' });
const withVersion = (version, mutate = () => {}) => {
  const snapshot = smallSnapshot();
  snapshot.version = version;
  mutate(snapshot);
  return snapshot;
};

describe('catalog repository', () => {
  const dirs = [];
  after(() => dirs.forEach((dir) => dir.cleanup()));
  const newDataDir = (options) => {
    const dir = createDataDir(options);
    dirs.push(dir);
    return dir;
  };

  test('returns the products and promotions from the snapshot file', () => {
    const data = newDataDir();
    const snapshot = createCatalogRepository({ catalogPath: data.catalogPath, logger }).getSnapshot();
    assert.equal(snapshot.version, data.snapshot.version);
    assert.equal(snapshot.products.length, 300);
    assert.equal(snapshot.promotions.length, 20);
  });

  // Requirement: merchandising updates must be visible within one second, without a restart.
  // The exporter replaces the file atomically (temp file + rename) every few minutes.
  test('serves each new snapshot within one second of it being published', async () => {
    const data = newDataDir({ snapshot: withVersion('v1') });
    const repository = createCatalogRepository({ catalogPath: data.catalogPath, logger });
    assert.equal(repository.getSnapshot().version, 'v1');

    data.replaceCatalog(withVersion('v2', (s) => { s.products[0].priceCents = 111; }));
    const v2 = await eventually(() => repository.getSnapshot().version === 'v2');
    assert.ok(v2, 'v2 was not served within 1.5 s of being published');
    assert.equal(repository.getSnapshot().products[0].priceCents, 111);

    data.replaceCatalog(withVersion('v3', (s) => { s.products[0].priceCents = 222; }));
    const v3 = await eventually(() => repository.getSnapshot().version === 'v3');
    assert.ok(v3, 'v3 was not served within 1.5 s of being published (second update after a rename)');
    assert.equal(repository.getSnapshot().products[0].priceCents, 222);
  });

  test('fails loudly when the snapshot is malformed', () => {
    const data = newDataDir();
    writeFileSync(data.catalogPath, JSON.stringify({ version: 'broken', products: 'nope' }));
    const repository = createCatalogRepository({ catalogPath: data.catalogPath, logger });
    assert.throws(() => repository.getSnapshot(), /Malformed catalog snapshot/);
  });
});
