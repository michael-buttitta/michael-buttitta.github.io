# The Technology Map — knowledge-graph architecture

The site's interactive exhibits form one connected learning system rather than
isolated pages. This document describes the mechanism and the roadmap.

## Single source of truth

`assets/js/knowledge-graph.js` defines everything once:

- **Topics** — id, name, URL (null = planned/ghost node), category, FA glyph,
  hand-tuned map coordinates, tagline, blurb, prerequisites.
- **Edges** — undirected relationships, each with a one-sentence explanation
  of *why* the two topics relate (these sentences are the teaching payload).
- **Learning paths** — Foundations of Computing, Security & Trust, The Road
  to AI.
- **Progress store** — localStorage (`tm-progress-v1`); a topic is *started*
  on visit and *explored* once the visitor scrolls past 60% of the page.
  Nothing leaves the browser.

The file is Node-requirable (exports the graph, no DOM), so data integrity is
testable: `node -e "const G=require('./assets/js/knowledge-graph.js'); ..."`.

**Adding a topic** = one entry in TOPICS (+ edges/path steps), a locale key in
`_data/locales/en.yml`, and the page itself. The map, the per-page navigation,
and the progress system pick it up automatically. Planned topics with
`url: null` appear as dashed "coming soon" ghost nodes — the map is designed
to absorb 30–50 topics by adding categories and coordinates, not new code.

## Consumers

1. **`/map/`** (`_tabs/map.html` + `assets/css/map.css` + `assets/js/map.js`)
   — the central navigation experience. Pannable/zoomable SVG graph (drag,
   wheel, pinch, buttons), hover/focus lights up a topic's neighborhood,
   hovering a connection shows its relationship sentence, click opens a
   detail panel (prereqs, unlocks, connections, CTA). Search + category
   filter chips double as a legend. Below the graph: a "continue where you
   left off" card, the three learning-path cards with live progress, and a
   fully static "All topics" index (works without JS; html-proofer-visible
   links).

2. **Every exhibit page** loads `knowledge-graph.js` + `knowledge-nav.js`
   (+ `knowledge-nav.css`) via `extra_js`/`extra_css`. The script finds the
   page's topic by URL, records progress, and injects a "Where this fits"
   section at the end of the `[id$="-experience"]` container:
   Learn-first / You-are-here / Go-next dependency diagram (with SVG
   connector curves), connection cards with the relationship sentences,
   learning-path steppers, and a CTA to /map/.

3. **Home page** (`_layouts/home.html`) — hero CTA leads with the map; a
   static "One living map of computing" section lists all exhibits grouped
   by category (styles in `assets/css/jekyll-theme-chirpy.scss`, `.tmap-*`).

## Design language

Category colors (defined once in knowledge-graph.js, mirrored in the static
HTML): Hardware `#2DD4BF` teal · Systems `#A78BFA` violet · Networks
`#38BDF8` sky · Security & Trust `#FBBF24` amber · Intelligence `#FB7185`
rose · Roadmap `#64748B` slate. Base palette matches the site skin
(slate `#0F172A`, teal accent, Inter).

## Capstone experiences

**"How ChatGPT Works" (`/chatgpt/`) is the first capstone** — a synthesis
journey that follows one prompt end-to-end and links *into* the foundational
exhibits rather than repeating them. Mechanically it is a normal topic entry
plus `capstone: true` and `cat: 'capstone'` (category color `#F8FAFC`):
`map.js` renders capstones as larger **hexagonal** nodes with a glow
(`.tm-node-capstone`), and the static index/home mirrors use
`.tm-card-capstone` / a Capstone group. The page itself
(`_tabs/chatgpt.html`, `assets/css/chatgpt.css`, `assets/js/chatgpt.js`,
`.cg-*` classes) also renders a mini constellation of the shared graph that
illuminates node-by-node as chapters are read (session-local, separate from
the localStorage progress store).

## Roadmap (deliberately not built yet)

- **More capstone journeys**: "How a Credit Card Transaction Works"
  (cryptography + internet + databases), "How Netflix Streams a Movie"
  (internet + cloud + memory + OS) — follow the chatgpt mechanism above.
- **Knowledge checkpoints** — optional predict-what-happens-next micro
  interactions inside exhibits, feeding the same progress store.
- **Next topics** — Large Language Models, Databases, Algorithms, Quantum
  Computing already exist as ghost nodes; each new page should follow the
  established mechanism (layout `gpu`, scoped CSS, `extra_js`, locale key,
  graph entry). Machine Learning graduated from ghost node to a live
  exhibit (`/machine-learning/`) in July 2026.
- **Component extraction** — the exhibits share patterns (chapter rail, hero
  canvas, sim controls) that were built per-page; extract shared CSS/JS only
  when a third consumer appears, to avoid premature abstraction.
