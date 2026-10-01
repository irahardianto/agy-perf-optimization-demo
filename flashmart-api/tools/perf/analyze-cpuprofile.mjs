#!/usr/bin/env node
// Summarises a V8 CPU profile (.cpuprofile from --cpu-prof, Chrome DevTools or VS Code) as Markdown:
// time by category, project hot spots, hot source lines, inclusive time and hottest call paths.
//
// Usage: node tools/perf/analyze-cpuprofile.mjs <file.cpuprofile> [--top 12]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createFrameClassifier, createSourceReader, escapeCell, KIND_LABELS, ms, pct, PROJECT_ROOT } from './lib/frames.mjs';

function addTo(map, frame, micros) {
  const entry = map.get(frame.id) ?? { frame, us: 0 };
  entry.us += micros;
  map.set(frame.id, entry);
  return entry;
}

/** @param {{ nodes: any[], samples: number[], timeDeltas: number[], startTime: number, endTime: number }} profile */
export function analyzeCpuProfile(profile, { projectRoot = PROJECT_ROOT } = {}) {
  const describe = createFrameClassifier(projectRoot);
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parentOf = new Map();
  for (const node of profile.nodes) for (const child of node.children ?? []) parentOf.set(child, node.id);

  const projectStacks = new Map();
  function projectStack(nodeId) {
    let frames = projectStacks.get(nodeId);
    if (frames) return frames;
    frames = [];
    for (let id = nodeId; id !== undefined; id = parentOf.get(id)) {
      const frame = describe(nodes.get(id).callFrame);
      if (frame.kind === 'project' && frames[frames.length - 1]?.id !== frame.id) frames.push(frame);
    }
    frames.reverse();
    projectStacks.set(nodeId, frames);
    return frames;
  }

  const byKind = new Map();
  const selfByFunction = new Map();
  const hotSpots = new Map(); // nearest project frame -> self + directly-called non-project time
  const inclusive = new Map();
  const paths = new Map();
  let totalUs = 0;
  let busyUs = 0;
  let busySamples = 0;

  const { samples, timeDeltas } = profile;
  for (let i = 0; i < samples.length; i += 1) {
    const micros = timeDeltas[i + 1] ?? 0;
    if (micros <= 0) continue;
    totalUs += micros;
    const leaf = describe(nodes.get(samples[i]).callFrame);
    byKind.set(leaf.kind, (byKind.get(leaf.kind) ?? 0) + micros);
    if (leaf.kind === 'idle' || leaf.kind === 'root') continue;
    busyUs += micros;
    busySamples += 1;
    addTo(selfByFunction, leaf, micros);

    const stack = projectStack(samples[i]);
    if (stack.length === 0) continue;
    const owner = addTo(hotSpots, stack[stack.length - 1], micros);
    if (leaf.kind !== 'project') {
      owner.callees ??= new Map();
      addTo(owner.callees, leaf, micros);
    }
    const seen = new Set();
    for (const frame of stack) {
      if (seen.has(frame.id)) continue;
      seen.add(frame.id);
      addTo(inclusive, frame, micros);
    }
    const pathKey = stack.map((frame) => `${frame.name} (${frame.location})`).join(' → ') + (leaf.kind === 'project' ? '' : ` → [${leaf.kind}] ${leaf.name}`);
    paths.set(pathKey, (paths.get(pathKey) ?? 0) + micros);
  }

  // Line-level self samples for project functions (positionTicks lines are 1-based).
  const sourceLine = createSourceReader();
  const lines = new Map();
  for (const node of profile.nodes) {
    const frame = describe(node.callFrame);
    if (frame.kind !== 'project' || !node.positionTicks) continue;
    for (const { line, ticks } of node.positionTicks) {
      const key = `${frame.file}:${line}`;
      const entry = lines.get(key) ?? { location: `${frame.location.replace(/:\d+$/, '')}:${line}`, fn: frame.name, ticks: 0, source: sourceLine(frame.file, line) };
      entry.ticks += ticks;
      lines.set(key, entry);
    }
  }

  const sortByUs = (map) => [...map.values()].sort((a, b) => b.us - a.us);
  return {
    totalUs,
    busyUs,
    busySamples,
    sampleCount: samples.length,
    intervalUs: samples.length > 1 ? Math.round(totalUs / samples.length) : 0,
    byKind,
    hotSpots: sortByUs(hotSpots),
    selfByFunction: sortByUs(selfByFunction),
    inclusive: sortByUs(inclusive),
    hotLines: [...lines.values()].sort((a, b) => b.ticks - a.ticks),
    paths: [...paths.entries()].map(([key, us]) => ({ path: key, us })).sort((a, b) => b.us - a.us),
  };
}

export function renderCpuMarkdown(analysis, { top = 12 } = {}) {
  const { totalUs, busyUs } = analysis;
  const out = [];
  out.push(
    '## CPU profile',
    '',
    `${(totalUs / 1e6).toFixed(1)} s profiled · ${analysis.sampleCount.toLocaleString('en-US')} samples (~${analysis.intervalUs} µs apart) · ` +
      `CPU busy ${pct(busyUs, totalUs)} of the time. Percentages below are **% of busy time** unless noted.`,
    '',
    '### Where the time went',
    '',
    '| Category | ms | % of profile | % of busy |',
    '|---|---:|---:|---:|',
  );
  for (const kind of ['project', 'native', 'node', 'dependency', 'gc', 'program', 'other', 'idle']) {
    const micros = analysis.byKind.get(kind);
    if (!micros) continue;
    out.push(`| ${KIND_LABELS[kind]} | ${ms(micros)} | ${pct(micros, totalUs)} | ${kind === 'idle' ? '-' : pct(micros, busyUs)} |`);
  }
  const gcShare = (analysis.byKind.get('gc') ?? 0) / (busyUs || 1);
  if (gcShare > 0.05) {
    out.push('', `> GC is ${(gcShare * 100).toFixed(1)}% of busy time — see the allocation hot spots for what is generating garbage.`);
  }

  out.push(
    '',
    '### Top project hot spots',
    '',
    'Self time of each project function **plus** time in V8 builtins / Node.js internals it calls directly (e.g. `JSON.parse`, `readFileSync`, `pbkdf2Sync`).',
    '',
    '| # | Function | Location | ms | % busy | Largest non-project callees |',
    '|---:|---|---|---:|---:|---|',
  );
  analysis.hotSpots.slice(0, top).forEach((entry, i) => {
    const callees = entry.callees
      ? [...entry.callees.values()].sort((a, b) => b.us - a.us).slice(0, 3).map((c) => `${c.frame.name} (${c.frame.kind}) ${pct(c.us, busyUs)}`).join(', ')
      : '';
    out.push(`| ${i + 1} | \`${escapeCell(entry.frame.name)}\` | ${entry.frame.location} | ${ms(entry.us)} | ${pct(entry.us, busyUs)} | ${escapeCell(callees)} |`);
  });

  out.push('', '### Hot lines (self samples inside project functions)', '', '| # | Location | % busy | Source |', '|---:|---|---:|---|');
  analysis.hotLines.slice(0, top).forEach((line, i) => {
    out.push(`| ${i + 1} | ${line.location} | ${pct(line.ticks, analysis.busySamples)} | \`${escapeCell(line.source)}\` |`);
  });

  out.push('', '### Project functions by inclusive time (cum)', '', '| # | Function | Location | ms | % busy |', '|---:|---|---|---:|---:|');
  analysis.inclusive.slice(0, top).forEach((entry, i) => {
    out.push(`| ${i + 1} | \`${escapeCell(entry.frame.name)}\` | ${entry.frame.location} | ${ms(entry.us)} | ${pct(entry.us, busyUs)} |`);
  });

  out.push('', '### Top self time, all code (flat)', '', '| # | Function | Kind | Location | ms | % busy |', '|---:|---|---|---|---:|---:|');
  analysis.selfByFunction.slice(0, top).forEach((entry, i) => {
    out.push(`| ${i + 1} | \`${escapeCell(entry.frame.name)}\` | ${entry.frame.kind} | ${escapeCell(entry.frame.location)} | ${ms(entry.us)} | ${pct(entry.us, busyUs)} |`);
  });

  out.push('', '### Hottest call paths (project frames, outer → inner)', '', '| # | % busy | Path |', '|---:|---:|---|');
  analysis.paths.slice(0, Math.min(top, 10)).forEach((entry, i) => {
    out.push(`| ${i + 1} | ${pct(entry.us, busyUs)} | ${escapeCell(entry.path)} |`);
  });
  return out.join('\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { top: { type: 'string', default: '12' } } });
  if (positionals.length !== 1) {
    console.error('Usage: node tools/perf/analyze-cpuprofile.mjs <file.cpuprofile> [--top 12]');
    process.exit(1);
  }
  const profile = JSON.parse(readFileSync(positionals[0], 'utf8'));
  console.log(renderCpuMarkdown(analyzeCpuProfile(profile), { top: Number(values.top) }));
}
