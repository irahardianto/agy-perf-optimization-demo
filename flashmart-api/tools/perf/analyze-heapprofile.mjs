#!/usr/bin/env node
// Summarises a V8 sampling heap profile (.heapprofile) as Markdown: allocation hot spots
// attributed to the nearest project function.
//
// Profiles written by tools/perf/profile.mjs include objects that were already garbage-collected,
// so they show *allocation volume* (what drives GC pressure), like pprof's alloc_space.
//
// Usage: node tools/perf/analyze-heapprofile.mjs <file.heapprofile> [--top 12]
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createFrameClassifier, escapeCell, PROJECT_ROOT } from './lib/frames.mjs';

const MB = 1024 * 1024;
const mb = (bytes) => (bytes / MB).toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const share = (part, whole) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '-');

function addTo(map, frame, bytes) {
  const entry = map.get(frame.id) ?? { frame, bytes: 0 };
  entry.bytes += bytes;
  map.set(frame.id, entry);
  return entry;
}

/** @param {{ head: { callFrame: object, selfSize: number, children: any[] } }} profile */
export function analyzeHeapProfile(profile, { projectRoot = PROJECT_ROOT } = {}) {
  const describe = createFrameClassifier(projectRoot);
  const owners = new Map();
  const flat = new Map();
  let totalBytes = 0;
  let unattributedBytes = 0;

  const pending = [{ node: profile.head, owner: null }];
  while (pending.length > 0) {
    const { node, owner: parentOwner } = pending.pop();
    const frame = describe(node.callFrame);
    const owner = frame.kind === 'project' ? frame : parentOwner;
    if (node.selfSize > 0) {
      totalBytes += node.selfSize;
      addTo(flat, frame, node.selfSize);
      if (owner) {
        const entry = addTo(owners, owner, node.selfSize);
        if (frame.kind !== 'project') {
          entry.callees ??= new Map();
          addTo(entry.callees, frame, node.selfSize);
        }
      } else {
        unattributedBytes += node.selfSize;
      }
    }
    for (const child of node.children ?? []) pending.push({ node: child, owner });
  }

  const sorted = (map) => [...map.values()].sort((a, b) => b.bytes - a.bytes);
  return { totalBytes, unattributedBytes, owners: sorted(owners), flat: sorted(flat) };
}

export function renderHeapMarkdown(analysis, { top = 12, requests } = {}) {
  const { totalBytes } = analysis;
  const out = [
    '## Allocation profile (sampled, includes garbage-collected objects)',
    '',
    `${mb(totalBytes)} MB allocated in total${requests ? ` · ≈ ${((totalBytes / requests) / 1024).toFixed(0)} KB per request (${requests.toLocaleString('en-US')} requests served by the process)` : ''}. ` +
      'High allocation volume drives GC time in the CPU profile.',
    '',
    '### Allocation hot spots (nearest project function)',
    '',
    '| # | Function | Location | MB | % | Largest non-project allocators |',
    '|---:|---|---|---:|---:|---|',
  ];
  analysis.owners.slice(0, top).forEach((entry, i) => {
    const callees = entry.callees
      ? [...entry.callees.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 3).map((c) => `${c.frame.name} (${c.frame.kind}) ${share(c.bytes, totalBytes)}`).join(', ')
      : '';
    out.push(`| ${i + 1} | \`${escapeCell(entry.frame.name)}\` | ${entry.frame.location} | ${mb(entry.bytes)} | ${share(entry.bytes, totalBytes)} | ${escapeCell(callees)} |`);
  });
  if (analysis.unattributedBytes > 0) {
    out.push(`| - | (no project frame: Node.js startup / internals) | | ${mb(analysis.unattributedBytes)} | ${share(analysis.unattributedBytes, totalBytes)} | |`);
  }
  out.push('', '### Top allocating functions, all code (flat)', '', '| # | Function | Kind | Location | MB | % |', '|---:|---|---|---|---:|---:|');
  analysis.flat.slice(0, top).forEach((entry, i) => {
    out.push(`| ${i + 1} | \`${escapeCell(entry.frame.name)}\` | ${entry.frame.kind} | ${escapeCell(entry.frame.location)} | ${mb(entry.bytes)} | ${share(entry.bytes, totalBytes)} |`);
  });
  return out.join('\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { top: { type: 'string', default: '12' } } });
  if (positionals.length !== 1) {
    console.error('Usage: node tools/perf/analyze-heapprofile.mjs <file.heapprofile> [--top 12]');
    process.exit(1);
  }
  const profile = JSON.parse(readFileSync(positionals[0], 'utf8'));
  console.log(renderHeapMarkdown(analyzeHeapProfile(profile), { top: Number(values.top) }));
}
