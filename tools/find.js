#!/usr/bin/env node
/* tools/find.js — find any sentence on the site and get its file:line.

   The click-to-edit server covers prose that lives in HTML. About a fifth of
   the site's writing does not: step captions, tooltips, status sentences and
   the shared topic tagline/blurb registry all live inside assets/js/*.js as
   string literals. Refactoring those out would mean touching thirteen working
   algorithm files, which is not worth the risk — so this is the way in.

   Usage:  node tools/find.js "billions of transistors"
           node tools/find.js --js "Streamed material"    (JS files only)   */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const jsOnly = args[0] === '--js' && args.shift();
const needle = args.join(' ').trim();

if (!needle) {
  console.error('usage: node tools/find.js [--js] "text to find"');
  process.exit(2);
}

const DIRS = jsOnly ? ['assets/js'] : ['_tabs', '_layouts', '_includes', '_posts', 'assets/js', '_data'];
const EXT = new Set(['.html', '.md', '.js', '.yml']);

function walk(dir, out) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) { return out; }
  for (const name of fs.readdirSync(abs)) {
    const rel = dir + '/' + name;
    const full = path.join(ROOT, rel);
    if (fs.statSync(full).isDirectory()) { walk(rel, out); }
    else if (EXT.has(path.extname(name))) { out.push(rel); }
  }
  return out;
}

const targets = DIRS.reduce((acc, d) => walk(d, acc), []);
if (!jsOnly && fs.existsSync(path.join(ROOT, '_config.yml'))) { targets.push('_config.yml'); }

const lower = needle.toLowerCase();
let hits = 0;

for (const rel of targets) {
  const lines = fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!line.toLowerCase().includes(lower)) { return; }
    hits++;
    console.log(rel + ':' + (i + 1));
    console.log('    ' + line.trim().slice(0, 200));
  });
}

if (!hits) {
  console.log('no match for "' + needle + '"');
  console.log('note: paragraphs are hard-wrapped in the source, so a phrase that spans');
  console.log('a line break will not match. Try a shorter fragment.');
  process.exitCode = 1;
} else {
  console.log('\n' + hits + ' match' + (hits === 1 ? '' : 'es'));
}
