# Preflight checklist and fallbacks

Everything that has to be true before you go on stage, plus what to do when it isn't. The
laptop only needs **Node.js ≥ 18.18 and git**. The repo has zero dependencies and never touches
a package registry. The Antigravity agent itself still needs internet access to reach its model.

---

## The day before (45 minutes)

1. **Unzip the kit** to a short path without spaces, e.g. `C:\ws\perf-workshop-kit` or
   `~/ws/perf-workshop-kit`. Keep `flashmart-api/` and `solution/` side by side: the helper
   commands use `../solution/...`.
2. **Tools:** `node --version` (≥ 18.18; 20 or 22 LTS recommended) and `git --version`.
3. **Seed and check** from `flashmart-api/`:

   ```bash
   npm run setup      # generates data/ (12,000 products, 300 promotions), ~2 s
   npm run doctor     # must end with "Ready. 0 failure(s)"
   ```

   If PowerShell blocks `npm` (*"running scripts is disabled on this system"*), use
   `npm.cmd run doctor` or `node scripts/doctor.mjs`, and plan to use **Kickoff B** in
   [prompts.md](prompts.md).
4. **Read the doctor's machine-speed line** (`catalog read+parse … ms · PBKDF2 … ms`):
   - About 55 ms / 6 ms: the timings in [run-of-show.md](run-of-show.md) hold.
   - Doctor warns about a slow machine (parse > 160 ms): shrink the catalog so the baseline
     phase doesn't eat your clock. Then re-run the doctor.

     ```bash
     node scripts/seed.mjs --products 6000 --promotions 150 --force
     ```

5. **Open `flashmart-api/` itself as the Antigravity workspace** (not the kit folder), so that
   `.agents/` is discovered.
6. **Check the workflow is visible:** type `/` in the agent panel. `perf-optimize` should be
   listed. If it isn't, go to [Workflow not found](#workflow-not-found).
7. **Agent settings** (names vary slightly between Antigravity versions):
   - *Terminal command auto execution* → **Turbo**, or keep your policy and add `node`, `npm`,
     `npm.cmd` and `git` to the allow list. The rehearsals ran **~45–65 coordinator commands plus
     ~25 analyst commands** with the time-boxed kickoff (177 in total without the time box).
     Approving them one by one is not an option on stage. The workflow's `// turbo-all` only works
     if your policy allows it, and it doesn't apply once the workflow is migrated to a skill.
   - *Review policy / planning mode:* the workflow has its own approval gate. If the agent
     pauses right after the kickoff to have its own plan reviewed, reply `Proceed with the
     workflow.` or switch to a mode that doesn't request review.
   - *Model:* use the most capable model you have, and rehearse with the same model you'll
     present with. Weaker models tend to skip phases or subagents.
   - *Quota:* Phase 2 sends five subagents to the model at once, and a full run makes ~70–100 model
     turns across the coordinator and analysts. Rehearsal 1 hit one transient rate-limit (auto-retried),
     and running two full rehearsals back-to-back exhausted an individual daily quota at the end of
     Rehearsal 2's third fix. Do your dress rehearsal the day before (not the hour before), and if
     your plan has tight quotas, prepare [Fallback E](#fallback-e-pre-run-to-the-gate).
8. **Full dress rehearsal** with a timer: run the whole [run-of-show.md](run-of-show.md) once.
   Note your own timings next to the reference ones. Then reset:

   ```bash
   npm run reset -- --yes     # back to the baseline tag; deletes .agentwork/, docs/audits/, .profiles/, bench/results/*.json
   ```

9. **Pre-bake a safety copy of Phase 1** (≈ 80 s) and keep it **outside** the repo, because reset
   deletes `bench/results/` and `.profiles/`:

   ```bash
   npm run profile -- --label baseline
   npm run bench -- --label baseline
   # copy .profiles/baseline/ and bench/results/baseline.json to ../prebaked/, then:
   npm run reset -- --yes
   ```

10. **Guardrail helper smoke test** (15 s, never touches your working tree):
    `node ../solution/naive/try-naive.mjs --all` should print `7/7 naive variants are caught`.
    On Windows, `catalog-fs-watch` may show *NOT CAUGHT*. That's expected (see the note it prints).
11. **Optional:** Chrome, for flame charts (DevTools → Performance → *Load profile* →
    `.profiles/baseline/cpu.cpuprofile`).

## One hour before

- **Power:** plug in, and set the power mode to *Best performance* (Windows) or turn off *Low Power
  Mode* (macOS). Laptops throttle on battery, and benchmark numbers drop by 30–50%.
- **Close CPU hogs:** browser tabs, sync clients, and any video-call app on the demo laptop if you
  can (present from a second machine).
- In `flashmart-api/`: `git status` is clean, `git log --oneline -1` shows the `baseline` commit,
  and `npm run doctor` passes.
- **Open tabs:** `README.md` (Operational requirements), `.agents/workflows/perf-optimize.md`, and
  `src/platform/request-history.js` for segment 9.
- Put [prompts.md](prompts.md) and [run-of-show.md](run-of-show.md) on the second screen or a
  tablet.
- Increase the terminal and editor font size. Two terminals, both in `flashmart-api/`.

## Five minutes before

- Start a **new** agent conversation with the right model selected and auto-execution on.
- Terminal 1: `npm start` ready to type. Terminal 2: the `curl` command from the Hook ready.
- `bench/results/` is empty (fresh reset). The Hook's `npm run bench:quick -- --label
  baseline-quick` records the quick baseline that the agent compares every fix against.
- A visible clock or timer. The decision points are at **0:09, 0:25, 0:36 and 0:45**.

---

## Workflow not found

**Symptom:** `/perf-optimize` doesn't autocomplete, or the agent says it doesn't know it.

1. **Wrong workspace root.** Open `flashmart-api/` itself, not its parent folder.
2. **Workflows retired in your Antigravity build.** Workflows are deprecated in favour of skills
   and scheduled to stop working on **November 1, 2026**. Either:
   - run `/migrate-workflows` if your build offers it (it converts
     `.agents/workflows/*.md` into skills and archives the originals), or
   - do it by hand from `flashmart-api/` (`extras/perf-optimize-skill/SKILL.md` has the same
     content as the workflow, with skill front matter):

     ```bash
     mkdir -p .agents/skills/perf-optimize
     cp ../extras/perf-optimize-skill/SKILL.md .agents/skills/perf-optimize/SKILL.md
     git rm -q .agents/workflows/perf-optimize.md
     git add .agents/skills/perf-optimize/SKILL.md
     ```

   Skills are still invoked as `/perf-optimize`. Commit the change before the session and
   **re-tag**, because reset and the helpers rely on the `baseline` tag. Either path leaves new,
   untracked files, and reset's `git clean` deletes anything that isn't committed:

   ```bash
   git add -A .agents
   git commit -m "chore: migrate perf-optimize to a skill"
   git tag -f baseline
   ```
3. **Last resort:** start the kickoff with
   `Read .agents/workflows/perf-optimize.md and follow it exactly.` (after a migration:
   `.agents/skills/perf-optimize/SKILL.md`) instead of `/perf-optimize`, followed by the rest of
   the kickoff prompt.

---

## Fallbacks

Pick the lightest one that saves the session. All of them keep the agent's work intact.

### Fallback A: recovery prompts

For a stuck or wandering agent, use the table in [prompts.md §3](prompts.md#3-recovery-prompts).
Always try this first.

### Fallback B: finish the fixes with reference patches

**When:** at the 0:36 decision point only one fix is committed.

1. Let the agent finish and commit the fix in progress, then send the "stop and verify" recovery
   prompt, or stop the agent.
2. Apply the reference commits for the remaining approved fixes:

   ```bash
   node ../solution/apply-patches.mjs 2 3     # works in bash, cmd and PowerShell
   npm test
   ```

   Each patch touches only its own source file and test. If the agent already changed the same
   file, `git am --3way` usually still merges. If it can't, the helper tells you to run
   `git am --abort`; then leave that fix out.
3. Run Phase 5 yourself: `npm run bench -- --count 3 --label final`, then
   `npm run bench:compare -- baseline final`.

**Say:** "These are the commits the same workflow produced in rehearsal: test first, `PERF:`
comment, one commit per fix."

### Fallback C: pre-baked solution

**When:** at 0:45 Phase 5 hasn't started, or the agent went off the rails.

```bash
git stash -u                                            # only if there are uncommitted changes
node ../solution/apply-patches.mjs --branch prebaked 1 2 3
npm test
npm run bench -- --label prebaked                       # ~30 s (--count 3: ~75 s)
npm run bench:compare -- baseline prebaked
```

This needs `bench/results/baseline.json`, from the agent's Phase 1 or your pre-baked copy. If
it's missing, compare against the recorded baseline and say that it comes from a different
machine: `npm run bench:compare -- ../solution/results/bench/baseline.json prebaked`.

The agent's commits stay on `main` (`git log main`). Switch back with `git checkout main`.

### Fallback D: recorded results

**When:** the laptop can't benchmark reliably (thermal throttling, a video call hogging the CPU)
or time is up. Nothing is executed except a table formatter:

```bash
node bench/compare.mjs ../solution/results/bench/baseline.json ../solution/results/bench/fix3-final.json
```

Then open `../solution/results/profiles/after-fix3/summary.md` ("the bottleneck moves") and the
rehearsal reports in `../solution/example-report/`. All reference numbers are in
[staircase.md](../solution/results/staircase.md).

### Fallback E: pre-run to the gate

**When:** you're worried about model quota, a slow model or conference Wi-Fi. Phases 0–3 are the
part of the demo with the most variance, and this is the insurance for them. Prepare it 30–60
minutes before the session, on the demo laptop.

1. Right after a reset, copy the whole repo folder next to the original, so `../solution/` still
   resolves. A plain copy keeps `data/` and the repo-local git settings (commit identity, line
   endings), which a `git clone` would lose:

   ```bash
   cp -r flashmart-api flashmart-api-prerun            # PowerShell: Copy-Item -Recurse flashmart-api flashmart-api-prerun
   cd flashmart-api-prerun && npm run bench:quick -- --label baseline-quick
   ```

2. Open `flashmart-api-prerun/` as a second Antigravity workspace, paste the same kickoff, and let
   it run to the approval gate (~20 minutes). **Don't approve.** Let it finish before the session
   starts: two agents benchmarking at once distort each other's numbers.
3. If the live run has no report at 0:25 and the recovery prompt didn't help, stop the live agent,
   switch to the pre-run conversation and say: *"Here's the same workflow, started before the
   session. It's waiting for me at the gate."* Paste the approval there, and from then on open
   the report and terminal in `flashmart-api-prerun/`.

It costs a second model run, and it doesn't help with Phases 4–6 (use B or C for those).

---

## Windows notes

| Task | PowerShell |
|---|---|
| `npm` blocked by execution policy | `npm.cmd run <script>`, or `node <script path>` (see README "Quick start") |
| `curl` is an alias for `Invoke-WebRequest` | use `curl.exe` with the same arguments |
| Helper paths | `node ..\solution\naive\try-naive.mjs --all` (forward slashes work too) |
| Line endings | the repo pins LF (`.gitattributes`) and sets `core.autocrlf=false`, so no CRLF noise in diffs |
| `catalog-fs-watch` naive variant | may pass the suite on Windows (fs.watch follows the path) |
| git says *"detected dubious ownership in repository"* | the kit is on a USB/exFAT drive or was extracted by another account. Copy it to your user folder, or run `git config --global --add safe.directory <full path to flashmart-api>` |
| `cp -r a b` (Fallback E) | `Copy-Item -Recurse a b` |

## Between rehearsals

```bash
git checkout main          # only needed if you used Fallback C (reset rewinds the current branch)
git branch -D prebaked     # likewise
npm run reset -- --yes
npm run doctor
```

Reset discards every commit after `baseline` **on the current branch**, deletes generated files,
and keeps `data/`. Run it on `main`. If you run it while still on `prebaked`, the agent's commits
survive on `main`.
