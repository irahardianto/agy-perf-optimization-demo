# Performance Analysis: FlashMart API — 11.11 readiness (search, product, cart)
Date: 2026-09-28 09:15 UTC · commit `05e16a3` (tag `baseline`)
Analyst: AI Performance Optimizer (multi-dimensional, 5 parallel subagents)
Language: Node.js v22.22.2, plain ESM JavaScript, zero dependencies (linux x64, 8 CPUs, AMD EPYC 7B12)
Profiling Tool: repo harness only. `npm run profile -- --label baseline` (V8 CPU profile + sampled allocation profile, mixed scenario, 16 connections) and `npm run bench -- --label baseline`

Raw data: `.profiles/baseline/summary.md`, `bench/results/baseline.json`, analyst findings in `.agentwork/findings-perf-{cpu,memory,io,concurrency,serialization}.md`.

## Executive Summary
- **Dimensions activated:** A (CPU), B (Memory), C (I/O), D (Concurrency / event loop), E (Serialization & data structures)
- **Dimensions skipped:** F. There is no frontend bundle, no Docker image and no build step.
- **Hot paths analyzed:** 4. Per-request auth + snapshot load (every `/api` call), `GET /api/products/search`, `GET /api/products/:sku`, `POST /api/cart/price`.
- **Findings:** 10 after deduplication: 6 critical, 0 high (the three HIGH root causes were escalated to CRITICAL by cross-dimension correlation, §3.4), 3 medium, 1 low.
- **Estimated cumulative impact:**
  - Removes about 95% of busy CPU (snapshot 57.4% + search 24.0% + PBKDF2 5.1%, plus most of the 8.4% GC) and about 99% of allocation (≈ 39 MB → ≈ 0.1–0.2 MB per mixed request).
  - Mean event-loop hold per request drops from ≈ 98 ms to ≲ 1–2 ms. The single-process ceiling rises from ≈ 10 req/s to several hundred.
  - Cart external wait drops from 37.7 to ≈ 16 ms for a 5-line cart.
- **Baseline benchmarks:** 0/4 scenarios on target; see the table below.
- **Overall performance health:** **CRITICAL BOTTLENECK**. Every request holds the only JS thread for about 98 ms, so throughput is capped at about 10 req/s. Little's law then puts the mean wait at about 1.6 s with 16 connections.

## Baseline Profile Summary
- **CPU profile:** 30.4 s, CPU busy 99.6%. Split: project code 71.4%, Node internals 17.3%, GC 8.4%.
  - Top by inclusive time: `dispatch` 88.2% · `handler` 77.0% · `getSnapshot`/`readSnapshot` 57.4% · search route 53.7% · `searchProducts` 24.0%.
  - Top by self time: `readSnapshot` (JSON.parse) 47.4% · `tokenize` 14.4% · `readFileSync` 9.9% · GC 8.4% · `pbkdf2Sync` 5.1%.
  - Hottest line: `catalog-repository.js:15` `JSON.parse(readFileSync(...))` = **47.6% of busy time**.
- **Heap profile:** 10,434 MB sampled over 268 requests, ≈ 39 MB per request.
  - By allocator: `readSnapshot` 4,088 MB (39.2%) · `searchProducts` 4,082 MB (39.1%) · `tokenize` 2,121 MB (20.3%) · `scoreProduct` 102 MB · `findBestPromotion` 12 MB.
  - Retained after GC: heap 7.2 → 7.3 MB. `requestHistorySize` went up by 164 for 164 requests (**nothing is evicted**, +0.62 KB per request).
- **Trace/mutex profile:** not applicable (a single JS thread, and no locks). The event loop is the contended resource: loop p99 was 988–1,886 ms.
- **Benchmark baseline** (`npm run bench -- --label baseline`, 16 connections, 5 s per scenario after 1 s warm-up, 1 run):

| scenario | req/s | p50 ms | p95 ms | p99 ms | loop p99 ms | heap MB | 11.11 target | status |
|---|---:|---:|---:|---:|---:|---:|---|---|
| search | 8 | 1,834.6 | 1,904.2 | 3,651.1 | 1,886.39 | 6.3 | p95 ≤ 100 ms | FAIL |
| product | 15.2 | 992.6 | 1,438.5 | 2,535.7 | 1,421.87 | 6.3 | p95 ≤ 50 ms | FAIL |
| cart | 12 | 1,282.4 | 1,852.0 | 1,980.2 | 988.28 | 6.6 | p95 ≤ 150 ms | FAIL |
| mixed | 10 | 681.4 | 5,551.0 | 6,698.7 | 1,301.28 | 6.7 | ≥ 250 req/s, p95 ≤ 150 ms | FAIL |

All scenarios also need loop p99 ≤ 50 ms and 0 errors. Errors were 0 everywhere.

**Micro-timings** (analysts, standalone `node` scripts on the real 12,000-product catalog). The five analysts ran at the same time on one machine, so absolute numbers vary by about ±30%:

| Operation | Today | With fix |
|---|---:|---:|
| `readFileSync` + `JSON.parse` of catalog.json (every request) | 59–98 ms (read 13–14 ms, parse 48–85 ms) | `statSync` 5–8 µs |
| `pbkdf2Sync` sha512 10k (every request) | 6.1–6.9 ms, so at most ~146–165 req/s | cache hit: µs |
| keyword search, per query | 50–68 ms, ~56 MB garbage | inverted index 0.26–0.53 ms, output byte-identical on all 16 bench queries |
| `activePromotionsFor` / `findBestPromotion` per line | 548–690 µs / 512–600 µs | 0.48 µs / tens of µs |
| `products.find(sku)` | ~0.1 ms | `Map.get` 0.04 µs |
| cart external wait, 2 / 5 / 8 / 50 lines | 28 / 38 / 48 / 189 ms | 17 / 16 / 16 / 18 ms |
| deep-freeze the snapshot once | — | 27–29 ms per publish |
| `structuredClone(snapshot)` (worker hand-off) | 119 ms | (this rules out parsing in a worker) |

## Critical Findings
Algorithmic or resource issues that cause non-linear degradation. Must be fixed immediately.

- [ ] **[CRIT-001] The 7.9 MB catalog is re-read and re-parsed with JSON.parse on every /api request** — [catalog-repository.js:15](../../flashmart-api/src/catalog/catalog-repository.js#L13-L27)
  - **Dimension:** A, B, C, D, E (flagged by all five)
  - **Profiler Evidence:**
    - `readSnapshot` 57.4% busy; hot line :15 is 47.6%; `readFileSync` 9.9%.
    - Allocates 4,088 MB (39.2%), about 15 MB per request.
    - It sits on hot paths #1, #3 and #4, covering all three endpoints.
    - Measured at 59–98 ms per call.
  - **Description:** The file changes every few minutes, but every search, product and cart request parses all 12,000 products and 300 promotions synchronously. That alone caps the process at about 10–15 req/s, and it explains the 1–1.9 s loop p99.
  - **Estimated Impact:** −57% busy CPU and −39% allocation. Per-request cost drops from about 70 ms to about 7 µs (one `statSync`).
  - **Pattern:** Result Caching (file identity is the cache key), plus an immutable snapshot with an atomic reference swap.
  - **Optimization Guidance:**
    - Cache `{ key, snapshot }` in the repository closure. `getSnapshot()` stays **synchronous**, which is required by the "fails loudly" test.
    - On each call, `statSync(catalogPath)` and build `key = ino:size:mtimeMs`. The rename-over changes `ino`, so the next request sees a new file. That is 0 s of staleness, well inside the 1 s window.
    - When the key changes, `open` + `fstat` + read the **same fd**, so the key and the content always match. Then parse, validate and `deepFreeze`, and swap the reference.
    - The synchronous reload is single-flight by construction.
    - A malformed file keeps today's behaviour: throw plus `logger.error`, which becomes a 500. The failure is cached per key, so a broken file is not re-parsed on every request.
    - Do **not** use `fs.watch(catalogPath)`: it keeps watching the old inode after a rename. The "second update after a rename" test catches exactly that.
    - Derived data (CRIT-002, CRIT-006) is memoised per snapshot identity (`WeakMap`) in its owning module. It is released together with the old snapshot, and product, promotion and index data can never come from different versions.
  - **Benchmark Target:** `npm run bench:quick` (all scenarios). Tests: `test/catalog-repository.test.js`, `test/api.test.js` (freshness, including search).
  - **Risk:** MEDIUM. It must preserve requirement (1), freshness ≤ 1 s. The existing tests cover it well.
  - **Fix workflow:** Phase 4 (≈ 40 lines, 2 files).

- [ ] **[CRIT-002] Search re-tokenizes all 12,000 products (4 fields each) and matches with `Array.includes` on every query** — [search.js:10-33](../../flashmart-api/src/catalog/search.js#L10-L33), loop [search.js:68-75](../../flashmart-api/src/catalog/search.js#L68-L75)
  - **Dimension:** A, B, D, E. The originals were CRIT / CRIT / HIGH / HIGH. A (O(N·L) CPU) and B (allocation per iteration) converge, which gives CRITICAL.
  - **Profiler Evidence:**
    - Inclusive time: `searchProducts` 24.0%, `scoreProduct` 21.6%, `tokenize` 17.1%.
    - Hot lines: :15 split 6.9%, :13 normalize 4.2%, :22 flatMap 3.6%.
    - Allocation: 6,304 MB, **60.4% of all allocation**. Native `split` is the #1 allocator in the process.
    - Measured at 50–68 ms and about 56 MB per query.
  - **Description:** Product text only changes when a new snapshot is published, yet every query lowercases, NFKD-normalizes, regex-splits and scans it. With CRIT-001 fixed, a single core still manages only about 15–20 searches/s, and search is 50% of mixed traffic.
  - **Estimated Impact:** Search drops from 50–68 ms to 0.26–0.53 ms per query (about 190×). That removes −24% busy CPU and −60% allocation.
  - **Pattern:** Result Caching / precomputed inverted index (hash lookup instead of a scan).
  - **Optimization Guidance:**
    - Build a per-snapshot `Map<token, postings>`, with postings holding a product index and the summed field weight (each field counted once). Build it lazily on the first search after a publish and memoise it per snapshot.
    - Use typed arrays for the postings. A per-product token-`Set` layout was measured at 10.6 ms per query and 24 MB, so it is not good enough.
    - At query time, use the **same** `tokenize` and keep duplicate terms (each occurrence adds its weight again, as today). Accumulate scores, collect matches in catalog order, then apply the category and price filters and the same `COMPARATORS`, slice and `toSummary`.
    - Weights are multiples of 0.5, so the float sums are exact.
    - The empty-`q` path is unchanged.
    - Build cost is 280–305 ms naive, once per publish. An ASCII fast path in `tokenize` (skip NFKD when the text is pure ASCII) reduces it.
  - **Benchmark Target:** `npm run bench:quick` (search, mixed). Tests: `test/search.test.js`, plus a new golden test comparing against the reference algorithm.
  - **Risk:** MEDIUM. Ranking must stay byte-identical (requirement 4), and the index must follow snapshot swaps (requirement 1). It adds about 10 MB of heap per snapshot.
  - **Fix workflow:** Phase 4 (≈ 70–90 lines in `search.js` + test).

- [ ] **[CRIT-003] PBKDF2-SHA512 (10k iterations) runs synchronously on the event loop for every /api request** — [api-key-auth.js:37](../../flashmart-api/src/auth/api-key-auth.js#L29-L44)
  - **Dimension:** A, D (C also noted it). The originals were CRIT / CRIT, so it stays CRITICAL.
  - **Profiler Evidence:** `pbkdf2Sync` is 5.1% busy (≈ 5.7 ms per request) and is hot path #5. Measured at 6.1–6.9 ms per call.
  - **Description:** Today it looks small, but once CRIT-001 and CRIT-002 land it becomes the largest loop hog. At 7 ms per request the process tops out at **~146–165 req/s**, below the mixed target of 250 req/s, whatever else we fix. The bench re-verifies the same key on every request.
  - **Estimated Impact:** Removes the throughput ceiling. Auth drops from about 6–7 ms to a few µs on a cache hit.
  - **Pattern:** Result Caching (positive-verification cache) with the SKILL.md safety invariants for security-sensitive caching.
  - **Optimization Guidance:**
    - Keep `authenticate` **synchronous**; the tests assert on its return value directly.
    - Flow:
      1. Look up `record = keyStore.get(id)` live.
      2. Compute `d = HMAC-SHA256(perProcessRandomKey, secret)`.
      3. It is a hit only if the cached entry for `record.id` has the same `hash`, `salt` and `iterations`, and `timingSafeEqual(entry.d, d)` holds.
      4. On a miss, run the **unchanged** `pbkdf2Sync(secret, salt, record.iterations, 32, 'sha512')` + `timingSafeEqual`, and cache the result only if it matched.
      5. **Always** check the live `record.status` afterwards.
    - Keep today's precedence (`invalid_secret` before `revoked_key`).
    - The cache holds one entry per existing key id, so it is bounded by the key store. Failures are never cached, and plaintext is never stored.
  - **Benchmark Target:** `npm run bench:quick` (product, mixed). Tests: `test/api-key-auth.test.js` (wrong secret right after a success, `…TgJextra`, revocation on the very next request).
  - **Risk:** MEDIUM, because it is security-sensitive. The KDF, digest, iterations and key length are unchanged; a non-matching secret can never hit; revocation is checked live. **This needs your explicit approval as the SEC-112 owner's proxy.** See Open decisions.
  - **Fix workflow:** Phase 4 (≈ 30 lines + tests). Follow-up (deferred): async `crypto.pbkdf2` for cache misses, which limits the DoS impact of floods of wrong secrets.

- [ ] **[CRIT-004] Request history grows without bound (memory leak)** — [request-history.js:21-23](../../flashmart-api/src/platform/request-history.js#L16-L34), fed by [app.js:123-136](../../flashmart-api/src/app.js#L123-L136)
  - **Dimension:** B (A, C and D also noted it)
  - **Profiler Evidence:** Retained memory shows `requestHistorySize` +164 for 164 requests, and heap +0.62 KB per request. Each entry also keeps the parsed request body, which can be up to 256 KB.
  - **Description:** Only the newest 200 entries are ever readable (`/internal/requests?limit` ≤ 200). At 250 req/s the array grows by about 0.56 GB/h, which ends in OOM within hours, and GC mark time grows along with it. Short benches barely show it.
  - **Estimated Impact:** Retained heap stays flat over uptime, and the OOM risk goes away.
  - **Pattern:** Bounded buffer (fixed-capacity ring buffer).
  - **Optimization Guidance:** Use a ring buffer with capacity `MAX_HISTORY_LIMIT` (200). `record` is O(1), `recent(limit)` walks back from the head (newest first), and `size()` returns the retained count. Redaction stays as it is.
  - **Benchmark Target:** `test/request-history.test.js`, `test/api.test.js`. Heap MB in `bench:quick` should stay flat.
  - **Risk:** LOW. Shapes are unchanged; `requestHistorySize` becomes capped at 200 (see Open decisions).
  - **Fix workflow:** Phase 4 (≈ 25 lines).

- [ ] **[CRIT-005] Cart awaits its external calls one after another: one `getStock` per line, then shipping, then loyalty** — [cart-pricer.js:65-83](../../flashmart-api/src/pricing/cart-pricer.js#L65-L83)
  - **Dimension:** C, D. The originals were HIGH / HIGH. They converge on the same function, so it is **escalated to CRITICAL**.
  - **Profiler Evidence:** This is wall-clock time, so the CPU profile can't show it. Measured with the real simulated clients:
    - External wait: 28 / 38 / 48 / 189 ms today for 2 / 5 / 8 / 50 lines, and ≈ 16–18 ms flat with batch + concurrent loyalty.
    - With a 60 ms loop hog running, the median goes from 325 to 66 ms, because each of the N+2 awaits has to wait for the thread again.
  - **Description:** This is the external-service N+1. Loyalty depends only on `customerId`. Shipping has to wait for stock, because only in-stock lines are shipped.
  - **Estimated Impact:** −13 ms (5 lines), −24 ms (8 lines) and −162 ms (50 lines) per cart. Awaits on the critical path drop from N+2 to 2.
  - **Pattern:** Batching (5a) + concurrent fetch over the dependency graph (5b).
  - **Optimization Guidance:**
    - **5a:** Make one `inventory.getStockBatch(foundSkus)` call, chunked by `MAX_BATCH_SIZE` (100) as a safeguard. Skip it when no SKU was found, and keep line order and `not_found` lines. Never cache stock.
    - **5b:** Start `loyalty.getTier()` at t0 and join it with `Promise.all`, or attach `.catch` immediately. Otherwise an inventory failure leaves an unhandled rejection, which crashes Node 22.
    - Shipping stays after stock and conditional on `shippable.length > 0`. Loyalty math is unchanged.
  - **Benchmark Target:** `npm run bench:quick` (cart, mixed). Tests: `test/cart-pricer.test.js` (the fakes already implement `getStockBatch`).
  - **Risk:** LOW. Requirements (3), (4) and (5) all hold: only how we *call* the clients changes.
  - **Fix workflow:** Phase 4, as 2 commits (5a, 5b).

- [ ] **[CRIT-006] Linear scans for SKU lookup and promotion membership, plus two ISO `Date` parses per promotion per evaluation** — [catalog-routes.js:27](../../flashmart-api/src/catalog/catalog-routes.js#L27), [cart-pricer.js:66](../../flashmart-api/src/pricing/cart-pricer.js#L66), [promotions.js:7-9](../../flashmart-api/src/pricing/promotions.js#L7-L9), [promotions.js:31-61](../../flashmart-api/src/pricing/promotions.js#L31-L61)
  - **Dimension:** A (HIGH), E (HIGH), B (LOW). An algorithmic scan (A) plus allocation per iteration (B) is the §3.4 pattern, so it is **escalated to CRITICAL**.
  - **Profiler Evidence:**
    - Baseline: `isActive` 0.4% and `findBestPromotion` 0.4% (hot lines promotions.js:8 and :35), 17.6 MB of `Date` garbage. These shares are small only because CRIT-001 dominates.
    - Measured: 548–690 µs per product view and 512–600 µs per in-stock cart line (300 promotions × ~690-SKU `includes` + 600 `Date` objects). `products.find` is ~0.1 ms.
  - **Description:** Once CRIT-001 to 003 land, this is the largest remaining handler cost for product and cart. It takes about 20% of the ~4 ms-per-request loop budget that 250 req/s allows.
  - **Estimated Impact:** Product drops from ~0.65 ms to ~1 µs, and cart saves ~0.6 ms per line.
  - **Pattern:** Precomputed per-snapshot hash index.
  - **Optimization Guidance:**
    - Memoise per snapshot identity:
      - `productsBySku`: first entry wins, mirroring `find`.
      - `promotionsBySku`: sorted by id and de-duplicated per promotion, with `startMs` / `endMs` pre-parsed using `Date.parse` (`NaN` stays inactive, as today).
    - Windows are still compared with `now.getTime()` **on every request**; "is active" is never cached (requirement 3).
    - Keep the exported signatures: the tests call them with arrays. Pass the per-SKU candidate list into them.
  - **Benchmark Target:** `npm run bench:quick` (product, cart). Tests: `test/promotions.test.js`, `test/cart-pricer.test.js`, `test/api.test.js`.
  - **Risk:** LOW–MEDIUM. The equivalence edge cases (duplicate SKUs, id ties, invalid dates) get tests.
  - **Fix workflow:** Phase 4 (3 source files: promotions.js, catalog-routes.js, cart-pricer.js).

## High Findings
Significant measurable waste in hot paths. Fix before release.
- None left after escalation. The three HIGH root causes (CRIT-002 for D/E, CRIT-005, CRIT-006) were escalated because 2+ dimensions converged on them.

## Medium Findings
Moderate waste detectable in profiles. Fix near term.
- [ ] **[MED-001] Every search fully sorts all matches (the whole catalog when `q` is empty) to return one page** — [search.js:77-81](../../flashmart-api/src/catalog/search.js#L77-L81)
  - **Dimension:** A (B also mentioned it as a follow-up)
  - **Profiler Evidence:** `searchProducts` self time 2.2% and comparators 0.2%. Measured: `q=""` sorted by rating takes 21.3 ms (12,000 items); bench keyword queries sort 679–1,427 matches (~0.5–1 ms).
  - **Estimated Impact:** Browsing the whole catalog drops from 21 ms to ~1 ms. It barely matters for the bench mix, where every empty-`q` query is category-filtered.
  - **Optimization Guidance:** Pre-sort per snapshot for `price_asc`, `price_desc` and `rating`, and use a bounded top-K with the same comparator for `relevance`. Order stays identical thanks to the SKU tie-break.
  - **Risk:** LOW
- [ ] **[MED-002] Per-line deep clone (`JSON.parse(JSON.stringify(product))`) and an eagerly built debug log line (two `JSON.stringify` calls) in cart pricing** — [cart-pricer.js:72-75](../../flashmart-api/src/pricing/cart-pricer.js#L71-L76)
  - **Dimension:** B, E. The originals were LOW / LOW; they converge, so it is escalated to MEDIUM.
  - **Profiler Evidence:** Below the profile noise floor today. Measured at 6.4 µs per line (clone 3.65 µs + discarded debug string 2.78 µs at info level).
  - **Estimated Impact:** Small in CPU terms. The real value is that immutability is enforced by the CRIT-001 deep-freeze instead of a per-request copy, and debug logging becomes level-gated.
  - **Optimization Guidance:** Delete the clone (the snapshot is frozen by CRIT-001). Log `logger.debug('priced line', { sku, status, promotionId })`, which uses structured fields that are serialized only when debug is on.
  - **Risk:** LOW
- [ ] **[MED-003] Guardrail: multi-process / cluster scaling would break SEC-112 and the internal endpoints** — [api-key-store.js:24-29](../../flashmart-api/src/auth/api-key-store.js#L24-L29), [server.js:18](../../flashmart-api/src/server.js#L18)
  - **Dimension:** D
  - **Description:** A revoke only updates the process that receives it, and history and metrics would each show one worker's slice. After the fixes above, a single process has large headroom, so clustering is not needed.
  - **Optimization Guidance:** No code change. Do not cluster without first broadcasting revocations and waiting for acknowledgements.
  - **Risk:** HIGH if someone clusters naively.

## Low Findings
Minor optimization opportunities. Backlog.
- [ ] **[LOW-001] Outbound calls have no deadline** — [cart-pricer.js:73-83](../../flashmart-api/src/pricing/cart-pricer.js#L73-L83)
  - **Dimension:** C
  - **Suggestion:** Wrap calls in `withDeadline(promise, ms)` with a ~300–500 ms budget. This is tail resilience only and has no effect on the bench. A 503/504 status would change the API contract, so a timeout must map to today's 500 unless product signs off. Defer to a separate `/bugfix` or feature session.

## Cross-Dimension Correlations
Findings that span multiple dimensions, with escalated severity.
- **CRIT-001 (A+B+C+D+E):** Blocking file I/O (C), a 50–85 ms parse (A/E), 15 MB of garbage per request (B) and a 98 ms loop hold (D) all come from one line. It was already CRITICAL and is the root of every baseline failure.
- **CRIT-002 (A+B, D+E):** O(N·L) tokenization (A) with heap allocation per product (B) matches the §3.4 "O(n²) + allocation per iteration" rule. The D and E HIGH ratings were raised to CRITICAL.
- **CRIT-003 (A+D):** A 5.1% self-time item turns out to be a hard ceiling (~146–165 req/s) once the loop is freed. Amdahl's law makes it the next bottleneck after CRIT-001 and CRIT-002.
- **CRIT-005 (C+D):** Sequential I/O (C) combined with loop convoying (D): every extra await queues behind other requests' CPU work (325 → 66 ms under a 60 ms hog). HIGH was escalated to CRITICAL.
- **CRIT-006 (A+E+B):** Linear scans (A/E) with 600 `Date` allocations per evaluation (B). HIGH was escalated to CRITICAL.
- **MED-002 (B+E):** A defensive copy (B) plus serialization used as the copy and log mechanism (E). LOW was escalated to MEDIUM. It depends on CRIT-001's deep-freeze.

## Implementation Priority Matrix

Findings ranked by impact/risk ratio for implementation order. Each row is one commit (`perf(scope): …`) with tests first, a `PERF:` comment, `npm test`, `npm run check`, `npm run bench:quick -- --label fix-<n>` and `npm run bench:compare -- baseline fix-<n>`.

| Priority | ID | Title | Impact | Risk | Approach |
|---|---|---|---|---|---|
| 1 | CRIT-001 | Cache the parsed catalog snapshot | HIGH (−57% CPU, −39% alloc, all endpoints) | MED | `statSync` identity key per request, fd-consistent sync reload, deep-freeze, cached parse failure |
| 2 | CRIT-004 | Bound the request history | HIGH (stops OOM / GC growth) | LOW | 200-entry ring buffer |
| 3 | CRIT-005a | Batch cart stock lookups | HIGH for cart (−13 to −162 ms) | LOW | One `getStockBatch` per cart (chunk ≤ 100, skip if empty) |
| 4 | CRIT-005b | Fetch loyalty concurrently | MED-HIGH (−8 ms per cart, fewer convoy waits) | LOW | Start at t0, join with `Promise.all` (no unhandled rejection) |
| 5 | CRIT-006 | Per-snapshot SKU and promotion indexes | MED-HIGH (~20% of the per-request budget) | LOW-MED | `WeakMap`-memoised `productsBySku` / `promotionsBySku` with pre-parsed windows; windows checked per request |
| 6 | CRIT-003 | Verified-key cache in `authenticate` | HIGH (removes the ~150 req/s ceiling) | MED (SEC-112) | HMAC digest bound to hash/salt/iterations, live status check, no negative caching |
| 7 | CRIT-002 | Inverted search index per snapshot | HIGH (search 50–68 → < 1 ms, −60% alloc) | MED | Typed-array postings, identical scoring, golden test against the old algorithm |
| 8 | MED-002 | Drop the deep clone, level-gate the debug log | LOW-MED | LOW | Only if time allows (depends on #1) |
| Cond. | MED-001 | Pre-sorted orders / top-K | LOW for the bench mix | LOW | Only if search p95 or loop p99 still misses after #7 |
| Skip | LOW-001 | Outbound deadlines | Resilience only, no bench effect | LOW-MED | Separate session; the timeout status needs a product decision |
| Skip | MED-003 | Cluster / multi-process | — | HIGH | Guardrail: breaks SEC-112 revocation |
| Defer | CRIT-003 follow-up | Async PBKDF2 for cache misses | DoS hardening | MED | `authenticate` becomes async, so the tests change; separate commit or session |

**Priority rules:**
- Low risk, high impact → do first (1–5)
- Medium risk, high impact → do second (6–7)
- High risk, high impact → do last (none)
- Any risk, low impact → skip (below noise floor)

**Dependencies:** #5, #7 and #8 need #1 (a stable snapshot identity plus freezing). #6 is independent.

**Expected end state (estimate, to be verified in Phase 5):**

| Scenario | Target | Expected |
|---|---|---|
| search | p95 ≤ 100 ms | ~5–15 ms |
| product | p95 ≤ 50 ms | ~2–10 ms |
| cart | p95 ≤ 150 ms | ~20–40 ms (external wait floor ≈ 16 ms) |
| mixed | ≥ 250 req/s, p95 ≤ 150 ms | several hundred req/s or more |
| all | loop p99 ≤ 50 ms | ≪ 50 ms |

Retained heap rises to about 20–30 MB (snapshot ≈ 8.5 MB + search index ≈ 10 MB), which is bounded.

**Freshness budget (requirement 1):** detection is immediate (`statSync` on each request). After a publish, the first request pays parse (~50–85 ms) + freeze (~28 ms), and the first search also pays the index build (~280–305 ms naive). Worst case is about 0.4 s, under 1 s. Re-check this on the demo laptop after #7; if a slower machine gets close to 1 s, add the ASCII fast path.

## Open decisions (need your answer before Phase 4)
1. **SEC-112 / CRIT-003:** do you approve the verified-key cache? It keeps the same PBKDF2 parameters and checks revocation live on every request, but it holds an HMAC digest of each verified secret in memory. The alternative is async `crypto.pbkdf2` on the libuv pool (~640 derivations/s, loop stays free). That changes the `authenticate` signature and its tests, and still costs ~6 ms of CPU per request.
2. **Malformed replacement catalog (CRIT-001):** keep today's behaviour (500 until a valid file lands; recommended, since the contract is unchanged), or serve the last good snapshot and log an error?
3. **`requestHistorySize` (CRIT-004):** once bounded, it reports entries retained (≤ 200) instead of the total ever recorded. The shape is unchanged. OK?
4. **Scope for the 60-minute slot:** fixes 1–7 are required to hit the targets; #8 is optional. OK to skip #8 and MED-001 if time is short?

## Dimensions Covered
| Dimension | Status | Scope Examined |
|---|---|---|
| A. CPU & Computation | ✅ Analyzed | Profile top 12 by self/inclusive time, hot lines; 1 micro-benchmark (snapshot, pbkdf2, search, promotions, find); 12 files |
| B. Memory & Allocation | ✅ Analyzed | Allocation profile, retained memory, GC; 1 heap measurement (`v8.GCProfiler`); 17 files |
| C. I/O & Network | ✅ Analyzed | Sync file I/O, external-call patterns; 2 measurements (file I/O, real simulated clients); 24 files |
| D. Concurrency & Parallelism | ✅ Analyzed | Event-loop hold model (Little's law), libuv pool, async PBKDF2, cart critical path; 2 measurements; 24 files |
| E. Serialization & Data Structures | ✅ Analyzed | JSON parse, tokenize/index layout, lookup structures, logging, response serialization; 2 measurements; 14 files |
| F. Build, Bundle & Deployment | ⏭ Skipped | No frontend bundle, no Docker, no build step |

## Rules Applied
- Always-on: `security-mandate.md`, `rugged-software-constitution.md`, `rule-priority.md` (security wins: no SEC-112 weakening; "measure first"), `core-design-principles.md` (no concurrency or clustering without evidence), `architectural-pattern.md` (I/O stays behind the repository and clients; pure logic stays pure), `logging-and-observability-mandate.md` (reload and parse failures logged), `code-idioms-and-conventions.md`, `code-organization-principles.md`, `documentation-principles.md` (`PERF:` comments), `project-structure.md`
- On demand: `performance-optimization-principles.md`, `resources-and-memory-management-principles.md`, `concurrency-and-threading-principles.md`, `data-serialization-and-interchange-principles.md` (`database-design-principles.md` N/A: no database)
- Skill: `perf-optimization` (SKILL.md, `references/perf-dimensions.md`, `references/perf-report-template.md`, `languages/typescript.md`)

---

## Implementation Results
<!-- Fill this section AFTER Phase 4 implementation is complete -->

### Before/After Benchmark Comparison

| Benchmark | Metric | Before | After | Δ | Δ% |
|---|---|---|---|---|---|

### Optimizations Applied
| Commit | ID | Title | Measured Improvement |
|---|---|---|---|

### Optimizations Skipped
| ID | Title | Reason |
|---|---|---|

### Failed Optimizations
| Attempt | Expected Gain | Actual Result | Why It Failed |
|---|---|---|---|

### Surprising Findings
-

### Remaining Opportunities
-

## Verification Suite Results
- **Full Benchmark Suite:** (pending: `npm run bench -- --count 3 --label final`)
- **Test Suite:** (pending: `npm test`)
- **Quality Checks:** (pending: `npm run check`)
