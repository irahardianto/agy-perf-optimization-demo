#!/usr/bin/env node
// Restores the repository to the `baseline` tag between rehearsals: discards commits and edits
// made after it, and removes generated artifacts (agent scratch files, reports, profiles, bench
// results). Keeps data/ so there is no need to re-seed.
// Usage: npm run reset -- --yes
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureGitRepo } from './lib/git-repo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (!process.argv.includes('--yes')) {
  console.log('This discards ALL commits and changes made after the "baseline" tag, and deletes');
  console.log('.agentwork/, docs/audits/, .profiles/ and bench/results/*.json.');
  console.log('\nRe-run with --yes to proceed:  npm run reset -- --yes   (or: node scripts/reset.mjs --yes)');
  process.exit(1);
}

ensureGitRepo(ROOT, { quiet: true });
const git = (...args) => execFileSync('git', args, { cwd: ROOT, stdio: 'inherit' });
try {
  execFileSync('git', ['rev-parse', '--verify', '--quiet', 'refs/tags/baseline'], { cwd: ROOT, stdio: 'ignore' });
} catch {
  console.error('No "baseline" tag found — nothing to reset to.');
  process.exit(1);
}

git('reset', '--hard', 'baseline');
git('clean', '-fd', '--exclude=data/');
for (const dir of ['.agentwork', path.join('docs', 'audits'), '.profiles']) {
  rmSync(path.join(ROOT, dir), { recursive: true, force: true });
}
const results = path.join(ROOT, 'bench', 'results');
if (existsSync(results)) {
  for (const file of readdirSync(results)) if (file.endsWith('.json')) rmSync(path.join(results, file));
}
console.log('\nRepository restored to "baseline".');
