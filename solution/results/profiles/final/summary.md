# Profile summary — ref-final

- Scenario: **mixed** · 16 connections · 8s profiled load (after 1s warm-up)
- Load during profiling: 1296.5 req/s · p50 7 ms · p95 36.7 ms · 0 errors (profilers add overhead — use `npm run bench` for official numbers)
- Commit 1c3c606 · node v22.22.2 · linux x64 · 12,000 products / 300 promotions
- Raw files: `.profiles/ref-final/cpu.cpuprofile` and `.profiles/ref-final/alloc.heapprofile` — load them in Chrome DevTools (Performance / Memory tab) for flame charts.
- The CPU profile covers the whole server process (startup, warm-up, profiled load, shutdown).

## CPU profile

10.1 s profiled · 8,623 samples (~1177 µs apart) · CPU busy 96.5% of the time. Percentages below are **% of busy time** unless noted.

### Where the time went

| Category | ms | % of profile | % of busy |
|---|---:|---:|---:|
| Project code (src/) | 6,126 | 60.4% | 62.6% |
| V8 builtins / native (JSON, RegExp, Array...) | 23 | 0.2% | 0.2% |
| Node.js internals (node:*) | 2,896 | 28.5% | 29.6% |
| Dependencies / tooling | 7 | 0.1% | 0.1% |
| Garbage collection | 460 | 4.5% | 4.7% |
| VM overhead (program) | 278 | 2.7% | 2.8% |
| Idle (waiting for I/O) | 355 | 3.5% | - |

### Top project hot spots

Self time of each project function **plus** time in V8 builtins / Node.js internals it calls directly (e.g. `JSON.parse`, `readFileSync`, `pbkdf2Sync`).

| # | Function | Location | ms | % busy | Largest non-project callees |
|---:|---|---|---:|---:|---|
| 1 | `relevance` | src/catalog/search.js:72 | 1,341 | 13.7% |  |
| 2 | `sendJson` | src/http/json.js:53 | 1,238 | 12.6% | writevGeneric (node) 6.4%, nextTick (node) 0.5%, checkInvalidHeaderChar (node) 0.4% |
| 3 | `searchProducts` | src/catalog/search.js:97 | 1,217 | 12.4% |  |
| 4 | `(anonymous)` | src/pricing/cart-pricer.js:83 | 616 | 6.3% |  |
| 5 | `scoreMatches` | src/catalog/search.js:59 | 414 | 4.2% |  |
| 6 | `rating` | src/catalog/search.js:75 | 297 | 3.0% |  |
| 7 | `(anonymous)` | src/catalog/catalog-routes.js:27 | 260 | 2.7% |  |
| 8 | `router.add.name` | src/catalog/catalog-routes.js:25 | 256 | 2.6% |  |
| 9 | `fileVersion` | src/catalog/catalog-repository.js:30 | 239 | 2.4% | statSync (node) 2.1%, getStatsFromBinding (node) 0.1%, (anonymous) (node) 0.0% |
| 10 | `handler` | src/app.js:100 | 225 | 2.3% | now (node) 0.2%, randomFillSync (node) 0.1%, get (node) 0.1% |
| 11 | `(anonymous)` | src/pricing/cart-pricer.js:90 | 200 | 2.0% |  |
| 12 | `secretMatches` | src/auth/api-key-auth.js:47 | 198 | 2.0% | Hash (node) 0.9%, digest (node) 0.4%, createHash (node) 0.1% |

### Hot lines (self samples inside project functions)

| # | Location | % busy | Source |
|---:|---|---:|---|
| 1 | src/catalog/search.js:72 | 12.2% | `relevance: (a, b) => b.score - a.score \|\| b.product.rating - a.product.rating \|\| bySku(...` |
| 2 | src/pricing/cart-pricer.js:83 | 6.4% | `const found = cart.items.map((item) => products.find((product) => product.sku === item....` |
| 3 | src/catalog/search.js:119 | 5.7% | `matches.sort(COMPARATORS[sort]);` |
| 4 | src/catalog/catalog-routes.js:27 | 5.1% | `const product = products.find((candidate) => candidate.sku === params.sku);` |
| 5 | src/catalog/search.js:64 | 4.0% | `for (const [position, weight] of postings) scores.set(position, (scores.get(position) ?...` |
| 6 | src/catalog/search.js:75 | 3.1% | `rating: (a, b) => b.product.rating - a.product.rating \|\| b.product.reviewCount - a.prod...` |
| 7 | src/http/json.js:54 | 2.6% | `const payload = JSON.stringify(body);` |
| 8 | src/catalog/search.js:102 | 2.1% | `(params.category && product.category !== params.category)` |
| 9 | src/catalog/search.js:111 | 2.0% | `if (passesFilters(product)) matches.push({ product, score });` |
| 10 | src/catalog/search.js:69 | 1.5% | `const bySku = (a, b) => (a.product.sku < b.product.sku ? -1 : a.product.sku > b.product...` |
| 11 | src/pricing/cart-pricer.js:93 | 1.3% | `const product = JSON.parse(JSON.stringify(found[i]));` |
| 12 | src/catalog/search.js:109 | 1.2% | `for (const [position, score] of scoreMatches(searchIndexFor(products), terms)) {` |

### Project functions by inclusive time (cum)

| # | Function | Location | ms | % busy |
|---:|---|---|---:|---:|
| 1 | `handler` | src/app.js:100 | 6,636 | 67.8% |
| 2 | `dispatch` | src/app.js:58 | 5,929 | 60.6% |
| 3 | `router.add.name` | src/catalog/catalog-routes.js:14 | 3,920 | 40.0% |
| 4 | `searchProducts` | src/catalog/search.js:97 | 3,636 | 37.1% |
| 5 | `relevance` | src/catalog/search.js:72 | 1,341 | 13.7% |
| 6 | `sendJson` | src/http/json.js:53 | 1,238 | 12.6% |
| 7 | `priceCart` | src/pricing/cart-pricer.js:74 | 1,046 | 10.7% |
| 8 | `router.add.name` | src/pricing/pricing-routes.js:11 | 795 | 8.1% |
| 9 | `router.add.name` | src/catalog/catalog-routes.js:25 | 716 | 7.3% |
| 10 | `(anonymous)` | src/pricing/cart-pricer.js:83 | 616 | 6.3% |
| 11 | `scoreMatches` | src/catalog/search.js:59 | 414 | 4.2% |
| 12 | `getSnapshot` | src/catalog/catalog-repository.js:37 | 330 | 3.4% |

### Top self time, all code (flat)

| # | Function | Kind | Location | ms | % busy |
|---:|---|---|---|---:|---:|
| 1 | `relevance` | project | src/catalog/search.js:72 | 1,341 | 13.7% |
| 2 | `searchProducts` | project | src/catalog/search.js:97 | 1,217 | 12.4% |
| 3 | `writevGeneric` | node | node:internal/stream_base_commons:121 | 631 | 6.4% |
| 4 | `(anonymous)` | project | src/pricing/cart-pricer.js:83 | 616 | 6.3% |
| 5 | `(garbage collector)` | gc |  | 460 | 4.7% |
| 6 | `scoreMatches` | project | src/catalog/search.js:59 | 414 | 4.2% |
| 7 | `rating` | project | src/catalog/search.js:75 | 297 | 3.0% |
| 8 | `sendJson` | project | src/http/json.js:53 | 287 | 2.9% |
| 9 | `(program)` | program |  | 278 | 2.8% |
| 10 | `(anonymous)` | project | src/catalog/catalog-routes.js:27 | 260 | 2.7% |
| 11 | `router.add.name` | project | src/catalog/catalog-routes.js:25 | 256 | 2.6% |
| 12 | `statSync` | node | node:fs:1745 | 201 | 2.1% |

### Hottest call paths (project frames, outer → inner)

| # | % busy | Path |
|---:|---:|---|
| 1 | 13.7% | handler (src/app.js:100) → dispatch (src/app.js:58) → router.add.name (src/catalog/catalog-routes.js:14) → searchProducts (src/catalog/search.js:97) → relevance (src/catalog/search.js:72) |
| 2 | 12.4% | handler (src/app.js:100) → dispatch (src/app.js:58) → router.add.name (src/catalog/catalog-routes.js:14) → searchProducts (src/catalog/search.js:97) |
| 3 | 6.4% | handler (src/app.js:100) → sendJson (src/http/json.js:53) → [node] writevGeneric |
| 4 | 6.3% | dispatch (src/app.js:58) → router.add.name (src/pricing/pricing-routes.js:11) → priceCart (src/pricing/cart-pricer.js:74) → (anonymous) (src/pricing/cart-pricer.js:83) |
| 5 | 4.2% | handler (src/app.js:100) → dispatch (src/app.js:58) → router.add.name (src/catalog/catalog-routes.js:14) → searchProducts (src/catalog/search.js:97) → scoreMatches (src/catalog/search.js:59) |
| 6 | 3.0% | handler (src/app.js:100) → dispatch (src/app.js:58) → router.add.name (src/catalog/catalog-routes.js:14) → searchProducts (src/catalog/search.js:97) → rating (src/catalog/search.js:75) |
| 7 | 2.9% | handler (src/app.js:100) → sendJson (src/http/json.js:53) |
| 8 | 2.7% | handler (src/app.js:100) → dispatch (src/app.js:58) → router.add.name (src/catalog/catalog-routes.js:25) → (anonymous) (src/catalog/catalog-routes.js:27) |
| 9 | 2.6% | handler (src/app.js:100) → dispatch (src/app.js:58) → router.add.name (src/catalog/catalog-routes.js:25) |
| 10 | 2.0% | priceCart (src/pricing/cart-pricer.js:74) → (anonymous) (src/pricing/cart-pricer.js:90) |

## Allocation profile (sampled, includes garbage-collected objects)

1,839.1 MB allocated in total · ≈ 164 KB per request (11,452 requests served by the process). High allocation volume drives GC time in the CPU profile.

### Allocation hot spots (nearest project function)

| # | Function | Location | MB | % | Largest non-project allocators |
|---:|---|---|---:|---:|---|
| 1 | `searchProducts` | src/catalog/search.js:97 | 569.5 | 31.0% | sort (native) 3.5%, next (native) 0.3%, split (native) 0.1% |
| 2 | `scoreMatches` | src/catalog/search.js:59 | 533.0 | 29.0% | set (native) 11.9%, next (native) 0.1%, Map (native) 0.0% |
| 3 | `relevance` | src/catalog/search.js:72 | 240.7 | 13.1% |  |
| 4 | `sendJson` | src/http/json.js:53 | 95.5 | 5.2% | clearBuffer (node) 1.7%, writevGeneric (node) 0.5%, processHeader (node) 0.3% |
| 5 | `(anonymous)` | src/catalog/search.js:47 | 58.3 | 3.2% | split (native) 0.7%, set (native) 0.7%, add (native) 0.4% |
| 6 | `rating` | src/catalog/search.js:75 | 47.3 | 2.6% |  |
| 7 | `tokenize` | src/catalog/search.js:10 | 29.2 | 1.6% | split (native) 0.8%, filter (native) 0.0%, toLowerCase (native) 0.0% |
| 8 | `(anonymous)` | src/pricing/cart-pricer.js:90 | 22.4 | 1.2% |  |
| 9 | `handler` | src/app.js:100 | 19.4 | 1.1% | serializeUUID (node) 0.1%, get pathname (node) 0.0%, now (node) 0.0% |
| 10 | `addField` | src/catalog/search.js:37 | 19.1 | 1.0% | set (native) 0.4%, Set (native) 0.3%, add (native) 0.1% |
| 11 | `promotionIndexFor` | src/pricing/promotions.js:25 | 17.6 | 1.0% | add (native) 0.5%, push (native) 0.1%, next (native) 0.1% |
| 12 | `readSnapshot` | src/catalog/catalog-repository.js:20 | 16.2 | 0.9% | readFileSync (node) 0.4% |
| - | (no project frame: Node.js startup / internals) | | 67.4 | 3.7% | |

### Top allocating functions, all code (flat)

| # | Function | Kind | Location | MB | % |
|---:|---|---|---|---:|---:|
| 1 | `searchProducts` | project | src/catalog/search.js:97 | 495.4 | 26.9% |
| 2 | `scoreMatches` | project | src/catalog/search.js:59 | 311.8 | 17.0% |
| 3 | `relevance` | project | src/catalog/search.js:72 | 240.7 | 13.1% |
| 4 | `set` | native | V8 builtin | 239.7 | 13.0% |
| 5 | `sort` | native | V8 builtin | 68.5 | 3.7% |
| 6 | `rating` | project | src/catalog/search.js:75 | 47.3 | 2.6% |
| 7 | `sendJson` | project | src/http/json.js:53 | 34.5 | 1.9% |
| 8 | `clearBuffer` | node | node:internal/streams/writable:744 | 31.5 | 1.7% |
| 9 | `split` | native | V8 builtin | 27.8 | 1.5% |
| 10 | `(anonymous)` | project | src/pricing/cart-pricer.js:90 | 22.4 | 1.2% |
| 11 | `(anonymous)` | project | src/catalog/search.js:47 | 20.5 | 1.1% |
| 12 | `add` | native | V8 builtin | 19.3 | 1.0% |

## Retained memory (after forced GC)

| Metric | Before profiled load | After profiled load | Δ |
|---|---:|---:|---:|
| V8 heap used (MB) | 35.3 | 36.1 | +0.8 |
| RSS (MB) | 163 | 258.7 | 95.7 |
| requestHistorySize | 1000 | 1000 | +0 |

Requests served between the two measurements: 10,450 · retained heap change per request: 0.08 KB.
