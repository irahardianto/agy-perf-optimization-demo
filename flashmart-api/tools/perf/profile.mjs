#!/usr/bin/env node
// Profiles the API under load and writes a Markdown summary — the Node.js counterpart of the
// perf workflow's "pprof bench mode". Captures:
//   - a V8 CPU profile (--cpu-prof)                       -> cpu.cpuprofile
//   - a sampling allocation profile (incl. collected objs) -> alloc.heapprofile
//   - retained heap after forced GC, before vs after load
// Output: .profiles/<label>/summary.md (+ the raw profiles, loadable in Chrome DevTools).
//
// Usage: npm run profile -- [--scenario mixed] [--duration 8] [--connections 16] [--label name]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { environmentInfo, gitInfo, timestampLabel } from '../../bench/lib/environment.mjs';
import { runLoad } from '../../bench/lib/load.mjs';
import { ROOT, readSeedManifest, startServer } from '../../bench/lib/server-process.mjs';
import { summarize } from '../../bench/lib/stats.mjs';
import { createScenarios, SCENARIO_NAMES } from '../../bench/scenarios.mjs';
import { analyzeCpuProfile, renderCpuMarkdown } from './analyze-cpuprofile.mjs';
import { analyzeHeapProfile, renderHeapMarkdown } from './analyze-heapprofile.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const HELP = `Usage: npm run profile -- [options]      (or: node tools/perf/profile.mjs [options])

  --scenario <name>    ${SCENARIO_NAMES.join(' | ')} (default: mixed)
  --duration <sec>     seconds of profiled load (default: 8)
  --connections <n>    concurrent connections (default: 16)
  --label <name>       output folder .profiles/<name>/ (default: profile-<timestamp>)
  --top <n>            rows per table (default: 12)`;

function parseOptions() {
  const { values } = parseArgs({
    options: {
      scenario: { type: 'string', default: 'mixed' },
      duration: { type: 'string', default: '8' },
      connections: { type: 'string', default: '16' },
      label: { type: 'string' },
      top: { type: 'string', default: '12' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }
  if (!SCENARIO_NAMES.includes(values.scenario)) throw new Error(`--scenario must be one of: ${SCENARIO_NAMES.join(', ')}`);
  const label = values.label ?? timestampLabel('profile');
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(label)) throw new Error('--label may only contain letters, digits, ".", "_" and "-"');
  const number = (raw, name) => {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be a positive number`);
    return value;
  };
  return {
    scenario: values.scenario,
    durationSec: number(values.duration, 'duration'),
    connections: Math.round(number(values.connections, 'connections')),
    top: Math.round(number(values.top, 'top')),
    label,
  };
}

function retainedSection(before, after) {
  // The server counts every request it answered, including the /internal/metrics call itself.
  const requests = Math.max(0, after.requests - before.requests - 1);
  const heapDelta = after.memoryMB.heapUsed - before.memoryMB.heapUsed;
  const historyDelta = after.requestHistorySize - before.requestHistorySize;
  const perRequest = requests > 0 ? `${((heapDelta * 1024) / requests).toFixed(2)} KB` : '-';
  return [
    '## Retained memory (after forced GC)',
    '',
    '| Metric | Before profiled load | After profiled load | Δ |',
    '|---|---:|---:|---:|',
    `| V8 heap used (MB) | ${before.memoryMB.heapUsed} | ${after.memoryMB.heapUsed} | ${heapDelta >= 0 ? '+' : ''}${heapDelta.toFixed(1)} |`,
    `| RSS (MB) | ${before.memoryMB.rss} | ${after.memoryMB.rss} | ${(after.memoryMB.rss - before.memoryMB.rss).toFixed(1)} |`,
    `| requestHistorySize | ${before.requestHistorySize} | ${after.requestHistorySize} | ${historyDelta >= 0 ? '+' : ''}${historyDelta} |`,
    '',
    `Requests served between the two measurements: ${requests.toLocaleString('en-US')} · retained heap change per request: ${perRequest}.`,
  ].join('\n');
}

async function main() {
  const options = parseOptions();
  const seedManifest = readSeedManifest();
  const scenarios = createScenarios({ productCount: seedManifest.products });
  const outDir = path.join(ROOT, '.profiles', options.label);
  mkdirSync(outDir, { recursive: true });
  const cpuFile = path.join(outDir, 'cpu.cpuprofile');
  const allocFile = path.join(outDir, 'alloc.heapprofile');

  console.log(`Profiling "${options.scenario}" load (${options.connections} connections, ${options.durationSec}s)...`);
  const server = await startServer({
    execArgv: [
      '--expose-gc',
      '--cpu-prof',
      `--cpu-prof-dir=${outDir}`,
      '--cpu-prof-name=cpu.cpuprofile',
      `--import=${pathToFileURL(path.join(HERE, 'alloc-sampler.mjs')).href}`,
    ],
    env: { FLASHMART_ALLOC_PROFILE: allocFile },
  });

  let raw;
  let before;
  let after;
  try {
    // Short warm-up so JIT compilation and lazy initialisation don't count as "retained growth".
    await runLoad({ port: server.port, connections: options.connections, durationMs: 1000, nextRequest: scenarios[options.scenario] });
    before = await server.metrics('gc=1');
    raw = await runLoad({ port: server.port, connections: options.connections, durationMs: options.durationSec * 1000, nextRequest: scenarios[options.scenario] });
    after = await server.metrics('gc=1');
  } finally {
    const exit = await server.stop();
    if (exit.code !== 0) console.warn(`warning: server exited with code ${exit.code} (${exit.signal ?? 'no signal'}) — profiles may be missing`);
  }
  if (!existsSync(cpuFile)) throw new Error(`CPU profile was not written to ${cpuFile}`);

  const load = summarize(raw);
  const git = gitInfo();
  const env = environmentInfo(seedManifest);
  const rel = (file) => path.relative(ROOT, file).split(path.sep).join('/');
  const sections = [
    `# Profile summary — ${options.label}`,
    '',
    `- Scenario: **${options.scenario}** · ${options.connections} connections · ${options.durationSec}s profiled load (after 1s warm-up)`,
    `- Load during profiling: ${load.rps} req/s · p50 ${load.latencyMs.p50} ms · p95 ${load.latencyMs.p95} ms · ${load.errors} errors ` +
      '(profilers add overhead — use `npm run bench` for official numbers)',
    `- ${git ? `Commit ${git.commit}${git.dirty ? ' (uncommitted changes)' : ''} · ` : ''}node ${env.node} · ${env.platform} ${env.arch} · ` +
      `${env.catalog.products.toLocaleString('en-US')} products / ${env.catalog.promotions} promotions`,
    `- Raw files: \`${rel(cpuFile)}\` and \`${rel(allocFile)}\` — load them in Chrome DevTools (Performance / Memory tab) for flame charts.`,
    '- The CPU profile covers the whole server process (startup, warm-up, profiled load, shutdown).',
    '',
    renderCpuMarkdown(analyzeCpuProfile(JSON.parse(readFileSync(cpuFile, 'utf8'))), { top: options.top }),
    '',
    existsSync(allocFile)
      ? renderHeapMarkdown(analyzeHeapProfile(JSON.parse(readFileSync(allocFile, 'utf8'))), { top: options.top, requests: after.requests })
      : '## Allocation profile\n\nNot available (the Node.js inspector could not be started).',
    '',
    retainedSection(before, after),
    '',
  ];
  const summary = sections.join('\n');
  const summaryFile = path.join(outDir, 'summary.md');
  writeFileSync(summaryFile, summary);
  console.log(`\n${summary}`);
  console.log(`Saved ${rel(summaryFile)}`);
}

main().catch((error) => {
  console.error(`profile failed: ${error.message}`);
  process.exit(1);
});
