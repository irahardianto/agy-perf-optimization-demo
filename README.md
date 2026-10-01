# Workshop kit: "From 10 req/s to 11.11-ready"

A 60-minute live demo of **application performance optimization with Google Antigravity**,
driven by the [`/perf-optimize`](https://github.com/irahardianto/awesome-agv/blob/main/.agents/workflows/perf-optimize.md)
workflow from awesome-agv. The agent profiles a slow Node.js API, runs parallel analysts, stops
at a human approval gate, then fixes the top three bottlenecks test-first. Mixed traffic goes from
~10 req/s to ~600–700 req/s and every 11.11 target turns green, with no guardrail broken.

Built for locked-down laptops: **Node.js ≥ 18.18 and git only.** No Docker, no database, no
`npm install`, no network.

## Layout

| Path | Audience | What it is |
|---|---|---|
| `flashmart-api/` | **Projected.** Open it as the Antigravity workspace | The demo repo: zero-dependency Node API with planted bottlenecks, tests that encode the operational requirements, bench, profiler, and awesome-agv's `.agents/` (rules, skills, `/perf-optimize` workflow). Tag `baseline` = starting point |
| `presenter/` | Presenter only | Run of show, copy-paste prompts, preflight checklist and fallbacks, answer key, slide outline |
| `solution/` | Presenter only (**never** inside the workspace) | Reference fixes as patches, the naive-fix guardrail demo, recorded bench results and profiles, and two example reports written by blind rehearsal runs |
| `extras/` | Presenter / organizer | Python-track notes, awesome-agv improvement suggestions, a skill version of the workflow |

`solution/` and `presenter/` sit **next to** `flashmart-api/` on purpose: the agent can't
see the answer key from its workspace, and the helper scripts find the repo via `../`.

## Setup (first time, ~5 minutes)

1. Clone this repository (or unzip it anywhere), keeping the four folders side by side.
2. In a terminal:

   ```bash
   cd flashmart-api
   npm run setup      # generates data/ offline (~2 s) and ensures the baseline git tag
   npm run doctor     # checks Node, git, data, machine speed, tests, server
   ```

   On Windows, if PowerShell blocks `npm`, use `npm.cmd run setup` or `node scripts/seed.mjs`
   (every npm script is a thin `node` wrapper; see the repo README).
3. Open `flashmart-api/` as the workspace in Antigravity and check that `/perf-optimize` shows up
   in the slash-command list. If it doesn't, see
   [preflight-and-fallbacks.md → workflow not found](presenter/preflight-and-fallbacks.md#workflow-not-found).
4. Do one full dry run with the real model, then reset:

   ```bash
   npm run reset -- --yes     # back to the baseline tag; keeps data/
   ```

The repo uses git's classic `files` ref format, so any git version can read it.

## Read in this order

1. [presenter/run-of-show.md](presenter/run-of-show.md): the minute-by-minute script, with what
   to say and what to point at while the agent works.
2. [presenter/prompts.md](presenter/prompts.md): kickoff, approval and recovery prompts to paste.
3. [presenter/preflight-and-fallbacks.md](presenter/preflight-and-fallbacks.md): day-before,
   one-hour and five-minute checklists, Antigravity settings, and fallbacks A–E.
4. [presenter/answer-key.md](presenter/answer-key.md): every planted issue, the correct fix, the
   traps, verification commands, rehearsal observations and Q&A.
5. [presenter/slides-outline.md](presenter/slides-outline.md): 14 slides plus 3 backups.
6. [solution/example-report/](solution/example-report/): what the agent's Phase 3/6 report looks
   like, from an untimed and a time-boxed rehearsal. Skim one before your dry run.

## Helpers (run from inside `flashmart-api/`)

| Command | What it does |
|---|---|
| `node ../solution/naive/try-naive.mjs --list` | Lists the 7 "obvious" fixes that break a requirement |
| `node ../solution/naive/try-naive.mjs catalog-load-once --diff` | Guardrail demo: runs the test suite against baseline + one naive file in a temp folder (your tree is untouched) and shows which requirement test catches it |
| `node ../solution/naive/try-naive.mjs --all` | All 7 naive fixes, 7 red builds (~15 s) |
| `node ../solution/apply-patches.mjs --list` | Lists the 6 reference fixes |
| `node ../solution/apply-patches.mjs --branch prebaked 1 2 3` | Fallback C: applies reference fixes 1–3 as commits on a new branch from `baseline` |
| `node bench/compare.mjs ../solution/results/bench/baseline.json ../solution/results/bench/fix3-final.json` | Fallback D: recorded before/after table, runs nothing |

Recorded numbers (bench staircase, profiles before and after) are in
[solution/results/staircase.md](solution/results/staircase.md).

## Reset between runs

```bash
git checkout main          # only if you used Fallback C
npm run reset -- --yes
npm run doctor
```
