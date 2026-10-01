import http from 'node:http';
import { send } from './http-client.mjs';

/**
 * Closed-loop load generator: `connections` workers each keep exactly one request in flight
 * over keep-alive sockets, continuously, through a warm-up phase and a measured window.
 *
 * Measurement starts once the warm-up time has elapsed AND every connection has completed at
 * least one request (so a slow server is in steady state before we measure), or after
 * `maxWarmupMs` at the latest. Only responses that complete inside the measured window count.
 *
 * @param {{
 *   port: number,
 *   connections: number,
 *   warmupMs?: number,
 *   maxWarmupMs?: number,
 *   durationMs: number,
 *   nextRequest: (sequence: number) => { method: string, path: string, headers?: Record<string, string>, body?: string },
 * }} options
 */
export async function runLoad({ port, connections, warmupMs = 0, maxWarmupMs = warmupMs + 10_000, durationMs, nextRequest }) {
  const agent = new http.Agent({ keepAlive: true, maxSockets: connections });
  const latenciesMs = [];
  const statusCounts = {};
  let errors = 0;
  let sequence = 0;
  let warmedWorkers = 0;
  let warmupElapsed = warmupMs <= 0;
  let measureFrom = Number.POSITIVE_INFINITY;
  let deadline = Number.POSITIVE_INFINITY;
  const startedAt = performance.now();

  function startMeasuring() {
    if (measureFrom !== Number.POSITIVE_INFINITY) return;
    measureFrom = performance.now();
    deadline = measureFrom + durationMs;
  }

  function maybeStartMeasuring() {
    if (warmupElapsed && warmedWorkers >= connections) startMeasuring();
  }

  const warmupTimer = setTimeout(() => {
    warmupElapsed = true;
    maybeStartMeasuring();
  }, warmupMs);
  const maxWarmupTimer = setTimeout(startMeasuring, Math.max(warmupMs, maxWarmupMs));

  async function worker() {
    let warmed = false;
    while (performance.now() < deadline) {
      const request = nextRequest(sequence);
      sequence += 1;
      const sentAt = performance.now();
      let status;
      try {
        status = await send({ port, agent, ...request });
      } catch {
        status = 'network_error';
      }
      const doneAt = performance.now();
      if (!warmed) {
        warmed = true;
        warmedWorkers += 1;
        maybeStartMeasuring();
      }
      if (doneAt < measureFrom || doneAt > deadline) continue;
      statusCounts[status] = (statusCounts[status] ?? 0) + 1;
      if (typeof status === 'number' && status >= 200 && status < 300) latenciesMs.push(doneAt - sentAt);
      else errors += 1;
    }
  }

  await Promise.all(Array.from({ length: connections }, () => worker()));
  clearTimeout(warmupTimer);
  clearTimeout(maxWarmupTimer);
  agent.destroy();
  return { latenciesMs, errors, statusCounts, durationMs, warmupMs: Math.round(measureFrom - startedAt) };
}
