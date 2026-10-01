# Example performance analysis reports

Two genuine reports produced by blind rehearsals of [`/perf-optimize`](../../flashmart-api/.agents/workflows/perf-optimize.md) on `flashmart-api/` (same 8-vCPU machine, offline, zero access to `solution/` or `presenter/`). Relative source links point to `../../flashmart-api/` at the `baseline` tag.

| File | Rehearsal | Kickoff | Kickoff → Gate | Report length | SEC-112 strategy | Final (`--count 3`) |
|---|---|---|---:|---:|---|---|
| [untimed-run-perf-analysis.md](untimed-run-perf-analysis.md) | Rehearsal 1 (completed Phases 0–6) | Plain kickoff (no Phase 2 time box) | 41 min | 616 lines | Option A: async `crypto.pbkdf2` | mixed 370 req/s, **3/4** (cart p95 155.5 ms > 150 ms) |
| [timeboxed-run-perf-analysis.md](timeboxed-run-perf-analysis.md) | Rehearsal 2 (Phase 3 gate report; fixes 1–3 verified) | Time-boxed Phase 2 kickoff (`presenter/prompts.md`) | **19 min** | 297 lines | Option B: verified-key HMAC cache | mixed 519 req/s, **4/4** (search 1,076, product 753, cart 178 req/s) |

## What to notice when skimming before your dry run

1. **Cross-dimension escalation (§3.4):** both runs flagged the 8 MB catalog `JSON.parse(readFileSync(...))` across all five dimensions (A–E) as `CRIT-001`.
2. **Why the approval prompt includes a conditional SEC-112 sign-off:** without explicit guidance, Rehearsal 1 defaulted to offloading PBKDF2 to libuv's thread pool (which left cart p95 at 155.5 ms → 3/4), whereas Rehearsal 2 recommended a bounded HMAC-digest verification cache (which hit 4/4).
3. **Why the approval prompt sets the fix order:** both reports ranked the unbounded request-history ring buffer (#2 in priority) ahead of search or auth because its risk is `LOW`. In a 60-minute slot you want the three throughput/latency fixes (`catalog`, `search`, `auth`) first so the deferred history leak remains visible in the final bench's `heap MB` column for Segment 9 ("the bottleneck moves").
