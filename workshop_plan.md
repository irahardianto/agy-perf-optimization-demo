# Workshop plan: "From 10 req/s to 11.11-ready"

**Application performance optimization with Google Antigravity and `/perf-optimize`, in 60 minutes.**

A live demo: the Antigravity agent runs your
[`perf-optimize`](https://github.com/irahardianto/awesome-agv/blob/main/.agents/workflows/perf-optimize.md)
workflow on a realistic Node.js API that falls over under load. The audience watches it profile,
send out five parallel analysts, stop at a human approval gate, and fix the top three bottlenecks
test-first. Mixed traffic goes from **~10 req/s to ~600 req/s**, the 11.11 readiness score goes
from **0/4 to 4/4**, and no guardrail breaks along the way.

> [!IMPORTANT]
> **Fits the locked-down laptop.** The demo needs only **Node.js ≥ 18.18 and git**. There are zero
> npm dependencies, no Docker and no database, and nothing touches a package registry. Only the
> Antigravity agent itself needs the network. The kit handles Windows (PowerShell blocking `npm`,
> `curl` aliases, CRLF) and very old git versions.

The complete kit is in this repository (see [README.md](README.md)). It was validated with **two blind end-to-end rehearsals**
(§6). Several prompts and timings below changed because of them.

---

## 1. What the audience takes away

1. **Evidence before edits.** A 30-second profile shows that one line is 48% of all CPU. Nobody
   guesses.
2. **A workflow turns an agent into a disciplined engineer:** orthogonal parallel analysis,
   severity with cross-dimension escalation, a human gate, TDD, one fix per commit, and measured
   impact after every step.
3. **Guardrails make speed safe.** Requirements live in tests. Seven tempting "fast" fixes each
   turn the suite red, and the security decision is made by a human at the gate.

## 2. The scenario: FlashMart before its 11.11 mega sale

FlashMart's storefront API (catalog search, product details, cart pricing) has to take **10×
normal traffic** in six weeks. Today one request is fast, but 16 concurrent users drown the event
loop: **~10 req/s, p95 in seconds, 0 of 4 targets met.**

| Scenario (16 connections) | 11.11 target | Baseline |
|---|---|---|
| search | p95 ≤ 100 ms | ~8 req/s, p95 ~2–4 s |
| product | p95 ≤ 50 ms | ~16 req/s, p95 ~1 s |
| cart | p95 ≤ 150 ms | ~12 req/s, p95 ~1.8 s |
| mixed | ≥ 250 req/s and p95 ≤ 150 ms | ~10 req/s, p95 ~5.3 s |
| all | event-loop p99 ≤ 50 ms, no errors | loop p99 ~0.9–1.9 s |

**Guardrails** (README "Operational requirements", most of them enforced by tests): catalog
changes visible within 1 s; **SEC-112**, meaning PBKDF2-SHA512 with fixed parameters and
immediate revocation; pricing rules; API contracts; and no edits to `src/external/`, `bench/` or
`tools/perf/`.

**Planted bottlenecks.** Each one is natural-looking code, and each maps to a teaching beat:

| # | Bottleneck | Dimensions | Teaching beat |
|---|---|---|---|
| 1 | 8 MB catalog JSON re-read and re-parsed on every request (48% of CPU) | A B C D E | *Measure first*; cross-dimension escalation to CRITICAL |
| 2 | Search re-tokenizes 12,000 products per query | A B E | Algorithm + allocation → inverted index |
| 3 | PBKDF2 (SEC-112) on every request, synchronously | A D | **Human gate:** a security decision |
| 4 | Promotion scan with `new Date()` in a loop | A E | Invisible at baseline, **#1 after the fixes** ("the bottleneck moves") |
| 5 | Cart: N+1 stock calls, sequential awaits | C D | Concurrency without breaking data dependencies |
| 6 | Unbounded request history | B | Invisible at 10 req/s, **a leak at hundreds** (heap column climbs) |
| 7–9 | Linear `find`, deep clone, eager debug log | A B E | The report's **Skip** list: below the noise floor |

## 3. The hour

The agent starts at minute 4, and you explain the workflow *while* it works. Full script, with
what to say and what to point at, is in
[presenter/run-of-show.md](presenter/run-of-show.md).

| Clock | Segment | Agent (rehearsal timing) | You |
|---|---|---|---|
| 0:00 | Hook | — | Story, one request, `bench:quick` → **0/4** |
| 0:04 | Kickoff | Reads rules + workflow | Paste the kickoff prompt |
| 0:05 | Why a workflow | Phase 0 recon, then Phase 1: profile + baseline (~5 min) | Walk the phases and guardrails |
| 0:10 | Evidence | Starts Phase 2 | Open the profile summary: **one line = 48% of CPU** |
| 0:13 | Parallel analysis + the traps | Phase 2: 5 analysts (~10 min) | Explain the lenses; run the **naive-fix demo** (7 shortcuts, 7 red builds) |
| 0:23 | Report + approval | Phase 3 (~3.5 min) → **gate** | Walk the report; give the SEC-112 sign-off; approve 3 fixes |
| 0:27 | Fixes 1–3 | Phase 4 (~13–15 min) | Narrate test first, `PERF:` comments, compare after each fix |
| 0:41 | Verify + ship | Phases 5–6 (~6 min) | Final compare: **0/4 → 4/4**, `git log`, report |
| 0:48 | The bottleneck moves | — | Heap climbing (leak), optional 11 s re-profile (new #1 hot line) |
| 0:52 | Recap + Q&A | — | Three takeaways. Q&A doubles as buffer |

**Decision points:** 0:09 (no profile yet → check for a pending command-approval prompt), 0:25
(no report → recovery prompt), 0:36 (< 2 fixes → stop and verify), 0:45 (no Phase 5 → Fallback C).

## 4. The kit

| Path | For | Contents |
|---|---|---|
| [README.md](README.md) | You | Layout, setup, reading order, helper commands |
| [flashmart-api/](flashmart-api/README.md) | **Projected** (the Antigravity workspace) | Demo repo at tag `baseline`: API, 69 requirement-encoding tests, bench with 11.11 targets, zero-dependency profiler with text summaries, doctor, reset, awesome-agv `.agents/` |
| [presenter/run-of-show.md](presenter/run-of-show.md) | You | Minute-by-minute script |
| [presenter/prompts.md](presenter/prompts.md) | You | Kickoff (npm / direct-node), approval with SEC-112 sign-off, recovery prompts |
| [presenter/preflight-and-fallbacks.md](presenter/preflight-and-fallbacks.md) | You | Checklists, Antigravity settings, workflow-retirement fix, Fallbacks A–E, Windows notes |
| [presenter/answer-key.md](presenter/answer-key.md) | You (never on screen) | Every planted issue, correct fixes, traps, 60-second verification, Q&A, rehearsal observations |
| [presenter/slides-outline.md](presenter/slides-outline.md) | You | 14 slides + 3 backups (the agent is the show) |
| `solution/` | You | 6 reference fix patches plus an `apply-patches.mjs` helper, the naive-fix demo (`try-naive.mjs`, 7 variants), recorded bench results and profiles, two example reports from the rehearsals |
| `extras/` | You / organizers | Python-track notes, awesome-agv improvement suggestions (with rehearsal evidence), the workflow migrated to a skill |

## 5. Preparation

| When | What | Time |
|---|---|---|
| **Now** | Settle the open decisions in §8, especially the **workshop date vs Nov 1, 2026** | — |
| As soon as you have the laptop | Unzip, `npm run setup`, `npm run doctor`, open `flashmart-api/` in Antigravity, check that `/perf-optimize` is listed, and set terminal auto-execution to Turbo | 15 min |
| Day before | Full dress rehearsal with the real model and a timer, then `npm run reset -- --yes` | 60 min |
| 1 hour before | Power mode, close CPU hogs, clean tree, doctor passes, tabs open. Optional: [Fallback E](presenter/preflight-and-fallbacks.md) (pre-run a copy to the gate) | 10–30 min |
| 5 minutes before | New agent conversation, right model, auto-execution on, terminals ready, clock visible | 5 min |

## 6. Rehearsal evidence

Two blind rehearsals on an 8-vCPU machine. The agent played Antigravity with the repo's `.agents/`
rules, skills and workflow, offline, with no access to the answer key.

| | Rehearsal 1: kickoff without time box | Rehearsal 2: time-boxed kickoff |
|---|---|---|
| Kickoff → approval gate | 41 min (Phase 2 alone: 25 min) | **19 min** (Phase 2: 10 min) |
| Findings | All 6 planted issues; 467-line report | All 6 planted issues; 297-line report |
| Auth strategy chosen | async PBKDF2 | verified-credential HMAC cache |
| Approval → fixes 1–3 | 13m22s (19m49s through Phase 6) | **12m57s** for all 3 fixes + tests (~18–19 min total) |
| Final (`bench --count 3`) | mixed 370 req/s, **3/4** (cart p95 155 ms) | mixed **519 req/s, 4/4** (search 1,076, product 753, cart 178 req/s) |
| Guardrails | 79/79 tests, no forbidden path touched, KDF untouched | 82/82 tests, no forbidden path touched, KDF untouched |

**What changed in the kit because of the rehearsals:**
- The kickoff now **time-boxes Phase 2**: compact analyst prompts, at most 5 findings each, reuse
  the profile's numbers. This took kickoff-to-gate from 41 to 19 minutes.
- The approval prompt gives an **explicit, conditional SEC-112 sign-off** for a cache of verified
  credentials. The two agents picked different strategies, and the async one ended at 3/4.
- It also pre-answers the gate questions both agents asked (test signature edits, defaults).
- The Hook's bench is saved as `baseline-quick`, so the agent's per-fix compares are like-for-like
  instead of warning "not directly comparable".
- The agenda moved: kickoff at 0:04 instead of 0:10, the workflow explained during Phases 0–1,
  and the naive-fix demo filling the Phase 2 wait.
- Found and fixed a bug in the manual workflow-to-skill migration steps: `git commit -am` would
  have left the new skill untracked, and reset would have deleted it.

## 7. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Phase 2/3 overrun (slow model, quota: five analysts call the model at once) | Time-boxed kickoff; 0:25 recovery prompt; **Fallback E** (a copy pre-run to the gate) |
| Agent picks async PBKDF2 → 3/4 | SEC-112 sign-off in the approval; if it happens anyway, narrate "the bottleneck moves" (the cart's sequential calls are already in the report) |
| Slow or throttling laptop | Doctor speed check; smaller catalog (`seed --products 6000`); power settings; **Fallback D** (recorded results, runs nothing) |
| Agent stops for approval on every command (~75 commands per run) | Turbo / allow list (preflight step 7) |
| `/perf-optimize` not found (wrong root, or workflows retired) | Open `flashmart-api/` itself; migration steps + `git tag -f baseline`; last-resort "read the workflow file" prompt |
| PowerShell blocks `npm` | Kickoff B (direct `node` commands) |
| A fix breaks a guardrail | Celebrate the red test; recovery prompt "don't change the test"; one commit per fix makes it easy to revert |
| Only 1 fix done at 0:36 | **Fallback B** applies the reference patches for the rest (`apply-patches.mjs 2 3`) |
| Agent goes off the rails | **Fallback C**: reference fixes on a `prebaked` branch in one command |

## 8. Open decisions for you

1. **Workshop date vs November 1, 2026.** Antigravity retires workflows in favor of skills on
   that date. If the session is later (or your build already dropped workflows), migrate once
   with `/migrate-workflows`, or use the manual steps in
   [preflight](presenter/preflight-and-fallbacks.md).
   It's still invoked as `/perf-optimize`, but `// turbo-all` stops applying.
2. **The laptop:** OS, core count and Node version. Run `npm run doctor` on it early. On 4 cores,
   expect lower absolute numbers; the ratios and the 0/4 → 4/4 story hold with the cache fix.
3. **Model:** rehearse with exactly the model you'll present with. Weaker models skip phases or
   subagents.
4. **Scope:** 3 fixes fit 60 minutes. With 90 minutes, delete the time-box paragraph and use the
   "more time" approval, so the agent also fixes the history leak, promotions and cart I/O.
5. **Python:** the kit is Node-only by design, because Node is the more reliable demo on a locked-down
   laptop. [python-track-notes.md](extras/python-track-notes.md)
   maps every piece to the Python stdlib if you want a twin later.
6. **Demo-only or hands-on:** the kit supports attendees repeating it (`README.md`, doctor, reset),
   but a hands-on version needs about 90 minutes and a model quota per attendee.
