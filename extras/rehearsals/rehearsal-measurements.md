# Rehearsal measurements (scratch notes)

## R1 — untimed kickoff A (original), rehearsal-run/
- start 08:32:23 (spawn)
- Phase 0 start 08:32:58 → Phase 1 start 08:35:16: kickoff→Phase 1 = 2m53s
- Phase 1: 08:35:16 → 08:37:26 = 2m10s (profile 33 s, bench 49 s)
- Phase 2: 08:37:26 → 09:02:16 = 24m50s
  - composing 5 analyst prompts inline (~53 KB of prompt text): 08:37:26 → 08:40:08 = 2m42s
  - analysts done: E 08:55:53 (15m45s after dispatch), A 08:59:52, C 09:00:28, B 09:00:38, D 09:02:16 (22m08s)
  - findings files 36–42 KB each (~200 KB total, ~5,000 words each)
  - one transient 429 RESOURCE_EXHAUSTED at 08:40:17
- Phase 3: 09:02:16 → gate message 09:13:22 = 11m06s (log "Phase 3 start" 09:03:43)
- kickoff → gate: 40m59s
- Report: 467 lines, 6,239 words, 43 KB. 19 findings (6 CRIT, 3 HIGH, 2 MED, 8 LOW) from 34 raw.
  - CRIT-001 snapshot (all 5 dims), CRIT-002 search (A+B+D+E), CRIT-003 KDF, CRIT-004 history ring (ranked #2!),
    CRIT-005 promotions (escalated), CRIT-006 cart I/O (escalated), HIGH-001 SKU map, HIGH-002 deep copy,
    HIGH-003 debug log, MED-001 UV_THREADPOOL_SIZE, MED-002 outbound timeouts. Skip LOW-001..008 (incl. "search
    result cache would game the bench").
  - Decisions asked at the gate: auth Option A (async pbkdf2, recommended) vs B (verified-credential cache, "needs
    SEC-112 sign-off"); test edit (await) approval; threadpool sizing; optional items; malformed catalog; missing SKU.
- Approval sent 09:14:13 (refined approval prompt, verbatim from prompts.md)

## R2 — time-boxed kickoff A, rehearsal-run-2/
- start 08:58:22
- Phase 0 start 08:59:11 → Phase 1 start 09:00:44: kickoff→Phase 1 = 2m22s
- Phase 1: 09:00:44 → 09:03:02 = 2m18s (profile 32 s, bench 46 s)
- Phase 2: 09:03:02 → ?
  - prompt authoring ~70 s (dispatched 09:04:23)
  - A 09:10:05 (5m54s), B 09:10:38 (6m27s), C 09:10:49 (6m38s), D 09:11:59 (7m48s), E ?
  - findings files 17–21 KB each
  - E 8m43s. Phase 2 total 9m52s.
- Phase 3: 3m37s. Gate at 09:17:36 (agent-reported); message 09:18:50. kickoff→gate 19m04s.
- Report: docs/audits/perf-analysis-flashmart-api-2026-09-28-0915.md. 10 findings (6 CRIT [3 escalated], 3 MED, 1 LOW).
  - Plan order: 1 catalog cache, 2 history ring(200), 3 getStockBatch, 4 loyalty Promise.all, 5 SKU/promo maps,
    6 auth = verified-key cache (HMAC of verified secret bound to hash/salt/iterations; revocation live; failures
    never cached) — default is Option B here (R1 defaulted to async pbkdf2!), 7 search inverted index (golden test),
    8 opt: drop clone + structured debug log. Skip: timeouts, multi-process (breaks SEC-112 revocation).
  - Decisions asked: SEC-112 cache approve? malformed catalog? history metric semantics? time box skip fix 8?
  - Rehearsal notes: Go-flavoured Phase 1; TS module suggests npx/lru-cache/piscina/fast-json-stringify/worker
    threads (wrong here: structuredClone 119 ms > parse); docs/audits vs docs/research_logs; dead "agent-protocols §3";
    findings file naming mismatch (key vs name); Dim C loads database-design-principles; §3.4 escalation → 6 CRIT/0 HIGH;
    duplicated measurement of the #1 hotspot; noisy concurrent micro-timings (48–85 ms); 9 scratch scripts left in
    .agentwork/. Suggests: phase0-context.md file, cap 5 findings / 1 page, reuse profile numbers, define convergence,
    warn presenter about gate questions.

## R1 Phase 4-6 (approval 09:14:13, agent logged receipt 09:14:39)
- fix-1 catalog: 09:14:39 → commit 09:21:08 = 6m29s (bench:quick 22 s). tests 73/73. quick: product 16→130.5, cart 11.8→85.5,
  search 8.4→17, mixed 10.4→29.5; 0/4. Stat key bigint dev:ino:size:mtimeNs:ctimeNs, fd-consistent load, deepFreeze,
  negative cache for malformed file, load log with loadMs. Correct.
- fix-2 search: 09:21:08 → 09:24:30 = 3m22s (bench:quick 12 s). tests 77/77. quick: search 136, mixed 117.5; 0/4 (KDF-bound).
- fix-3 auth (Option A async pbkdf2, re-read record after await + race test + event-loop test; tests only gained await):
  09:24:30 → 09:28:01 = 3m31s. quick: 3/4 (cart p95 178 FAIL); search 576.5 p95 42.1, product 447 p95 50, mixed 330 p95 138.8.
- Phase 4 total: 13m22s (approval → 3rd commit 09:28:01), 13m48s from approval message.
- Phase 5: 09:28:01 → 09:31:32 = 3m31s (bench --count 3 = 74 s). final: search 526.4 (p95 43.9), product 512.4 (42.2),
  cart 153.6 (155.5 FAIL), mixed 369.8 (p95 124). heap 27.4→31.6→34.7→38.0 MB. 3/4. tests 79/79.
- Phase 6: 09:31:32 → ?
- Phase 6: 09:31:32 → 09:34:02 = 2m30s (report updated + committed b8f5884 docs(perf); .agentwork removed)
- Approval → done: 19m49s. Verified: forbidden paths untouched; PERF: on each fix; DIGEST/KEY_LENGTH/params same; 79/79; check ok.
- R1 notes: quick-vs-full compare warning on every fix ("not directly comparable — duration differs: 5 vs 2") → added
  baseline-quick (Hook) to kickoff; loop histogram includes warm-up (one-time ~300 ms publish stall: 80 ms parse + 225 ms
  index build; showed as fix-2 search loop p99 360 ms); every catalog publish stalls the loop ~300 ms (new finding);
  Phase 5 has no re-profile step; Go wording (-race, -count=3, formatter/linter/scanner/build); TS module tools;
  javascript-idioms assumes Prettier/ESLint; testing-strategy says co-locate tests (repo uses test/); approved order
  renumbered fix labels; §3.4 mechanical escalation (µs items → HIGH); suggests adding CRIT-004/CRIT-006 to scope.
  Heap growth in final: +10.6 MB while history grew 19,196 entries (~0.55 KB/request).

## R2 Phase 4-6 (approval 09:33:50)
- Phase 4 start logged 09:36:01 (2m11s loading javascript-idioms skill + test/git/security rules first)
