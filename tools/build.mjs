// Joins src/pure.js and src/plugin.js into main.js. No dependencies, no transforms.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const read = (name) => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');
// BUILD goes into each line of the latency log, to show which code was loaded.
const build = createHash('sha256').update(read('pure.js') + read('plugin.js')).digest('hex').slice(0, 8);
const out = [
  '// Built by tools/build.mjs from src/pure.js and src/plugin.js. Edit those, not this file.',
  `const BUILD = '${build}';`,
  'const pure = (() => { const module = { exports: {} };',
  read('pure.js'),
  'return module.exports; })();',
  read('plugin.js'),
].join('\n');
writeFileSync(new URL('../main.js', import.meta.url), out);
console.log(`main.js ${out.split('\n').length} lines`);
