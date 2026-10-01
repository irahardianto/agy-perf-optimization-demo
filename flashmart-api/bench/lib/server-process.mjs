// Starts src/server.js as a child process on an ephemeral port and talks to it over IPC.
// Shared by bench/run.mjs and tools/perf/profile.mjs.
import { fork } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requestJson } from './http-client.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const INTERNAL_TOKEN = 'bench-internal-token';

/** Reads data/.seed.json, or explains how to create it. */
export function readSeedManifest() {
  const manifestPath = path.join(ROOT, 'data', '.seed.json');
  if (!existsSync(manifestPath) || !existsSync(path.join(ROOT, 'data', 'catalog.json'))) {
    throw new Error('No catalog data found. Run `npm run setup` (or `node scripts/seed.mjs`) first.');
  }
  return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

/**
 * @param {{ execArgv?: string[], env?: Record<string, string>, startupTimeoutMs?: number }} [options]
 * @returns {Promise<{ port: number, child: import('node:child_process').ChildProcess, metrics: (query?: string) => Promise<any>, stop: () => Promise<{ code: number | null, signal: string | null }> }>}
 */
export async function startServer({ execArgv = [], env = {}, startupTimeoutMs = 60_000 } = {}) {
  const child = fork(path.join(ROOT, 'src', 'server.js'), [], {
    cwd: ROOT,
    execArgv,
    env: { ...process.env, PORT: '0', LOG_LEVEL: 'warn', INTERNAL_TOKEN, ...env },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  const exited = new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });

  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`server did not report ready within ${startupTimeoutMs} ms`));
    }, startupTimeoutMs);
    child.on('message', (message) => {
      if (message?.type === 'ready') {
        clearTimeout(timer);
        resolve(message.port);
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited during startup (exit code ${code}) — see the log above`));
    });
  });

  return {
    port,
    child,
    /** GET /internal/metrics with an optional query string such as "gc=1" or "reset=1". */
    async metrics(query = '') {
      const response = await requestJson({
        port,
        method: 'GET',
        path: `/internal/metrics${query ? `?${query}` : ''}`,
        headers: { 'x-internal-token': INTERNAL_TOKEN },
      });
      if (response.status !== 200) throw new Error(`/internal/metrics returned ${response.status}`);
      return response.body;
    },
    /** Graceful shutdown over IPC (portable, and lets --cpu-prof/--heap-prof flush). */
    async stop(timeoutMs = 15_000) {
      if (child.exitCode !== null || child.signalCode !== null) return exited;
      child.send({ type: 'shutdown' });
      const killTimer = setTimeout(() => child.kill(), timeoutMs);
      const result = await exited;
      clearTimeout(killTimer);
      return result;
    },
  };
}
