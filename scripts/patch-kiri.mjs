// Applies FRC 5572 Slicer additions to a Kiri:Moto checkout (idempotent).
// Usage: node scripts/patch-kiri.mjs <grid-apps dir>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = process.argv[2];
if (!src) throw new Error('usage: patch-kiri.mjs <grid-apps dir>');

// 1. tree supports
fs.copyFileSync(path.join(here, 'kiri-ext', 'tree.js'), path.join(src, 'src/kiri/mode/fdm/work/tree.js'));

const file = path.join(src, 'src/kiri/mode/fdm/work/slice.js');
// normalize line endings (Windows checkouts use CRLF)
let code = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const edits = [
  [
    "import { layerProcessTop } from './post.js';",
    "import { layerProcessTop } from './post.js';\nimport { treeSupports } from './tree.js';",
  ],
  [
    "            // console.log('TREE OUTPUT');",
    "            treeSupports(stack, { process, lineWidth, sliceHeight, minArea, progress: p => trackupdate(p, div[1].lo, div[1].hi, 'support') });",
  ],
  [
    "        // perform accumulation top down\n        for (let slice of stack.slice().reverse()) {",
    "        // perform accumulation top down (skipped for tree supports)\n        for (let slice of (process.sliceSupportTree ? [] : stack.slice().reverse())) {",
  ],
  // tree supports: branches print as a single outline (no fill, like Bambu/Orca);
  // only roof (interface) areas get filled, at interface density
  [
    "    let polys = slice.supports;\n    if (polys) {\n        supportPolyFill({",
    "    let polys = slice.supports;\n    if (polys && slice.treeRoofs) {\n        polys = polys.filter(p => slice.treeRoofs.some(r => p.isInside(r, 0.2)));\n        density = Math.max(density, 0.45);\n    }\n    if (polys && polys.length) {\n        supportPolyFill({",
  ],
];
for (const [from, to] of edits) {
  if (code.includes(to)) continue;
  if (!code.includes(from)) throw new Error(`patch-kiri: anchor not found in slice.js:\n${from}`);
  code = code.replace(from, to);
}
fs.writeFileSync(file, code);

// 2. gyroid infill: replace Kiri's tiled gyroid with an analytic generator
// (much faster, and correct density). See scripts/kiri-ext/gyroid.js.
const fillFile = path.join(src, 'src/kiri/mode/fdm/work/fill.js');
let fill = fs.readFileSync(fillFile, 'utf8').replace(/\r\n/g, '\n');
if (!fill.includes('function fillGyroidFast(')) {
  if (!fill.includes('    gyroid: fillGyroid,')) throw new Error('patch-kiri: gyroid registry not found in fill.js');
  fill = fill.replace('    gyroid: fillGyroid,', '    gyroid: fillGyroidFast,');
  fill += fs.readFileSync(path.join(here, 'kiri-ext', 'gyroid.js'), 'utf8');
}
fs.writeFileSync(fillFile, fill);
console.log('>> patched Kiri:Moto (tree supports, analytic gyroid)');
