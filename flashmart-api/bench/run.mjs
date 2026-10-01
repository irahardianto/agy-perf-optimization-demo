#!/usr/bin/env node
// FlashMart load benchmark: starts the API, drives each scenario, and records throughput,
// latency percentiles, event-loop delay and retained heap. Run with --help for options.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { environmentInfo, formatTable, gitInfo, timestampLabel } from './lib/environment.mjs';
import { runLoad } from './lib/load.mjs';
import { ROOT, readSeedManifest, startServer } from './lib/server-process.mjs';
import { medianBy, summarize } from './lib/stats.mjs';
import { createScenarios, SCENARIO_NAMES } from './scenarios.mjs';
import { EVENT_LOOP_P99_TARGET_MS, evaluate } from './targets.mjs';

const HELP = `Usage: npm run bench -- [options]      (or: node bench/run.mjs [options])

  --scenario <names>   ${SCENARIO_NAMES.join(' | ')} | all, comma-separated (default: all)
  --connections <n>    concurrent keep-alive connections (default: 16)
  --duration <sec>     measured seconds per scenario (default: 5; --quick: 2)
  --warmup <sec>       unmeasured warm-up seconds per scenario (default: 1; --quick: 0.5)
  --count <n>          repeat each scenario n times, report the median run (default: 1)
  --quick              short runs for fast feedback while iterating
  --label <name>       save to bench/results/<name>.json (default: run-<timestamp>)
  --json               print the result JSON instead of the table

Compare two runs: npm run bench:compare -- <before-label> <after-label>`;

function positiveNumber(raw, name, { integer = false } = {}) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) {
    throw new Error(`--${name} must be a positive ${integer ? 'integer' : 'number'} (got "${raw}")`);
  }
  return value;
}

function parseOptions() {
  const { values } = parseArgs({
    options: {
      scenario: { type: 'string', default: 'all' },
      connections: { type: 'string', default: '16' },
      duration: { type: 'string' },
      warmup: { type: 'string' },
      count: { type: 'string', default: '1' },
      quick: { type: 'boolean', default: false },
      label: { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }
  const scenarios = values.scenario === 'all' ? [...SCENARIO_NAMES] : values.scenario.split(',').map((s) => s.trim());
  const unknown = scenarios.filter((name) => !SCENARIO_NAMES.includes(name));
  if (unknown.length > 0) throw new Error(`Unknown scenario(s): ${unknown.join(', ')}. Choose from: ${SCENARIO_NAMES.join(', ')}, all`);
  const label = values.label ?? timestampLabel('run');
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(label)) throw new Error('--label may only contain letters, digits, ".", "_" and "-"');
  return {
    scenarios,
    label,
    json: values.json,
    connections: positiveNumber(values.connections, 'connections', { integer: true }),
    durationSec: positiveNumber(values.duration ?? (values.quick ? '2' : '5'), 'duration'),
    warmupSec: positiveNumber(values.warmup ?? (values.quick ? '0.5' : '1'), 'warmup'),
    count: positiveNumber(values.count, 'count', { integer: true }),
  };
}

async function measureScenario(server, nextRequest, options) {
  // Reset while the server is idle: a reset sent mid-load would queue behind the backlog on a
  // saturated server. The event-loop histogram therefore covers warm-up + measured window.
  await server.metrics('reset=1');
  const raw = await runLoad({
    port: server.port,
    connections: options.connections,
    warmupMs: options.warmupSec * 1000,
    durationMs: options.durationSec * 1000,
    nextRequest,
  });
  const runtime = await server.metrics('gc=1');
  return {
    ...summarize(raw),
    effectiveWarmupSec: Math.round(raw.warmupMs / 100) / 10,
    eventLoopDelayMs: runtime.eventLoopDelayMs,
    heapUsedMB: runtime.memoryMB.heapUsed,
    rssMB: runtime.memoryMB.rss,
    requestHistorySize: runtime.requestHistorySize,
  };
}

function printReport(report) {
  const { environment: env, settings } = report;
  const lines = [
    `FlashMart API benchmark · ${report.label}${report.git ? ` · commit ${report.git.commit}${report.git.dirty ? ' (uncommitted changes)' : ''}` : ''}`,
    `node ${env.node} · ${env.platform} ${env.arch} · ${env.cpus} CPUs (${env.cpuModel}) · catalog ${env.catalog.products.toLocaleString('en-US')} products / ${env.catalog.promotions} promotions`,
    `${settings.connections} connections · ${settings.durationSec}s measured per scenario (${settings.warmupSec}s warm-up) · ${settings.count} run(s)${settings.count > 1 ? ', median shown' : ''}`,
    '',
  ];
  const rows = Object.entries(report.scenarios).map(([name, r]) => [
    name,
    r.rps,
    r.latencyMs.p50,
    r.latencyMs.p95,
    r.latencyMs.p99,
    r.latencyMs.max,
    r.errors,
    r.eventLoopDelayMs.p99,
    r.heapUsedMB,
    r.readiness ? `${r.readiness.ok ? 'PASS' : 'FAIL'}${r.readiness.ok ? '' : ` (${r.readiness.checks.filter((c) => !c.ok).map((c) => c.label).join(', ')})`}` : '',
  ]);
  lines.push(formatTable(['scenario', 'req/s', 'p50 ms', 'p95 ms', 'p99 ms', 'max ms', 'errors', 'loop p99 ms', 'heap MB', '11.11 target'], rows));
  const evaluated = Object.values(report.scenarios).filter((r) => r.readiness);
  lines.push(
    '',
    `11.11 readiness: ${evaluated.filter((r) => r.readiness.ok).length}/${evaluated.length} scenarios on target (event-loop p99 target <= ${EVENT_LOOP_P99_TARGET_MS} ms)`,
    'heap MB = V8 heap still in use after a forced GC at the end of each scenario (scenarios share one server process)',
  );
  console.log(lines.join('\n'));
}

async function main() {
  const options = parseOptions();
  const seedManifest = readSeedManifest();
  const scenarios = createScenarios({ productCount: seedManifest.products });

  const log = options.json ? () => {} : (message) => console.log(message);
  log(`Starting FlashMart API for benchmark "${options.label}"...`);
  const server = await startServer({ execArgv: ['--expose-gc'] });

  const results = {};
  try {
    for (const name of options.scenarios) {
      const runs = [];
      for (let run = 1; run <= options.count; run += 1) {
        const result = await measureScenario(server, scenarios[name], options);
        runs.push(result);
        log(`  ${name.padEnd(8)} run ${run}/${options.count}: ${result.rps} req/s · p95 ${result.latencyMs.p95} ms · loop p99 ${result.eventLoopDelayMs.p99} ms · ${result.errors} errors`);
      }
      const chosen = medianBy(runs, (r) => r.rps);
      results[name] = { ...chosen, readiness: evaluate(name, chosen), ...(runs.length > 1 ? { runs } : {}) };
    }
  } finally {
    await server.stop();
  }

  const report = {
    label: options.label,
    createdAt: new Date().toISOString(),
    git: gitInfo(),
    environment: environmentInfo(seedManifest),
    settings: { connections: options.connections, durationSec: options.durationSec, warmupSec: options.warmupSec, count: options.count },
    scenarios: results,
  };

  const resultsDir = path.join(ROOT, 'bench', 'results');
  mkdirSync(resultsDir, { recursive: true });
  const outFile = path.join(resultsDir, `${options.label}.json`);
  writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('');
    printReport(report);
    console.log(`\nSaved ${path.relative(ROOT, outFile).split(path.sep).join('/')}`);
  }
}

main().catch((error) => {
  console.error(`bench failed: ${error.message}`);
  process.exit(1);
});
