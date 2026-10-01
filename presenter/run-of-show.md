# Run of show — "From 10 req/s to 11.11-ready" (60 minutes)

**Format:** live demo on one projected laptop. The presenter narrates while the Antigravity agent
runs `/perf-optimize` on the `flashmart-api` repo. Timings come from two blind rehearsals on an
8-vCPU machine (see [answer-key.md §6](answer-key.md#6-rehearsal-observations)).

**Golden rule:** the agent's work is the show, and your job is to narrate it. Never sit in silence
waiting for a command. Every wait below comes with something to point at.

**Shape of the hour:** the agent starts at minute 4, and you explain the workflow *while* it works.
With the time-boxed kickoff, the rehearsal reached the approval gate **19 minutes** after the
kickoff. Phases 4–6 then took about **21 minutes**. The last ~9 minutes are recap, Q&A and buffer.

| Clock | Segment | You | Agent (rehearsal timing) | On screen |
|---|---|---|---|---|
| 0:00 | 1. Hook | 11.11 story, one request, quick bench (~35 s) | — | Terminal: 0/4 targets, p95 in seconds |
| 0:04 | 2. Kickoff | Paste Kickoff A | Reads the rules and the workflow | Agent panel |
| 0:05 | 3. Why a workflow | Walk the phases and the README guardrails | Phase 0 recon (~2.5 min), then Phase 1: profile (~30 s) + baseline bench (~50 s) | Workflow file / slide 5 |
| 0:10 | 4. Evidence | Open `.profiles/baseline/summary.md` | Starts Phase 2 (~1 min writing 5 analyst prompts) | Hot lines table |
| 0:13 | 5. Parallel analysis + the traps | Explain the dimensions, run the naive-fix demo, open the first findings file | Phase 2: 5 analysts, 6–9 min each | Subagent panel, terminal, `.agentwork/` |
| 0:23 | 6. Report + approval | Walk the report, make the SEC-112 call, paste the approval | Phase 3 (~3.5 min) → gate | `docs/audits/perf-analysis-*.md` |
| 0:27 | 7. Fixes 1–3 | Narrate test first, `PERF:` comments, compare after each fix | Phase 4 (~13 min: 6.5 / 3.5 / 3.5) | Diffs + compare tables |
| 0:41 | 8. Verify + ship | Final compare, `git log`, updated report | Phase 5 (~3.5 min) + Phase 6 (~4 min) | Before/after table |
| 0:48 | 9. The bottleneck moves | Heap column, optional 11-second re-profile | — | Heap MB climbing, new #1 hot line |
| 0:52 | 10. Recap + Q&A | Three takeaways. Q&A is your buffer | — | Slides 13–14 |

> [!IMPORTANT]
> **Decision points** (check the clock):
> - **0:09**: no profile running yet? Look for a pending "run this command?" prompt in the agent panel and allow it, or switch terminal execution to Turbo ([preflight](preflight-and-fallbacks.md#the-day-before-45-minutes)).
> - **0:25**: no report yet? Paste the "proceed to Phase 3" recovery prompt ([prompts.md](prompts.md#3-recovery-prompts)).
> - **0:36**: fewer than 2 fixes committed? Let the current fix finish, then send the "stop and verify" recovery prompt.
> - **0:45**: Phase 5 not started? Switch to [Fallback C](preflight-and-fallbacks.md#fallback-c-pre-baked-solution) (or D) and narrate the numbers yourself.

---

## 1. Hook (0:00–0:04)

**Say:** "FlashMart is a storefront API. 11.11 is six weeks away and marketing expects ten times
normal traffic. Here's the service today."

```bash
npm start
```

In a second terminal, show that a single request looks fine:

```bash
curl -s "http://127.0.0.1:3000/api/products/search?q=wireless+earbuds&limit=3" -H "x-api-key: fmk_web01.Vt8q2KfN4xLm7RcZ"
```

Stop the server (Ctrl+C), then:

```bash
npm run bench:quick -- --label baseline-quick
```

Keep that label: the kickoff prompt tells the agent to compare every fix against
`baseline-quick`, so the per-fix tables are like-for-like (quick vs quick). Without it,
`bench:compare` warns *"runs are not directly comparable — duration differs: 5 vs 2"* after
every fix.

At baseline the quick bench takes **~35 s**, because the slow requests are the point. Fill the wait:
"It starts its own server, fires 16 concurrent clients per scenario and measures latency and
event-loop delay. Same bench, same targets, before and after every fix."

**Point at:** `11.11 readiness: 0/4`, **~10 req/s**, p95 in **seconds**, `loop p99` in the hundreds
to thousands of ms. "One user: fine. Sixteen concurrent users: the event loop is drowning."

**Say:** "I could guess what's wrong, and so could an AI. Guessing is how you end up optimizing the
wrong thing. So let's not guess."

## 2. Kickoff (0:04–0:05)

Paste **Kickoff A** (or B on locked-down Windows) from [prompts.md](prompts.md). The bench must have
finished first: two benchmarks at once distort each other.

**Say while it starts:** "The prompt does three things. It maps the workflow's Go-flavoured
tooling to what this repo has, because the laptop is offline. It time-boxes the analysis to fit
this hour. And it makes the agent stop at the approval gate."

## 3. Why a workflow (0:05–0:10), while Phase 0 and Phase 1 run

Open `.agents/workflows/perf-optimize.md` (or show slide 5). The agent is reading the same file
right now. Cover it in about 4 minutes:

1. **Recon → Profile → Analyze → Synthesize → [human gate] → Implement → Verify → Document.**
2. **Measure first:** Phase 1 produces a profile and a baseline before anyone touches code.
3. **Parallel, orthogonal analysts:** one subagent per dimension (CPU, memory, I/O,
   concurrency, serialization). Different lenses find different problems.
4. **Severity + cross-dimension escalation:** if CPU *and* memory *and* I/O all point at the same
   function, it's critical.
5. **Human approval gate:** nothing changes until you approve the plan.
6. **Discipline in Phase 4:** test first, one fix per commit, a `PERF:` comment explaining the
   evidence, and a benchmark after every fix.

Then open README.md → **Operational requirements**. "These are the guardrails a real team has:
catalog changes visible within 1 second, a security-mandated KDF, pricing rules. A fast but wrong
fix is worse than a slow service. The tests enforce these."

**Glance back at the agent** once or twice. When it prints its dimension selection (*"A, B, C, D,
E active; F skipped: no bundles, Docker or build step"*), read it aloud.

## 4. Evidence (0:10–0:13)

By now the agent has run `npm run profile -- --label baseline` (~30 s) and
`npm run bench -- --label baseline` (~50 s). Open `.profiles/baseline/summary.md` yourself.

**Point at:**
- *Where the time went*: project code ~72%, **GC ~8.5%**.
- *Hot lines*: **one line, `JSON.parse(readFileSync(...))`, is ~48% of all CPU**.
- `tokenize` ~17%, `pbkdf2Sync` ~5%.
- *Allocation profile*: **~10 GB allocated in 30 s, ~40 MB per request**.

**Say:** "That's the value of Phase 1. We now know where the time goes instead of guessing."

## 5. Parallel analysis + the traps (0:13–0:23)

The first findings file lands about 6 minutes after the analysts start, and the last one about
9 minutes after. Use the wait in three parts.

**A. The five lenses (3 min).** Show the subagent panel: five analysts running at once.

| Dim | Lens | What it should find here |
|---|---|---|
| A | CPU | snapshot parse, search tokenization, PBKDF2, promotion scans |
| B | Memory | ~40 MB/request garbage, unbounded request history |
| C | I/O | sync file read per request, N+1 inventory calls |
| D | Concurrency | sync work blocking the event loop, sequential awaits |
| E | Serialization / data structures | JSON parse per request, linear `find`/`includes`, deep clone |

**B. The traps the agent must avoid (4 min).** "Before the agent proposes anything, here's what
the obvious fix would do." The helper rebuilds the baseline code in a temporary folder, swaps in
one naive file and runs the existing test suite there. Your working tree and the agent's work are
never touched.

```bash
node ../solution/naive/try-naive.mjs catalog-load-once --diff
```

**Point at:** the diff (parse once, keep forever: a three-line change), then
`CAUGHT: 2 of 69 tests fail` and *"product details did not reflect the new snapshot within
1.5 s"*. "A load-once cache is the obvious fix, and it silently breaks the catalog freshness
guarantee. Watch whether the agent falls for it."

Then every tempting shortcut at once (~15 s):

```bash
node ../solution/naive/try-naive.mjs --all
```

"Seven plausible performance fixes, seven red builds: an fs.watch cache, a search index keyed by
product count, two auth caches that skip the secret or the revocation check, promotions frozen
at load time, and 'just Promise.all everything'." The path assumes the kit layout
(`flashmart-api/` next to `solution/`). Run `--list` to see all variants.

**C. The first findings file (3 min).** When `.agentwork/findings-perf-*.md` appears, open it and
read one finding aloud (evidence → root cause → proposed fix).

**Filler if it's slow:** open the flame chart. Chrome DevTools → Performance → *Load profile* →
`.profiles/baseline/cpu.cpuprofile`. Or show `src/external/README.md` and explain the simulated
latency ("we can't change the warehouse API, only how we call it").

## 6. Report + approval (0:23–0:27)

Open `docs/audits/perf-analysis-*.md`. It is long, so jump with the editor's outline:
1. **Executive Summary:** baseline table and overall health. One rehearsal report had a line worth
   reading aloud: "reaching 250 req/s needs ≤ 4 ms of synchronous loop work per request; today it
   is ~84 ms."
2. **Cross-Dimension Correlations:** the catalog re-parse, flagged by all five dimensions.
3. **Implementation Priority Matrix:** point at the *Skip* items, which are micro-optimizations
   below the noise floor. "The workflow says no to those." One rehearsal agent also refused a
   search-result cache because it "would game the bench".
4. **Decisions needed:** usually the auth approach. "The agent is asking for a security
   decision. That's my job at the gate."

**Say:** "This is the human gate. We have about 15 minutes of fixing time, so I'll approve the top
three themes, give the SEC-112 sign-off with conditions, and defer the rest."

Paste the **Approval** prompt. Expect the agent's plan order to differ from the approval order
(one rehearsal ranked the request-history leak #2). The approval sets the order.

## 7. Fixes 1–3 (0:27–0:41)

Rehearsal timing: **6.5 min** for fix 1 (it loads a couple of skills first), then **~3.5 min**
each. For each fix, narrate these moments:

1. **Test first:** the new test fails (red), for example "an unchanged catalog file should not be
   re-parsed".
2. **The fix + `PERF:` comment:** open the diff. The comment cites the profiler evidence.
3. **Full test suite:** all green, including the guardrail tests.
4. **Quick bench + compare:** read the Δ% column aloud.
5. **Commit:** `perf(scope): …` with What / Why / Impact / Measurement.

Expected staircase (mixed scenario; your numbers will differ, but the ratios hold):

| After | Quick bench, rehearsal | Full bench (`--count 3`) | Readiness |
|---|---:|---:|---|
| baseline | 10 req/s | 10 req/s, p95 ~5.3 s | 0/4 |
| fix 1: catalog cache | 27–30 | 31, p95 ~2.0 s | 0/4 |
| fix 2: search index | 108–118 | 120, p95 ~0.5 s | 0/4 (auth now dominates) |
| fix 3: auth cache | 500 | 519–702, p95 ~93–126 ms | **4/4** |
| fix 3: async PBKDF2 instead | 330 | 370, p95 124 ms | 3/4 (cart p95 ~155 ms) |

**Teaching moments to call out if they happen:**
- The agent revalidates the cache by file `stat` instead of loading once. "It read the freshness
  requirement, and it didn't fall for the trap we just saw." (Rehearsal: a stat key of inode, size
  and nanosecond timestamps, checked on every call for ~5 µs.)
- The auth cache keeps checking revocation on every hit and never caches failures. "SEC-112
  intact."
- If a guardrail test goes red: **celebrate it.** "This is why the tests exist." Let the agent fix
  its own mistake.
- **If the agent chose async PBKDF2 anyway** (one rehearsal did), the final result is likely 3/4
  with cart just over target. Own it: "Three of four, and the report already says why: the cart
  still makes its external calls one after another. That's the next fix in the backlog." It's an
  honest demo of the bottleneck moving.

## 8. Verify + ship (0:41–0:48)

Phase 5: `npm run bench -- --count 3 --label final` (~75 s), the compare, then tests and checks.
While the bench runs, show `git log --oneline`: three `perf(...)` commits, one per fix.

**Point at** the compare table: ×-factors on req/s and the p95 drop, and the readiness line
(`0/4 → 4/4`). Then the updated report: optimizations applied (commit SHAs), skipped, remaining
opportunities.

Optional 60-second trust check (see [answer-key.md §4](answer-key.md#4-checking-the-agents-work-in-60-seconds)):
`git diff --stat baseline -- src/external bench tools/perf scripts` prints nothing.

## 9. The bottleneck moves (0:48–0:52)

In the final bench output, point at the **heap MB** column climbing from scenario to scenario
(rehearsal: 27 → 32 → 35 → 38 MB; reference run: 37.5 → 54.6 MB). "At 10 req/s, the unbounded
request history was invisible. At hundreds of req/s it's a memory leak. Fixing the CPU exposed it,
and it's already in the report's *remaining opportunities*." Show
`src/platform/request-history.js`.

If you have 30 more seconds, show that the CPU bottleneck moved too:

```bash
npm run profile -- --label after
```

It takes ~11 s now (31 s at baseline). Open `.profiles/after/summary.md`: the old #1 line (the
catalog `JSON.parse`, ~48%) is gone. The new #1 is `new Date(...)` inside the promotions check
(`src/pricing/promotions.js:8`, ~18%), then `skus.includes` (~14%). "Same workflow, next iteration."

## 10. Recap + Q&A (0:52–1:00)

Three takeaways:
1. **Evidence before edits:** the profile named the problem in 30 seconds.
2. **A workflow turns an agent into a disciplined engineer:** parallel analysis, a human gate,
   TDD, one fix per commit, measured impact.
3. **Guardrails make speed safe:** requirements live in tests, and security (SEC-112) is a human
   decision at the gate.

"Everything you saw is in github.com/irahardianto/awesome-agv. Drop `.agents/` into your repo and
type `/perf-optimize`."

The Q&A block is your buffer: if the agent ran late, cut it short. Likely questions and answers are
in [answer-key.md §5](answer-key.md#5-likely-audience-questions).
