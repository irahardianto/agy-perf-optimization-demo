# Profile summary — ref-fix3

- Scenario: **mixed** · 16 connections · 8s profiled load (after 1s warm-up)
- Load during profiling: 534.8 req/s · p50 11.2 ms · p95 122 ms · 0 errors (profilers add overhead — use `npm run bench` for official numbers)
- Commit 00107a2 · node v22.22.2 · linux x64 · 12,000 products / 300 promotions
- Raw files: `.profiles/ref-fix3/cpu.cpuprofile` and `.profiles/ref-fix3/alloc.heapprofile` — load them in Chrome DevTools (Performance / Memory tab) for flame charts.
- The CPU profile covers the whole server process (startup, warm-up, profiled load, shutdown).

## CPU profile

10.4 s profiled · 8,771 samples (~1184 µs apart) · CPU busy 97.6% of the time. Percentages below are **% of busy time** unless noted.

### Where the time went

| Category | ms | % of profile | % of busy |
|---|---:|---:|---:|
| Project code (src/) | 7,554 | 72.8% | 74.6% |
| V8 builtins / native (JSON, RegExp, Array...) | 9 | 0.1% | 0.1% |
| Node.js internals (node:*) | 2,149 | 20.7% | 21.2% |
| Dependencies / tooling | 5 | 0.1% | 0.1% |
| Garbage collection | 247 | 2.4% | 2.4% |
| VM overhead (program) | 165 | 1.6% | 1.6% |
| Idle (waiting for I/O) | 253 | 2.4% | - |

### Top project hot spots

Self time of each project function **plus** time in V8 builtins / Node.js internals it calls directly (e.g. `JSON.parse`, `readFileSync`, `pbkdf2Sync`).

| # | Function | Location | ms | % busy | Largest non-project callees |
|---:|---|---|---:|---:|---|
| 1 | `isActive` | src/pricing/promotions.js:7 | 1,682 | 16.6% |  |
| 2 | `findBestPromotion` | src/pricing/promotions.js:31 | 1,589 | 15.7% |  |
| 3 | `sendJson` | src/http/json.js:53 | 731 | 7.2% | writevGeneric (node) 3.5%, checkInvalidHeaderChar (node) 0.3%, nextTick (node) 0.3% |
| 4 | `relevance` | src/catalog/search.js:72 | 657 | 6.5% |  |
| 5 | `(anonymous)` | src/pricing/cart-pricer.js:66 | 569 | 5.6% |  |
| 6 | `(anonymous)` | src/pricing/promotions.js:58 | 565 | 5.6% |  |
| 7 | `searchProducts` | src/catalog/search.js:97 | 490 | 4.8% |  |
| 8 | `priceCart` | src/pricing/cart-pricer.js:60 | 315 | 3.1% |  |
| 9 | `scoreMatches` | src/catalog/search.js:59 | 218 | 2.2% |  |
| 10 | `fileVersion` | src/catalog/catalog-repository.js:30 | 191 | 1.9% | statSync (node) 1.5%, getStatsFromBinding (node) 0.1%, Stats (node) 0.1% |
| 11 | `secretMatches` | src/auth/api-key-auth.js:47 | 173 | 1.7% | Hash (node) 0.7%, digest (node) 0.3%, createHash (node) 0.1% |
| 12 | `(anonymous)` | src/catalog/catalog-routes.js:27 | 161 | 1.6% |  |

### Hot lines (self samples inside project functions)

| # | Location | % busy | Source |
|---:|---|---:|---|
| 1 | src/pricing/promotions.js:8 | 18.5% | `return new Date(promotion.startsAt) <= now && now <= new Date(promotion.endsAt);` |
| 2 | src/pricing/promotions.js:35 | 14.0% | `if (!promotion.skus.includes(line.sku)) continue;` |
| 3 | src/pricing/cart-pricer.js:66 | 7.1% | `const found = products.find((product) => product.sku === item.sku);` |
| 4 | src/catalog/search.js:72 | 6.2% | `relevance: (a, b) => b.score - a.score \|\| b.product.rating - a.product.rating \|\| bySku(...` |
| 5 | src/pricing/promotions.js:58 | 5.2% | `.filter((promotion) => isActive(promotion, now) && promotion.skus.includes(sku))` |
| 6 | src/catalog/catalog-routes.js:27 | 2.4% | `const product = products.find((candidate) => candidate.sku === params.sku);` |
| 7 | src/catalog/search.js:119 | 2.3% | `matches.sort(COMPARATORS[sort]);` |
| 8 | src/catalog/search.js:64 | 1.9% | `for (const [position, weight] of postings) scores.set(position, (scores.get(position) ?...` |
| 9 | src/catalog/search.js:75 | 1.5% | `rating: (a, b) => b.product.rating - a.product.rating \|\| b.product.reviewCount - a.prod...` |
| 10 | src/http/json.js:54 | 1.0% | `const payload = JSON.stringify(body);` |
| 11 | src/catalog/search.js:102 | 1.0% | `(params.category && product.category !== params.category)` |
| 12 | src/pricing/cart-pricer.js:72 | 0.8% | `const product = JSON.parse(JSON.stringify(found));` |

### Project functions by inclusive time (cum)

| # | Function | Location | ms | % busy |
|---:|---|---|---:|---:|
| 1 | `handler` | src/app.js:100 | 4,759 | 47.0% |
| 2 | `dispatch` | src/app.js:58 | 4,091 | 40.4% |
| 3 | `priceCart` | src/pricing/cart-pricer.js:60 | 3,874 | 38.2% |
| 4 | `priceLine` | src/pricing/cart-pricer.js:23 | 2,888 | 28.5% |
| 5 | `findBestPromotion` | src/pricing/promotions.js:31 | 2,809 | 27.7% |
| 6 | `router.add.name` | src/catalog/catalog-routes.js:14 | 2,083 | 20.6% |
| 7 | `searchProducts` | src/catalog/search.js:97 | 1,840 | 18.2% |
| 8 | `isActive` | src/pricing/promotions.js:7 | 1,682 | 16.6% |
| 9 | `router.add.name` | src/catalog/catalog-routes.js:25 | 1,370 | 13.5% |
| 10 | `activePromotionsFor` | src/pricing/promotions.js:56 | 1,064 | 10.5% |
| 11 | `(anonymous)` | src/pricing/promotions.js:58 | 1,028 | 10.1% |
| 12 | `sendJson` | src/http/json.js:53 | 731 | 7.2% |

### Top self time, all code (flat)

| # | Function | Kind | Location | ms | % busy |
|---:|---|---|---|---:|---:|
| 1 | `isActive` | project | src/pricing/promotions.js:7 | 1,682 | 16.6% |
| 2 | `findBestPromotion` | project | src/pricing/promotions.js:31 | 1,589 | 15.7% |
| 3 | `relevance` | project | src/catalog/search.js:72 | 657 | 6.5% |
| 4 | `(anonymous)` | project | src/pricing/cart-pricer.js:66 | 569 | 5.6% |
| 5 | `(anonymous)` | project | src/pricing/promotions.js:58 | 565 | 5.6% |
| 6 | `searchProducts` | project | src/catalog/search.js:97 | 490 | 4.8% |
| 7 | `writevGeneric` | node | node:internal/stream_base_commons:121 | 351 | 3.5% |
| 8 | `priceCart` | project | src/pricing/cart-pricer.js:60 | 315 | 3.1% |
| 9 | `(garbage collector)` | gc |  | 247 | 2.4% |
| 10 | `scoreMatches` | project | src/catalog/search.js:59 | 218 | 2.2% |
| 11 | `(program)` | program |  | 165 | 1.6% |
| 12 | `(anonymous)` | project | src/catalog/catalog-routes.js:27 | 161 | 1.6% |

### Hottest call paths (project frames, outer → inner)

| # | % busy | Path |
|---:|---:|---|
| 1 | 15.7% | priceCart (src/pricing/cart-pricer.js:60) → priceLine (src/pricing/cart-pricer.js:23) → findBestPromotion (src/pricing/promotions.js:31) |
| 2 | 12.0% | priceCart (src/pricing/cart-pricer.js:60) → priceLine (src/pricing/cart-pricer.js:23) → findBestPromotion (src/pricing/promotions.js:31) → isActive (src/pricing/promotions.js:7) |
| 3 | 6.5% | handler (src/app.js:100) → dispatch (src/app.js:58) → router.add.name (src/catalog/catalog-routes.js:14) → searchProducts (src/catalog/search.js:97) → relevance (src/catalog/search.js:72) |
| 4 | 5.6% | handler (src/app.js:100) → dispatch (src/app.js:58) → router.add.name (src/catalog/catalog-routes.js:25) → activePromotionsFor (src/pricing/promotions.js:56) → (anonymous) (src/pricing/promotions.js:58) |
| 5 | 4.8% | handler (src/app.js:100) → dispatch (src/app.js:58) → router.add.name (src/catalog/catalog-routes.js:14) → searchProducts (src/catalog/search.js:97) |
| 6 | 4.6% | handler (src/app.js:100) → dispatch (src/app.js:58) → router.add.name (src/catalog/catalog-routes.js:25) → activePromotionsFor (src/pricing/promotions.js:56) → (anonymous) (src/pricing/promotions.js:58) → isActive (src/pricing/promotions.js:7) |
| 7 | 4.5% | priceCart (src/pricing/cart-pricer.js:60) → (anonymous) (src/pricing/cart-pricer.js:66) |
| 8 | 3.5% | handler (src/app.js:100) → sendJson (src/http/json.js:53) → [node] writevGeneric |
| 9 | 2.6% | priceCart (src/pricing/cart-pricer.js:60) |
| 10 | 2.1% | handler (src/app.js:100) → dispatch (src/app.js:58) → router.add.name (src/catalog/catalog-routes.js:14) → searchProducts (src/catalog/search.js:97) → scoreMatches (src/catalog/search.js:59) |

## Allocation profile (sampled, includes garbage-collected objects)

1,191.1 MB allocated in total · ≈ 244 KB per request (5,003 requests served by the process). High allocation volume drives GC time in the CPU profile.

### Allocation hot spots (nearest project function)

| # | Function | Location | MB | % | Largest non-project allocators |
|---:|---|---|---:|---:|---|
| 1 | `searchProducts` | src/catalog/search.js:97 | 244.7 | 20.5% | sort (native) 2.0%, next (native) 0.3%, push (native) 0.0% |
| 2 | `scoreMatches` | src/catalog/search.js:59 | 223.1 | 18.7% | set (native) 7.7%, next (native) 0.1%, Map (native) 0.0% |
| 3 | `findBestPromotion` | src/pricing/promotions.js:31 | 151.2 | 12.7% | [Symbol.toPrimitive] (native) 0.0%, next (native) 0.0% |
| 4 | `relevance` | src/catalog/search.js:72 | 101.7 | 8.5% |  |
| 5 | `priceLine` | src/pricing/cart-pricer.js:23 | 100.4 | 8.4% |  |
| 6 | `(anonymous)` | src/pricing/promotions.js:58 | 86.1 | 7.2% | [Symbol.toPrimitive] (native) 0.0% |
| 7 | `(anonymous)` | src/catalog/search.js:47 | 57.0 | 4.8% | split (native) 1.0%, set (native) 0.9%, Set (native) 0.5% |
| 8 | `sendJson` | src/http/json.js:53 | 43.1 | 3.6% | clearBuffer (node) 0.8%, writevGeneric (node) 0.7%, _storeHeader (node) 0.2% |
| 9 | `tokenize` | src/catalog/search.js:10 | 28.4 | 2.4% | split (native) 1.1%, filter (native) 0.1%, toLowerCase (native) 0.0% |
| 10 | `rating` | src/catalog/search.js:75 | 19.9 | 1.7% |  |
| 11 | `addField` | src/catalog/search.js:37 | 18.6 | 1.6% | set (native) 0.7%, Set (native) 0.4%, add (native) 0.2% |
| 12 | `readSnapshot` | src/catalog/catalog-repository.js:20 | 16.4 | 1.4% | readFileSync (node) 0.6% |
| - | (no project frame: Node.js startup / internals) | | 32.3 | 2.7% | |

### Top allocating functions, all code (flat)

| # | Function | Kind | Location | MB | % |
|---:|---|---|---|---:|---:|
| 1 | `searchProducts` | project | src/catalog/search.js:97 | 214.9 | 18.0% |
| 2 | `findBestPromotion` | project | src/pricing/promotions.js:31 | 150.8 | 12.7% |
| 3 | `scoreMatches` | project | src/catalog/search.js:59 | 128.9 | 10.8% |
| 4 | `set` | native | V8 builtin | 111.4 | 9.3% |
| 5 | `relevance` | project | src/catalog/search.js:72 | 101.7 | 8.5% |
| 6 | `priceLine` | project | src/pricing/cart-pricer.js:23 | 100.4 | 8.4% |
| 7 | `(anonymous)` | project | src/pricing/promotions.js:58 | 86.0 | 7.2% |
| 8 | `split` | native | V8 builtin | 26.3 | 2.2% |
| 9 | `sort` | native | V8 builtin | 25.3 | 2.1% |
| 10 | `rating` | project | src/catalog/search.js:75 | 19.9 | 1.7% |
| 11 | `(anonymous)` | project | src/catalog/search.js:47 | 19.5 | 1.6% |
| 12 | `sendJson` | project | src/http/json.js:53 | 15.9 | 1.3% |

## Retained memory (after forced GC)

| Metric | Before profiled load | After profiled load | Δ |
|---|---:|---:|---:|
| V8 heap used (MB) | 31.6 | 34.6 | +3.0 |
| RSS (MB) | 147.5 | 152.8 | 5.3 |
| requestHistorySize | 636 | 5002 | +4366 |

Requests served between the two measurements: 4,366 · retained heap change per request: 0.70 KB.
