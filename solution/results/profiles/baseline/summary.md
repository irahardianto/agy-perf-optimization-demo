# Profile summary — baseline

- Scenario: **mixed** · 16 connections · 8s profiled load (after 1s warm-up)
- Load during profiling: 8.6 req/s · p50 814 ms · p95 6696.9 ms · 0 errors (profilers add overhead — use `npm run bench` for official numbers)
- Commit 05e16a3 · node v22.22.2 · linux x64 · 12,000 products / 300 promotions
- Raw files: `.profiles/baseline/cpu.cpuprofile` and `.profiles/baseline/alloc.heapprofile` — load them in Chrome DevTools (Performance / Memory tab) for flame charts.
- The CPU profile covers the whole server process (startup, warm-up, profiled load, shutdown).

## CPU profile

30.2 s profiled · 25,425 samples (~1187 µs apart) · CPU busy 99.7% of the time. Percentages below are **% of busy time** unless noted.

### Where the time went

| Category | ms | % of profile | % of busy |
|---|---:|---:|---:|
| Project code (src/) | 21,611 | 71.6% | 71.9% |
| V8 builtins / native (JSON, RegExp, Array...) | 762 | 2.5% | 2.5% |
| Node.js internals (node:*) | 5,073 | 16.8% | 16.9% |
| Dependencies / tooling | 25 | 0.1% | 0.1% |
| Garbage collection | 2,569 | 8.5% | 8.5% |
| VM overhead (program) | 38 | 0.1% | 0.1% |
| Idle (waiting for I/O) | 96 | 0.3% | - |

> GC is 8.5% of busy time — see the allocation hot spots for what is generating garbage.

### Top project hot spots

Self time of each project function **plus** time in V8 builtins / Node.js internals it calls directly (e.g. `JSON.parse`, `readFileSync`, `pbkdf2Sync`).

| # | Function | Location | ms | % busy | Largest non-project callees |
|---:|---|---|---:|---:|---|
| 1 | `readSnapshot` | src/catalog/catalog-repository.js:13 | 17,182 | 57.1% | readFileSync (node) 9.4%, isInt32 (node) 0.0%, isUint8Array (node) 0.0% |
| 2 | `tokenize` | src/catalog/search.js:10 | 5,224 | 17.4% | RegExp: [^a-z0-9]+ (native) 2.3%, RegExp: [\u0300-\u036f] (native) 0.2% |
| 3 | `authenticate` | src/auth/api-key-auth.js:29 | 1,558 | 5.2% | pbkdf2Sync (node) 5.1%, from (node) 0.0%, write (node) 0.0% |
| 4 | `scoreProduct` | src/catalog/search.js:19 | 1,242 | 4.1% |  |
| 5 | `searchProducts` | src/catalog/search.js:63 | 778 | 2.6% |  |
| 6 | `router.add.name` | src/catalog/catalog-routes.js:14 | 263 | 0.9% | parseParams (node) 0.0%, URLSearchParams (node) 0.0% |
| 7 | `(anonymous)` | src/server.js:37 | 164 | 0.5% | post (node) 0.4%, #onMessage (node) 0.1%, (anonymous) (dependency) 0.1% |
| 8 | `findBestPromotion` | src/pricing/promotions.js:31 | 121 | 0.4% |  |
| 9 | `sendJson` | src/http/json.js:53 | 116 | 0.4% | writevGeneric (node) 0.1%, end (node) 0.0%, matchHeader (node) 0.0% |
| 10 | `isActive` | src/pricing/promotions.js:7 | 88 | 0.3% |  |
| 11 | `relevance` | src/catalog/search.js:38 | 52 | 0.2% |  |
| 12 | `(anonymous)` | src/pricing/cart-pricer.js:66 | 50 | 0.2% |  |

### Hot lines (self samples inside project functions)

| # | Location | % busy | Source |
|---:|---|---:|---|
| 1 | src/catalog/catalog-repository.js:15 | 47.9% | `const snapshot = JSON.parse(readFileSync(catalogPath, 'utf8'));` |
| 2 | src/catalog/search.js:15 | 7.7% | `.split(/[^a-z0-9]+/)` |
| 3 | src/catalog/search.js:13 | 4.3% | `.normalize('NFKD')` |
| 4 | src/catalog/search.js:22 | 3.4% | `const tagTokens = product.tags.flatMap(tokenize);` |
| 5 | src/catalog/search.js:12 | 1.7% | `.toLowerCase()` |
| 6 | src/catalog/search.js:14 | 1.3% | `.replace(/[\u0300-\u036f]/g, '')` |
| 7 | src/catalog/search.js:16 | 1.1% | `.filter(Boolean);` |
| 8 | src/catalog/catalog-routes.js:17 | 0.8% | `return { status: 200, body: searchProducts(products, params) };` |
| 9 | src/catalog/search.js:30 | 0.6% | `if (descriptionTokens.includes(term)) score += WEIGHTS.description;` |
| 10 | src/pricing/promotions.js:35 | 0.4% | `if (!promotion.skus.includes(line.sku)) continue;` |
| 11 | src/pricing/promotions.js:8 | 0.3% | `return new Date(promotion.startsAt) <= now && now <= new Date(promotion.endsAt);` |
| 12 | src/catalog/search.js:26 | 0.3% | `for (const term of terms) {` |

### Project functions by inclusive time (cum)

| # | Function | Location | ms | % busy |
|---:|---|---|---:|---:|
| 1 | `dispatch` | src/app.js:58 | 26,506 | 88.1% |
| 2 | `handler` | src/app.js:100 | 23,275 | 77.4% |
| 3 | `getSnapshot` | src/catalog/catalog-repository.js:25 | 17,185 | 57.1% |
| 4 | `readSnapshot` | src/catalog/catalog-repository.js:13 | 17,182 | 57.1% |
| 5 | `router.add.name` | src/catalog/catalog-routes.js:14 | 16,093 | 53.5% |
| 6 | `searchProducts` | src/catalog/search.js:63 | 7,305 | 24.3% |
| 7 | `scoreProduct` | src/catalog/search.js:19 | 6,461 | 21.5% |
| 8 | `router.add.name` | src/catalog/catalog-routes.js:25 | 5,446 | 18.1% |
| 9 | `tokenize` | src/catalog/search.js:10 | 5,224 | 17.4% |
| 10 | `priceCart` | src/pricing/cart-pricer.js:60 | 3,608 | 12.0% |
| 11 | `router.add.name` | src/pricing/pricing-routes.js:11 | 3,373 | 11.2% |
| 12 | `authenticate` | src/auth/api-key-auth.js:29 | 1,559 | 5.2% |

### Top self time, all code (flat)

| # | Function | Kind | Location | ms | % busy |
|---:|---|---|---|---:|---:|
| 1 | `readSnapshot` | project | src/catalog/catalog-repository.js:13 | 14,350 | 47.7% |
| 2 | `tokenize` | project | src/catalog/search.js:10 | 4,464 | 14.8% |
| 3 | `readFileSync` | node | node:fs:433 | 2,824 | 9.4% |
| 4 | `(garbage collector)` | gc |  | 2,569 | 8.5% |
| 5 | `pbkdf2Sync` | node | node:internal/crypto/pbkdf2:62 | 1,532 | 5.1% |
| 6 | `scoreProduct` | project | src/catalog/search.js:19 | 1,242 | 4.1% |
| 7 | `searchProducts` | project | src/catalog/search.js:63 | 778 | 2.6% |
| 8 | `RegExp: [^a-z0-9]+` | native | V8 builtin | 692 | 2.3% |
| 9 | `router.add.name` | project | src/catalog/catalog-routes.js:14 | 259 | 0.9% |
| 10 | `compileForInternalLoader` | node | node:internal/bootstrap/realm:385 | 128 | 0.4% |
| 11 | `findBestPromotion` | project | src/pricing/promotions.js:31 | 121 | 0.4% |
| 12 | `post` | node | node:inspector:118 | 105 | 0.4% |

### Hottest call paths (project frames, outer → inner)

| # | % busy | Path |
|---:|---:|---|
| 1 | 23.7% | handler (src/app.js:100) → dispatch (src/app.js:58) → router.add.name (src/catalog/catalog-routes.js:14) → getSnapshot (src/catalog/catalog-repository.js:25) → readSnapshot (src/catalog/catalog-repository.js:13) |
| 2 | 14.8% | handler (src/app.js:100) → dispatch (src/app.js:58) → router.add.name (src/catalog/catalog-routes.js:25) → getSnapshot (src/catalog/catalog-repository.js:25) → readSnapshot (src/catalog/catalog-repository.js:13) |
| 3 | 14.8% | handler (src/app.js:100) → dispatch (src/app.js:58) → router.add.name (src/catalog/catalog-routes.js:14) → searchProducts (src/catalog/search.js:63) → scoreProduct (src/catalog/search.js:19) → tokenize (src/catalog/search.js:10) |
| 4 | 9.2% | dispatch (src/app.js:58) → router.add.name (src/pricing/pricing-routes.js:11) → priceCart (src/pricing/cart-pricer.js:60) → getSnapshot (src/catalog/catalog-repository.js:25) → readSnapshot (src/catalog/catalog-repository.js:13) |
| 5 | 5.1% | handler (src/app.js:100) → dispatch (src/app.js:58) → authenticate (src/auth/api-key-auth.js:29) → [node] pbkdf2Sync |
| 6 | 4.7% | handler (src/app.js:100) → dispatch (src/app.js:58) → router.add.name (src/catalog/catalog-routes.js:14) → getSnapshot (src/catalog/catalog-repository.js:25) → readSnapshot (src/catalog/catalog-repository.js:13) → [node] readFileSync |
| 7 | 4.1% | handler (src/app.js:100) → dispatch (src/app.js:58) → router.add.name (src/catalog/catalog-routes.js:14) → searchProducts (src/catalog/search.js:63) → scoreProduct (src/catalog/search.js:19) |
| 8 | 2.9% | handler (src/app.js:100) → dispatch (src/app.js:58) → router.add.name (src/catalog/catalog-routes.js:25) → getSnapshot (src/catalog/catalog-repository.js:25) → readSnapshot (src/catalog/catalog-repository.js:13) → [node] readFileSync |
| 9 | 2.6% | handler (src/app.js:100) → dispatch (src/app.js:58) → router.add.name (src/catalog/catalog-routes.js:14) → searchProducts (src/catalog/search.js:63) |
| 10 | 2.3% | handler (src/app.js:100) → dispatch (src/app.js:58) → router.add.name (src/catalog/catalog-routes.js:14) → searchProducts (src/catalog/search.js:63) → scoreProduct (src/catalog/search.js:19) → tokenize (src/catalog/search.js:10) → [native] RegExp: [^a-z0-9]+ |

## Allocation profile (sampled, includes garbage-collected objects)

10,413.2 MB allocated in total · ≈ 39788 KB per request (268 requests served by the process). High allocation volume drives GC time in the CPU profile.

### Allocation hot spots (nearest project function)

| # | Function | Location | MB | % | Largest non-project allocators |
|---:|---|---|---:|---:|---|
| 1 | `searchProducts` | src/catalog/search.js:63 | 4,082.9 | 39.2% | split (native) 19.2%, flatMap (native) 2.2%, next (native) 0.0% |
| 2 | `readSnapshot` | src/catalog/catalog-repository.js:13 | 4,082.0 | 39.2% | readFileSync (node) 19.3%, wrappedFn (node) 0.0% |
| 3 | `tokenize` | src/catalog/search.js:10 | 2,103.5 | 20.2% | split (native) 8.3%, filter (native) 0.0%, toLowerCase (native) 0.0% |
| 4 | `scoreProduct` | src/catalog/search.js:19 | 102.6 | 1.0% | split (native) 0.5%, flatMap (native) 0.1%, next (native) 0.0% |
| 5 | `findBestPromotion` | src/pricing/promotions.js:31 | 13.8 | 0.1% | next (native) 0.0% |
| 6 | `relevance` | src/catalog/search.js:38 | 5.3 | 0.1% |  |
| 7 | `isActive` | src/pricing/promotions.js:7 | 4.0 | 0.0% |  |
| 8 | `sendJson` | src/http/json.js:53 | 3.4 | 0.0% | writevGeneric (node) 0.0%, push (native) 0.0%, nextTick (node) 0.0% |
| 9 | `(anonymous)` | src/pricing/promotions.js:58 | 2.7 | 0.0% |  |
| 10 | `rating` | src/catalog/search.js:41 | 1.6 | 0.0% |  |
| 11 | `toSummary` | src/catalog/search.js:44 | 0.6 | 0.0% |  |
| 12 | `authenticate` | src/auth/api-key-auth.js:29 | 0.5 | 0.0% | from (node) 0.0%, wrappedFn (node) 0.0%, Uint8Array (native) 0.0% |
| - | (no project frame: Node.js startup / internals) | | 7.6 | 0.1% | |

### Top allocating functions, all code (flat)

| # | Function | Kind | Location | MB | % |
|---:|---|---|---|---:|---:|
| 1 | `split` | native | V8 builtin | 2,912.8 | 28.0% |
| 2 | `readSnapshot` | project | src/catalog/catalog-repository.js:13 | 2,072.4 | 19.9% |
| 3 | `readFileSync` | node | node:fs:433 | 2,009.6 | 19.3% |
| 4 | `searchProducts` | project | src/catalog/search.js:63 | 1,843.3 | 17.7% |
| 5 | `tokenize` | project | src/catalog/search.js:10 | 1,242.5 | 11.9% |
| 6 | `flatMap` | native | V8 builtin | 241.2 | 2.3% |
| 7 | `scoreProduct` | project | src/catalog/search.js:19 | 40.6 | 0.4% |
| 8 | `findBestPromotion` | project | src/pricing/promotions.js:31 | 13.6 | 0.1% |
| 9 | `next` | native | V8 builtin | 5.9 | 0.1% |
| 10 | `relevance` | project | src/catalog/search.js:38 | 5.3 | 0.1% |
| 11 | `isActive` | project | src/pricing/promotions.js:7 | 4.0 | 0.0% |
| 12 | `(anonymous)` | project | src/pricing/promotions.js:58 | 2.7 | 0.0% |

## Retained memory (after forced GC)

| Metric | Before profiled load | After profiled load | Δ |
|---|---:|---:|---:|
| V8 heap used (MB) | 8.1 | 7.3 | -0.8 |
| RSS (MB) | 357.4 | 417.3 | 59.9 |
| requestHistorySize | 108 | 267 | +159 |

Requests served between the two measurements: 159 · retained heap change per request: -5.15 KB.
