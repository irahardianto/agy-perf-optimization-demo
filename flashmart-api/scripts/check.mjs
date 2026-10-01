#!/usr/bin/env node
// Offline quality gate (no dependencies): syntax-checks every JavaScript file and flags a few
// mistakes that should never be committed. Usage: npm run check
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['src', 'test', 'bench', 'tools', 'scripts'];
const SKIP = new Set(['node_modules', 'results']);

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else if (/\.(m?js)$/.test(entry)) out.push(full);
  }
  return out;
}

const RULES = [
  { pattern: /^\s*debugger\s*;?\s*$/m, message: 'debugger statement' },
  { pattern: /\b(test|it|describe)\.only\s*\(/, message: '.only() left in a test' },
];

const files = DIRS.flatMap((dir) => listFiles(path.join(ROOT, dir)));
const problems = [];
for (const file of files) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const syntax = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (syntax.status !== 0) problems.push(`${rel}: syntax error\n${syntax.stderr.trim()}`);
  const source = readFileSync(file, 'utf8');
  for (const rule of RULES) {
    if (rule.pattern.test(source)) problems.push(`${rel}: ${rule.message}`);
  }
}

if (problems.length > 0) {
  console.error(`check failed (${problems.length} problem${problems.length === 1 ? '' : 's'}):\n\n${problems.join('\n')}`);
  process.exit(1);
}
console.log(`check passed: ${files.length} files (syntax, debugger statements, .only in tests)`);
