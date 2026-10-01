#!/usr/bin/env node
// Pre-flight check for the workshop laptop. Safe to run any time: npm run doctor
import { execFileSync, spawnSync } from 'node:child_process';
import { pbkdf2Sync } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requestJson } from '../bench/lib/http-client.mjs';
import { startServer } from '../bench/lib/server-process.mjs';
import { DEMO_KEYS } from './lib/generate-data.mjs';
import { ensureGitRepo } from './lib/git-repo.mjs';
import { seed } from './seed.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const report = (status, title, detail = '') => {
  results.push({ status, title, detail });
  console.log(`[${status}] ${title}${detail ? `\n       ${detail.split('\n').join('\n       ')}` : ''}`);
};

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
}

function best(fn, runs) {
  let fastest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < runs; i += 1) {
    const started = performance.now();
    fn();
    fastest = Math.min(fastest, performance.now() - started);
  }
  return fastest;
}

async function main() {
  console.log('FlashMart workshop doctor\n');

  // 1. Node.js
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 18 || (major === 18 && minor < 18)) report('FAIL', `Node.js ${process.version}`, 'Node.js 18.18 or newer is required (20 or 22 LTS recommended).');
  else report(major >= 20 ? ' ok ' : 'WARN', `Node.js ${process.version}`, major >= 20 ? '' : 'Works, but Node.js 20+ is recommended.');

  // 2. git + identity (the workflow commits every optimization)
  try {
    git(['--version']);
    ensureGitRepo(ROOT, { quiet: true });
    let name = '';
    let email = '';
    try { name = git(['config', 'user.name']); } catch { /* not set */ }
    try { email = git(['config', 'user.email']); } catch { /* not set */ }
    if (name && email) report(' ok ', `git identity: ${name} <${email}>`);
    else report('FAIL', 'git user.name / user.email not configured', 'Run (inside this repo):\n  git config user.name "Workshop Demo"\n  git config user.email "demo@example.com"');
    try {
      git(['rev-parse', '--verify', '--quiet', 'refs/tags/baseline']);
      const head = git(['rev-parse', '--short', 'HEAD']);
      const dirty = git(['status', '--porcelain']).length > 0;
      report(dirty ? 'WARN' : ' ok ', `git repo at ${head}, tag "baseline" present`, dirty ? 'Working tree has changes — `npm run reset -- --yes` restores the baseline.' : '');
    } catch {
      report('WARN', 'tag "baseline" not found', 'Reset (`npm run reset`) needs it: git tag baseline <commit>');
    }
  } catch {
    report('FAIL', 'git not found on PATH', 'The perf workflow commits each fix; install/enable git or plan to skip commits.');
  }

  // 3. Antigravity workflow + skill
  const workflow = path.join(ROOT, '.agents', 'workflows', 'perf-optimize.md');
  const skill = path.join(ROOT, '.agents', 'skills', 'perf-optimization', 'SKILL.md');
  report(existsSync(workflow) && existsSync(skill) ? ' ok ' : 'FAIL', '.agents/ perf-optimize workflow + perf-optimization skill present');

  // 4. Data
  try {
    const seeded = seed({ quiet: true });
    const manifest = JSON.parse(readFileSync(path.join(ROOT, 'data', '.seed.json'), 'utf8'));
    report(' ok ', `catalog data: ${manifest.products.toLocaleString('en-US')} products / ${manifest.promotions} promotions${seeded.skipped ? '' : ' (just generated)'}`);
  } catch (error) {
    report('FAIL', 'could not generate data/', error.message);
  }

  // 5. Machine speed (drives how dramatic the baseline is)
  const catalogPath = path.join(ROOT, 'data', 'catalog.json');
  if (existsSync(catalogPath)) {
    const parseMs = best(() => JSON.parse(readFileSync(catalogPath, 'utf8')), 3);
    const kdfMs = best(() => pbkdf2Sync('calibration-secret', Buffer.alloc(16, 7), 10_000, 32, 'sha512'), 5);
    const detail = `catalog read+parse ${parseMs.toFixed(0)} ms · PBKDF2 ${kdfMs.toFixed(1)} ms (reference laptop-class CPU: ~55 ms · ~6 ms)`;
    if (parseMs > 160) {
      report('WARN', 'slow machine: baseline runs will take long', `${detail}\nConsider a smaller catalog: node scripts/seed.mjs --products 6000 --promotions 150 --force`);
    } else {
      report(' ok ', 'machine speed', detail);
    }
  }

  // 6. Tests (spec reporter output ends with "ℹ tests N / ℹ pass N / ℹ fail N" lines)
  const tests = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'test.mjs')], { cwd: ROOT, encoding: 'utf8' });
  const count = (name) => (tests.stdout.match(new RegExp(`(?:ℹ|#) ${name} (\\d+)`)) ?? [])[1] ?? '?';
  const testSummary = `(${count('pass')}/${count('tests')} passed)`;
  report(
    tests.status === 0 ? ' ok ' : 'FAIL',
    `test suite ${tests.status === 0 ? 'passes' : 'FAILED'} ${testSummary}`,
    tests.status === 0 ? '' : `${tests.stdout}${tests.stderr}`.slice(-2000),
  );

  // 7. Server smoke test
  try {
    const server = await startServer();
    try {
      const health = await requestJson({ port: server.port, method: 'GET', path: '/healthz' });
      const started = performance.now();
      const search = await requestJson({ port: server.port, method: 'GET', path: '/api/products/search?q=wireless+earbuds', headers: { 'x-api-key': DEMO_KEYS.storefront } });
      const elapsed = performance.now() - started;
      const ok = health.status === 200 && search.status === 200;
      report(ok ? ' ok ' : 'FAIL', `server smoke test (search took ${elapsed.toFixed(0)} ms)`, ok ? '' : `healthz ${health.status}, search ${search.status}`);
    } finally {
      await server.stop();
    }
  } catch (error) {
    report('FAIL', 'server failed to start', error.message);
  }

  if (process.platform === 'win32') {
    report('INFO', 'Windows tips', 'If PowerShell blocks npm ("running scripts is disabled"), use npm.cmd (e.g. `npm.cmd run bench`)\nor call node directly (e.g. `node bench/run.mjs --quick`).');
  }

  const failed = results.filter((r) => r.status === 'FAIL').length;
  const warned = results.filter((r) => r.status === 'WARN').length;
  console.log(`\n${failed === 0 ? 'Ready.' : 'Not ready.'} ${failed} failure(s), ${warned} warning(s).`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`doctor crashed: ${error.stack}`);
  process.exit(1);
});
