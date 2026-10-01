#!/usr/bin/env node
// Runs the test suite with Node's built-in test runner (no dependencies).
// Usage: npm test [-- <node --test flags>]   e.g.  npm test -- --test-name-pattern="catalog"
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Explicit file list: works the same on every Node version (>= 18) and every shell.
const files = readdirSync(path.join(ROOT, 'test'))
  .filter((file) => file.endsWith('.test.js'))
  .sort()
  .map((file) => path.join('test', file));

const extraArgs = process.argv.slice(2);
// Compact output even when stdout is not a terminal (e.g. agent-run commands), unless overridden.
const reporter = extraArgs.some((arg) => arg.startsWith('--test-reporter')) ? [] : ['--test-reporter=spec'];

const result = spawnSync(process.execPath, ['--test', ...reporter, ...extraArgs, ...files], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, SIMULATE_EXTERNAL_LATENCY: '0' },
});
process.exit(result.status ?? 1);
