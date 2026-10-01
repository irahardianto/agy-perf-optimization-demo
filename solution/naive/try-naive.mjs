#!/usr/bin/env node
// Workshop helper: shows that FlashMart's existing test suite catches "naive" performance fixes.
//
// For a variant it rebuilds src/, test/, scripts/ and package.json from a git ref (default: the
// `baseline` tag) in a temporary folder, swaps in the naive file, runs the test suite there and
// reports which tests fail. The repository's working tree, index and branches are never touched,
// so it is safe to run in the middle of the live demo.
//
// Run from the flashmart-api folder (Node >= 18.18, git on PATH):
//   node ../solution/naive/try-naive.mjs --list
//   node ../solution/naive/try-naive.mjs catalog-load-once
//   node ../solution/naive/try-naive.mjs catalog-load-once --diff   # also print the naive change
//   node ../solution/naive/try-naive.mjs --all                      # every variant (rehearsal)
// Options:
//   --repo <path>   repository to read from (default: current folder)
//   --ref <ref>     git ref to rebuild the code from (default: baseline)
//   --raw           print the full test output
//   --keep          keep the temporary folder for inspection
// Exit code: 0 = caught (every variant, with --all), 2 = a variant passed the suite, 1 = error.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ensureGitRepo } from '../../flashmart-api/scripts/lib/git-repo.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VARIANTS = JSON.parse(readFileSync(path.join(HERE, 'variants.json'), 'utf8'));
const COPY_PATHS = ['src', 'test', 'scripts', 'package.json'];
const USAGE = `Usage (from the flashmart-api folder):
  node <kit>/solution/naive/try-naive.mjs --list
  node <kit>/solution/naive/try-naive.mjs <variant> [--diff] [--raw] [--keep] [--ref baseline] [--repo .]
  node <kit>/solution/naive/try-naive.mjs --all`;

class UsageError extends Error {}

function git(repo, args, input) {
  try {
    return execFileSync('git', args, { cwd: repo, input, maxBuffer: 256 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('git was not found on PATH.');
    const stderr = error.stderr?.toString().trim();
    throw new Error(`git ${args.join(' ')} failed${stderr ? `: ${stderr}` : ''}`);
  }
}

function resolveCommit(repo, ref) {
  if (existsSync(path.join(repo, 'scripts', 'lib', 'git-repo.mjs'))) {
    ensureGitRepo(repo, { quiet: true });
  }
  try {
    return git(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).toString().trim();
  } catch {
    throw new UsageError(
      `No git ref "${ref}" in ${repo}.\n`
      + 'Run this from the flashmart-api folder (or pass --repo <path>), or pick another ref with --ref.',
    );
  }
}

/** Reads many blobs with one `git cat-file --batch` call (one process instead of one per file). */
function readBlobs(repo, commit, files) {
  const output = git(repo, ['cat-file', '--batch'], files.map((file) => `${commit}:${file}\n`).join(''));
  const blobs = new Map();
  let offset = 0;
  for (const file of files) {
    const headerEnd = output.indexOf(0x0a, offset);
    const header = output.subarray(offset, headerEnd).toString('utf8');
    const match = /^[0-9a-f]+ blob (\d+)$/.exec(header);
    if (!match) throw new Error(`Could not read ${file} at ${commit.slice(0, 7)} (${header})`);
    const start = headerEnd + 1;
    const end = start + Number(match[1]);
    blobs.set(file, output.subarray(start, end));
    offset = end + 1; // cat-file terminates every blob with a newline
  }
  return blobs;
}

/** Writes src/, test/, scripts/ and package.json as they are at `commit` into `dir`. */
function materialize(repo, commit, dir) {
  const files = git(repo, ['ls-tree', '-r', '-z', '--name-only', commit, '--', ...COPY_PATHS])
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
  if (!files.includes('package.json') || !files.some((file) => file.startsWith('test/'))) {
    throw new UsageError(`${repo} at ${commit.slice(0, 7)} does not look like the FlashMart API repository.`);
  }
  for (const [file, content] of readBlobs(repo, commit, files)) {
    const target = path.join(dir, ...file.split('/'));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

function runSuite(dir) {
  const env = { ...process.env, NO_COLOR: '1', SIMULATE_EXTERNAL_LATENCY: '0' };
  delete env.FORCE_COLOR;
  delete env.NODE_TEST_CONTEXT;
  const started = Date.now();
  const result = spawnSync(process.execPath, [path.join('scripts', 'test.mjs')], {
    cwd: dir,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 5 * 60_000,
  });
  if (result.error) throw result.error;
  return {
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    seconds: (Date.now() - started) / 1000,
  };
}

const DURATION = /\s+\([\d.]+m?s\)$/;
const GLYPH = /^[✔✖▶ℹ﹣]/;

const clip = (text, max = 70) => (text.length > max ? `${text.slice(0, max - 3)}...` : text);

/**
 * One-line description of a failure: the assertion message or, for generic "Expected values to
 * be ..." messages, the expected and actual values (printed on one line by the spec reporter).
 */
function describeFailure(lines, from) {
  let message = '';
  let actual;
  let expected;
  for (let i = from; i < lines.length && i < from + 200; i += 1) {
    const text = lines[i].trim();
    if (GLYPH.test(text) || text.startsWith('test at ')) break;
    if (message === '') {
      if (text !== '') message = text.replace(/^(AssertionError|Error) \[ERR_[A-Z_]+\]: /, '');
      continue;
    }
    const property = /^(actual|expected): (.*?),?$/.exec(text);
    if (property?.[1] === 'actual') actual = property[2];
    if (property?.[1] === 'expected') expected = property[2];
  }
  if (message.startsWith('Expected values to be') && actual !== undefined && expected !== undefined) {
    return `expected ${clip(expected)}, got ${clip(actual)}`;
  }
  return message;
}

/** Extracts counts and failing tests from the spec reporter output (Node 18 and Node 20+ layouts). */
export function parseSpecOutput(output) {
  const lines = output.split(/\r?\n/);
  const counts = {};
  for (const line of lines) {
    const match = /^ℹ (tests|pass|fail|cancelled|skipped|todo) (\d+)$/.exec(line.trim());
    if (match) counts[match[1]] = Number(match[2]);
  }

  const failures = [];
  const summaryStart = lines.findIndex((line) => line.trim() === '✖ failing tests:');
  if (summaryStart !== -1) {
    // Node >= 20 prints a summary block per failing test: "test at <file:line:col>", "✖ <name>", error.
    let location = null;
    for (let i = summaryStart + 1; i < lines.length; i += 1) {
      const at = /^test at (.+)$/.exec(lines[i].trim());
      if (at) {
        location = at[1];
        continue;
      }
      const failed = /^✖ (.+)$/.exec(lines[i]);
      if (failed) {
        failures.push({ name: failed[1].replace(DURATION, ''), location, message: describeFailure(lines, i + 1) });
        location = null;
      }
    }
  } else {
    // Node 18 reports failures inline, with the error indented under the failing test.
    for (let i = 0; i < lines.length; i += 1) {
      const failed = /^(\s*)✖ (.+)$/.exec(lines[i]);
      if (!failed) continue;
      const next = lines[i + 1] ?? '';
      const nextIndent = next.length - next.trimStart().length;
      if (next.trim() === '' || nextIndent <= failed[1].length || GLYPH.test(next.trim())) continue; // a suite
      failures.push({ name: failed[2].replace(DURATION, ''), location: null, message: describeFailure(lines, i + 1) });
    }
  }
  return { counts, failures };
}

function printDiff(dir, target, baselineContent, variantContent) {
  const diffDir = path.join(dir, '_diff');
  for (const [side, content] of [['baseline', baselineContent], ['naive', variantContent]]) {
    const file = path.join(diffDir, side, ...target.split('/'));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  const result = spawnSync('git', ['diff', '--no-index', '--no-color', '--', `baseline/${target}`, `naive/${target}`], {
    cwd: diffDir,
    encoding: 'utf8',
  });
  process.stdout.write(`${result.stdout || result.stderr || '(no differences)\n'}\n`);
}

/** Runs the suite against one variant. Returns { caught, failures, counts, seconds }. */
function tryVariant(name, { repo, commit, diff = false, raw = false, keep = false, quiet = false }) {
  const variant = VARIANTS[name];
  const dir = mkdtempSync(path.join(os.tmpdir(), `flashmart-naive-${name}-`));
  try {
    materialize(repo, commit, dir);
    const targetPath = path.join(dir, ...variant.target.split('/'));
    const baselineContent = readFileSync(targetPath);
    const variantContent = readFileSync(path.join(HERE, 'variants', `${name}.js`));
    writeFileSync(targetPath, variantContent);
    if (diff) printDiff(dir, variant.target, baselineContent, variantContent);

    const run = runSuite(dir);
    const { counts, failures } = parseSpecOutput(run.output);
    if (raw) process.stdout.write(`${run.output}\n`);
    const caught = run.status !== 0;
    if (!quiet) report(name, variant, { caught, failures, counts, run });
    return { caught, failures, counts, seconds: run.seconds };
  } finally {
    if (keep) console.log(`Temporary copy kept at ${dir}`);
    else rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

function report(name, variant, { caught, failures, counts, run }) {
  console.log('');
  console.log(`Naive variant: ${name}`);
  console.log(`  Replaces : ${variant.target}  (in a temporary copy; your working tree is untouched)`);
  console.log(`  Idea     : ${variant.idea}`);
  console.log(`  Breaks   : README requirement ${variant.requirement}`);
  console.log(`             ${variant.whyWrong}`);
  console.log('');
  const total = counts.tests ?? '?';
  if (caught) {
    const failing = counts.fail ?? failures.length;
    console.log(`  CAUGHT: ${failing} of ${total} tests fail (${run.seconds.toFixed(1)} s)`);
    for (const failure of failures) {
      console.log(`    x ${failure.name}`);
      const detail = [failure.message, failure.location && `(${failure.location})`].filter(Boolean).join('  ');
      if (detail) console.log(`        ${detail}`);
    }
    if (failures.length === 0) {
      console.log('    (could not parse the failing test names; showing the end of the test output)');
      console.log(run.output.split(/\r?\n/).slice(-40).map((line) => `    ${line}`).join('\n'));
    }
  } else {
    console.log(`  NOT CAUGHT: all ${total} tests pass (${run.seconds.toFixed(1)} s)`);
    if (variant.platformNote) console.log(`  Note: ${variant.platformNote}`);
  }
  console.log('');
  console.log(`  Correct fix: ${variant.correctFix}`);
  console.log('');
}

function listVariants() {
  console.log('Naive variants (each breaks a README "Operational requirement" and is caught by the existing tests):\n');
  const width = Math.max(...Object.keys(VARIANTS).map((name) => name.length));
  for (const [name, variant] of Object.entries(VARIANTS)) {
    console.log(`  ${name.padEnd(width)}  ${variant.target}`);
    console.log(`  ${''.padEnd(width)}  ${variant.idea}`);
    console.log(`  ${''.padEnd(width)}  breaks: ${variant.requirement}\n`);
  }
}

function runAll(options) {
  const names = Object.keys(VARIANTS);
  console.log(`Checking ${names.length} naive variants against the test suite at ${options.ref} (about 3 s each)...\n`);
  const width = Math.max(...names.map((name) => name.length));
  let caughtCount = 0;
  for (const name of names) {
    const result = tryVariant(name, { ...options, quiet: true });
    const variant = VARIANTS[name];
    const actual = new Set(result.failures.map((failure) => failure.name));
    const missing = (variant.expectedFailures ?? []).filter((test) => !actual.has(test));
    const verdict = result.caught ? `CAUGHT      ${result.counts.fail ?? result.failures.length} failing` : 'NOT CAUGHT  all pass  ';
    if (result.caught) caughtCount += 1;
    console.log(`  ${name.padEnd(width)}  ${verdict}  (${result.seconds.toFixed(1)} s)`);
    for (const failure of result.failures) console.log(`  ${''.padEnd(width)}    x ${failure.name}`);
    if (result.caught && missing.length > 0) {
      console.log(`  ${''.padEnd(width)}    (expected but passed: ${missing.join('; ')})`);
    }
    if (!result.caught && variant.platformNote) console.log(`  ${''.padEnd(width)}    note: ${variant.platformNote}`);
  }
  console.log(`\n${caughtCount}/${names.length} naive variants are caught by the existing tests.`);
  return caughtCount === names.length;
}

function main() {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        all: { type: 'boolean' },
        list: { type: 'boolean' },
        diff: { type: 'boolean' },
        raw: { type: 'boolean' },
        keep: { type: 'boolean' },
        repo: { type: 'string' },
        ref: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (error) {
    throw new UsageError(error.message);
  }
  const { values, positionals } = parsed;
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  if (values.list) {
    listVariants();
    return 0;
  }

  const repo = path.resolve(values.repo ?? process.cwd());
  const ref = values.ref ?? 'baseline';
  const commit = resolveCommit(repo, ref);
  const options = { repo, ref, commit, diff: values.diff, raw: values.raw, keep: values.keep };

  if (values.all) return runAll(options) ? 0 : 2;
  if (positionals.length !== 1) throw new UsageError('Pick one variant (see --list), or use --all.');
  const [name] = positionals;
  if (!Object.hasOwn(VARIANTS, name)) {
    throw new UsageError(`Unknown variant "${name}". Known variants: ${Object.keys(VARIANTS).join(', ')}`);
  }
  return tryVariant(name, options).caught ? 0 : 2;
}

function invokedDirectly() {
  if (process.argv[1] === undefined) return false;
  try {
    const self = realpathSync(fileURLToPath(import.meta.url));
    const invoked = realpathSync(path.resolve(process.argv[1]));
    return process.platform === 'win32' ? self.toLowerCase() === invoked.toLowerCase() : self === invoked;
  } catch {
    return true;
  }
}

if (invokedDirectly()) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`try-naive: ${error.message}`);
    if (error instanceof UsageError) console.error(`\n${USAGE}`);
    process.exitCode = 1;
  }
}
