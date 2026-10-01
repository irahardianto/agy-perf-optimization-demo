# Copy-paste prompts

Paste these into the Antigravity agent panel **exactly** as written. Every prompt was written
against the `flashmart-api` repo at tag `baseline`.

> [!TIP]
> Keep this file open on a second screen (or in a pinned editor tab) during the session.
> The **bold** prompts are the ones you'll use in a normal run; the rest are for recovery.

---

## 1. Kickoff — start the workflow (≈ minute 10)

Use variant **A** unless `npm run doctor` showed that PowerShell blocks `npm`, in which case use
variant **B**.

### A. npm variant (default)

```text
/perf-optimize

Optimize the FlashMart API in this repo for the 11.11 sale (~10× normal traffic). `npm run bench` shows every scenario failing its 11.11 target; the targets and the operational requirements are in README.md.

This laptop is locked down, so use ONLY the tooling already in the repo:
- Offline: no npm install, no npx, no Docker, no new dependencies.
- Phase 1 profile: `npm run profile -- --label baseline`, then read `.profiles/baseline/summary.md` (CPU hot spots, hot lines, allocation hot spots, retained memory). Pass that file path to the Phase 2 analysts.
- Phase 1 baseline: `npm run bench -- --label baseline`. For Node.js, use req/s, p50/p95/p99 latency, event-loop delay p99 and heap MB in place of ns/op, B/op and allocs/op.
- Phase 4, after each fix: `npm test`, `npm run check`, `npm run bench:quick -- --label fix-<n>`, then `npm run bench:compare -- baseline-quick fix-<n>`. I recorded `baseline-quick` with the same quick settings before we started; if bench/results/baseline-quick.json is missing, run `npm run bench:quick -- --label baseline-quick` once first.
- Phase 5: `npm run bench -- --count 3 --label final`, then `npm run bench:compare -- baseline final`.

Every item under "Operational requirements" in README.md is non-negotiable (catalog freshness within 1 s, SEC-112, pricing rules, API contracts, and no changes to src/external/, bench/ or tools/perf/).

This is a live 60-minute demo, so keep Phase 2 tight. Give each analyst a compact prompt that points to its scope card in the perf-optimization skill and to .profiles/baseline/summary.md by path instead of pasting them. Tell each analyst to rely on the profile and the source, reuse the profile's numbers for the top hot spot (the analysts run at the same time, so their timings contend for CPU), run at most two short measurements, report at most 5 findings in about one page, and write its findings file within about 6 minutes.

Stop after Phase 3: show me the prioritized implementation plan and wait for my approval before changing any code.
```

### B. Direct-node variant (PowerShell blocks `npm`)

```text
/perf-optimize

Optimize the FlashMart API in this repo for the 11.11 sale (~10× normal traffic). `node bench/run.mjs` shows every scenario failing its 11.11 target; the targets and the operational requirements are in README.md.

This laptop is locked down: `npm` is blocked by the PowerShell execution policy, so call `node` directly and use ONLY the tooling already in the repo:
- Offline: no npm install, no npx, no Docker, no new dependencies.
- Phase 1 profile: `node tools/perf/profile.mjs --label baseline`, then read `.profiles/baseline/summary.md` (CPU hot spots, hot lines, allocation hot spots, retained memory). Pass that file path to the Phase 2 analysts.
- Phase 1 baseline: `node bench/run.mjs --label baseline`. For Node.js, use req/s, p50/p95/p99 latency, event-loop delay p99 and heap MB in place of ns/op, B/op and allocs/op.
- Phase 4, after each fix: `node scripts/test.mjs`, `node scripts/check.mjs`, `node bench/run.mjs --quick --label fix-<n>`, then `node bench/compare.mjs baseline-quick fix-<n>`. I recorded `baseline-quick` with the same quick settings before we started; if bench/results/baseline-quick.json is missing, run `node bench/run.mjs --quick --label baseline-quick` once first.
- Phase 5: `node bench/run.mjs --count 3 --label final`, then `node bench/compare.mjs baseline final`.

Every item under "Operational requirements" in README.md is non-negotiable (catalog freshness within 1 s, SEC-112, pricing rules, API contracts, and no changes to src/external/, bench/ or tools/perf/).

This is a live 60-minute demo, so keep Phase 2 tight. Give each analyst a compact prompt that points to its scope card in the perf-optimization skill and to .profiles/baseline/summary.md by path instead of pasting them. Tell each analyst to rely on the profile and the source, reuse the profile's numbers for the top hot spot (the analysts run at the same time, so their timings contend for CPU), run at most two short measurements, report at most 5 findings in about one page, and write its findings file within about 6 minutes.

Stop after Phase 3: show me the prioritized implementation plan and wait for my approval before changing any code.
```

> [!NOTE]
> Why the kickoff is this long: the workflow's Phase 1 examples are Go (`go-pprof.sh`,
> `ns/op`), and the TypeScript language module suggests `npx clinic` / `autocannon`, which fail
> offline. The prompt maps each phase to the repo's own Node tooling so the agent doesn't burn
> minutes discovering that.
>
> Why the "keep Phase 2 tight" paragraph: in an untimed rehearsal the coordinator spent ~2.7 min
> writing five full analyst prompts (scope cards pasted inline), and each analyst then ran dozens
> of its own measurements. The first findings file (~5,000 words) landed 18 minutes into Phase 2,
> twice the time this agenda can give it. The findings were excellent but far too long for a live
> audience. For a 90-minute or longer session, delete that paragraph and let the workflow run at
> full depth.
>
> With the paragraph, a second rehearsal reached the approval gate **19 minutes** after the
> kickoff (Phase 2: 9m52s, Phase 3: 3m37s; untimed: 41 minutes) and still found all six planted
> bottlenecks. The 5-finding cap and the "reuse the profile's numbers" hint were added afterwards,
> from that run's own feedback: its findings files were still 17–21 KB each, and all five analysts
> had re-measured the same hot spot at the same time.

---

## 2. Approval — the Phase 3 gate (≈ minute 23–25)

Approve **by theme, not by finding number**: the agent assigns its own IDs, so numbers are not
predictable. Read the plan aloud first and point at the severity and cross-dimension escalations.

The plan usually ends with a few **decisions**. Both rehearsal agents asked about the auth
approach, and one also asked about updating a test's call signature and about optional items. The
prompt below answers them in advance, so the agent doesn't stop to ask again on stage.

```text
Approved, with a reduced scope for this session. Implement only these three, in this order, as separate commits:
1. the catalog snapshot being re-read and re-parsed on every request,
2. search re-tokenizing every product on every request,
3. the per-request PBKDF2 API-key verification. SEC-112 sign-off: a bounded in-memory cache of successful verifications is approved, provided the KDF and its parameters stay exactly as they are, the raw secret is never stored, failed attempts are never cached, and revocation and key rotation still take effect on the very next request.

For any other open decision, go with your recommended default. If a fix changes a function signature, you may update existing tests to match, but don't weaken or remove any assertion. Mark every other finding as deferred under "Remaining opportunities" in the report. For each fix: test first, implement with a PERF: comment, run the tests, the checks and the quick benchmark with a compare against baseline, then commit. After the third fix, go straight to Phase 5 and Phase 6.
```

> [!IMPORTANT]
> **Why item 3 carries a security sign-off.** The two rehearsal agents picked *different* SEC-112
> strategies. One chose a cache of verified credentials; the other chose async `crypto.pbkdf2`,
> saying a cache "needs security sign-off". Async PBKDF2 frees the event loop but still spends
> ~5 ms of CPU per request. It finished at **3/4** (cart p95 155 ms against a 150 ms target) even
> on an 8-vCPU machine, and it will do worse on a 4-core laptop. The cache reaches 4/4 with
> margin. Say it out loud: *"The agent asked for a security decision. That's my job at the gate,
> and here are my conditions."* If the agent still goes async, see "the bottleneck moves" in
> [run-of-show.md](run-of-show.md#7-fixes-13-027041).

If you have **more** time than planned (the agent reached the gate before minute 20), use this
instead:

```text
Approved. Implement the plan in priority order, one commit per fix, starting with the catalog snapshot caching, search tokenization and API-key verification findings. For the API-key verification, a bounded in-memory cache of successful verifications is approved under SEC-112 with the conditions: KDF and parameters unchanged, no raw secrets stored, failures never cached, revocation and rotation effective on the next request. I'll tell you when to stop; when I do, finish the fix in progress, then run Phase 5 and Phase 6.
```

---

## 3. Recovery prompts

| Situation | Paste this |
|---|---|
| Agent tries `npx`, `npm install`, `clinic`, `autocannon`, `0x` | `We're offline — don't install anything. Use npm run profile and npm run bench from the README.` |
| Agent edits `bench/`, `tools/perf/` or `src/external/` | `Revert your changes to bench/, tools/perf/ and src/external/ — README "Operational requirements" 5 and 6 put them off-limits. Change how FlashMart calls the external clients instead.` |
| Agent proposes lowering PBKDF2 iterations / swapping the KDF | `Rejected — SEC-112 is non-negotiable (and the workflow's feedback loop says security concerns are rejected). Find a way that keeps the KDF and its parameters unchanged.` |
| A test goes red after a fix | Say nothing for a minute — let it read the failure. If it starts weakening the test: `Don't change the test; it encodes a README requirement. Change the implementation so it meets the requirement.` |
| Phase 2 subagents are still running at minute 24 | `Proceed to Phase 3 now with the findings already written in .agentwork/. Note any dimension that didn't finish in the report.` |
| Agent wants to run the full `--count 3` bench after every fix | `Use npm run bench:quick for per-fix measurements; keep --count 3 for Phase 5 only.` |
| Agent asks which findings to approve before the report is written | `Write the report to docs/audits/ first (Phase 3.6), then present the plan.` |
| Running out of time mid-Phase 4 | `Stop after the fix in progress. Commit it, then run Phase 5 (bench --count 3 --label final, compare against baseline) and update the report.` |
| Workflow does not appear as `/perf-optimize` | See the fallback in [preflight-and-fallbacks.md](preflight-and-fallbacks.md#workflow-not-found). As a last resort, start with: `Read .agents/workflows/perf-optimize.md and follow it exactly.` followed by the rest of the kickoff prompt. |

---

## 4. Optional audience prompts (Q&A / extra time)

```text
Explain, using the profile summary, why fixing the catalog caching made the heap numbers in the benchmark start climbing between scenarios.
```

```text
What would break if the catalog were loaded once at startup instead of revalidated? Show me which test proves it.
```

```text
Summarize the remaining opportunities from the report as a prioritized backlog for the next session.
```
