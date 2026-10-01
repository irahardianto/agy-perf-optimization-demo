# Suggestions for awesome-agv

Notes from building this workshop kit and rehearsing `/perf-optimize` end to end on a Node.js
repo. They're ordered by impact on a live session. None of them is required for the workshop:
the kickoff prompt works around each gap.

## 1. Migrate workflows to skills before November 1, 2026

Antigravity retires workflows on Nov 1, 2026 in favour of skills, which are still invoked as
`/name`. `/migrate-workflows` converts them in place (it renames each original to `.md.bak`).
`extras/perf-optimize-skill/SKILL.md` in this kit is a migrated copy of `perf-optimize.md`: the
same body plus `name`/`description` front matter.

Two things don't carry over automatically and deserve a line in the README:

- `// turbo-all` has no effect in a skill. Auto-running commands then depends on the user's
  terminal policy (Turbo or an allow list).
- Skills are discovered by description, so the description should say *when* to use it
  ("profile-driven performance optimization with parallel dimension analysis and an approval
  gate"), not just what it is.

## 2. Make Phase 1 language-aware

Phase 1 names only `go-pprof.sh`, and the baseline is expressed as ns/op, B/op and allocs/op. On
a Node repo the agent has to improvise (the kickoff prompt tells it how). A dispatch table would
fix that:

| Language | Profile | Summarize for the agent | Baseline metrics |
|---|---|---|---|
| Go | `scripts/go-pprof.sh bench …` | built in | ns/op, B/op, allocs/op |
| Node / TS | `node --cpu-prof --heap-prof` | a zero-dependency summarizer (this kit's `tools/perf/analyze-cpuprofile.mjs` and `analyze-heapprofile.mjs` are ready to upstream) | req/s, p50/p95/p99, event-loop delay p99, heap after GC |
| Python | `python -m cProfile` + `tracemalloc` | `pstats` text sorted by cumulative/tottime | req/s, p95, peak traced memory |
| Java / Kotlin | JFR (`-XX:StartFlightRecording`) | `jfr print --events jdk.ExecutionSample` | ops/s (JMH), alloc rate |

The same applies to Phase 4 step 4 (`go test -race ./...`) and Phase 5 (`-count=3`): list the
per-language equivalents next to them.

## 3. Add a no-install path to `languages/typescript.md`

The module's toolchain (`clinic`, `autocannon`, `0x` via `npx`) fails on offline or locked-down
machines, and those are common at enterprise workshops. Everything needed is built into Node:
`--cpu-prof`, `--heap-prof`, `perf_hooks.monitorEventLoopDelay()`, `process.memoryUsage()` after
`--expose-gc`, plus a ~60-line keep-alive load generator on `node:http`. This kit's
`bench/` and `tools/perf/` show a complete version.

## 4. Capture invariants in Phase 0 and hand them to every analyst

The feedback loop rejects security-violating optimizations, but only *after* they've been
proposed. A Phase 0 step would stop them earlier: "list the non-negotiable requirements (README,
ADRs, SECURITY.md, `SEC-xxx` comments, freshness/consistency SLOs) and include them in every
Phase 2 prompt". Analysts then propose a digest-keyed auth cache instead of lowering PBKDF2
iterations, and a version-checked cache instead of load-once.

## 5. Add a cache-correctness checklist to the perf skill

Every naive variant in this kit (`solution/naive/`) is a caching or concurrency shortcut that
looks right and silently breaks a requirement:

- **What invalidates this cache?** Load-once and `fs.watch` on rename-over files both miss
  updates.
- **Is the key complete?** Keying by product count, or by key id without the secret.
- **What must still be checked on every hit?** Revocation, time windows, permissions.
- **Is time-dependent state frozen at build time?** Promotions filtered by "active now" when the
  index is built.
- **Is it bounded?** Unbounded caches and histories turn into leaks at high request rates.
- **Can concurrency change semantics?** A `Promise.all` that drops a data dependency, like
  shipping that needs stock.

Six bullets in `SKILL.md` would prevent most of them.

## 6. Distinguish quick and full benchmarks

Phase 4 says "benchmark immediately" and Phase 5 says `-count=3`. Say explicitly that per-fix
measurements may use a short run, with `-count=3` reserved for Phase 5. In a live session that
saves one to two minutes per fix, and agents otherwise sometimes run the full suite every time.

## 7. Report template: add "Requirements preserved"

Add a small table: fix → invariants it touched → test that proves each still holds. It turns
"trust me" into evidence, and it's the part reviewers care about most for performance changes.

## 8. What two blind rehearsals showed

Two blind runs of `/perf-optimize` on this kit's repo, offline and following the workflow
literally. Rehearsal 1 used the plain kickoff; rehearsal 2 added a Phase 2 time box. Both
produced excellent analyses: all six planted bottlenecks, correct and well-tested fixes, and no
guardrail broken. The friction was almost entirely about **time and volume**.

| | Rehearsal 1 (workflow as written) | Rehearsal 2 (time-boxed kickoff) |
|---|---|---|
| Kickoff → approval gate | 41 min | 19 min |
| Phase 2 | 24m50s, of which 2m42s writing analyst prompts | 9m52s, of which ~70 s writing prompts |
| Findings files | 36–42 KB each (~200 KB in total) | 17–21 KB each |
| Phase 3 | 11 min, 467-line report | 3.6 min, 297-line report |
| Terminal commands | 64 coordinator + 113 analyst | 38 coordinator (25 to gate) + 25 analyst |

Suggestions, most useful first:

1. **Add a depth knob to Phase 2**, e.g. `quick | standard | deep`. *Quick* = compact analyst
   prompts, at most 5 findings (about a page) per analyst, at most two measurements, ~6 minutes.
   Rehearsal 2 shows that *quick* still finds everything that matters on a codebase this size.
2. **Pass shared context by file, not inline.** Write Phase 0 recon, the baseline and the
   invariants to `.agentwork/phase0-context.md` and give analysts the path. Rehearsal 1's
   coordinator generated ~53 KB of prompt text before a single analyst started.
3. **Tell analysts they run concurrently.** All five re-measured the same #1 hot spot at the same
   time, and the contended timings for one `JSON.parse` ranged from 48 to 85 ms. Reuse the
   profile's numbers and measure only what a profile can't show (wall-clock waits, prototype
   equivalence).
4. **Define "converge" in §3.4.** On a small codebase every lens sees the same functions, so
   escalation produced 6 CRITICAL / 0 HIGH (rehearsal 2) and lifted µs-level items to HIGH
   (rehearsal 1). Suggest: escalate only when two or more analysts filed their *own* finding with
   impact above the noise floor, and never escalate LOW.
5. **Give the report template a "Decisions" section with a recommended default each**, so a bare
   "approved" is a complete answer. Both runs ended Phase 3 with 4–5 questions: auth strategy,
   editing test call sites for a signature change, malformed-file policy, metric semantics. The
   two runs also picked *different* SEC-112 strategies (async PBKDF2 vs a verified-credential
   cache) and scored 3/4 vs 4/4 as a result, which is exactly the kind of call a human should make.
6. **Make per-fix comparisons like-for-like.** Phase 4 compared 2-second quick runs against the
   5-second Phase 1 baseline, and `bench:compare` printed "not directly comparable" after every
   fix. Record a quick baseline in Phase 1 (this kit's Hook does that).
7. **Offer an optional re-profile in Phase 5.** "The next bottleneck is X" otherwise rests on a
   model. Here an 11-second `npm run profile -- --label after` shows it directly
   (`promotions.js:8` becomes the #1 hot line).
8. **Small inconsistencies the agents tripped over:**
   - `docs/audits/` (workflow) vs `docs/research_logs/` (SKILL.md step 2);
   - `findings-perf-{dimension-key}.md` vs the scope cards' names (`cpu`, `memory`, …);
   - the reference to "agent-protocols §3";
   - Dimension C's scope card loads `database-design-principles.md` even when there's no
     database;
   - `javascript-idioms` assumes Prettier/ESLint, and `testing-strategy` says to co-locate tests
     while many repos use `test/`;
   - Phase 4/5 wording is Go-only (`-race`, `-count=3`, "formatter, linter, security scanner,
     build");
   - analysts left 9 scratch scripts in `.agentwork/` (Phase 6 cleans it, but naming a location
     for them would help).
9. **Expect the first fix to be the slowest.** About 4–5 minutes passed between approval and the
   first edit in both runs. That time went on reading the git, testing and security rules plus an
   idiom skill (1–2 minutes), then writing the first test and fix. Fixes 2 and 3 took ~3.5 minutes
   each. A leaner "Phase 4 loads" list in the workflow would trim the first part.
