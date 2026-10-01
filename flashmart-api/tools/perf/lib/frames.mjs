// Shared helpers for turning V8 profile call frames into readable, project-relative locations.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// Code under these folders runs in-process but is measurement tooling, not the application.
const NON_PROJECT_DIRS = /^(node_modules|bench|tools)[\\/]/;

/**
 * Returns a memoized function that classifies a V8 call frame.
 * kind: project | dependency | node | native | gc | idle | program | root | other
 */
export function createFrameClassifier(projectRoot = PROJECT_ROOT) {
  const root = path.resolve(projectRoot);
  const cache = new Map();

  return function describe(callFrame) {
    const cacheKey = `${callFrame.functionName}|${callFrame.url}|${callFrame.lineNumber}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const { functionName, url, lineNumber } = callFrame;
    let kind;
    let location = '';
    let file = null;
    if (functionName === '(idle)') kind = 'idle';
    else if (functionName === '(garbage collector)') kind = 'gc';
    else if (functionName === '(program)') kind = 'program';
    else if (functionName === '(root)') kind = 'root';
    else if (url.startsWith('file:')) {
      file = url.startsWith('file:///workspace/flashmart-api/')
        ? path.join(root, ...url.slice('file:///workspace/flashmart-api/'.length).split('/'))
        : fileURLToPath(url);
      const rel = path.relative(root, file);
      const inside = rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
      kind = inside && !NON_PROJECT_DIRS.test(rel) ? 'project' : 'dependency';
      location = `${(inside ? rel : file).split(path.sep).join('/')}:${lineNumber + 1}`;
    } else if (url.startsWith('node:')) {
      kind = 'node';
      location = `${url}:${lineNumber + 1}`;
    } else if (url === '') {
      kind = 'native';
      location = 'V8 builtin';
    } else {
      kind = 'other';
      location = url;
    }

    const name = functionName || '(anonymous)';
    const described = { kind, name, location, file, id: `${name}\u0000${location}` };
    cache.set(cacheKey, described);
    return described;
  };
}

/** Reads one source line (1-based), trimmed, for "hot lines" tables. */
export function createSourceReader() {
  const files = new Map();
  return function sourceLine(file, line) {
    if (!files.has(file)) {
      try {
        files.set(file, readFileSync(file, 'utf8').split(/\r?\n/));
      } catch {
        files.set(file, null);
      }
    }
    const text = files.get(file)?.[line - 1]?.trim() ?? '';
    return text.length > 90 ? `${text.slice(0, 87)}...` : text;
  };
}

export const KIND_LABELS = Object.freeze({
  project: 'Project code (src/)',
  native: 'V8 builtins / native (JSON, RegExp, Array...)',
  node: 'Node.js internals (node:*)',
  dependency: 'Dependencies / tooling',
  gc: 'Garbage collection',
  program: 'VM overhead (program)',
  other: 'Other',
  idle: 'Idle (waiting for I/O)',
});

export const pct = (part, whole) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '-');
export const ms = (micros) => Math.round(micros / 1000).toLocaleString('en-US');
export const escapeCell = (text) => String(text).replace(/\|/g, '\\|');
