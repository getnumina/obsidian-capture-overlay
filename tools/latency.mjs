// Summarises latency.jsonl, the log the plugin writes while debug.json exists.
// Usage: node tools/latency.mjs [log file]
// Per variant, arrangement and action it prints, for each timing mark in
// milliseconds since the hotkey callback started: the number of samples, the
// median, the worst case, and "noise": the gap between the median of the odd
// and of the even samples. A change smaller than the noise is not a change.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const LABELS = new Set(['at', 'build', 'variant', 'arrangement', 'action', 'typing']);

export function median(values) {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarise(records) {
  const groups = new Map();
  for (const record of records) {
    const key = `${record.variant} | ${record.arrangement} | ${record.action}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return [...groups].map(([key, rows]) => {
    const marks = [...new Set(rows.flatMap((row) => Object.keys(row).filter((name) => !LABELS.has(name))))];
    return {
      key,
      samples: rows.length,
      builds: [...new Set(rows.map((row) => row.build))],
      typing: rows.filter((row) => row.typing === true).length,
      marks: marks.map((name) => {
        const values = rows.map((row) => row[name]).filter(Number.isFinite);
        const odd = values.filter((_, index) => index % 2 === 1);
        const even = values.filter((_, index) => index % 2 === 0);
        return {
          name,
          n: values.length,
          median: median(values),
          worst: Math.max(...values),
          noise: Math.abs(median(odd) - median(even)),
        };
      }),
    };
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2] || new URL('../latency.jsonl', import.meta.url);
  const records = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((text) => JSON.parse(text));
  const fixed = (value) => (Number.isFinite(value) ? value.toFixed(1) : '-').padStart(8);
  for (const group of summarise(records)) {
    console.log(`\n${group.key}   samples ${group.samples}   builds ${group.builds.join(',')}` +
      (group.key.endsWith('hide') ? '' : `   typing in editor ${group.typing} of ${group.samples}`));
    console.log(`${'mark'.padEnd(12)}${'n'.padStart(4)}${'median'.padStart(8)}${'worst'.padStart(8)}${'noise'.padStart(8)}`);
    for (const mark of group.marks) {
      console.log(`${mark.name.padEnd(12)}${String(mark.n).padStart(4)}${fixed(mark.median)}${fixed(mark.worst)}${fixed(mark.noise)}`);
    }
  }
}
