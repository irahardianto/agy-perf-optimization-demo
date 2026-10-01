#!/usr/bin/env node
// Compares two benchmark result files and prints a Markdown table in the same shape as the
// perf report template (Benchmark | Metric | Before | After | Δ | Δ%).
//
// Usage: npm run bench:compare -- <before> <after>
//   <before>/<after>: a label in bench/results/ (e.g. "baseline"), a path to a result JSON,
//   or "latest" for the most recently written result.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/server-process.mjs';

const RESULTS_DIR = path.join(ROOT, 'bench', 'results');
const NOISE_PCT = 5;

// direction: +1 = higher is better, -1 = lower is better
const METRICS = [
  { name: 'req/s', direction: +1, get: (r) => r.rps },
  { name: 'p50 ms', direction: -1, get: (r) => r.latencyMs.p50 },
  { name: 'p95 ms', direction: -1, get: (r) => r.latencyMs.p95 },
  { name: 'p99 ms', direction: -1, get: (r) => r.latencyMs.p99 },
  { name: 'event-loop p99 ms', direction: -1, get: (r) => r.eventLoopDelayMs.p99 },
  { name: 'heap MB (after GC)', direction: -1, get: (r) => r.heapUsedMB },
  { name: 'errors', direction: -1, get: (r) => r.errors },
];

function resolveResult(ref) {
  if (ref === 'latest') {
    const files = existsSync(RESULTS_DIR) ? readdirSync(RESULTS_DIR).filter((f) => f.endsWith('.json')) : [];
    if (files.length === 0) throw new Error('No results in bench/results/ yet — run `npm run bench` first.');
    const newest = files
      .map((f) => ({ f, mtime: statSync(path.join(RESULTS_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)[0].f;
    return path.join(RESULTS_DIR, newest);
  }
  const candidates = [ref, path.join(RESULTS_DIR, ref), path.join(RESULTS_DIR, `${ref}.json`)];
  const found = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
  if (!found) throw new Error(`Cannot find results "${ref}" (looked in bench/results/). Run: npm run bench -- --label ${ref}`);
  return found;
}

const fmt = (value) => (value === null || value === undefined ? '-' : Number.isInteger(value) ? String(value) : value.toFixed(1));

function delta(before, after, direction) {
  if (typeof before !== 'number' || typeof after !== 'number') return { abs: '-', pct: '-' };
  const diff = after - before;
  const abs = `${diff > 0 ? '+' : diff < 0 ? '−' : '±'}${fmt(Math.abs(diff))}`;
  if (before === 0) return { abs, pct: after === 0 ? '0%' : 'n/a' };
  const pctValue = (diff / before) * 100;
  let pct = `${pctValue > 0 ? '+' : pctValue < 0 ? '−' : '±'}${Math.abs(pctValue) >= 100 ? Math.round(Math.abs(pctValue)) : Math.abs(pctValue).toFixed(1)}%`;
  const ratio = direction > 0 ? after / before : before / after;
  if (Number.isFinite(ratio) && ratio >= 2) pct += ` (${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}× ${direction > 0 ? 'higher' : 'lower'})`;
  else if (Math.abs(pctValue) < NOISE_PCT) pct += ' (noise)';
  return { abs, pct };
}

function settingsWarnings(a, b) {
  const warnings = [];
  const check = (label, x, y) => {
    if (JSON.stringify(x) !== JSON.stringify(y)) warnings.push(`${label} differs: ${JSON.stringify(x)} vs ${JSON.stringify(y)}`);
  };
  check('connections', a.settings.connections, b.settings.connections);
  check('duration', a.settings.durationSec, b.settings.durationSec);
  check('catalog size', a.environment.catalog, b.environment.catalog);
  check('node version', a.environment.node, b.environment.node);
  check('CPU', a.environment.cpuModel, b.environment.cpuModel);
  return warnings;
}

function main() {
  const [beforeRef, afterRef] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  if (!beforeRef || !afterRef) {
    console.error('Usage: npm run bench:compare -- <before> <after>   (labels in bench/results/, file paths, or "latest")');
    process.exit(1);
  }
  const before = JSON.parse(readFileSync(resolveResult(beforeRef), 'utf8'));
  const after = JSON.parse(readFileSync(resolveResult(afterRef), 'utf8'));

  const lines = [
    `### Benchmark comparison: \`${before.label}\` → \`${after.label}\``,
    '',
    `Commits: ${before.git?.commit ?? '?'} → ${after.git?.commit ?? '?'}${after.git?.dirty ? ' (uncommitted changes)' : ''} · ` +
      `${after.settings.connections} connections · ${after.settings.durationSec}s per scenario · node ${after.environment.node} · ` +
      `${after.environment.catalog.products} products`,
    '',
    '| Benchmark | Metric | Before | After | Δ | Δ% |',
    '|---|---|---|---|---|---|',
  ];
  const scenarios = Object.keys(before.scenarios).filter((name) => name in after.scenarios);
  for (const name of scenarios) {
    for (const metric of METRICS) {
      const b = metric.get(before.scenarios[name]);
      const a = metric.get(after.scenarios[name]);
      const d = delta(b, a, metric.direction);
      lines.push(`| ${name} | ${metric.name} | ${fmt(b)} | ${fmt(a)} | ${d.abs} | ${d.pct} |`);
    }
  }
  const readiness = (report) => {
    const evaluated = Object.values(report.scenarios).filter((r) => r.readiness);
    return `${evaluated.filter((r) => r.readiness.ok).length}/${evaluated.length}`;
  };
  lines.push('', `11.11 readiness: ${readiness(before)} → ${readiness(after)} scenarios on target. Changes under ±${NOISE_PCT}% are within run-to-run noise.`);
  const skipped = Object.keys(before.scenarios).filter((name) => !(name in after.scenarios));
  if (skipped.length > 0) lines.push(`Not in both runs: ${skipped.join(', ')}`);
  const warnings = settingsWarnings(before, after);
  if (warnings.length > 0) lines.push('', `> Warning: runs are not directly comparable — ${warnings.join('; ')}`);
  console.log(lines.join('\n'));
}

try {
  main();
} catch (error) {
  console.error(`compare failed: ${error.message}`);
  process.exit(1);
}
