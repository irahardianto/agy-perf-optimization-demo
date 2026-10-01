# Answer key (presenter only — never show this file on screen)

What's planted in `flashmart-api`, what the workflow should find, which fixes are right, which
"fast" fixes are traps, and how to check the agent's work in seconds. Line numbers refer to the
`baseline` tag.

- Reference numbers: [../solution/results/staircase.md](../solution/results/staircase.md)
- Reference fixes, one commit each: [../solution/patches/](../solution/patches/)
- Naive fixes and the tests that catch them: [../solution/naive/](../solution/naive/)

---

## 1. Planted issues at a glance

| # | Issue | Where (baseline) | Dimensions | Expected severity | Reference fix |
|---|---|---|---|---|---|
| 1 | Catalog snapshot (8 MB) re-read and re-parsed on **every** request | `src/catalog/catalog-repository.js:15` | A, B, C, D, E | **CRITICAL** (cross-dimension escalation) | `0001` cache per file version |
| 2 | Search re-tokenizes all 12,000 products per query | `src/catalog/search.js:19-33` (`scoreProduct` → `tokenize` ×4) | A, B, E | HIGH → CRITICAL (A+B) | `0002` inverted index per snapshot |
| 3 | PBKDF2 (10,000 iterations of SHA-512) on every request | `src/auth/api-key-auth.js:37` | A, D | HIGH (it becomes *the* wall after fixes 1–2) | `0003` cache successful verifications |
| 4 | Promotion scan: 300 promotions × 2 `new Date()` per line / product page | `src/pricing/promotions.js:8`, `:35`, `:58` | A, E | MEDIUM at baseline (masked), **#1 hot spot after fix 3** | `0004` SKU → promotions index |
| 5 | Cart: one inventory call per line (N+1), then shipping, then loyalty, all sequential | `src/pricing/cart-pricer.js:73`, `:82-83` | C, D | HIGH (cart latency) | `0005` batch + concurrent loyalty |
| 6 | Unbounded request history (each entry keeps headers + cart body) | `src/platform/request-history.js:22`, fed by `src/app.js:124-135` | B | MEDIUM (invisible at 10 req/s, a leak at 1,000+) | `0006` ring buffer (1,000) |
| 7 | Linear SKU lookups `products.find` | `src/catalog/catalog-routes.js:27`, `src/pricing/cart-pricer.js:66` | A, E | LOW → MEDIUM after the big fixes | not fixed (remaining opportunity) |
| 8 | Deep clone per cart line `JSON.parse(JSON.stringify(found))` | `src/pricing/cart-pricer.js:72` | B, E | LOW / **Skip** (defensive, guarded by a test) | not fixed |
| 9 | Eager debug-log string building (`JSON.stringify` ×2 even when debug is off) | `src/pricing/cart-pricer.js:75` | A, B | LOW / **Skip** | not fixed |

Profile evidence at baseline (from `.profiles/baseline/summary.md`): hot line #1 is
`catalog-repository.js:15` at **47.9%** of busy CPU. Tokenize lines (split 7.7%, normalize 4.3%,
flatMap 3.4%, …) add up to ~20%, `pbkdf2Sync` ~5%, GC 8.5%, and **~40 MB is allocated per
request**. Issues 4–9 barely register at baseline because issue 1 drowns everything. That's the
point of "the bottleneck moves".

> [!TIP]
> A good report puts #1 first as CRITICAL, flagged by 3+ dimensions. #2 and #3 follow as HIGH,
> #4/#5 as HIGH or MEDIUM, #6 as MEDIUM (some agents call it CRITICAL, since "memory leak" is in
> the workflow's CRITICAL definition, which is defensible), and #8/#9 as Skip. Any ordering that
> keeps #1 on top and puts micro-optimizations in Skip is a good outcome. Don't argue with the
> agent's exact labels on stage.

---

## 2. Each issue: correct fix, acceptable alternatives, traps

### 2.1 Catalog snapshot re-parse (CRITICAL)

- **Correct (patch 0001):** cache the parsed snapshot keyed by file version:
  `statSync` → `ino:size:mtimeMs` on every call, re-parse only when it changes. statSync costs
  ~2% of CPU after all fixes. The rename-over-temp-file export changes the inode, so updates are
  seen on the very next request.
- **Also correct:** the same with a short TTL on the stat (≤ 1 s total staleness), or async
  `fs.promises.stat`. Anything that serves a new file within 1 s is fine.
- **Traps (both caught by the suite):**
  - Load once and keep forever → `try-naive catalog-load-once` → fails
    *"serves each new snapshot within one second of it being published"* and
    *"serves catalog updates within one second, including in search results"*.
  - `fs.watch` invalidation → `try-naive catalog-fs-watch` → the watcher stays on the renamed-away
    inode, so every update after the first is missed on Linux/macOS. It fails the first test
    above. **On Windows it may pass**, which is worth saying out loud: "works on my machine"
    caching.
- **Watch for:** mtime-only checks (1–2 s mtime granularity on some filesystems), and caching the
  snapshot *object* but mutating it per request. The test *"never mutates the shared catalog
  snapshot"* guards that.
- **Rehearsal 1's version was better than patch 0001:** a bigint stat key
  (`dev:ino:size:mtimeNs:ctimeNs`) checked on every call (~5 µs), key and content read from the same
  file descriptor, a deep-frozen shared snapshot, and a negative cache so a malformed file isn't
  re-parsed on every request. It also found a cost the cache can't remove: each catalog publish
  stalls the event loop for ~300 ms (80 ms parse + 225 ms search-index rebuild on the first request
  after the publish). Freshness still holds. It's a good answer to "what's next?".

### 2.2 Search tokenization (HIGH)

- **Correct (patch 0002):** an inverted index built once per snapshot (token → product position →
  summed field weight), stored in a `WeakMap` keyed by the snapshot's `products` array. It is
  rebuilt automatically when fix 1 serves a new snapshot, and garbage-collected with the old one.
  A differential check of 400 queries against the baseline found 0 mismatches.
- **Plausible but insufficient:** pre-tokenized per-product `Set`s, still scanning all 12,000
  products per query. Search reaches 139.6 req/s with p95 186 ms, so it **fails**. Readiness is
  2/4 after fix 3 (see staircase). If this happens live, celebrate the measurement: "the target
  still fails, and the profile says why".
- **Trap:** an index cached by product count → `try-naive search-index-keyed-by-size` → fails
  *"serves catalog updates within one second, including in search results"* (the test renames
  product 0 and keeps the count).
- **Watch for:** relevance drift. The baseline counts each field once per term (`includes`), so the
  index must dedupe tokens per field (`new Set(tokens)`). The golden test *"keeps ranking stable
  on the generated catalog"* catches drift.

### 2.3 PBKDF2 per request (HIGH, SEC-112)

- **Correct (patch 0003):** a bounded LRU (1,000 entries, 5 min TTL) of *successful*
  verifications:
  - keyed by `keyId + SHA-256(secret)`, never the raw secret;
  - an entry is honoured only while the stored hash is unchanged (key rotation);
  - failures are never cached (no memory-exhaustion vector from random secrets);
  - `record.status` is checked on **every** request (revocation).
  KDF, digest, iterations and key length are untouched.
- **Also correct, but slower:** async `crypto.pbkdf2` on the libuv threadpool, with the key record
  re-read after the `await` so a revocation that lands mid-hash still wins. Rehearsal 1 chose this
  on its own. The code was correct: existing tests only gained `await`, and it added a race test
  and an event-loop test. But every request still burns ~5 ms of CPU on the 4-thread pool.
  Measured on 8 vCPUs (`--count 3`): search 526 req/s, product 512 (p95 42 ms; one of three runs
  was 54.6), cart 154 (**p95 155.5 ms, fails ≤ 150**), mixed 370 (p95 124). That's **3/4**, and a
  4-core laptop will do worse. Combining it with the cache is fine.
- **Agents differ here.** Rehearsal 1 defaulted to async and called a cache something that "needs
  SEC-112 sign-off". Rehearsal 2 defaulted to a cache (an HMAC of the verified secret, bound to
  the record's hash, salt and iterations). The approval prompt gives that sign-off explicitly, with
  conditions, so the outcome doesn't depend on which way the agent leans.
- **Traps:**
  - Cache by key id only → `try-naive auth-cache-by-key-id` → fails *"rejects a wrong secret"* and
    *"rejects a wrong secret right after the same key id authenticated successfully"*.
  - Cache the whole result → `try-naive auth-cache-skips-revocation` → fails *"revocation takes
    effect on the very next request"* and *"revokes API keys immediately"*.
- **Forbidden:** lowering iterations, switching to SHA-256 / scrypt / bcrypt, or re-seeding keys
  with weaker parameters. Use the SEC-112 recovery prompt.

> [!WARNING]
> **No test pins the KDF parameters.** They live in the key records (`data/api-keys.json`,
> git-ignored) and in `scripts/lib/generate-data.mjs`. An agent that lowered `KDF.iterations`
> there and re-seeded would still pass the suite. SEC-112 is protected by the README, the code
> comment, the kickoff prompt and **you at the approval gate**. That's a teaching moment: *not
> every requirement can be a test, which is why the workflow has a human gate.* Quick check
> after the run: `git diff --stat baseline -- scripts` must be empty (the data can only be
> re-seeded through `scripts/`), and the `src/auth` diff must leave `DIGEST`, `KEY_LENGTH` and
> `record.iterations` alone.

### 2.4 Promotion scan (MEDIUM → the next #1)

- **Correct (patch 0004):** SKU → promotions index per snapshot, with `startsAt`/`endsAt`
  pre-parsed to numbers. Windows are still evaluated **per call** against `now`, and the
  tie-break (lowest id) is kept. A comparison sweep over 11,040 cases found 0 mismatches.
- **Trap:** keep only promotions active at index-build time →
  `try-naive promotions-prefiltered-by-window` → fails *"evaluates promotion windows at request
  time, not when the catalog was loaded"*.
- **Demo value:** after fixes 1–3 this is the profile's #1 hot line
  (`promotions.js:8`, 18.5%, plus `skus.includes` 14%). Use it for "the bottleneck moves".

### 2.5 Cart I/O (HIGH for the cart scenario)

- **Correct (patch 0005):** one `getStockBatch` per 100 SKUs (`MAX_BATCH_SIZE` from
  `src/external/inventory-client.js`), run concurrently with `loyalty.getTier`. Shipping is still
  quoted **after** stock is known, on in-stock weight only, and not at all if nothing ships.
- **Trap:** `Promise.all` everything → `try-naive cart-all-calls-parallel` → fails *"charges and
  ships only the lines that are in stock"* (it quotes 3,400 g instead of 400 g) and *"does not
  request a shipping quote when nothing can be shipped"*.
- **Forbidden:** editing `src/external/` (lowering the simulated latency, raising the batch cap).
  README requirement 5.

### 2.6 Unbounded request history (MEDIUM, "memory leak")

- **Correct (patch 0006):** a ring buffer (capacity 1,000). `recent(limit)` still returns newest
  first. Redaction is untouched (*"records recent API requests with credentials redacted"*).
- **Evidence:** heap after GC climbs across scenarios in one bench, e.g. 37.5 → 54.6 MB in the
  3-fix `--count 3` run. `requestHistorySize` is in the result JSON: 38,899 entries after fix 5.
- **Not a leak:** the jump from ~6 MB (baseline) to ~30 MB after fixes 1–2 is the cached catalog
  and search index, which is intended. Expect an audience question about this.

### 2.7 Expected "Skip" / "Remaining opportunities"

The deep clone (#8), eager debug logging (#9) and `sendJson` serialization are each ≤ 1–3% after
the big fixes, so a good plan skips them. `products.find` (#7) and the relevance sort
(`search.js:77`, the #1 hot line after all six fixes) are legitimate next-session items.

---

## 3. Requirement-encoding tests (the guardrails)

| README requirement | Test (file:line at baseline) |
|---|---|
| 1. Catalog freshness | `test/catalog-repository.test.js:35` serves each new snapshot within one second of it being published · `test/api.test.js:158` serves catalog updates within one second, including in search results |
| 2. SEC-112 | `test/api-key-auth.test.js:45` rejects a wrong secret · `:49` rejects a revoked key even with the right secret · `:53` rejects a wrong secret right after the same key id authenticated successfully · `:60` revocation takes effect on the very next request · `test/api.test.js:150` revokes API keys immediately |
| 3. Pricing rules | `test/cart-pricer.test.js:105` charges and ships only the lines that are in stock · `:121` does not request a shipping quote when nothing can be shipped · `:129` evaluates promotion windows at request time… · `:143` never mutates the shared catalog snapshot · `test/promotions.test.js` best promotion / tie-break |
| 4. API contracts | `test/api.test.js` (shapes, status codes, error format) · `test/search.test.js:81` golden ranking |
| 5–6. External services, harness | **Not tests.** Check with `git diff --stat baseline -- src/external bench tools/perf` (must be empty) |

`node ../solution/naive/try-naive.mjs --all` proves that all 7 naive variants are caught
(7/7, about 15 s).

---

## 4. Checking the agent's work in 60 seconds

Run from `flashmart-api/` after Phase 4 (or during Phase 5):

```bash
git log --oneline baseline..HEAD                             # one perf(...) commit per fix
git diff --stat baseline -- src/external bench tools/perf    # must print nothing
git diff --stat baseline -- scripts                          # must print nothing (SEC-112 keys, seed)
git grep -n "PERF:" -- src                                   # at least one per fix
npm test                                                     # green; more than 69 tests
```

PowerShell: identical, except use `npm.cmd test` if `npm` is blocked.

What a good auth diff looks like: `DIGEST`, `KEY_LENGTH` and `record.iterations` unchanged;
`timingSafeEqual` still used on a cache miss; status checked outside the cache.

---

## 5. Likely audience questions

| Question | Short answer |
|---|---|
| "Why not just add servers / cluster / worker threads?" | The profile shows waste, not load: 40 MB allocated and an 8 MB JSON parse per request. Scaling out multiplies the waste (and the memory of every cached snapshot). Fix the waste, then scale. |
| "Isn't caching auth results a security risk?" | Walk the 0003 design: digest-keyed, bounded, TTL, failures never cached, rotation-aware, status checked every request, KDF unchanged. The cache only skips recomputing an identical PBKDF2 result. |
| "Heap went from 6 MB to 40 MB, is that a leak?" | Only the *climb* is. The step up is the intentionally cached catalog + index; the climb across scenarios is the history list (issue 6). |
| "What if the agent picks a wrong fix?" | Three nets: the approval gate, TDD plus requirement tests (`try-naive --all`), and one commit per fix (easy to revert). |
| "Does this work for Python / Go / Java?" | The workflow is language-agnostic. The skill ships language modules; see `extras/python-track-notes.md` for a Python mapping. |
| "Why a workflow instead of one good prompt?" | Repeatability. The same phases, the same gate, the same evidence every time, parallel analysts with different lenses, and a report that survives the chat. |
| "Workflows are being retired in Antigravity?" | Yes, on Nov 1, 2026. `/migrate-workflows` turns them into skills (still invoked as `/perf-optimize`); a migrated copy is in `extras/perf-optimize-skill/`. |
| "How long / how much did the agent spend?" | With the time-boxed kickoff: **19 min** to the human approval gate, **~13 min** for the three fixes, and **~6 min** for Phase 5–6 verification and documentation (~38–40 min of agent wall time, ~70 terminal commands across coordinator + 5 analysts). Without the time box, Phase 2 alone took 25 min (41 min to the gate, 177 commands). See §6. |

---

## 6. Rehearsal observations

Two blind end-to-end rehearsals of `/perf-optimize` were run on an 8-vCPU Linux machine (`AMD EPYC 7B12`, Node `v22.22.2`) against a clean clone of `flashmart-api` at tag `baseline`, offline, with zero access to `solution/` or `presenter/`. Their full reports are saved in [`solution/example-report/`](../solution/example-report/README.md).

### 6.1 Phase-by-phase wall times

| Phase / step | Run-of-show budget | Rehearsal 1 (untimed kickoff) | Rehearsal 2 (time-boxed kickoff) |
|---|---:|---:|---:|
| Kickoff → Phase 1 start (Phase 0 recon + rules) | ~2.5 min | 2m18s | 2m22s |
| Phase 1 (profile ~32 s + baseline bench ~48 s) | ~2.5 min | 2m10s | 2m18s |
| Phase 2 (5 parallel analysts A–E) | ~10 min | 24m50s (findings 36–42 KB each) | **9m52s** (findings 17–21 KB each; 5m54s–8m43s per analyst) |
| Phase 3 (synthesis + report to `docs/audits/`) | ~3.5 min | 11m06s (467-line report) | **3m37s** (297-line report) |
| **Kickoff → human approval gate** | **~19 min** | **41m** | **19m04s** |
| Phase 4 fix 1 (catalog snapshot cache + tests + quick bench) | ~6.5 min | 6m29s (`185b400`, mixed 29.5 req/s) | 7m19s (`440f828`, mixed 26.5 req/s; includes 2m11s loading Phase 4 skills/rules) |
| Phase 4 fix 2 (per-snapshot inverted search index) | ~3.5 min | 3m22s (`00f30e1`, mixed 117.5 req/s) | 3m06s (`e4cb8e4`, mixed 107.5 req/s) |
| Phase 4 fix 3 (SEC-112 auth optimization) | ~3.5 min | 3m31s (`0b8e614`, async `crypto.pbkdf2`, mixed 330 req/s, 3/4) | 2m32s code + tests (`api-key-auth.js`, HMAC verified-key cache; quick bench: mixed **500 req/s, 4/4**)¹ |
| Phase 5 (`bench --count 3` ~75 s + `test` + `check`) | ~3.5 min | 3m31s | ~2m (measured on R2's tree) |
| Phase 6 (update report + commit + delete `.agentwork/`) | ~2.5 min | 2m30s (`b8f5884`) | —¹ |
| **Approval → complete** | **~20 min** | **19m49s** | **~18–19 min** |
| Terminal commands (`run_command`) | — | 64 coordinator + 113 analysts = **177** | 38 coordinator (through fix 3) + 25 analysts = **63** |

¹ _After writing fix 3's implementation and 8 new SEC-112 unit tests (82/82 passing), Rehearsal 2's subagent hit an individual daily model quota cap (`429 RESOURCE_EXHAUSTED`) because two full 6-agent rehearsals had been run back to back in the same session. Running `bench:quick` and `bench --count 3` directly on Rehearsal 2's unmodified working tree produced the numbers below._

### 6.2 Final `--count 3` benchmark comparison

| Scenario (target) | Baseline | Rehearsal 1 (async `crypto.pbkdf2`) | Rehearsal 2 (verified-key HMAC cache) | Reference patches 1–3 |
|---|---|---|---|---|
| **search** (p95 ≤ 100 ms) | 8 req/s · p95 1,904 ms | 526.4 req/s · p95 43.9 ms (PASS) | **1,076.2 req/s · p95 25.9 ms (PASS)** | 1,294 req/s · p95 21.8 ms (PASS) |
| **product** (p95 ≤ 50 ms) | 15.2 req/s · p95 1,439 ms | 512.4 req/s · p95 42.2 ms (PASS) | **753.4 req/s · p95 36.6 ms (PASS)** | 993 req/s · p95 27.2 ms (PASS) |
| **cart** (p95 ≤ 150 ms) | 12 req/s · p95 1,852 ms | 153.6 req/s · **p95 155.5 ms (FAIL)** | **177.6 req/s · p95 128.9 ms (PASS)** | 227 req/s · p95 101.8 ms (PASS) |
| **mixed** (≥ 250 req/s, p95 ≤ 150 ms) | 10 req/s · p95 5,551 ms | 369.8 req/s · p95 124.0 ms (PASS) | **518.6 req/s · p95 125.8 ms (PASS)** | 596 req/s · p95 107.4 ms (PASS) |
| **Readiness** | **0/4** | **3/4** | **4/4** | **4/4** |
| **Heap MB across scenarios** | 6.3 → 6.7 MB | 27.4 → 31.6 → 34.7 → 38.0 MB | 25.8 → 31.1 → 35.8 → 42.9 MB | 37.5 → 54.6 MB |
| **Guardrails & tests** | 69/69 | 79/79 pass, 0 forbidden diffs | 82/82 pass, 0 forbidden diffs | 76/76 pass, 0 forbidden diffs |

### 6.3 What changed in the kit because of the rehearsals

1. **Phase 2 time box in the kickoff prompt ([prompts.md](prompts.md)):** untimed analysts wrote 36–42 KB each and ran 113 shell commands (25 min). Pointing analysts to their scope card and `.profiles/baseline/summary.md` by path, capping each at ≤ 2 measurements and ≤ 5 findings, cut Phase 2 to **9m52s** and Phase 3 to **3m37s** while still finding all 6 planted bottlenecks.
2. **Explicit SEC-112 cache sign-off in the approval prompt:** without guidance at the gate, Rehearsal 1 chose async `crypto.pbkdf2` (offloading to libuv's 4-thread pool still burned ~6 ms CPU/req and left cart p95 at 155.5 ms → **3/4**), whereas Rehearsal 2 chose a bounded HMAC verified-key cache and hit **4/4** (mixed 518.6 req/s, cart p95 128.9 ms).
3. **Pre-answering gate questions in the approval prompt:** both agents asked 4–5 questions at the gate (SEC-112 strategy, malformed-snapshot error policy, whether test call sites can be updated for signature changes, and whether to skip low-impact items). Answering them up front avoids a second round-trip during the live demo.
4. **Recording `baseline-quick` during the Hook ([run-of-show.md](run-of-show.md#1-hook-000004)):** comparing a 2 s `bench:quick` run against a 5 s full `baseline` caused `bench:compare` to print `Warning: runs are not directly comparable — duration differs: 5 vs 2` after every fix.
5. **Better catalog stat-key design (§2.1):** both rehearsal agents keyed the snapshot cache on `dev:ino:size:mtime:ctime` read from the **same file descriptor** (`openSync` + `fstatSync` + `readFileSync(fd)`), preventing a mid-read rename from pairing a new file's identity with old bytes, and negative-cached malformed files by identity so a bad publish still fails loudly without re-parsing 8 MB on every request.
6. **Quota management ([preflight-and-fallbacks.md](preflight-and-fallbacks.md)):** a single run dispatches 5 parallel subagents and executes ~65–90 model turns across all agents. Run your dress rehearsal the day before—not immediately before going on stage—and keep **Fallback E** (a copy pre-run to the approval gate) ready if your account has tight per-hour or daily quotas.

