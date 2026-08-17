#!/usr/bin/env node
/* tools/edit.js — click-to-edit content editor for the site.

   There is no local Jekyll render on this machine (no Ruby), but the exhibit
   pages contain zero Liquid below their front matter, so the HTML on disk is
   byte-for-byte the HTML that ships. That lets us build a faithful local page
   out of two halves: the deployed shell (head, sidebar, topbar, compiled theme
   CSS) fetched once from the live site, and the LOCAL file's body spliced into
   it between <main> and </main>. Assets are served off disk when they exist
   locally and proxied to the live site when they come from the theme gem.

   Usage:  node tools/edit.js                 http://localhost:8790/
           node tools/edit.js --refresh-shell  re-fetch every cached shell
           PORT=8795 node tools/edit.js

   Editing model — deliberately conservative. The prose here is full of inline
   <em>/<strong>/<a> and HTML entities (&mdash;, &middot;), and paragraphs are
   hard-wrapped across source lines. So this NEVER round-trips text: it records
   the byte range of each prose element's innerHTML in the source file, and on
   save splices back only the elements you actually typed into. Everything you
   did not touch stays byte-identical.

   Markdown pages and _layouts/home.html (which has Liquid mid-sentence) can't
   be safely written back from rendered HTML, so they open a raw source panel
   instead. */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, execFile } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'https://michael-buttitta.github.io';
const CACHE_DIR = path.join(__dirname, '.shell-cache');
const PORT = Number(process.env.PORT) || 8790;
const REFRESH = process.argv.includes('--refresh-shell');
const NO_OPEN = process.argv.includes('--no-open');

/* Only these directories may ever be written by a save request. */
const WRITABLE = ['_tabs', '_layouts', '_posts'];

/* ------------------------------------------------------------------ *
 * Route table: URL path -> source file.
 * The URL follows the FILENAME slug, not the front-matter title
 * (_tabs/operating-systems.html -> /operating-systems/), so the file
 * listing is the routing table.
 * ------------------------------------------------------------------ */
function routes() {
  const map = new Map();
  map.set('/', { file: '_layouts/home.html', mode: 'home' });
  for (const name of fs.readdirSync(path.join(ROOT, '_tabs'))) {
    const ext = path.extname(name);
    if (ext !== '.html' && ext !== '.md') { continue; }
    /* published: false tabs (consulting, and categories/tags/archives until
       there are posts) do not exist on the live site, so there is no shell to
       fetch — routing them would just cache a 404 page. */
    const head = fs.readFileSync(path.join(ROOT, '_tabs', name), 'utf8').slice(0, 1200);
    if (/^published:\s*false/m.test(head)) { continue; }
    const slug = path.basename(name, ext);
    map.set('/' + slug + '/', {
      file: '_tabs/' + name,
      mode: ext === '.md' ? 'md' : 'rich'
    });
  }
  for (const name of fs.existsSync(path.join(ROOT, '_posts')) ? fs.readdirSync(path.join(ROOT, '_posts')) : []) {
    if (!/^\d{4}-\d{2}-\d{2}-.+\.md$/.test(name)) { continue; }
    const slug = name.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '');
    map.set('/posts/' + slug + '/', { file: '_posts/' + name, mode: 'raw' });
  }
  return map;
}

/* ------------------------------------------------------------------ *
 * Deployed shell, fetched once and cached so the editor works offline.
 * curl, not Node fetch: Node's fetch intermittently aborts on teardown
 * on this machine (libuv UV_HANDLE_CLOSING) and returns empty output
 * even after a successful request.
 * ------------------------------------------------------------------ */
function shellFor(urlPath) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const key = (urlPath === '/' ? 'index' : urlPath.replace(/^\/|\/$/g, '').replace(/\//g, '_'));
  const cached = path.join(CACHE_DIR, key + '.html');
  if (!REFRESH && fs.existsSync(cached)) { return fs.readFileSync(cached, 'utf8'); }
  const url = ORIGIN + urlPath + '?nocache=' + Date.now();
  process.stdout.write('  fetching shell for ' + urlPath + ' ... ');
  const html = execFileSync('curl', ['-sS', '-L', url], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (!html || html.length < 500) { throw new Error('empty response from ' + url); }
  fs.writeFileSync(cached, html);
  console.log('cached (' + html.length + ' bytes)');
  return html;
}

/* ------------------------------------------------------------------ *
 * Front matter
 * ------------------------------------------------------------------ */
function splitFrontMatter(src) {
  if (!src.startsWith('---')) { return { bodyStart: 0 }; }
  const end = src.indexOf('\n---', 3);
  if (end === -1) { return { bodyStart: 0 }; }
  const nl = src.indexOf('\n', end + 1);
  return { bodyStart: nl === -1 ? src.length : nl + 1 };
}

/* ------------------------------------------------------------------ *
 * Prose scanner
 *
 * A hand-written tag walker rather than a parser dependency: node_modules in
 * a Pages repo is a build-time liability, and all we need is balanced-tag
 * tracking with correct handling of quoted attribute values (aria-label
 * strings in these files contain '>' characters).
 * ------------------------------------------------------------------ */

/* Known gap: the <noscript> fallback paragraph does get marked, but browsers
   with scripting enabled parse <noscript> contents as raw text rather than DOM,
   so it is never clickable. That copy is reachable with tools/find.js. */

/* Elements whose text a writer would want to change. */
const CANDIDATE = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'li', 'td', 'th', 'dt', 'dd', 'figcaption', 'caption', 'span']);

/* If any of these appears inside a candidate, it is not a leaf prose element.
   canvas/svg/output/button/input make it interactive or runtime-driven; the
   block tags mean the real prose is in a child, not here. */
const DISQUALIFY = /<(div|section|article|aside|header|footer|nav|main|form|table|thead|tbody|tr|td|th|ul|ol|li|dl|dt|dd|p|h1|h2|h3|h4|h5|h6|canvas|svg|figure|button|input|select|textarea|output|iframe|video|audio|img|picture|script|style|noscript)\b/i;

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

/* Walk `src` from `from`, returning every tag as {name, kind, start, end, attrs}. */
function* tags(src, from) {
  let i = from;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) { return; }
    if (src.startsWith('<!--', lt)) {
      const close = src.indexOf('-->', lt);
      i = close === -1 ? src.length : close + 3;
      continue;
    }
    if (src.startsWith('<!', lt)) {
      const close = src.indexOf('>', lt);
      i = close === -1 ? src.length : close + 1;
      continue;
    }
    const closing = src[lt + 1] === '/';
    let j = lt + (closing ? 2 : 1);
    const nameStart = j;
    while (j < src.length && /[a-zA-Z0-9:-]/.test(src[j])) { j++; }
    const name = src.slice(nameStart, j).toLowerCase();
    if (!name) { i = lt + 1; continue; }
    /* Scan to the tag's '>', skipping over quoted attribute values. */
    let quote = null;
    while (j < src.length) {
      const c = src[j];
      if (quote) { if (c === quote) { quote = null; } }
      else if (c === '"' || c === "'") { quote = c; }
      else if (c === '>') { break; }
      j++;
    }
    const end = j + 1;
    const selfClosing = src[j - 1] === '/';
    yield { name, closing, selfClosing, start: lt, end, attrs: src.slice(nameStart + name.length, selfClosing ? j - 1 : j) };
    /* Raw-text elements: their contents are not markup. */
    if (!closing && !selfClosing && (name === 'script' || name === 'style')) {
      const re = new RegExp('</' + name + '\\s*>', 'i');
      const rest = src.slice(end);
      const m = re.exec(rest);
      i = m ? end + m.index + m[0].length : src.length;
      continue;
    }
    i = end;
  }
}

/* Find every editable prose element in `src` at or after `bodyStart`.
   Offsets returned are absolute positions in the whole file. */
function scanProse(src, bodyStart, bodyEnd) {
  const limit = bodyEnd == null ? src.length : bodyEnd;
  const stack = [];
  const found = [];
  for (const t of tags(src, bodyStart)) {
    if (t.start >= limit) { break; }
    if (t.closing) {
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k].name === t.name) {
          const open = stack[k];
          stack.length = k;
          if (!CANDIDATE.has(t.name)) { break; }
          const inner = src.slice(open.innerStart, t.start);
          if (DISQUALIFY.test(inner)) { break; }
          /* Liquid in the source means what you see is computed, not written:
             _layouts/home.html derives its exhibit count from site.tabs and
             builds hrefs through relative_url. Saving the browser's rendered
             view would replace `{{ exhibit_tabs.size }}` with a frozen number
             and strip the filters. Those blocks stay read-only. */
          if (inner.includes('{{') || inner.includes('{%')) { break; }
          /* aria-live and aria-hidden elements are runtime surfaces, not copy. */
          if (/\baria-(live|hidden)\s*=/i.test(open.attrs)) { break; }
          /* Empty in source means JS fills it at runtime (e.g. p#gx-race-verdict);
             editing that would write a computed value into the file. */
          if (!/[A-Za-z0-9]/.test(inner.replace(/<[^>]*>/g, ''))) { break; }
          found.push({ tagStart: open.start, tagEnd: open.end, start: open.innerStart, end: t.start });
          break;
        }
      }
      continue;
    }
    if (t.selfClosing || VOID.has(t.name)) { continue; }
    stack.push({ name: t.name, start: t.start, end: t.end, innerStart: t.end, attrs: t.attrs });
  }
  /* Drop candidates nested inside another editable one, so ranges never
     overlap — you edit the outer paragraph, inline spans and all. */
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  let lastEnd = -1;
  for (const f of found) {
    if (f.start < lastEnd) { continue; }
    out.push(f);
    lastEnd = f.end;
  }
  return out;
}

/* Insert data-edit="start:end" into each element's open tag. Applied
   back-to-front so earlier offsets stay valid while splicing. */
function markProse(src, bodyStart, bodyEnd) {
  const spots = scanProse(src, bodyStart, bodyEnd);
  let body = src.slice(bodyStart, bodyEnd == null ? src.length : bodyEnd);
  const shift = bodyStart;
  for (let i = spots.length - 1; i >= 0; i--) {
    const s = spots[i];
    const at = s.tagEnd - 1 - shift - (src[s.tagEnd - 2] === '/' ? 1 : 0);
    body = body.slice(0, at) + ' data-edit="' + s.start + ':' + s.end + '"' + body.slice(at);
  }
  return { body, count: spots.length };
}

/* ------------------------------------------------------------------ *
 * Home page
 *
 * _layouts/home.html is two different things in one file: a hand-written
 * hero and Technology Map teaser at the top, then the theme's post-list
 * machinery — 140 lines of Liquid nobody edits as prose. So only the
 * authored region is served from disk and made editable; everything below
 * it keeps coming from the deployed page, already rendered.
 *
 * The Liquid resolved below is for DISPLAY ONLY. Blocks whose source
 * contains Liquid are never editable (see scanProse), so a resolved value
 * can never be written back to the file.
 * ------------------------------------------------------------------ */
const AUTHORED_END = '{% assign all_pinned';

function resolveLiquidForDisplay(html, exhibitCount) {
  return html
    /* Tags ({% assign %}, {% include %}) render nothing — drop them so they
       are not visible as literal text between the sections. */
    .replace(/\{%[\s\S]*?%\}/g, '')
    .replace(/\{\{\s*'([^']+)'\s*\|\s*relative_url\s*\}\}/g, '$1')
    .replace(/\{\{\s*exhibit_tabs\.size\s*\}\}/g, String(exhibitCount));
}

/* ------------------------------------------------------------------ *
 * Markdown pages (_tabs/about.md, posts)
 *
 * Rendered here rather than shown as a raw file, so the same click-to-edit
 * gesture works. The important difference from the HTML path: what you edit
 * is the block's MARKDOWN, swapped in on focus, and it is written back
 * verbatim. Converting rendered HTML back to Markdown would be lossy — this
 * way `[text](/url/)` and `**bold**` round-trip exactly, because they are
 * never converted at all.
 *
 * Deliberately a small subset — headings, paragraphs, lists, rules, and the
 * inline forms about.md actually uses. Kramdown does more; anything it
 * renders that this misses still displays as its own source text, which is
 * visible rather than silently wrong.
 * ------------------------------------------------------------------ */
function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inlineMd(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
}

function renderMarkdown(src, bodyStart) {
  const text = src.slice(bodyStart);
  const lines = text.split('\n');
  const out = [];
  let count = 0;
  let i = 0;
  let offset = bodyStart;

  /* Byte offset of the start of each line. */
  const lineStart = [];
  let acc = bodyStart;
  for (const ln of lines) { lineStart.push(acc); acc += ln.length + 1; }

  function block(tag, from, to, cls) {
    const start = lineStart[from];
    const end = lineStart[to] + lines[to].length;
    const raw = src.slice(start, end);
    count++;
    return '<' + tag + (cls ? ' class="' + cls + '"' : '')
      + ' data-edit="' + start + ':' + end + '" data-md="1"'
      + ' data-md-src="' + esc(raw) + '">'
      + inlineMd(raw.replace(/^#{1,6}\s+/, '').replace(/^[-*]\s+/, ''))
      + '</' + tag + '>';
  }

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^<!--/.test(line.trim())) {
      while (i < lines.length && !lines[i].includes('-->')) { i++; }
      i++;
      continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line.trim())) { out.push('<hr>'); i++; continue; }
    const h = /^(#{1,6})\s+/.exec(line);
    if (h) { out.push(block('h' + h[1].length, i, i)); i++; continue; }
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i]) || (items.length && lines[i].trim() && !/^\s*$/.test(lines[i]) && /^\s{2,}/.test(lines[i])))) {
        if (/^\s*[-*]\s+/.test(lines[i])) { items.push([i, i]); }
        else { items[items.length - 1][1] = i; }
        i++;
      }
      out.push('<ul>' + items.map(r => block('li', r[0], r[1])).join('') + '</ul>');
      continue;
    }
    const from = i;
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|<!--|\s*[-*]\s)/.test(lines[i]) && !/^(-{3,}|\*{3,})\s*$/.test(lines[i].trim())) { i++; }
    out.push(block('p', from, i - 1));
  }
  return { html: '<div class="content">' + out.join('\n') + '</div>', count };
}

/* ------------------------------------------------------------------ *
 * Writeback
 * ------------------------------------------------------------------ */

/* contenteditable hands back raw Unicode; the source files use named entities.
   Re-encode the set this codebase actually uses so a one-word change does not
   rewrite the punctuation of the whole paragraph. */
const ENTITIES = [
  [' ', '&nbsp;'], ['—', '&mdash;'], ['–', '&ndash;'],
  ['·', '&middot;'], ['“', '&ldquo;'], ['”', '&rdquo;'],
  ['‘', '&lsquo;'], ['’', '&rsquo;'], ['×', '&times;'],
  ['≈', '&asymp;'], ['→', '&rarr;'], ['←', '&larr;'],
  ['≥', '&ge;'], ['≤', '&le;'], ['±', '&plusmn;'],
  ['…', '&hellip;'], ['½', '&frac12;'], ['°', '&deg;']
];

/* Re-encode only the entities THIS file already uses. The exhibit pages write
   `&mdash;`, but _layouts/home.html writes a literal em dash — blanket encoding
   would rewrite that file's punctuation on the first edit for no visual change.
   Either form renders identically, so the file's own convention wins. */
function normalize(html, src) {
  let s = html;
  for (const [ch, ent] of ENTITIES) {
    if (src && !src.includes(ent)) { continue; }
    s = s.split(ch).join(ent);
  }
  /* The browser echoes back our own marker; it must never reach the file. */
  s = s.replace(/\s*data-edit="\d+:\d+"/g, '');
  return s;
}

function applyEdits(file, hash, edits) {
  const abs = path.join(ROOT, file);
  const src = fs.readFileSync(abs, 'utf8');
  if (sha(src) !== hash) {
    throw new Error('File changed on disk since this page was loaded. Reload the page and redo the edit — refusing to overwrite.');
  }
  /* core.autocrlf is true here, so a file can be CRLF on disk while the browser
     always hands back \n inside innerHTML. Match the file rather than leaving it
     with mixed endings. */
  const crlf = (src.match(/\r\n/g) || []).length > (src.match(/(?<!\r)\n/g) || []).length;
  /* Markdown is plain text — entity-encoding it would put a literal &mdash;
     into the prose. That normalization exists only for the HTML pages, whose
     source already uses named entities. */
  const isMd = file.endsWith('.md');
  const sorted = edits.slice().sort((a, b) => b.start - a.start);
  let lastStart = Infinity;
  let out = src;
  for (const e of sorted) {
    if (!(e.end >= e.start) || e.end > src.length) { throw new Error('edit range out of bounds'); }
    if (e.end > lastStart) { throw new Error('overlapping edit ranges'); }
    lastStart = e.start;
    let html = isMd ? e.html : normalize(e.html, src);
    if (crlf) { html = html.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'); }
    out = out.slice(0, e.start) + html + out.slice(e.end);
  }
  fs.writeFileSync(abs, out);
  return sorted.length;
}

function sha(s) { return crypto.createHash('sha256').update(s, 'utf8').digest('hex'); }

function assertWritable(file) {
  const norm = file.replace(/\\/g, '/');
  if (norm.includes('..') || !WRITABLE.some(d => norm.startsWith(d + '/'))) {
    throw new Error('refusing to write outside ' + WRITABLE.join(', ') + ': ' + file);
  }
  if (!fs.existsSync(path.join(ROOT, norm))) { throw new Error('no such file: ' + file); }
  return norm;
}

/* ------------------------------------------------------------------ *
 * Page assembly
 * ------------------------------------------------------------------ */

/* Chirpy registers a service worker that will happily serve a stale cached
   page from this origin and survive restarts. Kill it before its script runs.
   (Same reason and same approach as _audit/proxy.js.) */
const SW_KILL = `<script>
(function(){
  if (navigator.serviceWorker) {
    try {
      navigator.serviceWorker.register = function(){ return Promise.resolve({ unregister: function(){ return Promise.resolve(true); } }); };
      navigator.serviceWorker.getRegistrations().then(function(rs){ rs.forEach(function(r){ r.unregister(); }); }).catch(function(){});
    } catch (e) {}
  }
  if (window.caches && caches.keys) { caches.keys().then(function(ks){ ks.forEach(function(k){ caches.delete(k); }); }).catch(function(){}); }
})();
</script>`;

function buildPage(urlPath, route) {
  const abs = path.join(ROOT, route.file);
  const src = fs.readFileSync(abs, 'utf8');
  const shell = shellFor(urlPath);

  const mainOpen = shell.search(/<main\b/i);
  const mainGt = mainOpen === -1 ? -1 : shell.indexOf('>', mainOpen);
  const mainClose = shell.indexOf('</main>', mainGt);
  if (mainOpen === -1 || mainClose === -1) {
    throw new Error('could not find <main> in the cached shell for ' + urlPath + ' — try --refresh-shell');
  }

  let inner;
  let count = 0;
  if (route.mode === 'rich') {
    const { bodyStart } = splitFrontMatter(src);
    const marked = markProse(src, bodyStart);
    inner = marked.body;
    count = marked.count;
  } else if (route.mode === 'home') {
    const { bodyStart } = splitFrontMatter(src);
    const stop = src.indexOf(AUTHORED_END);
    const marked = markProse(src, bodyStart, stop === -1 ? src.length : stop);
    /* Derived exactly the way the Liquid derives it: every exhibit uses
       layout: gpu, and /map/ is the only non-exhibit that does. */
    const exhibits = [...ROUTES.values()].filter(r => r.mode === 'rich').length - 1;
    const authored = resolveLiquidForDisplay(marked.body, exhibits);

    /* Everything after the Technology Map section — the post list or the
       "Writing coming soon" empty state — comes from the deployed page. */
    const deployedMain = shell.slice(mainGt + 1, mainClose);
    const cta = deployedMain.indexOf('tmap-cta');
    const secEnd = cta === -1 ? -1 : deployedMain.indexOf('</section>', cta);
    inner = authored + (secEnd === -1 ? '' : deployedMain.slice(secEnd + '</section>'.length));
    count = marked.count;
  } else if (route.mode === 'md') {
    const { bodyStart } = splitFrontMatter(src);
    const rendered = renderMarkdown(src, bodyStart);
    /* Keep the deployed page's own wrappers (title header, post content class)
       so the theme's typography still applies; swap only the article body. */
    const deployed = shell.slice(mainGt + 1, mainClose);
    const cStart = deployed.indexOf('<div class="content">');
    const cEnd = cStart === -1 ? -1 : deployed.lastIndexOf('</div>');
    inner = cStart === -1
      ? rendered.html
      : deployed.slice(0, cStart) + rendered.html + deployed.slice(cEnd + 6);
    count = rendered.count;
  } else {
    /* Raw mode keeps the deployed body on screen for context; the local file
       is edited through the source panel instead. */
    inner = shell.slice(mainGt + 1, mainClose);
  }

  const config = {
    file: route.file.replace(/\\/g, '/'),
    /* home edits HTML innerHTML exactly like an exhibit — the client needs no
       separate case, only the server assembles it differently. */
    mode: route.mode === 'home' ? 'rich' : route.mode,
    hash: sha(src),
    count: count,
    raw: route.mode === 'raw' ? src : null,
    /* Every editable page, so the toolbar can offer a jump list — otherwise the
       only way to reach a page is to know its URL, and landing on a raw-mode
       page (like /) reads as "nothing is clickable". */
    pages: [...ROUTES.entries()].map(([url, r]) => ({ url: url, mode: r.mode }))
  };

  const head = shell.slice(0, mainGt + 1);
  const tail = shell.slice(mainClose);
  const boot = SW_KILL
    + '<script>window.__EDIT__=' + JSON.stringify(config).replace(/</g, '\\u003c') + ';</script>'
    + '<script src="/__editor.js"></script>';
  const page = head + inner + tail;
  return page.includes('</body>')
    ? page.replace('</body>', boot + '</body>')
    : page + boot;
}

/* ------------------------------------------------------------------ *
 * Static assets: local file when we have one, live site otherwise
 * (theme CSS/JS is compiled inside the gem and only exists deployed).
 * ------------------------------------------------------------------ */
const MIME = {
  '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.txt': 'text/plain', '.html': 'text/html'
};

function serveAsset(urlPath, res) {
  const clean = urlPath.split('?')[0];
  const local = path.join(ROOT, clean.replace(/^\//, ''));
  if (local.startsWith(ROOT) && fs.existsSync(local) && fs.statSync(local).isFile()) {
    res.writeHead(200, {
      'content-type': MIME[path.extname(local)] || 'application/octet-stream',
      'cache-control': 'no-store'
    });
    res.end(fs.readFileSync(local));
    return;
  }
  try {
    const buf = execFileSync('curl', ['-sS', '-L', ORIGIN + clean], { maxBuffer: 32 * 1024 * 1024 });
    res.writeHead(200, {
      'content-type': MIME[path.extname(clean)] || 'application/octet-stream',
      'cache-control': 'no-store'
    });
    res.end(buf);
  } catch (e) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found: ' + clean);
  }
}

/* ------------------------------------------------------------------ *
 * Live reload
 * ------------------------------------------------------------------ */
const clients = new Set();
let reloadTimer = null;

function watch() {
  for (const dir of ['_tabs', '_layouts', 'assets/css', 'assets/js', '_posts']) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) { continue; }
    fs.watch(abs, { persistent: true }, () => {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        for (const c of clients) { try { c.write('data: reload\n\n'); } catch (e) { /* client gone */ } }
      }, 120);
    });
  }
}

/* ------------------------------------------------------------------ *
 * Server
 * ------------------------------------------------------------------ */
const ROUTES = routes();

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);

  /* Lets a second launch recognise a running editor instead of starting
     another one on the next port up. */
  if (urlPath === '/__alive') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('edit.js');
    return;
  }

  if (urlPath === '/__editor.js') {
    res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
    res.end(fs.readFileSync(path.join(__dirname, 'editor-client.js')));
    return;
  }

  if (urlPath === '/__events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write('retry: 1000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (urlPath === '/__save' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const file = assertWritable(payload.file);
        let n;
        if (payload.raw != null) {
          const current = fs.readFileSync(path.join(ROOT, file), 'utf8');
          if (sha(current) !== payload.hash) {
            throw new Error('File changed on disk since this page was loaded. Reload and redo the edit.');
          }
          fs.writeFileSync(path.join(ROOT, file), payload.raw);
          n = 1;
        } else {
          n = applyEdits(file, payload.hash, payload.edits || []);
        }
        const after = sha(fs.readFileSync(path.join(ROOT, file), 'utf8'));
        console.log('  saved ' + n + ' edit(s) -> ' + file);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, saved: n, hash: after }));
      } catch (e) {
        console.log('  save refused: ' + e.message);
        res.writeHead(409, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  const route = ROUTES.get(urlPath) || (urlPath.endsWith('/') ? null : ROUTES.get(urlPath + '/'));
  if (route) {
    try {
      const html = buildPage(urlPath.endsWith('/') ? urlPath : urlPath + '/', route);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(html);
    } catch (e) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('edit.js: ' + e.message + '\n\n' + e.stack);
    }
    return;
  }

  serveAsset(urlPath, res);
});

/* Open the browser. Async on purpose: a synchronous launch that hung would
   take the server down with it, and the URL is always printed anyway. */
function openBrowser(port) {
  const url = 'http://localhost:' + port + '/';
  const cmd = process.platform === 'win32'
    ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  execFile(cmd[0], cmd[1], () => { /* no browser available; ignore */ });
}

/* If an editor is already up on this port, just bring it to the front. Without
   this, asking for the editor twice leaves two servers on climbing ports and
   the browser pointed at whichever one you opened last. */
function reuseOrStart(start) {
  let done = false;
  const go = () => { if (!done) { done = true; start(); } };
  const req = http.get({ host: 'localhost', port: PORT, path: '/__alive', timeout: 800 }, (res) => {
    let body = '';
    res.on('data', (c) => { body += c; });
    res.on('end', () => {
      if (body.trim() !== 'edit.js') { go(); return; }
      done = true;
      console.log('\n  Editor already running on http://localhost:' + PORT + '/ — opening it.\n');
      if (!NO_OPEN) { openBrowser(PORT); }
      setTimeout(() => process.exit(0), 300);
    });
  });
  req.on('error', go);
  req.on('timeout', () => { req.destroy(); go(); });
}

/* A server left running by an earlier session squats its port, and Git Bash on
   Windows has no pkill — walk up rather than dying on EADDRINUSE. */
function listen(port, attemptsLeft) {
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.log('port ' + port + ' busy — trying ' + (port + 1));
      listen(port + 1, attemptsLeft - 1);
    } else {
      console.error('edit.js failed to listen: ' + e.message);
      process.exitCode = 1;
    }
  });
  server.listen(port, () => {
    console.log('\n  Content editor on http://localhost:' + port + '\n');
    const byMode = m => [...ROUTES.entries()].filter(([, r]) => r.mode === m).map(([u]) => u);
    const rich = byMode('home').concat(byMode('rich'));
    const md = byMode('md');
    console.log('  click-to-edit, HTML (' + rich.length + '):');
    console.log('    ' + rich.join('  '));
    console.log('  click-to-edit, Markdown (' + md.length + ') — click shows the block\'s Markdown:');
    console.log('    ' + md.join('  '));
    console.log('\n  Click any paragraph, type, Ctrl+S. Jump between pages with the');
    console.log('  dropdown in the bottom toolbar. Stop with Ctrl-C.\n');
    watch();
    if (!NO_OPEN) { openBrowser(port); }
  });
}

reuseOrStart(() => listen(PORT, 8));
