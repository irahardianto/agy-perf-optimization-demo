# Performance Analysis: FlashMart API (11.11 readiness)
Date: 2026-09-28 (analysis 08:32–09:10 UTC)
Analyst: AI Performance Optimizer (multi-dimensional, 5 parallel subagents)
Language: JavaScript (ESM), Node.js v22.22.2, zero npm dependencies, no build step
Profiling Tool: `npm run profile` (V8 `--cpu-prof` + sampling heap profiler, via `tools/perf/`), `npm run bench` (`bench/run.mjs`, 16 keep-alive connections), plus read-only `node -e` micro-measurements by the analysts
Machine: 8 vCPU AMD EPYC 7B12, Linux x64, libuv threadpool default (4)

> [!NOTE]
> Analyst working files (`.agentwork/findings-perf-*.md`) are temporary and deleted at the end of the workflow, so this report is self-contained. Projections marked **(model)** come from per-request micro-measurements and a closed-loop queueing model. They are not end-to-end measurements. Phase 4 benchmarks replace them.

## Executive Summary
- **Dimensions activated:** A (CPU & Computation), B (Memory & Allocation), C (I/O & Network), D (Concurrency & Parallelism), E (Serialization & Data Structures)
- **Dimensions skipped:** F (Build, Bundle & Deployment): no frontend bundles, no Dockerfile or container build, no build step.
- **Hot paths analyzed:** 5
  - `dispatch → authenticate`, on every `/api` request
  - `getSnapshot → readSnapshot`, on every route
  - `products.search → searchProducts → scoreProduct → tokenize`
  - `products.get → products.find + activePromotionsFor`
  - `cart.price → priceCart → find / getStock / findBestPromotion / shipping / loyalty`
- **Findings:** 19 after deduplication, from 34 raw analyst findings: 6 critical, 3 high, 2 medium, 8 low.
  - 4 of the 6 criticals and all 3 highs were flagged by 2–5 dimensions.
  - Four findings were escalated one level under §3.4 (see Cross-Dimension Correlations).
- **Estimated cumulative impact (model):**

  | Measure | Now | After the plan |
  |---|---:|---:|
  | Main-thread CPU per mixed request | ~84 ms | ~0.3–0.5 ms |
  | Allocation per request | ~39.7 MB | — (≈ 99.6% of sampled allocation volume removed) |
  | Cart external-wait critical path | 37.4 ms | 15.8 ms (measured on the 64 bench carts) |
  | Request history | unbounded | ≤ 200 entries |
  | Projected targets met | 0/4 | 4/4 |

  The next limit becomes KDF capacity on the libuv pool: ~450–575 verifications/s on 4 threads, ~690–780/s on 8.
- **Baseline benchmarks:** `npm run bench -- --label baseline` (16 connections), saved as `bench/results/baseline.json`. 0/4 scenarios meet their 11.11 target; 0 errors.

  | Scenario | req/s | p50 ms | p95 ms | p99 ms | loop p99 ms | heap MB | Target | Met |
  |---|---:|---:|---:|---:|---:|---:|---|---|
  | search | 8.4 | 1862.7 | 3681.1 | 11881.8 | 1868.56 | 6.3 | p95 ≤ 100 | ❌ |
  | product | 16 | 964.3 | 992.5 | 1917.5 | 994.57 | 6.3 | p95 ≤ 50 | ❌ |
  | cart | 11.8 | 1309.6 | 1838.1 | 2046.8 | 1013.45 | 6.6 | p95 ≤ 150 | ❌ |
  | mixed | 10.4 | 664.2 | 5294.5 | 6307.2 | 898.11 | 6.8 | ≥ 250 req/s and p95 ≤ 150 | ❌ |

  All scenarios also require loop p99 ≤ 50 ms and 0 errors. Loop p99 is 18–37× over budget everywhere.
- **Overall performance health:** **CRITICAL BOTTLENECK.**
  - The single event loop is saturated: CPU is busy 99.6% of the time at ~9–16 req/s.
  - Little's law reproduces the observed p50 of every scenario: latency ≈ 16 connections × main-thread ms per request.
  - Reaching 250 req/s needs **≤ 4 ms of synchronous loop work per request**, and the longest single slice must be **≲ 3 ms** to keep loop p99 ≤ 50 ms.
- **Outcome (Phases 4–5, measured):** the approved scope was three fixes: CRIT-001, CRIT-002 and CRIT-003.
  - Together they took the service from 0/4 to 3/4 targets, with mixed at 369.8 req/s and p95 124 ms.
  - Cart p95 is 155.5 ms against ≤ 150 ms; CRIT-006 is deferred.
  - The deferred CRIT-004 leak is measurable, at ≈ 0.55 KB per request.
  - See Implementation Results.

## Baseline Profile Summary
Run with `npm run profile -- --label baseline`: mixed scenario, 16 connections, 8 s of profiled load, 9.1 req/s under the profiler, 31.0 s profile. Wall time 33 s. Output in `.profiles/baseline/summary.md`.

- **CPU profile, top by inclusive (cum) time:**

  | Function | ms | % busy |
  |---|---:|---:|
  | `dispatch` (app.js:58) | 27,189 | 88.1% |
  | `getSnapshot` / `readSnapshot` (catalog-repository.js:25/13) | 17,747 | 57.5% |
  | `searchProducts` (search.js:63) | 7,318 | 23.7% |
  | `scoreProduct` (search.js:19) | 6,472 | 21.0% |
  | `priceCart` (cart-pricer.js:60) | 3,711 | 12.0% |

  9.2 of `priceCart`'s 12.0 points are `readSnapshot`.
- **CPU profile, top by self (flat) time:**

  | Function | ms | % busy |
  |---|---:|---:|
  | `readSnapshot` | 14,860 | 48.1% |
  | `tokenize` | 4,318 | 14.0% |
  | `readFileSync` | 2,882 | 9.3% |
  | garbage collector | 2,679 | 8.7% |
  | `pbkdf2Sync` | 1,604 | 5.2% |

  Hottest lines:
  - catalog-repository.js:15 `JSON.parse(readFileSync(...))`: 48.2%
  - search.js:15 `split`: 6.6%
  - search.js:13 `normalize('NFKD')`: 4.5%
  - search.js:22 tags `flatMap`: 3.7%
- **Heap profile (sampled, includes collected objects):** 10,712 MB allocated in total, **≈ 39.7 MB per request**.

  | Allocator | MB | Share |
  |---|---:|---:|
  | `searchProducts` (native `split` 19.3%) | 4,202 | 39.2% |
  | `readSnapshot` (`readFileSync` Buffer 19.3%) | 4,184 | 39.1% |
  | `tokenize` | 2,178 | 20.3% |
  | `scoreProduct` | 104 | 1.0% |

  Everything else is < 0.3%.
  - Per request, that is a full catalog copy (≈ 15.2 MB on heap + 7.5 MB off-heap) plus ~56 MB of token garbage per keyword search (Dimension B walk).
  - Retained memory: `requestHistorySize` 103 → 275 (+172 over 172 requests), +0.60 KB of retained heap per request, RSS 378.9 → 387.6 MB.
- **Trace/mutex profile:** N/A for Node.js. The equivalent is event-loop delay, measured by the bench as loop p99 of 898–1,869 ms.
  - The "global lock" is the JS thread. Per-request synchronous slices, measured by Dimension D:
    - snapshot parse: 54–86 ms
    - keyword scoring: 47 ms avg, 65 ms max
    - PBKDF2: 5.41 ms p50
    - GC: ~9.7 ms
  - At 16 connections, each ms of synchronous slice adds ≈ 16 ms of loop delay.
- **Benchmark baseline:** the table in the Executive Summary. For Node, the ns/op, B/op and allocs/op metrics map to req/s, p50/p95/p99, loop p99 and heap MB. Wall time 49 s.

## Critical Findings
Algorithmic or resource issues causing non-linear degradation. Must be fixed immediately.

- [x] **[CRIT-001]** The 7.9 MB catalog snapshot is re-read and re-parsed on every request — [catalog-repository.js:13-27](../../flashmart-api/src/catalog/catalog-repository.js#L13-L27) (hot line [:15](../../flashmart-api/src/catalog/catalog-repository.js#L15))
  - **Dimension:** A, B, C, D, E. All five rated it CRITICAL.
  - **Profiler Evidence:**
    - `readSnapshot` 17,747 ms = **57.5% of busy time**. Line 15 alone is 48.2%; `readFileSync` is 9.3%.
    - 39.1% of all allocated bytes.
    - Measured bare cost is 54–86 ms per call (`readFileSync` 16.8 ms + `JSON.parse` 68.7 ms).
    - ≈ 7.3 ms of GC per request, about 75% of profile GC time: the 8 MB object graph survives scavenges and gets promoted.
    - Cart requests hold their private parse across external awaits. 16 in-flight carts add ≈ +161 MB of heap, against ≈ +4 MB with a shared snapshot. Bench RSS reached 454 / 472 MB in cart / mixed.
  - **Description:** Every `getSnapshot()` call does a synchronous `readFileSync` + `JSON.parse` of the whole file on the event loop. Every route calls it once per request, and this is how catalog freshness is implemented today.
    - On its own it caps throughput at 12–16 req/s.
    - With 16 connections that is a latency and loop-delay floor of ≈ 1.0–1.4 s.
  - **Estimated Impact (model):**
    - Removes ≈ 54–64 ms of main-thread CPU and ≈ 23 MB of allocation per request. The replacement check (`statSync`) costs ≈ 5 µs.
    - Product ≈ 60 → 6.5 ms CPU per request; mixed ≈ 12 → 33 req/s.
    - **Alone it still meets 0/4 targets.** It is the prerequisite for CRIT-002, CRIT-005 and HIGH-001, whose per-snapshot indexes only pay off once the snapshot is reused.
  - **Pattern:** Result Caching with cheap change detection, plus an immutable snapshot swapped atomically.
  - **Optimization Guidance:**
    1. Keep `{ key, snapshot }` in the repository.
    2. On **every** `getSnapshot()`, call `statSync(catalogPath, { bigint: true })` and build the key `dev:ino:size:mtimeNs:ctimeNs`. If the key is unchanged, return the cached reference.
    3. On a key change, reload through one file descriptor so that the key and the content match: `openSync` → `fstatSync(fd)` → `readFileSync(fd, 'utf8')` → `closeSync` in `finally` → `JSON.parse` → validate → deep-freeze (≈ 25 ms) → swap one reference.
    4. Log each reload at info level with version, generatedAt and parse ms.
    5. Keep the first load lazy inside `getSnapshot()`. The "fails loudly" test constructs the repository on a bad file and expects `getSnapshot()` to throw.
    6. For a malformed file, keep today's behavior (`logger.error` + throw) but negative-cache its key. Every request still fails loudly while the bad file is live, but without re-parsing 7.9 MB each time.
    7. `// PERF:` comment citing the 57.5% profile share.

    Rejected alternatives:
    - `fs.watch`/`watchFile`: a watcher on the renamed-away inode goes stale, and the test performs two renames.
    - TTL polling: a stale window plus periodic stalls.
    - Per-request async `readFile`: still parses on every request and floods the threadpool.
    - Parsing in a worker: `v8.deserialize` of the result costs 81.8 ms, more than `JSON.parse`.
  - **Operational requirements preserved:**
    - **(1) Freshness.** Every request stats the file. A temp-file + rename always changes the inode, and an in-place write changes size/mtime/ctime at ns resolution. The request that observes the change reloads synchronously, so staleness is ≈ 0 s (≪ 1 s), with no restart.
    - **(4)** The snapshot shape is unchanged.
    - The deep freeze also makes accidental cross-request mutation throw instead of silently corrupting shared data, which strict-mode ESM guarantees.
  - **Expected side effect:** bench "heap MB" goes **up** by ≈ 15–25 MB. That is the retained snapshot plus per-snapshot indexes, an intended cache that replaces ≈ 39.7 MB of garbage per request.
  - **Benchmark Target:** all 4 scenarios (`bench:quick` fix-1).
    - Existing tests: catalog freshness after two renames, API "search reflects a new snapshot", cart `deepFreeze`.
    - New tests: in-place rewrite detected; malformed → fixed file recovers; the same object is returned while unchanged; the snapshot is frozen.
  - **Risk:** MEDIUM (freshness semantics), mitigated by the stat on every call plus tests.
  - **Fix workflow:** Phase 4, ≈ 40 lines across 1 src file and 1 test file.

- [x] **[CRIT-002]** Search re-tokenizes all 12,000 products on every keyword query — [search.js:19-33](../../flashmart-api/src/catalog/search.js#L19-L33), [search.js:63-83](../../flashmart-api/src/catalog/search.js#L63-L83)
  - **Dimension:** A (CRITICAL), E (CRITICAL), B (HIGH), D (HIGH). The result is CRITICAL: it matches §3.4 "algorithm (A) + heap allocation per iteration (B)".
  - **Profiler Evidence:**
    - `tokenize` 16.4% self: `split` 6.6%, `normalize` 4.5%, tags `flatMap` 3.7%, `toLowerCase` 1.7%, `replace` 1.4%.
    - `scoreProduct` 21.0% cum; `searchProducts` 23.7% cum.
    - **60.5% of all allocated bytes**, ≈ 56 MB of garbage per keyword query. `split` alone is 28.1% flat.
    - Measured 47 ms avg / 65 ms max per query even with the snapshot already in memory. That single synchronous slice is 15–20× the ≈ 3 ms loop-delay budget.
  - **Description:** `scoreProduct` tokenizes name, brand, tags and description of every product for every query, then scans the token arrays with `.includes`. The cost is O(products × fields) per query no matter how few products match.
  - **Estimated Impact:**
    - Prototypes by A and E measured **0.34–0.63 ms per query**, about 100× faster, with results byte-identical to today on 24 queries including the golden set.
    - The index costs ≈ 170–180 ms to build, **once per snapshot**.
    - Removes ≈ 56 MB of garbage per query.
    - (model) Search CPU drops to ≈ 5.9 ms per request, of which 95% is the KDF (CRIT-003).
  - **Pattern:** Precomputed inverted index, cached per snapshot.
  - **Optimization Guidance:**
    - Build `WeakMap<products array, index>` lazily. The index holds postings `token → [(productIdx, field)]`, built with the **same `tokenize`**.
    - Query path:
      - Tokenize the query as today and **keep duplicate terms**, because the current loop scores each occurrence.
      - Accumulate `WEIGHTS` into a `Float64Array(products.length)` scratch buffer.
      - Visit the touched ids in **ascending product order**. This preserves today's pre-sort order, and therefore stable-sort ties.
      - Apply the category and price filters, then build `{ product, score }` and sort with the **existing comparators**.
    - A category or price browse with no terms keeps the current linear path.
    - `// PERF:` comment citing 23.7% cum / 60.5% of allocations.
    - Keep it inside `search.js` plus tests, within the ~100-line guidance.
    - **Must land after CRIT-001.** Otherwise the index is rebuilt on every request, a 170 ms regression.
  - **Operational requirements preserved:**
    - **(1)** The WeakMap is keyed by the snapshot's `products` array, so every new snapshot gets a new index automatically and the old one is collected with the old snapshot. The API test "search reflects a new snapshot" guards this.
    - **(4)** Same tokenizer, weights, filters and comparators, so ranking is byte-identical. The golden ranking test guards this.
  - **Benchmark Target:** search, mixed.
    - New tests: equivalence against the reference scorer on the fixture (including duplicate terms, diacritics and filters); the index is rebuilt for a new snapshot.
  - **Risk:** MEDIUM (ranking equivalence), guarded by the golden and equivalence tests.
  - **Fix workflow:** Phase 4, ≈ 80–100 lines, at the `/refactor` threshold but contained to one module.

- [x] **[CRIT-003]** PBKDF2 verification runs synchronously on the event loop for every `/api` request — [api-key-auth.js:37](../../flashmart-api/src/auth/api-key-auth.js#L37) (called from [app.js:71](../../flashmart-api/src/app.js#L71))
  - **Dimension:** A (CRITICAL), D (CRITICAL). C and E noted it cross-dimension.
  - **Profiler Evidence:**
    - `pbkdf2Sync` 1,604 ms flat = 5.2% of busy time, ≈ 5.8 ms per request.
    - Bare measurement with the stored params (SHA-512, 10,000 iterations, 32 bytes): **5.41 ms p50** (range 5.08–6.49).
    - That is a ceiling of **172–185 req/s** on one loop, below the 250 target, and a loop-delay / latency floor of **86–93 ms** at 16 connections, above the 50 ms loop p99 and 50 ms product p95 budgets.
    - Once CRIT-001 and CRIT-002 land, it is **85–95% of the remaining main-thread CPU** (model). With the KDF still on the loop: product ≈ 104 ms p50, mixed ≈ 150 req/s, **0/4 targets**.
  - **Description:** The KDF cost is mandated by SEC-112 and cannot be reduced. The only compliant levers are **where** it runs (off the loop) and, with security sign-off, **how often** it runs.
  - **Optimization Guidance: Option A (recommended, no sign-off needed)**
    - Replace `pbkdf2Sync` with `await promisify(crypto.pbkdf2)(secret, salt, record.iterations, KEY_LENGTH, DIGEST)`: the same KDF, digest, per-key iterations and key length, on the libuv threadpool.
    - Keep the `timingSafeEqual` comparison of the full-length derived key.
    - **After the await, re-read `keyStore.get(id)` and check `status` on the live record**, so that a revoke landing mid-derivation takes effect. Keep today's order: secret check first, then status.
    - `dispatch` awaits `authenticate`.
    - Measured capacity: 443–575 verifications/s on 4 pool threads and 687–777/s on 8 (see MED-001), with loop p99 ≈ 2 ms.
    - ⚠️ `authenticate` becomes async, so **`test/api-key-auth.test.js` call sites need `await` / async test callbacks. Assertions stay unchanged.** This is the only planned edit to an existing test and needs your approval.
  - **Optimization Guidance: Option B (needs SEC-112 security sign-off)**
    - A positive-only verified-credential cache with at most one entry per key id, storing an HMAC-SHA256 of the secret under a per-process random key.
    - A hit requires the same record object, hash, salt and iterations, within a TTL. Status is checked on every request, and failures are never cached.
    - It keeps the sync signature and today's tests, but changes the security posture from "KDF per request" to "KDF per credential per TTL".
  - **Rejected alternatives:**
    - Checking status before the KDF: creates a timing oracle for revoked keys.
    - Fewer iterations: forbidden by SEC-112.
    - `node:cluster`: each worker has its own `keyStore`, which breaks "revocation on the very next request".
    - A hand-rolled `worker_threads` pool: more code than the built-in async KDF for the same effect.
  - **Operational requirements preserved:**
    - **(2) SEC-112:** the KDF and its parameters are unchanged; a wrong secret is never accepted (constant-time full-length compare); revocation takes effect on the next request because the live record is re-read after the await.
    - **(4)** The 401 body and status are unchanged.
  - **Estimated Impact:**
    - −5.4 ms of main-thread CPU per request.
    - KDF-induced loop delay drops from 86–93 ms to ≈ 2 ms.
    - The auth ceiling rises from ~185 to ~450–575 req/s (4 threads), or ~690–780 req/s (8 threads).
  - **Pattern:** Move blocking CPU work off the event loop, using the built-in async API.
  - **Benchmark Target:** product (most sensitive), mixed.
    - Existing tests: "wrong secret right after a success", "revocation on the very next request", API 401 contract.
    - New test: a revoke while a derivation is in flight is rejected.
  - **Risk:** MEDIUM. It touches a security-sensitive path, but semantics are preserved and tested.
  - **Fix workflow:** Phase 4, ≈ 20 lines of src plus `await` edits in one test file.

- [ ] **[CRIT-004]** Request history grows without bound — [request-history.js:16-33](../../flashmart-api/src/platform/request-history.js#L16-L33) (recorded at [app.js:123-135](../../flashmart-api/src/app.js#L123-L135))
  - **Dimension:** B (CRITICAL), D (CRITICAL). E noted it.
  - **Profiler Evidence:**
    - `requestHistorySize` +172 over 172 requests; +0.60 KB of retained heap per request in the profile, and 0.8–1.4 KB per entry measured.
    - At 250 req/s that is **≈ 0.7–1.3 GB per hour**, exhausting the heap within ≈ 3–5 h of the sale.
    - `/api` requests that end in 401/404 are recorded too, so junk traffic can exhaust memory far faster.
    - The full-GC pause grows ≈ 0.9 ms per 1,000 retained entries.
  - **Description:** `entries.push` never evicts, yet the only consumer (`GET /internal/requests`) returns at most the 200 newest entries.
  - **Estimated Impact:** retained history is bounded at ≈ 200 × ~1 KB ≈ 0.2–0.3 MB. Removes the OOM risk and the growing GC cost. Neutral in short bench runs.
  - **Pattern:** Bounded buffer (ring buffer).
  - **Optimization Guidance:**
    - A fixed-capacity ring buffer. Export `HISTORY_CAPACITY = 200` and reuse it as `MAX_HISTORY_LIMIT` in [internal-routes.js:3](../../flashmart-api/src/internal/internal-routes.js#L3) so the two can't drift.
    - `record` is an O(1) overwrite. `recent(limit)` returns newest first. `size()` returns the number of entries retained (≤ 200).
    - Add a capacity/eviction test.
  - **Operational requirements preserved:**
    - **(4)** `/internal/requests` still returns newest first with limit 1–200, and every valid limit is fully served.
    - `/internal/metrics.requestHistorySize` remains a number, the size of the retained history; the API test checks its type.
  - **Benchmark Target:** heap MB stays flat across scenarios; request-history tests plus a new capacity test.
  - **Risk:** LOW. **Fix workflow:** Phase 4, ≈ 30 lines.

- [ ] **[CRIT-005]** Promotion lookups scan all 300 promotions on every product request and every cart line — [promotions.js:7-9](../../flashmart-api/src/pricing/promotions.js#L7-L9), [promotions.js:31-61](../../flashmart-api/src/pricing/promotions.js#L31-L61)
  - **Dimension:** A (HIGH), E (HIGH), B (MEDIUM). **Escalated HIGH → CRITICAL** under §3.4: three dimensions converge on this module.
  - **Profiler Evidence:**
    - At baseline it is hidden behind the parse: `isActive` 0.4% and `findBestPromotion` 0.4% of busy time.
    - Line 8 creates **600 `Date` objects per evaluation** (≈ 61 KB).
    - Line 35 runs `skus.includes` over ≈ 690 SKUs for each of the ≈ 202 active promotions.
    - Measured **0.55–1.0 ms per call**.
    - After CRIT-001 to CRIT-003, it becomes the largest remaining main-thread cost: ≈ 35% of cart CPU, ≈ 30% of the loop at 250 req/s (model).
  - **Description:** A linear scan with repeated ISO date parsing, once per product page and once per in-stock cart line.
  - **Estimated Impact:** 0.55–1.0 ms → **0.3–2.8 µs per call**. A and E prototypes produced identical output, including at window edges. It also drops the 600 `Date` allocations per call.
  - **Pattern:** Precomputed index (hash lookup) plus pre-parsed timestamps, cached per snapshot.
  - **Optimization Guidance:**
    - Build `WeakMap<promotions array, Map<sku, entry[]>>` once per snapshot (≈ 207k postings). Each entry is `{ promotion, startsAtMs, endsAtMs }`, sorted by id.
    - Request path:
      - Look up the SKU's entries (≈ 17 on average).
      - Check the window with `startsAtMs <= now.getTime() && now.getTime() <= endsAtMs` **at request time**.
      - Then check `minQuantity` and compute the discount with the explicit lowest-id tie-break.
    - `activePromotionsFor` keeps its output shape (including the original ISO `endsAt`) and id order.
    - Keep `isActive` exported.
    - **Never write parsed fields onto the frozen promotion objects.**
  - **Operational requirements preserved:**
    - **(3)** Windows are evaluated per request; there is no "active" pre-filter at load time. Still a single best promotion, with ties going to the lowest id.
    - **(1)** The index lives per snapshot.
  - **Benchmark Target:** product, cart, mixed.
    - Existing tests: promotions and cart-pricer window tests.
    - New tests: boundary instants (`now == startsAt` and `now == endsAt`), tie → lowest id, index rebuilt for a new snapshot.
  - **Risk:** LOW–MEDIUM. **Fix workflow:** Phase 4, ≈ 50 lines.

- [ ] **[CRIT-006]** Cart pricing calls inventory once per line in sequence, then shipping, then loyalty — [cart-pricer.js:65-83](../../flashmart-api/src/pricing/cart-pricer.js#L65-L83)
  - **Dimension:** C (HIGH), D (HIGH). **Escalated HIGH → CRITICAL** under §3.4. B and E also flag per-line waste in the same loop (HIGH-002 and HIGH-003).
  - **Profiler Evidence:**
    - The CPU profile cannot see these waits (idle 0.4%), so wall-clock was measured with the real simulated clients.
    - On the 64 bench carts (2–8 lines): **37.4 ms avg / 47.7 ms p95** of external waits.
    - A 50-line cart spends ≈ 170 ms on external waits alone, above the 150 ms cart target.
    - Each cart makes 6.95 sequential awaits. Under a busy loop, each await costs one loop iteration, which brackets the mixed p95 of 5,294 ms: carts are the 20% of traffic above p80.
  - **Description:** This is an N+1 pattern (`getStock` per line, although `getStockBatch` takes up to 100 SKUs) followed by a waterfall. `loyalty.getTier` depends only on `customerId`, but it waits for the shipping quote.
  - **Estimated Impact:**
    - Measured on the bench carts: **37.4 → 15.8 ms avg (−58%), p95 47.7 → 16.4 ms (−66%)**, which is the dependency floor.
    - 50-line cart: 170 → ≈ 18 ms.
    - Sequential hops per cart: 6.95 → 2. Inventory round trips per cart: 4.95 → 1.
  - **Pattern:** Batching plus parallelizing independent dependencies.
  - **Optimization Guidance:**
    1. Resolve products synchronously.
    2. Create **both promises inside one `Promise.all([...])` argument list**:
       - `loyalty.getTier(customerId)`;
       - an async branch that dedupes the SKUs, chunks them to ≤ 100 (a pricer-local constant equal to the client's `MAX_BATCH_SIZE`), makes one `getStockBatch` call, builds the lines in `cart.items` order, filters the shippable lines, and requests the shipping quote **only if something ships**.
    3. Compute totals exactly as today.
    4. Never start `getTier` early without a handler attached. In Node 22 an unhandled rejection crashes the process.
    5. A SKU missing from the batch result **throws**, which gives a 500 like any dependency fault today. Never default to "in stock".
  - **Operational requirements preserved:**
    - **(3)** `now` is captured once. Only in-stock lines are charged and shipped. One quote is requested on their weight, and none when nothing ships. Loyalty applies to the total after promotions.
    - **(4)** Line order and shapes are unchanged.
    - **(5)** `src/external/` is untouched, and any dependency rejection still produces a 500.
  - **Benchmark Target:** cart, mixed.
    - Existing tests: cart-pricer (its fakes already implement `getStockBatch`) and API "prices a cart".
    - New tests: `getStock` is never called and `getStockBatch` is called once with the found SKUs; `getTier` starts before stock resolves; a stock rejection rejects without `unhandledRejection`.
  - **Risk:** LOW–MEDIUM. **Fix workflow:** Phase 4, ≈ 40 lines.

## High Findings
Significant measurable waste in hot paths. Fix before release.

- [ ] **[HIGH-001]** SKU lookup is a linear `products.find` over 12,000 products — [catalog-routes.js:27](../../flashmart-api/src/catalog/catalog-routes.js#L27), [cart-pricer.js:66](../../flashmart-api/src/pricing/cart-pricer.js#L66)
  - **Dimension:** A (MEDIUM), E (MEDIUM). **Escalated MEDIUM → HIGH** under §3.4.
  - **Profiler Evidence:** 70–118 µs per lookup. The cart-pricer predicate is 54 ms (0.2%) at baseline. It becomes a top remaining cost for product requests once CRIT-001 to CRIT-005 land.
  - **Description:** Every product request and every cart line scans the product array.
  - **Estimated Impact:** ≈ 0.1 ms → < 1 µs per lookup.
  - **Pattern:** Hash-based lookup, built per snapshot.
  - **Optimization Guidance:** Add a catalog helper, e.g. `findProductBySku(products, sku)`, backed by a `WeakMap<products, Map<sku, product>>` with **first-wins** insertion, which matches `Array.find` for duplicate SKUs. Use it in the product route and the pricer.
  - **Benchmark Target:** product, cart. The existing 404 test plus a new first-wins test.
  - **Risk:** LOW. **Fix workflow:** Phase 4, ≈ 25 lines.

- [ ] **[HIGH-002]** Each cart line deep-copies its product with `JSON.parse(JSON.stringify(...))` — [cart-pricer.js:72](../../flashmart-api/src/pricing/cart-pricer.js#L72)
  - **Dimension:** B (MEDIUM), E (MEDIUM). **Escalated MEDIUM → HIGH** under §3.4. The escalation is mechanical and the absolute impact is small.
  - **Profiler Evidence:** ≈ 7–9 µs and ≈ 2 KB per line, ≈ 40 µs per cart.
  - **Description:** A defensive copy that is unnecessary: `priceLine` only reads the product.
  - **Estimated Impact:** < 1% of post-fix cart CPU (model).
  - **Optimization Guidance:** Remove it after CRIT-001 deep-freezes the shared snapshot. The existing `deepFreeze` test ("never mutates the shared catalog snapshot") keeps guarding, and any mutation now throws.
  - **Risk:** LOW. **Priority:** do last (optional).

- [ ] **[HIGH-003]** An eager debug template runs two `JSON.stringify` calls per cart line even at `LOG_LEVEL=warn` — [cart-pricer.js:75](../../flashmart-api/src/pricing/cart-pricer.js#L75)
  - **Dimension:** B (MEDIUM), E (MEDIUM). **Escalated MEDIUM → HIGH** under §3.4, mechanically.
  - **Profiler Evidence:** ≈ 3.5–7.5 µs per line. The message string is built before the logger's level check.
  - **Description:** Wasted work, and an unstructured log message, contrary to the logging mandate.
  - **Optimization Guidance:** `logger.debug('priced line', { sku, status, promotionId, discountCents, lineTotalCents })`: structured fields that are serialized only when debug is enabled.
  - **Risk:** LOW. **Priority:** do last (optional).

## Medium Findings
Moderate waste detectable in profiles. Fix near term.

- [ ] **[MED-001]** The libuv threadpool stays at 4 threads, which caps auth throughput once PBKDF2 is async — [server.js:1-8](../../flashmart-api/src/server.js#L1-L8)
  - **Dimension:** D
  - **Profiler Evidence:**
    - Async verification capacity: 443–575/s with 4 threads against 687–777/s with 8.
    - Queueing for a KDF slot at 16 connections: ≈ 16/4 × 5.4 ≈ 22 ms with 4 threads, against ≈ 11 ms with 8. That margin matters for the product p95 target of ≤ 50 ms.
  - **Description:** With Option A the pool is dedicated to PBKDF2. After CRIT-001 the catalog path is `statSync` only, so nothing else competes for it.
  - **Estimated Impact:** ≈ +35–50% auth capacity and roughly half the KDF queueing delay (model).
  - **Optimization Guidance:**
    - Make `process.env.UV_THREADPOOL_SIZE ??= String(Math.min(8, os.availableParallelism()))` the **first statement** in `src/server.js`. An operator override still wins.
    - Verified on Node v22.22.2 with a FIFO-blocking probe: the pool is created lazily on first use, and ESM loading does not create it, so setting the variable in the entry module body takes effect.
    - Only relevant with Option A.
  - **Risk:** LOW.

- [ ] **[MED-002]** No outbound dependency call has a timeout — [cart-pricer.js:73](../../flashmart-api/src/pricing/cart-pricer.js#L73), [:82-83](../../flashmart-api/src/pricing/cart-pricer.js#L82-L83)
  - **Dimension:** C
  - **Profiler Evidence:** Code-level only; there is no effect in the bench because simulated latency is fixed.
    - By Little's law, a hung dependency means unbounded cart latency and unbounded in-flight carts.
    - The rugged constitution and the resource principles require timeouts on all I/O.
  - **Estimated Impact:**
    - Bench-neutral by design.
    - When a dependency degrades, cart latency is bounded at ≈ 0.75 s, and in-flight carts are capped at ≈ 38 at 250 req/s.
  - **Optimization Guidance:**
    - Add a `withTimeout(promise, { dependency, timeoutMs })` helper in `platform/`, built on `Promise.race` with `clearTimeout` in `finally`, rejecting with a typed error.
    - Wrap the call sites only; `src/external/` stays untouched.
    - Configurable defaults well above p99, e.g. 250 / 500 / 250 ms.
    - A timeout reaches the existing 500 path. No silent fallback, no retries.
  - **Risk:** LOW. The main hazard is deadlines that are too tight. **Priority:** optional reliability commit, or defer.

## Low Findings
Minor optimization opportunities. Backlog.

| ID | Dimensions | Where | Suggestion |
|---|---|---|---|
| LOW-001 | A, B | [search.js:77-81](../../flashmart-api/src/catalog/search.js#L77-L81) | Full sort of all matches to serve one page. Top-k selection saves 0.1–0.5 ms per search. Do it only if the re-profile after CRIT-002 shows the sort. |
| LOW-002 | A | [search.js:10-17](../../flashmart-api/src/catalog/search.js#L10-L17) | ASCII fast path in `tokenize`. All 71,929 catalog strings are ASCII, so skipping NFKD saves 29% of tokenize time. After CRIT-002 it only affects index build (≈ 13 ms per snapshot). |
| LOW-003 | E | search route | Cache search results per (snapshot, params). **Not recommended:** CRIT-002 already brings a query to ≈ 0.4 ms, and a cache over the bench's 16 fixed queries would inflate the numbers without helping real traffic. |
| LOW-004 | C | cart-pricer call sites | Per-dependency concurrency bounds. After CRIT-006, each cart makes ≤ 3 calls, so this is a guardrail only. |
| LOW-005 | C | cart-pricer call sites | No timing, metrics or logs around external calls (logging mandate). Add dependency name and durationMs on failure. |
| LOW-006 | B | [app.js:133-134](../../flashmart-api/src/app.js#L133-L134) | Clients control history entry size through headers and body. A byte budget needs contract sign-off; the capacity bound in CRIT-004 already limits the total. |
| LOW-007 | D | request pipeline | No cancellation when a client aborts. Abandoned requests still run auth, pricing and external calls. |
| LOW-008 | D | [server.js:18-19](../../flashmart-api/src/server.js#L18-L19) | No admission control or tuned server timeouts. Load shedding (503) needs contract sign-off. |

## Cross-Dimension Correlations
- **CRIT-001 (all five dimensions):** each dimension saw a different facet of one line: CPU (A), per-request 23 MB copies held across awaits (B), synchronous file I/O (C), a loop-wide lock requiring a herd-free atomic swap (D), and full deserialization (E). It was already CRITICAL everywhere, so there was nothing to escalate. The correlation shaped the design: one validated, frozen, shared snapshot fixes all five facets.
- **CRIT-002 (A + B + D + E):** O(n) re-tokenization per query (A) with heap allocation per iteration (B) is the §3.4 "algorithm + allocation per iteration → CRITICAL" pattern. D shows it is also a single 47–65 ms loop slice, and E supplies the data-structure fix (inverted index).
- **CRIT-005, promotions (A HIGH + E HIGH + B MEDIUM → CRITICAL):** a linear scan (A/E) plus 600 `Date` allocations per call (B), on the same function. Escalated because it becomes the largest main-thread cost once CRIT-001 to CRIT-003 land.
- **CRIT-006, cart I/O (C HIGH + D HIGH → CRITICAL):** N+1 plus a waterfall (C) and missed parallelism plus loop-hop amplification under load (D), on the same function. It also sets the 50-line cart latency floor.
- **HIGH-001, SKU lookup (A MEDIUM + E MEDIUM → HIGH).**
- **HIGH-002 and HIGH-003, cart per-line waste (B MEDIUM + E MEDIUM → HIGH):** escalated mechanically by §3.4, but the measured impact is µs per line, so both sit in "do last" in the matrix. Severity and priority deliberately diverge here.
- **Sequencing dependencies, found through correlation:**
  - CRIT-002, CRIT-005 and HIGH-001 key their indexes by snapshot identity, so they **require** CRIT-001.
  - HIGH-002 requires CRIT-001's deep freeze.
  - MED-001 only matters with CRIT-003 Option A.
  - Dimension A's model shows **CRIT-001 alone and CRIT-001+002 still meet 0/4 targets**. The KDF (CRIT-003) is the gate to all four.

## Implementation Priority Matrix

Findings are ranked by impact/risk and by dependency order. Each is one commit with `// PERF:` comments, tests first, then `npm test` → `npm run check` → `npm run bench:quick -- --label fix-<n>` → `npm run bench:compare -- baseline fix-<n>`.

| Priority | Fix label | ID | Title | Impact | Risk | Approach |
|---|---|---|---|---|---|---|
| 1 | fix-1 | CRIT-001 | Snapshot cache | HIGH | MED | Stat key on every call; reload through the fd on change; validate, deep-freeze and swap atomically; lazy first load; negative-cache a malformed file |
| 2 | fix-2 | CRIT-004 | Bounded request history | HIGH (stability) | LOW | 200-slot ring buffer; shared capacity constant |
| 3 | fix-3 | CRIT-002 | Search inverted index | HIGH | MED | Per-snapshot WeakMap index; same tokenizer, weights and comparators; ascending id visit |
| 4 | fix-4 | CRIT-003 | Auth off the event loop | HIGH | MED | **Option A:** async `crypto.pbkdf2`, same params, live-record re-check after the await; `await` in auth tests |
| 5 | fix-5 | MED-001 | Threadpool sizing | MED | LOW | `UV_THREADPOOL_SIZE ??= min(8, cores)`, first statement of server.js |
| 6 | fix-6 | CRIT-005 | Promotions index | HIGH | LOW–MED | Per-snapshot `sku → entries` with pre-parsed ms; window check at request time |
| 7 | fix-7 | CRIT-006 | Cart batch + parallel | HIGH (cart tail) | LOW–MED | One `getStockBatch`; `Promise.all` with loyalty; shipping only if something ships |
| 8 | fix-8 | HIGH-001 | SKU map | MED | LOW | Per-snapshot `Map<sku, product>` (first wins) via a catalog helper |
| 9 (opt.) | fix-9 | HIGH-002 | Drop the per-line deep copy | LOW | LOW | Rely on the frozen snapshot |
| 10 (opt.) | fix-10 | HIGH-003 | Structured debug log | LOW | LOW | Fields instead of an eager template |
| 11 (opt.) | fix-11 | MED-002 | Outbound timeouts | Reliability (bench-neutral) | LOW | `withTimeout` at call sites; configurable; 500 on timeout |
| Skip | — | LOW-001..008 | See Low Findings | LOW | — | Below the noise floor, needs contract/product sign-off, or games the bench (LOW-003) |

**Projected progression (model, from the Dimension A/D analyses):**

| After | Main-thread CPU per mixed request | Projected verdict |
|---|---:|---|
| baseline | ≈ 84 ms | 0/4 (measured) |
| + fix-1 | ≈ 31 ms | 0/4: search ≈ 0.9 s, product ≈ 104 ms |
| + fix-3 | ≈ 6.6 ms (the KDF is 85–95% of it) | 0/4: product ≈ 104 ms, mixed ≈ 150 req/s |
| + fix-4, fix-5 | ≈ 1.3 ms on the main thread; KDF on the pool | 4/4 feasible, bound by the KDF pool (~450–780 req/s) |
| + fix-6 to fix-8 | ≈ 0.3–0.5 ms | 4/4 with headroom; cart ≈ 16 ms external floor plus KDF |

### Decisions needed before Phase 4
1. **Auth (CRIT-003):** **Option A** (recommended) or Option B.
   - Option A is async PBKDF2 on the libuv pool. It needs `await` added at the call sites in `test/api-key-auth.test.js`; assertions are unchanged.
   - Option B is a verified-credential cache and needs SEC-112 security sign-off.
2. **Threadpool sizing (MED-001):** include? Default: yes, with Option A.
3. **Optional items 9–11:** default is to include 9–10 (tiny, low risk, logging mandate) and defer 11 (timeouts) to a reliability follow-up. Bring 11 in if you want the rugged-constitution timeouts now.
4. **Malformed catalog policy:** default is to keep today's behavior (log error and throw on every request while a bad file is live, negative-cached). The alternative, serving the last good snapshot, is a behavior change: stale prices.
5. *(Minor)* SKU missing from the batch stock result: default is to throw, which gives a 500. The alternative is to treat it as 0 in stock and log a warning.

## Dimensions Covered
| Dimension | Status | Scope Examined |
|---|---|---|
| A. CPU & Computation | ✅ Analyzed | Top CPU functions, hot lines and call paths. Scanned all hot-path modules (38 files). Micro-benchmarked parse, tokenize, KDF, promotions and find. Built a closed-loop throughput model calibrated to the baseline. |
| B. Memory & Allocation | ✅ Analyzed | Heap profile walked by route. `--expose-gc` heap deltas and `--trace-gc`. Retained-memory growth (history). Checked for benchmark/profiler artifacts. |
| C. I/O & Network | ✅ Analyzed | Catalog file I/O. Wall-clock critical path of every external call with the real simulated clients (latency on). Timeouts, batching, concurrency bounds. No database, so database principles apply only loosely. |
| D. Concurrency & Parallelism | ✅ Analyzed | Event-loop budget (Little's law, loop-delay model). Synchronous slices. Threadpool sizing and an async-KDF capacity test. Cluster/worker options. Revocation races. Cancellation and admission control. |
| E. Serialization & Data Structures | ✅ Analyzed | Snapshot deserialization, per-line copies and eager logging. Linear scans (products, promotions, token arrays). Inverted-index and promotion-index prototypes verified byte-identical. |
| F. Build, Bundle & Deployment | ⏭ Skipped | No frontend bundles, no Docker/container build, no build step. |

## Rules Applied
- `performance-optimization-principles.md`: measure first; one change at a time; no caching without an invalidation story.
- `resources-and-memory-management-principles.md`: bounded buffers (CRIT-004); timeouts on I/O (MED-002).
- `concurrency-and-threading-principles.md`: no blocking work on the event loop (CRIT-003); no unhandled rejections in fan-out (CRIT-006).
- `database-design-principles.md`: no database; consulted for the batching and N+1 guidance (CRIT-006).
- `data-serialization-and-interchange-principles.md`: the exporter owns the JSON on-disk format, which is unchanged.
- `security-mandate.md` and `security-principles.md`: SEC-112 KDF parameters untouched; constant-time compare; no weakening; Option B gated on sign-off.
- `rugged-software-constitution.md`: fail loudly (malformed catalog, missing batch SKU); proactive timeouts.
- `logging-and-observability-mandate.md`: structured logs (HIGH-003); snapshot reload logs; dependency failure logs (LOW-005).
- `architectural-pattern.md`, `code-organization-principles.md` and `core-design-principles.md`: module-local indexes behind public catalog helpers; no cross-feature internals; YAGNI (LOW-003 rejected).
- `rule-priority.md`: security and operational requirements take precedence over performance.

---

## Implementation Results
Phase 4 ran with a reduced, approved scope: three fixes, one commit each, in this order: CRIT-001, CRIT-002, CRIT-003 (Option A). Everything else is deferred (see Optimizations Skipped).

Decisions applied:
- Option A for auth, with the SEC-112 parameters unchanged.
- Keep the throw on a malformed catalog.
- No threadpool change.

> [!NOTE]
> Bench labels follow the approved order, not the matrix's fix labels:
> - bench `fix-1` = CRIT-001 (matrix fix-1)
> - bench `fix-2` = CRIT-002 (matrix fix-3)
> - bench `fix-3` = CRIT-003 (matrix fix-4)
>
> Result files are in `bench/results/` (git-ignored): `baseline.json`, `fix-1.json`, `fix-2.json`, `fix-3.json` and `final.json`.

### Before/After Benchmark Comparison
Output of `npm run bench:compare -- baseline final`.
- **Baseline:** `npm run bench -- --label baseline` at `05e16a3`, 1 run.
- **Final:** `npm run bench -- --count 3 --label final` at `0b8e614`, median of 3 runs.
- **Both:** 16 connections, 5 s measured per scenario, Node v22.22.2, 12,000 products.

| Benchmark | Metric | Before | After | Δ | Δ% |
|---|---|---|---|---|---|
| search | req/s | 8.4 | 526.4 | +518 | +6167% (63× higher) |
| search | p50 ms | 1862.7 | 29.1 | −1833.6 | −98.4% (64× lower) |
| search | p95 ms | 3681.1 | 43.9 | −3637.2 | −98.8% (84× lower) |
| search | p99 ms | 11881.8 | 60 | −11821.8 | −99.5% (198× lower) |
| search | event-loop p99 ms | 1868.6 | 23.1 | −1845.5 | −98.8% (81× lower) |
| search | heap MB (after GC) | 6.3 | 27.4 | +21.1 | +335% |
| search | errors | 0 | 0 | ±0 | 0% |
| product | req/s | 16 | 512.4 | +496.4 | +3103% (32× higher) |
| product | p50 ms | 964.3 | 30.3 | −934 | −96.9% (32× lower) |
| product | p95 ms | 992.5 | 42.2 | −950.3 | −95.7% (24× lower) |
| product | p99 ms | 1917.5 | 53.6 | −1863.9 | −97.2% (36× lower) |
| product | event-loop p99 ms | 994.6 | 22.9 | −971.7 | −97.7% (43× lower) |
| product | heap MB (after GC) | 6.3 | 31.6 | +25.3 | +402% |
| product | errors | 0 | 0 | ±0 | 0% |
| cart | req/s | 11.8 | 153.6 | +141.8 | +1202% (13× higher) |
| cart | p50 ms | 1309.6 | 102 | −1207.6 | −92.2% (13× lower) |
| cart | p95 ms | 1838.1 | 155.5 | −1682.6 | −91.5% (12× lower) |
| cart | p99 ms | 2046.8 | 176.8 | −1870 | −91.4% (12× lower) |
| cart | event-loop p99 ms | 1013.5 | 29.2 | −984.3 | −97.1% (35× lower) |
| cart | heap MB (after GC) | 6.6 | 34.7 | +28.1 | +426% |
| cart | errors | 0 | 0 | ±0 | 0% |
| mixed | req/s | 10.4 | 369.8 | +359.4 | +3456% (36× higher) |
| mixed | p50 ms | 664.2 | 28.4 | −635.8 | −95.7% (23× lower) |
| mixed | p95 ms | 5294.5 | 124 | −5170.5 | −97.7% (43× lower) |
| mixed | p99 ms | 6307.2 | 155.5 | −6151.7 | −97.5% (41× lower) |
| mixed | event-loop p99 ms | 898.1 | 30.2 | −867.9 | −96.6% (30× lower) |
| mixed | heap MB (after GC) | 6.8 | 38 | +31.2 | +459% |
| mixed | errors | 0 | 0 | ±0 | 0% |

**11.11 readiness: 0/4 → 3/4.**

| Scenario | Target | Final (median of 3) | p95 ms per run | Met |
|---|---|---|---|---|
| search | p95 ≤ 100 ms | p95 43.9 ms | 41.2 / 43.9 / 40.8 | ✅ |
| product | p95 ≤ 50 ms | p95 42.2 ms | 54.6 / 42.2 / 42.9 | ✅ Thin margin: run 1 was over |
| cart | p95 ≤ 150 ms | p95 155.5 ms | 158.3 / 155.5 / 153.4 | ❌ 5.5 ms over |
| mixed | ≥ 250 req/s and p95 ≤ 150 ms | 369.8 req/s, p95 124 ms | 145.9 / 124 / 115.9 | ✅ |

Event-loop p99 is 22.9–30.24 ms in every scenario, within the 50 ms budget. None of the 12 runs had an error.

### Optimizations Applied
| Commit | ID | Title | Measured Improvement |
|---|---|---|---|
| `185b400` | CRIT-001 | perf(catalog): cache the parsed snapshot per published file | Removes the 7.9 MB read and parse (57.5% of busy time) from every request. bench:quick vs baseline: product 16 → 130.5 req/s (p95 992.5 → 216.5 ms); cart 11.8 → 85.5 req/s (p95 1838.1 → 268.5 ms); search 8.4 → 17 req/s; mixed 10.4 → 29.5 req/s. Still 0/4, as modelled. |
| `00f30e1` | CRIT-002 | perf(search): index catalog tokens once per snapshot | Per query: 52–55 ms → 0.49 ms p50 / 1.14 ms p95. The index is built once per snapshot, in ≈ 225 ms. Responses are byte-identical to the old implementation on 21/21 queries. bench:quick vs fix-1: search 17 → 136 req/s (p95 975.6 → 210.2 ms); mixed 29.5 → 117.5 req/s (p95 2080.4 → 544.1 ms). Still 0/4, as modelled: the KDF is the limit. |
| `0b8e614` | CRIT-003 | perf(auth): verify API key secrets off the event loop | bench:quick vs fix-2: search 136 → 576.5 req/s (p95 210.2 → 42.1 ms); product 126 → 447 req/s (p95 221.3 → 50 ms); cart 82.5 → 138 req/s (p95 270.6 → 178.3 ms); mixed 117.5 → 330 req/s (p95 544.1 → 138.8 ms). Loop p99 67–360 → 27–28 ms. 0/4 → 3/4. |

Progression. The per-fix rows are bench:quick (2 s per scenario, 1 run); baseline and final are full runs. Cells show req/s · p95 ms.

| After | search | product | cart | mixed | loop p99 ms | heap MB | Met |
|---|---|---|---|---|---|---|---|
| baseline (full) | 8.4 · 3681.1 | 16 · 992.5 | 11.8 · 1838.1 | 10.4 · 5294.5 | 898–1869 | 6.3–6.8 | 0/4 |
| fix-1 `185b400` | 17 · 975.6 | 130.5 · 216.5 | 85.5 · 268.5 | 29.5 · 2080.4 | 58–918 | 15.3–16.1 | 0/4 |
| fix-2 `00f30e1` | 136 · 210.2 | 126 · 221.3 | 82.5 · 270.6 | 117.5 · 544.1 | 67–360 | 24.8–25.7 | 0/4 |
| fix-3 `0b8e614` | 576.5 · 42.1 | 447 · 50 | 138 · 178.3 | 330 · 138.8 | 27–28 | 25.4–27.4 | 3/4 |
| final (full, ×3) | 526.4 · 43.9 | 512.4 · 42.2 | 153.6 · 155.5 | 369.8 · 124 | 23–30 | 27.4–38 | 3/4 |

Tests went from 69 to 79, all passing. No existing assertion was removed or weakened.
- **CRIT-001 (4 new):**
  - the same object is returned while the file is unchanged;
  - the snapshot is deep-frozen;
  - an in-place rewrite with the same size is detected;
  - a truncated file keeps failing, then recovers.
- **CRIT-002 (4 new):**
  - a repeated term counts again;
  - results match the old algorithm on 18 cases;
  - product text is read once per snapshot;
  - each snapshot gets its own index.
- **CRIT-003 (2 new):**
  - the loop keeps running while a secret is verified;
  - a revocation that lands mid-verification still rejects the request.

  The existing auth tests only gained `async`/`await`.

### Optimizations Skipped
| ID | Title | Reason |
|---|---|---|
| CRIT-004 | Bounded request history (matrix fix-2) | Out of the approved scope for this session. **Top follow-up:** the leak shows up in the final run (see Surprising Findings). |
| MED-001 | Threadpool sizing (fix-5) | Out of the approved scope. The Phase 3 default was "yes, with Option A", but the approval limited the session to three fixes. |
| CRIT-005 | Promotions index (fix-6) | Out of the approved scope. |
| CRIT-006 | Cart batch + parallel (fix-7) | Out of the approved scope. This finding is why cart still misses its target. |
| HIGH-001 | SKU map (fix-8) | Out of the approved scope. |
| HIGH-002 | Drop the per-line deep copy (fix-9, optional) | Out of the approved scope; saves only µs per line. |
| HIGH-003 | Structured debug log (fix-10, optional) | Out of the approved scope; saves only µs per line. |
| MED-002 | Outbound timeouts (fix-11, optional) | Out of the approved scope; a reliability fix with no bench effect. |
| LOW-001..008 | See Low Findings | Skipped in the plan: below the noise floor, needs contract or product sign-off, or games the bench (LOW-003). |

### Failed Optimizations
None. All three fixes improved their target scenarios on the first attempt, and nothing was reverted.

| Attempt | Expected Gain | Actual Result | Why It Failed |
|---|---|---|---|
| — | — | — | — |

### Surprising Findings
- **The request-history leak (CRIT-004) shows up in the final run.** Across scenarios, heap after GC climbs 27.4 → 31.6 → 34.7 → 38.0 MB while `requestHistorySize` climbs 6,175 → 25,371. That is +10.6 MB for +19,196 entries, ≈ 0.55 KB each. At the final mixed rate of ≈ 370 req/s, the heap grows by ≈ 0.7 GB per hour.
- **The KDF pool is now the ceiling, as modelled.**
  - Search and product run at 512–526 req/s, inside the measured async capacity of 4 threads (443–575 verifications/s).
  - Their p50 of ≈ 30 ms matches Little's law: 16 connections ÷ ≈ 520 req/s.
  - The event loop has headroom: loop p99 is 23–30 ms.
- **The heap step is by design:** +9 MB for the frozen shared snapshot (fix-1) and +9 MB for the search index (fix-2).
- **The event-loop delay histogram includes warm-up.**
  - The cold start costs ≈ 80 ms for the first snapshot load plus ≈ 225 ms for the index build.
  - It appears as a loop max of 359 ms in the fix-3 search run.
  - At fix-2 it *was* the loop p99 (360 ms), because the saturated loop produced few samples.
  - The final bench reports the median of 3 runs, which hides it.
- **Every catalog publish repeats that stall.**
  - After a rename, the next request re-parses the file (≈ 80 ms) and the next search rebuilds the index (≈ 225 ms), both on the event loop.
  - Freshness is still met. The cost is a tail of up to ≈ 300 ms for requests in flight during a publish, every few minutes.
- **`bench:compare` warns "duration differs: 5 vs 2" on every per-fix comparison.** The baseline is a full run, but each per-fix run is a quick run. A quick baseline (`npm run bench:quick -- --label baseline-quick`) would give like-for-like per-fix deltas.

### Remaining Opportunities
In order of expected value for 11.11:
1. **CRIT-004, bounded request history (stability):** must land before the sale, because the heap grows ≈ 0.7 GB/h at 370 req/s. About 30 lines, LOW risk.
2. **CRIT-006, cart batch + parallel:** closes the cart gap (p95 155.5 ms against ≤ 150 ms). On the bench carts, the external critical path drops from 37.4 to 15.8 ms on average, and sequential hops drop from 6.95 to 2. About 40 lines.
3. **CRIT-005, promotions index:** 0.55–1.0 ms → µs per product request and per in-stock cart line. It is the largest remaining main-thread cost (model: ≈ 35% of cart CPU). About 50 lines.
4. **MED-001, threadpool of 8:**
   - Raises KDF capacity to 687–777 verifications/s.
   - Roughly halves KDF queueing (≈ 22 → 11 ms).
   - Gives product p95 margin: one of the three product runs was 54.6 ms.
   - One statement plus a test.
5. **HIGH-001, SKU map:** ≈ 0.1 ms → < 1 µs per lookup, for product and cart.
6. **HIGH-002, HIGH-003 and MED-002 (optional):** HIGH-003 also closes a logging-mandate gap, and MED-002 adds timeouts for reliability.
7. **New: the publish stall.**
   - Prepare the next snapshot and its index off the request path, in a worker thread or as a chunked build, then swap them atomically.
   - It must keep freshness ≤ 1 s on every endpoint.
   - It needs a design; measure first.
8. **LOW-001..008:** backlog as listed. LOW-003 stays rejected.

Model after items 1–5: 4/4 with headroom. Cart would sit at ≈ 16 ms of external waits plus the KDF.

## Verification Suite Results
- **Full Benchmark Suite:**
  - Command: `npm run bench -- --count 3 --label final` at `0b8e614`, wall time 74 s.
  - 3/4 scenarios on target; cart misses with p95 155.5 ms against ≤ 150 ms.
  - 0 errors in all 12 runs, and loop p99 ≤ 30.24 ms everywhere.
  - `npm run bench:compare -- baseline final`: 0/4 → 3/4, with no comparability warning.
- **Test Suite:**
  - `npm test`: 79/79 pass (69 at baseline, 10 new).
  - Node has no `-race` equivalent. The concurrency guards are the two new auth tests: a loop turn runs during verification, and a revocation mid-verification rejects the request.
- **Quality Checks:**
  - `npm run check` passes on 51 files: syntax, `debugger` statements, `.only` in tests.
  - No formatter, linter or security scanner is available offline, and there is no build step.
  - SEC-112 was reviewed by hand:
    - same KDF, digest, iteration count and key length;
    - `timingSafeEqual`;
    - the secret is checked before the status;
    - the live record is re-checked after the await.
