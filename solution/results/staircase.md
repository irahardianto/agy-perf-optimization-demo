# Reference results: the staircase

Numbers recorded while building the kit, for the presenter's eyes only. Your laptop will produce
different absolute numbers, but the **ratios and the order of the bottlenecks** hold.

**Rehearsal machine:** 8 vCPU AMD EPYC 7B12 (cloud VM), Node 22.22.2, Linux, 12,000 products and
300 promotions, 16 connections. A recent laptop CPU usually has faster single-thread performance,
so expect equal or better numbers.

## Full benchmark after each fix (`npm run bench`, 5 s per scenario)

Each row adds one commit from [`../patches/`](../patches/) on top of the previous one.

| After | search req/s | product req/s | cart req/s | mixed req/s | mixed p95 | Readiness | Heap MB, first → last scenario |
|---|---:|---:|---:|---:|---:|---|---|
| baseline | 8 | 16 | 12.4 | 10 | 5,246 ms | 0/4 | 6.3 → 6.7 |
| 0001 catalog cache | 17.2 | 132.6 | 93.8 | 30.8 | 1,989 ms | 0/4 | 15.4 → 16.7 |
| 0002 search index | 135.2 | 128.2 | 94.2 | 120.4 | 531 ms | 0/4 (PBKDF2-bound) | 30.7 → 32.5 |
| **0003 auth cache** | **1,104** | **948** | **213** | **702** | **92.8 ms** | **4/4** | 33.9 → 40.1 |
| 0004 promotion index | 1,058 | 3,404 | 376 | 1,480 | 49.4 ms | 4/4 | 33.7 → 52.4 |
| 0005 cart I/O | 1,148 | 3,315 | 681 | 1,750 | 29.4 ms | 4/4 | 34.1 → 54.7 |
| 0006 history ring buffer | 1,186 | 3,626 | 669 | 1,677 | 30.1 ms | 4/4 | 31.4 → 35.5 (flat) |

Things to notice:

- **Fix 1 alone doesn't pass a single target.** Search is still tokenizing 12,000 products per
  request, and every request still pays for PBKDF2.
- **Fix 2 hits a wall at ~130 req/s on every scenario.** That's PBKDF2: about 5.2 ms of
  synchronous CPU per request (measured by `npm run doctor`), so 130 req/s already spends ~70% of
  the event loop on key verification.
- **Fix 3 is where the 11.11 targets pass.** This is the approved scope in the demo.
- **Heap:** the jump from ~6 MB to ~30 MB is the cached catalog plus the search index, which is
  intended. The *climb* across scenarios (34 → 55 MB) is the unbounded request history
  (`requestHistorySize` reached 38,899 entries after fix 5). Fix 6 flattens it.

## The demo scope: fixes 1–3, Phase 5 (`npm run bench -- --count 3 --label final`)

File: [`bench/fix3-final.json`](bench/fix3-final.json) (73 s wall time).

| Scenario | req/s | p95 | loop p99 | heap MB | vs baseline |
|---|---:|---:|---:|---:|---|
| search | 1,294 | 21.5 ms | 35.6 ms | 37.5 | 162× req/s, p95 170× lower |
| product | 993 | 27.2 ms | 43.6 ms | 48.9 | 62× req/s |
| cart | 227 | 101.8 ms | 21.1 ms | 52.7 | 18× req/s |
| mixed | 596 | 107.4 ms | 33.0 ms | 54.6 | 60× req/s, p95 5,246 → 107 ms |

Readiness goes from **0/4 to 4/4**. Mixed p95 (107 ms against a 150 ms target) and product
event-loop p99 (43.6 ms against 50 ms) have the least headroom. On a slow laptop they're the first
to flip to FAIL, which is a good lead-in to "the bottleneck moves".

## All six fixes, Phase 5 (`--count 3`)

File: [`bench/final.json`](bench/final.json). search 1,122 req/s · product 3,565 · cart 686 ·
mixed 1,723 (p95 29.8 ms) · 4/4 · heap flat at ~35 MB. Against baseline: search 140×, product
223×, cart 55×, mixed 172×.

## Alternative fix 2: per-product token sets instead of an inverted index

A plausible live-agent outcome. The agent pre-tokenizes each product into `Set`s but still
scans all 12,000 products per query:

| State | search req/s | search p95 | mixed req/s | mixed p95 | Readiness |
|---|---:|---:|---:|---:|---|
| token sets alone | 77 | — | — | — | 0/4 |
| token sets + auth cache | 139.6 | 186 ms (FAIL) | 219 | 280 ms (FAIL) | **2/4** |

The profile then shows `Set.has` inside `scoreProduct` at ~63% of CPU. If this happens live, it's
a gift: "the workflow measured it, the target still fails, and the profile says why. Next
iteration: an inverted index."

## Quick benchmarks (`npm run bench:quick`, 2 s per scenario)

| State | Wall time | search | product | cart | mixed | Readiness |
|---|---:|---|---|---|---|---|
| baseline ([file](bench/baseline-quick.json)) | **35 s** | 8.5 req/s, p95 12.2 s | 16 req/s, p95 1.9 s | 12 req/s, p95 1.7 s | 9 req/s, p95 6.2 s | 0/4 |
| after fix 3 ([file](bench/fix3-quick.json)) | 11 s | 1,066 req/s, p95 26 ms | 887 req/s, p95 30 ms | 203 req/s, p95 122 ms | 566 req/s, p95 116 ms | 4/4 |

> [!NOTE]
> At baseline the quick bench takes **~35 s**, not 10 s: requests take seconds to drain at the
> end of each scenario. Budget for that in the Hook, and narrate over it.

## Command wall times (rehearsal machine)

| Command | Baseline | After fix 3 |
|---|---:|---:|
| `npm test` | ~2.5 s | ~2.5 s |
| `npm run bench:quick` | 35 s | 11 s |
| `npm run bench` | 47 s | ~30 s |
| `npm run bench -- --count 3` | — | 73 s |
| `npm run profile` | 31 s | 11 s |

## What's hot (profile summaries in [`profiles/`](profiles/))

| Profile | #1 hot line | Also hot | Allocation |
|---|---|---|---|
| [baseline](profiles/baseline/summary.md) | `catalog-repository.js:15` `JSON.parse(readFileSync(...))` **47.9%** | tokenize (split/normalize/flatMap) ~20%, `pbkdf2Sync` ~5%, GC 8.5% | 10.4 GB in 30 s, **~40 MB per request** |
| [after fix 3](profiles/after-fix3/summary.md) | `promotions.js:8` `new Date(promotion.startsAt)` **18.5%** | `promotion.skus.includes` 14%, `products.find` in cart 7.1%, search sort 6% | 244 KB per request; history +4,366 entries during the profile |
| [final](profiles/final/summary.md) | `search.js:119` sorting matches (relevance comparator 13.7%) | `writev` 6.4%, `products.find` in cart 6.3% | 164 KB per request; heap flat |

"After fix 3" is the **bottleneck moves** slide: once the catalog, search and auth costs are gone,
the promotion scan (a deferred finding) is the new #1. Re-running `npm run profile` at that point
takes about 11 seconds.

## Showing recorded results if the live run fails

`bench/compare.mjs` accepts file paths, so nothing needs to be copied. From `flashmart-api/`:

```bash
node bench/compare.mjs ../solution/results/bench/baseline.json ../solution/results/bench/fix3-final.json
node bench/compare.mjs ../solution/results/bench/baseline.json ../solution/results/bench/final.json
```

Flame charts: Chrome DevTools → Performance → Load profile → `profiles/<name>/cpu.cpuprofile`.
