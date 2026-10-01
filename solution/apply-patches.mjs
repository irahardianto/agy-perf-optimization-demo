#!/usr/bin/env node
// Workshop fallback: applies reference fixes from ./patches as commits with `git am`.
// It works the same in bash, zsh, cmd.exe and PowerShell, with no shell globs to worry about.
//
// Run from the flashmart-api folder:
//   node ../solution/apply-patches.mjs --list
//   node ../solution/apply-patches.mjs 2 3                      # fixes 2 and 3 on the current branch
//   node ../solution/apply-patches.mjs --branch prebaked 1 2 3  # new branch from `baseline`, then fixes 1-3
// Nothing is discarded: the agent's commits stay on their branch.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ensureGitRepo } from '../flashmart-api/scripts/lib/git-repo.mjs';

const PATCHES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'patches');

function fail(message) {
  console.error(`apply-patches: ${message}`);
  process.exit(1);
}

function git(args, options = {}) {
  return execFileSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'], ...options }).toString().trim();
}

/** Commit subject from a format-patch file ("Subject: [PATCH 2/6] perf(search): ..."), unfolded. */
function subjectOf(file) {
  const header = readFileSync(file, 'utf8').split('\n\n', 1)[0].replace(/\n[ \t]+/g, ' ');
  const subject = /^Subject: (?:\[PATCH[^\]]*\] )?(.*)$/m.exec(header);
  return subject ? subject[1].trim() : path.basename(file);
}

function availablePatches() {
  const patches = new Map();
  for (const file of readdirSync(PATCHES_DIR).sort()) {
    const match = /^(\d{4})-.+\.patch$/.exec(file);
    if (match) {
      const fullPath = path.join(PATCHES_DIR, file);
      patches.set(Number(match[1]), { file: fullPath, title: subjectOf(fullPath) });
    }
  }
  return patches;
}

let parsed;
try {
  parsed = parseArgs({ allowPositionals: true, options: { branch: { type: 'string' }, list: { type: 'boolean' } } });
} catch (error) {
  fail(error.message);
}
const { values, positionals } = parsed;
const patches = availablePatches();

if (values.list || positionals.length === 0) {
  console.log('Reference fixes (apply with: node ../solution/apply-patches.mjs <number>...):\n');
  for (const [number, { title }] of patches) console.log(`  ${number}  ${title}`);
  process.exit(values.list ? 0 : 1);
}

const numbers = positionals.map(Number);
const unknown = positionals.filter((value, i) => !patches.has(numbers[i]));
if (unknown.length > 0) fail(`unknown fix number(s): ${unknown.join(', ')}. Run with --list.`);

if (existsSync(path.join(process.cwd(), 'scripts', 'lib', 'git-repo.mjs'))) {
  ensureGitRepo(process.cwd(), { quiet: true });
}
try {
  git(['rev-parse', '--verify', '--quiet', 'refs/tags/baseline']);
} catch {
  fail('run this from the flashmart-api folder (no "baseline" tag found here).');
}
const gitDir = git(['rev-parse', '--git-dir']);
if (existsSync(path.join(gitDir, 'rebase-apply'))) {
  fail('a previous "git am" is still in progress. Run: git am --abort');
}
if (git(['status', '--porcelain', '--untracked-files=no']) !== '') {
  fail('you have uncommitted changes to tracked files. Commit them, or run: git stash');
}

if (values.branch) {
  const result = spawnSync('git', ['checkout', '-b', values.branch, 'baseline'], { stdio: 'inherit' });
  if (result.status !== 0) fail(`could not create branch "${values.branch}" from baseline.`);
}

const files = [...new Set(numbers)].sort((a, b) => a - b).map((number) => patches.get(number).file);
const before = git(['rev-parse', 'HEAD']);
const am = spawnSync('git', ['am', '--3way', ...files], { stdio: 'inherit' });
if (am.status !== 0) {
  console.error('\nA patch did not apply, probably because the agent already changed the same file.');
  console.error('Undo this attempt with:  git am --abort   (then leave that fix out and try again)');
  process.exit(1);
}

const added = Number(git(['rev-list', '--count', `${before}..HEAD`]));
if (added === 0) {
  console.log('\nNothing new was committed: these fixes are already on this branch.');
  process.exit(0);
}
console.log(`\nCommitted ${added} fix(es):`);
console.log(git(['log', '--oneline', `-${added}`]));
console.log('\nNext: npm test, then npm run bench -- --label <name> and npm run bench:compare -- baseline <name>');
