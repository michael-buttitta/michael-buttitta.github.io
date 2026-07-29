/* ============================================================================
   knowledge-graph.js — the single source of truth for the Technology Map.

   Defines every topic on the site, the relationships between them, and the
   structured learning paths. Consumed by:
     - /assets/js/map.js            (the interactive Technology Map at /map/)
     - /assets/js/knowledge-nav.js  (the "Where this fits" section injected
                                     into every exhibit page)

   Also owns the shared progress store (localStorage) so the map and the
   exhibit pages agree on what the visitor has explored.

   Adding a future topic = add one entry to TOPICS (+ edges/paths as needed).
   Nothing else has to change.
   ========================================================================== */
(function () {
  'use strict';

  /* ----- Categories (color families match the site's fintech skin) ------- */
  var CATEGORIES = {
    hardware:     { name: 'Hardware',           color: '#2DD4BF' },
    systems:      { name: 'Systems & Software', color: '#A78BFA' },
    networks:     { name: 'Networks',           color: '#38BDF8' },
    security:     { name: 'Security & Trust',   color: '#FBBF24' },
    intelligence: { name: 'Intelligence',       color: '#FB7185' },
    capstone:     { name: 'Capstone experiences', color: '#F8FAFC' },
    future:       { name: 'On the roadmap',     color: '#64748B' }
  };

  /* ----- Topics ----------------------------------------------------------
     id       stable key (used in URLs of progress store, edges, paths)
     name     full display name          short  label under the map node
     url      live page (null = planned) cat    category key
     fa       Font Awesome glyph codepoint (weight 900 unless brand:true)
     x, y     hand-tuned position in the map's 1240x820 viewBox
     tagline  one-line hook              blurb  2-3 sentence panel copy
     prereqs  topic ids best understood first (drives "Learn first / Go next")
  ------------------------------------------------------------------------- */
  var TOPICS = [
    {
      id: 'cpu', name: 'Inside a CPU', short: 'CPU', url: '/cpu/',
      cat: 'hardware', fa: '\uf2db', x: 255, y: 465,
      tagline: 'The engine that executes every instruction your computer runs.',
      blurb: 'Fetch, decode, execute — billions of times per second. Registers, ' +
        'caches, pipelines, branch prediction, and multi-core chips, all ' +
        'explained with live simulations.',
      prereqs: []
    },
    {
      id: 'memory', name: 'Inside Memory', short: 'Memory', url: '/memory/',
      cat: 'hardware', fa: '\uf538', x: 480, y: 545,
      tagline: 'How computers remember — from registers to SSDs.',
      blurb: 'The memory hierarchy is a series of trade-offs between speed, ' +
        'size, and cost. Caches, RAM, flash cells, virtual memory and paging, ' +
        'with latency you can feel in live simulations.',
      prereqs: ['cpu']
    },
    {
      id: 'gpu', name: 'Inside a Modern GPU', short: 'GPU', url: '/gpu/',
      cat: 'hardware', fa: '\uf5fd', x: 330, y: 250,
      tagline: 'Thousands of small cores working in parallel.',
      blurb: 'Where a CPU races through one thing at a time, a GPU does ' +
        'thousands of things at once. The graphics pipeline, VRAM bandwidth, ' +
        'tensor cores, and a live ray tracer running in your browser.',
      prereqs: ['cpu', 'memory']
    },
    {
      id: 'os', name: 'Understanding Operating Systems', short: 'OS',
      url: '/operating-systems/', cat: 'systems', fa: '\uf085', x: 585, y: 345,
      tagline: 'The conductor coordinating hardware and software.',
      blurb: 'Booting, process scheduling, virtual memory, file systems, ' +
        'drivers, and system calls — the software that turns raw hardware ' +
        'into a machine you can actually use.',
      prereqs: ['cpu', 'memory']
    },
    {
      id: 'internet', name: 'How the Internet Works', short: 'Internet',
      url: '/internet/', cat: 'networks', fa: '\uf0ac', x: 860, y: 390,
      tagline: 'One web request, from your keyboard to a data center and back.',
      blurb: 'DNS, routers, undersea cables, CDNs, and load balancers — follow ' +
        'a single request across the planet and back to pixels on your screen.',
      prereqs: ['os']
    },
    {
      id: 'cloud', name: 'Understanding Cloud Computing', short: 'Cloud',
      url: '/cloud/', cat: 'systems', fa: '\uf0c2', x: 845, y: 165,
      tagline: 'Other people’s computers, industrialized at planet scale.',
      blurb: 'Data centers, regions and availability zones, virtual machines, ' +
        'containers, auto scaling, and serverless — how a laptop-sized idea ' +
        'serves a billion users.',
      prereqs: ['internet', 'os']
    },
    {
      id: 'ai', name: 'Understanding Artificial Intelligence', short: 'AI',
      url: '/ai/', cat: 'intelligence', fa: '\uf544', x: 585, y: 120,
      tagline: 'Machines that learn patterns instead of following rules.',
      blurb: '70 years from symbolic logic to generative models. Machine ' +
        'learning, deep learning, reinforcement learning, and honest limits, ' +
        'with live models you can train in the browser.',
      prereqs: ['gpu', 'cloud']
    },
    {
      id: 'machine-learning', name: 'Understanding Machine Learning',
      short: 'ML', url: '/machine-learning/', cat: 'intelligence',
      fa: '\uf201', x: 385, y: 85,
      tagline: 'How models actually learn from data.',
      blurb: 'Features, labels, training, loss, gradient descent, ' +
        'overfitting, and honest evaluation \u2014 the complete pipeline from ' +
        'data to predictions, with real models you can train, break, and ' +
        'fix in the browser.',
      prereqs: ['ai']
    },
    {
      id: 'cryptography', name: 'Understanding Cryptography',
      short: 'Cryptography', url: '/cryptography/', cat: 'security',
      fa: '\uf084', x: 1050, y: 240,
      tagline: 'The mathematics of secrets, signatures, and trust.',
      blurb: 'Symmetric and asymmetric ciphers, hash functions, digital ' +
        'signatures, certificates, and HTTPS — with real cryptography running ' +
        'live in your browser.',
      prereqs: []
    },
    {
      id: 'blockchain', name: 'Understanding Blockchain', short: 'Blockchain',
      url: '/blockchain/', cat: 'security', fa: '\uf1b3', x: 990, y: 570,
      tagline: 'A tamper-evident ledger no single party controls.',
      blurb: 'Hash chains, distributed consensus, and smart contracts — plus ' +
        'an honest look at when a blockchain helps and when a plain database ' +
        'is the better tool.',
      prereqs: ['cryptography']
    },
    {
      id: 'bitcoin', name: 'Understanding Bitcoin', short: 'Bitcoin',
      url: '/bitcoin/', cat: 'security', fa: '\uf379', brand: true,
      x: 1155, y: 440,
      tagline: 'Digital money with no bank in the middle.',
      blurb: 'The double-spending problem, keys and signatures, mining and ' +
        'proof of work, and the 21 million supply schedule — powered by real ' +
        'SHA-256 and secp256k1 running in your browser.',
      prereqs: ['blockchain', 'internet']
    },

    /* ----- Capstone experiences: synthesis journeys across many topics ---
       capstone: true renders as a distinct hexagonal node on the map. ---- */
    {
      id: 'chatgpt', name: 'How ChatGPT Works', short: 'ChatGPT',
      url: '/chatgpt/', cat: 'capstone', capstone: true, fa: '',
      x: 715, y: 250,
      tagline: 'One prompt’s complete journey — the whole map, working together.',
      blurb: 'The capstone experience: follow a single prompt from a keystroke ' +
        'through the OS, the internet, TLS, a cloud load balancer, ' +
        'tokenization, transformer layers on GPUs, and token sampling, all ' +
        'the way back to a streamed answer on your screen.',
      prereqs: ['ai', 'machine-learning', 'internet', 'cloud', 'gpu']
    },

    /* ----- Planned topics: visible on the map, not yet built ------------- */
    {
      id: 'llm', name: 'Large Language Models', short: 'LLMs',
      url: null, cat: 'future', fa: '\uf086', x: 470, y: 25,
      tagline: 'Transformers, tokens, and text at planetary scale.', blurb: '',
      prereqs: ['machine-learning', 'ai']
    },
    {
      id: 'databases', name: 'Databases', short: 'Databases',
      url: null, cat: 'future', fa: '\uf1c0', x: 745, y: 630,
      tagline: 'How the world’s data is stored and queried.', blurb: '',
      prereqs: ['os']
    },
    {
      id: 'algorithms', name: 'Algorithms', short: 'Algorithms',
      url: null, cat: 'future', fa: '\uf542', x: 140, y: 655,
      tagline: 'The recipes behind every program.', blurb: '', prereqs: ['cpu']
    },
    {
      id: 'quantum', name: 'Quantum Computing', short: 'Quantum',
      url: null, cat: 'future', fa: '\uf5d2', x: 1185, y: 100,
      tagline: 'Computing with the rules of quantum mechanics.', blurb: '',
      prereqs: ['cryptography']
    }
  ];

  /* ----- Relationships (undirected, each with a teaching sentence) ------- */
  var EDGES = [
    { a: 'cpu', b: 'memory',
      label: 'Every instruction and every byte the CPU touches flows through the memory hierarchy.' },
    { a: 'cpu', b: 'gpu',
      label: 'The CPU directs the show; the GPU runs thousands of parallel actors.' },
    { a: 'cpu', b: 'os',
      label: 'The operating system decides which process runs on which core, and when.' },
    { a: 'memory', b: 'gpu',
      label: 'VRAM bandwidth is what keeps thousands of GPU cores fed.' },
    { a: 'memory', b: 'os',
      label: 'Virtual memory is the OS’s grand illusion, built on RAM and paging.' },
    { a: 'gpu', b: 'ai',
      label: 'Deep learning is matrix math at massive scale — exactly what GPUs are built for.' },
    { a: 'os', b: 'internet',
      label: 'Sockets, packets, and the network stack live inside the kernel.' },
    { a: 'os', b: 'cloud',
      label: 'Virtual machines and containers are operating-system technology.' },
    { a: 'internet', b: 'cloud',
      label: 'Every cloud service is reached across the internet’s backbone.' },
    { a: 'cloud', b: 'ai',
      label: 'Modern AI models are trained on cloud GPU clusters.' },
    { a: 'internet', b: 'cryptography',
      label: 'HTTPS wraps every secure connection in modern cryptography.' },
    { a: 'cryptography', b: 'blockchain',
      label: 'Hashes and digital signatures are what make a blockchain tamper-evident.' },
    { a: 'blockchain', b: 'bitcoin',
      label: 'Bitcoin is the original blockchain — the reason the idea exists.' },
    { a: 'cryptography', b: 'bitcoin',
      label: 'Owning bitcoin means holding a private key.' },
    { a: 'internet', b: 'bitcoin',
      label: 'Bitcoin is a peer-to-peer network riding on the internet.' },

    /* the capstone touches nearly everything — that is its point */
    { a: 'chatgpt', b: 'ai',
      label: 'The assistant is a transformer language model — AI is the engine of the whole experience.' },
    { a: 'chatgpt', b: 'gpu',
      label: 'Every token of every reply is matrix math on thousands of GPU cores.' },
    { a: 'chatgpt', b: 'cloud',
      label: 'Your prompt is served by load-balanced GPU fleets in cloud regions.' },
    { a: 'chatgpt', b: 'internet',
      label: 'Prompt out, tokens back — one HTTPS round trip across the backbone per message.' },
    { a: 'chatgpt', b: 'cryptography',
      label: 'A TLS handshake encrypts your conversation before it leaves your machine.' },
    { a: 'chatgpt', b: 'os',
      label: 'Keystrokes, sockets, and streams all pass through the operating system on both ends.' },
    { a: 'chatgpt', b: 'cpu',
      label: 'From the keyboard interrupt to rendering the reply, the CPU bookends every message.' },
    { a: 'chatgpt', b: 'memory',
      label: 'Your prompt lives in RAM at home; model weights live in VRAM in the data center.' },

    { a: 'ai', b: 'machine-learning',
      label: 'Machine learning is the engine room of modern AI.' },
    { a: 'gpu', b: 'machine-learning',
      label: 'Training is matrix math at scale — GPUs are why it finishes this decade.' },
    { a: 'cloud', b: 'machine-learning',
      label: 'Large models are trained on distributed cloud compute.' },
    { a: 'chatgpt', b: 'machine-learning',
      label: 'ChatGPT is a machine-learned model — trained once, then run for every reply.' },

    /* dashed edges to planned topics */
    { a: 'machine-learning', b: 'llm', planned: true,
      label: 'LLMs are the training loop from this page, scaled to all of human text.' },
    { a: 'cloud', b: 'databases', planned: true,
      label: 'Every cloud application sits on top of a database.' },
    { a: 'cpu', b: 'algorithms', planned: true,
      label: 'Algorithms decide how much work the CPU actually has to do.' },
    { a: 'cryptography', b: 'quantum', planned: true,
      label: 'Quantum computers are why post-quantum cryptography exists.' }
  ];

  /* ----- Learning paths --------------------------------------------------- */
  var PATHS = [
    {
      id: 'foundations', name: 'Foundations of Computing',
      hook: 'From a single instruction to planet-scale services.',
      steps: ['cpu', 'memory', 'gpu', 'os', 'internet', 'cloud']
    },
    {
      id: 'security', name: 'Security & Trust',
      hook: 'From the mathematics of secrets to digital money.',
      steps: ['cryptography', 'blockchain', 'bitcoin']
    },
    {
      id: 'intelligence', name: 'The Road to AI',
      hook: 'The hardware and infrastructure behind machines that learn.',
      steps: ['cpu', 'gpu', 'cloud', 'ai', 'machine-learning', 'chatgpt']
    }
  ];

  /* ----- Lookups & helpers ----------------------------------------------- */
  var byId = {};
  TOPICS.forEach(function (t) { byId[t.id] = t; });

  function neighborsOf(id) {
    var out = [];
    EDGES.forEach(function (e) {
      if (e.a === id) out.push({ id: e.b, label: e.label, planned: !!e.planned });
      else if (e.b === id) out.push({ id: e.a, label: e.label, planned: !!e.planned });
    });
    return out;
  }

  function prereqsOf(id) {
    var t = byId[id];
    return t ? t.prereqs.slice() : [];
  }

  /* topics that list `id` as a prerequisite (live pages only) */
  function unlocksOf(id) {
    return TOPICS.filter(function (t) {
      return t.url && t.prereqs.indexOf(id) !== -1;
    }).map(function (t) { return t.id; });
  }

  /* ----- Progress store (localStorage; degrades to a no-op) -------------- */
  var LS_KEY = 'tm-progress-v1';

  function readStore() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      var data = raw ? JSON.parse(raw) : null;
      if (data && typeof data === 'object' && data.t) return data;
    } catch (e) { /* private mode / disabled storage */ }
    return { t: {}, last: null };
  }

  function writeStore(data) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch (e) { /* ignore */ }
  }

  var progress = {
    /* 0 = untouched, 1 = started, 2 = explored (scrolled most of the page) */
    stateOf: function (id) {
      var rec = readStore().t[id];
      if (!rec) return 0;
      return rec.c ? 2 : 1;
    },
    markStarted: function (id) {
      var data = readStore();
      if (!data.t[id]) data.t[id] = {};
      if (!data.t[id].s) data.t[id].s = Date.now();
      data.last = id;
      writeStore(data);
    },
    markExplored: function (id) {
      var data = readStore();
      if (!data.t[id]) data.t[id] = { s: Date.now() };
      if (!data.t[id].c) data.t[id].c = Date.now();
      writeStore(data);
    },
    last: function () { return readStore().last; },
    pathProgress: function (pathId) {
      var path = null;
      PATHS.forEach(function (p) { if (p.id === pathId) path = p; });
      if (!path) return { done: 0, total: 0 };
      var done = 0;
      path.steps.forEach(function (id) { if (progress.stateOf(id) === 2) done++; });
      return { done: done, total: path.steps.length };
    }
  };

  var GRAPH = {
    categories: CATEGORIES,
    topics: TOPICS,
    byId: byId,
    edges: EDGES,
    paths: PATHS,
    neighborsOf: neighborsOf,
    prereqsOf: prereqsOf,
    unlocksOf: unlocksOf,
    progress: progress
  };

  if (typeof window !== 'undefined') window.TECH_GRAPH = GRAPH;

  /* Under Node (tests/tooling) export the data — no DOM here. */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = GRAPH;
  }
})();
