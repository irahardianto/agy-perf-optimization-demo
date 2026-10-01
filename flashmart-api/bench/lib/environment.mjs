import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { ROOT } from './server-process.mjs';

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
}

/** Current commit and whether tracked files have uncommitted changes (null outside git). */
export function gitInfo() {
  try {
    return { commit: git(['rev-parse', '--short', 'HEAD']), dirty: git(['status', '--porcelain', '--untracked-files=no']).length > 0 };
  } catch {
    return null;
  }
}

/** Machine description stored with every result so comparisons can be sanity-checked. */
export function environmentInfo(seedManifest) {
  const cpus = os.cpus();
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpus: cpus.length,
    cpuModel: cpus[0]?.model?.trim() ?? 'unknown',
    totalMemGB: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    catalog: { products: seedManifest.products, promotions: seedManifest.promotions },
  };
}

export function timestampLabel(prefix, date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${prefix}-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** Renders rows as an aligned plain-text table (first column left-aligned, the rest right-aligned). */
export function formatTable(header, rows) {
  const all = [header, ...rows].map((row) => row.map((cell) => String(cell ?? '-')));
  const widths = header.map((_, col) => Math.max(...all.map((row) => row[col].length)));
  return all
    .map((row) => row.map((cell, col) => (col === 0 || col === row.length - 1 ? cell.padEnd(widths[col]) : cell.padStart(widths[col]))).join('  ').trimEnd())
    .join('\n');
}
