// Ensures flashmart-api/ has its own local git repository and `baseline` tag, even when cloned
// as a subfolder of the outer workshop repository (where nested .git directories are not tracked).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function runGit(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString().trim();
}

export function ensureGitRepo(root = DEFAULT_ROOT, { quiet = false } = {}) {
  const dotGit = path.join(root, '.git');
  if (existsSync(dotGit)) {
    let name = '';
    let email = '';
    try { name = runGit(root, ['config', 'user.name']); } catch { /* unset */ }
    try { email = runGit(root, ['config', 'user.email']); } catch { /* unset */ }
    if (!name) runGit(root, ['config', 'user.name', 'FlashMart Workshop']);
    if (!email) runGit(root, ['config', 'user.email', 'workshop@flashmart.example']);
    try {
      runGit(root, ['rev-parse', '--verify', '--quiet', 'refs/tags/baseline']);
    } catch {
      runGit(root, ['tag', 'baseline']);
    }
    return { initialized: false };
  }

  runGit(root, ['init', '--quiet']);
  runGit(root, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  runGit(root, ['config', 'user.name', 'FlashMart Workshop']);
  runGit(root, ['config', 'user.email', 'workshop@flashmart.example']);
  runGit(root, ['config', 'core.autocrlf', 'false']);
  runGit(root, ['add', '-A']);
  runGit(root, ['commit', '--quiet', '-m', 'chore: FlashMart API v1.4.0 (baseline)']);
  runGit(root, ['tag', '-f', 'baseline']);
  if (!quiet) {
    console.log('initialized local git repository in flashmart-api/ at tag "baseline"');
  }
  return { initialized: true };
}
