/* =============================================================================
   Understanding Artificial Intelligence — interactivity
   Vanilla JS, no dependencies. Loaded with `defer` on /ai/ only.

   Structure:
     1. Shared utilities (canvas fitting, visibility gating, rAF loops) —
        the same toolkit as the other exhibits
     2. One init function per widget, each guarded by element existence and
        wrapped in try/catch so one failure never takes down the page
     3. Everything respects prefers-reduced-motion: ambient animation is
        disabled and story animations jump to labeled final states

   Honesty notes: the pathfinding demo, the perceptron classifier, and the
   Q-learning gridworld are real implementations of the real algorithms —
   small, but genuinely computing. The hero scene, hype curve, deep-network
   animation, Markov text toy, and diffusion slider are honest cartoons built
   to teach concepts; the captions in the HTML say so where it matters.
   ============================================================================ */

(function () {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  document.documentElement.classList.add('ai-js');

  var RM = window.matchMedia('(prefers-reduced-motion: reduce)');
  function reduced() { return RM.matches; }

  function setStatus(el, msg, kind) {
    if (!el) { return; }
    el.textContent = msg;
    el.classList.remove('is-ok', 'is-bad');
    if (kind === 'ok') { el.classList.add('is-ok'); }
    if (kind === 'bad') { el.classList.add('is-bad'); }
  }

  /* ==========================================================================
     Shared canvas / animation utilities
     ========================================================================== */

  var C = {
    deep: '#0b1120', line: '#1e293b', lineStrong: '#334155',
    text: '#cbd5e1', strong: '#f1f5f9', muted: '#94a3b8', faint: '#64748b',
    teal: '#2dd4bf', tealDeep: '#14b8a6',
    cTeal: '#0d9488', amber: '#d97706', sky: '#0284c7',
    rose: '#e11d48', violet: '#8b5cf6', lime: '#65a30d', free: '#273449'
  };

  /* Fit a canvas's backing store to its CSS box (devicePixelRatio-aware).
     Guards against zero-size layout while the page is hidden/prerendered. */
  function setupCanvas(canvas, onResize) {
    var ctx = canvas.getContext('2d');
    if (!ctx) { throw new Error('2d context unavailable'); }
    var state = { w: 0, h: 0, dpr: 1 };
    var initial = true;
    function resize() {
      var rect = canvas.getBoundingClientRect();
      if (rect.width < 2) { return; }
      state.dpr = Math.min(window.devicePixelRatio || 1, 2);
      state.w = rect.width;
      state.h = rect.height;
      canvas.width = Math.max(2, Math.round(rect.width * state.dpr));
      canvas.height = Math.max(2, Math.round(rect.height * state.dpr));
      ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
      if (onResize && !initial) { onResize(); }
    }
    if ('ResizeObserver' in window) {
      var pending = null;
      new ResizeObserver(function () {
        if (pending) { return; }
        pending = requestAnimationFrame(function () { pending = null; resize(); });
      }).observe(canvas);
    } else {
      window.addEventListener('resize', resize);
    }
    resize();
    initial = false;
    return { ctx: ctx, state: state, resize: resize };
  }

  /* Run enter/leave callbacks as an element scrolls in and out of view. */
  function onScreen(el, enter, leave) {
    if (!('IntersectionObserver' in window)) { if (enter) { enter(); } return; }
    new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { if (enter) { enter(); } }
        else if (leave) { leave(); }
      });
    }, { threshold: 0.12 }).observe(el);
  }

  /* A stoppable requestAnimationFrame loop. fn(tMs, dtMs). */
  function makeLoop(fn) {
    var id = null;
    var last = 0;
    function frame(t) {
      id = requestAnimationFrame(frame);
      var dt = Math.min(50, t - last);
      last = t;
      fn(t, dt);
    }
    return {
      start: function () { if (id === null) { last = performance.now(); id = requestAnimationFrame(frame); } },
      stop: function () { if (id !== null) { cancelAnimationFrame(id); id = null; } },
      running: function () { return id !== null; }
    };
  }

  function easeInOut(p) { return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; }

  /* A simple seeded PRNG so ambient scenes are repeatable. */
  function makeRng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  /* ==========================================================================
     Reveal-on-scroll + chapter rail
     ========================================================================== */

  function initReveal() {
    var targets = $$('#ai-experience [data-ai-reveal]');
    if (!targets.length) { return; }
    if (!('IntersectionObserver' in window) || reduced()) {
      targets.forEach(function (el) { el.classList.add('is-in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    targets.forEach(function (el) { io.observe(el); });
  }

  function initRail() {
    var dots = $$('#ai-experience .ai-rail-dot');
    if (!dots.length || !('IntersectionObserver' in window)) { return; }
    var byId = {};
    dots.forEach(function (d) {
      var id = (d.getAttribute('href') || '').slice(1);
      if (id) { byId[id] = d; }
    });
    var current = null;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting && byId[e.target.id]) {
          if (current) { current.classList.remove('is-active'); }
          current = byId[e.target.id];
          current.classList.add('is-active');
        }
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    Object.keys(byId).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) { io.observe(el); }
    });
  }

  /* ==========================================================================
     HERO — one set of nodes morphing through three eras of AI:
     a logic-circuit grid, a search tree, and a layered neural network.
     ========================================================================== */

  function initHero() {
    var canvas = $('#ai-hero-canvas');
    if (!canvas) { return; }
    var cv = setupCanvas(canvas);
    var ctx = cv.ctx, st = cv.state;
    var rng = makeRng(19560718);

    var N = 24;
    var i, j;

    /* Each era assigns every node a position in unit space (x,y in 0..1)
       plus an alpha (some nodes sit out an era), and an edge list. */
    function circuitLayout() {
      var pos = [], edges = [];
      var cols = 6, rows = 4;
      for (i = 0; i < N; i++) {
        var cx = i % cols, cy = Math.floor(i / cols);
        pos.push({ x: 0.14 + (cx / (cols - 1)) * 0.72, y: 0.16 + (cy / (rows - 1)) * 0.68, a: 1 });
      }
      for (i = 0; i < N; i++) {
        if (i % cols < cols - 1) { edges.push([i, i + 1]); }
        if (Math.floor(i / cols) < rows - 1 && (i % 3 === 0)) { edges.push([i, i + cols]); }
      }
      return { pos: pos, edges: edges, square: true };
    }

    function treeLayout() {
      var pos = [], edges = [];
      /* binary tree with 15 nodes; the other 9 fade out */
      var depth, idx = 0, levels = 4;
      for (depth = 0; depth < levels; depth++) {
        var count = Math.pow(2, depth);
        for (j = 0; j < count; j++) {
          pos[idx] = {
            x: (j + 0.5) / count * 0.84 + 0.08,
            y: 0.14 + (depth / (levels - 1)) * 0.7,
            a: 1
          };
          if (idx > 0) { edges.push([Math.floor((idx - 1) / 2), idx]); }
          idx++;
        }
      }
      for (; idx < N; idx++) {
        pos[idx] = { x: 0.5 + (rng() - 0.5) * 0.7, y: 1.15, a: 0 };
      }
      return { pos: pos, edges: edges, square: false };
    }

    function netLayout() {
      var pos = [], edges = [];
      var layers = [5, 7, 7, 5];
      var lx = [0.14, 0.38, 0.62, 0.86];
      var idx = 0, L, start = [];
      for (L = 0; L < layers.length; L++) {
        start.push(idx);
        for (j = 0; j < layers[L]; j++) {
          pos[idx] = { x: lx[L], y: 0.5 + (j - (layers[L] - 1) / 2) * (0.72 / layers[L]), a: 1 };
          idx++;
        }
      }
      for (L = 0; L < layers.length - 1; L++) {
        for (i = 0; i < layers[L]; i++) {
          for (j = 0; j < layers[L + 1]; j++) {
            if ((i + j * 3) % 3 !== 1) { edges.push([start[L] + i, start[L + 1] + j]); }
          }
        }
      }
      return { pos: pos, edges: edges, square: false };
    }

    var eras = [circuitLayout(), treeLayout(), netLayout()];
    var labels = ['1950s — logic', '1970s — search', 'today — learning'];
    var HOLD = 3800, FADE = 1600, ERA = HOLD + FADE;
    var wob = [];
    for (i = 0; i < N; i++) { wob.push({ p: rng() * Math.PI * 2, s: 0.5 + rng() * 0.8 }); }
    var pulses = [];
    for (i = 0; i < 7; i++) { pulses.push({ e: 0, p: rng(), v: 0.00012 + rng() * 0.00018 }); }

    function nodeXY(era, k, t) {
      var p = eras[era].pos[k];
      var wx = Math.sin(t * 0.00045 * wob[k].s + wob[k].p) * 0.008;
      var wy = Math.cos(t * 0.0005 * wob[k].s + wob[k].p) * 0.008;
      return { x: (p.x + wx) * st.w, y: (p.y + wy) * st.h, a: p.a };
    }

    function drawEra(era, alpha, t) {
      if (alpha <= 0.01) { return; }
      var lay = eras[era];
      ctx.globalAlpha = alpha * 0.5;
      ctx.strokeStyle = C.lineStrong;
      ctx.lineWidth = 1;
      lay.edges.forEach(function (e) {
        var a = nodeXY(era, e[0], t), b = nodeXY(era, e[1], t);
        if (a.a === 0 || b.a === 0) { return; }
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      });
      /* pulses travel along a few edges of the visible era */
      ctx.globalAlpha = alpha;
      pulses.forEach(function (pu, k) {
        var e = lay.edges[(k * 5 + era * 3) % lay.edges.length];
        var a = nodeXY(era, e[0], t), b = nodeXY(era, e[1], t);
        if (a.a === 0 || b.a === 0) { return; }
        var pp = (pu.p + t * pu.v) % 1;
        ctx.beginPath();
        ctx.arc(a.x + (b.x - a.x) * pp, a.y + (b.y - a.y) * pp, 2.2, 0, Math.PI * 2);
        ctx.fillStyle = C.teal;
        ctx.fill();
      });
      for (var k = 0; k < N; k++) {
        var p = nodeXY(era, k, t);
        if (p.a === 0) { continue; }
        ctx.globalAlpha = alpha * 0.95;
        if (lay.square) {
          ctx.fillStyle = C.free;
          ctx.strokeStyle = 'rgba(45, 212, 191, 0.55)';
          ctx.lineWidth = 1.2;
          ctx.fillRect(p.x - 5, p.y - 5, 10, 10);
          ctx.strokeRect(p.x - 5, p.y - 5, 10, 10);
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
          ctx.fillStyle = C.free;
          ctx.fill();
          ctx.strokeStyle = 'rgba(45, 212, 191, 0.55)';
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      }
      ctx.globalAlpha = alpha * 0.8;
      ctx.font = '600 11px Inter, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = C.faint;
      ctx.fillText(labels[era], st.w - 18, st.h - 14);
      ctx.globalAlpha = 1;
    }

    function draw(t) {
      ctx.clearRect(0, 0, st.w, st.h);
      var cyc = t % (ERA * 3);
      var era = Math.floor(cyc / ERA);
      var inEra = cyc % ERA;
      var next = (era + 1) % 3;
      var mix = inEra < HOLD ? 0 : easeInOut((inEra - HOLD) / FADE);
      drawEra(era, 1 - mix, t);
      drawEra(next, mix, t);
    }

    if (reduced()) {
      /* single static frame of the modern era */
      var drawStatic = function () { ctx.clearRect(0, 0, st.w, st.h); drawEra(2, 1, 0); };
      drawStatic();
      onScreen(canvas, drawStatic);
      return;
    }
    var loop = makeLoop(function (t) { draw(t); });
    onScreen(canvas, function () { loop.start(); }, function () { loop.stop(); });
  }

  /* ==========================================================================
     01 — WHAT IS INTELLIGENCE? Capability profiles per system.
     ========================================================================== */

  function initIntel() {
    var grid = $('#ai-intel-grid');
    var statusEl = $('#ai-intel-status');
    var chips = $$('#intelligence .ai-chip');
    if (!grid || !chips.length) { return; }

    var CAPS = [
      'Learning', 'Reasoning', 'Planning', 'Problem solving',
      'Perception', 'Adaptation', 'Creativity', 'Consciousness'
    ];

    /* y = yes, p = partial/qualified, n = no */
    var SYSTEMS = {
      calc: {
        label: 'A calculator',
        blurb: 'Enormous computational power, zero intelligence by any definition — a useful baseline. Computation alone is not intelligence.',
        caps: {
          Learning: ['n', 'Behaves identically forever; nothing it encounters changes it.'],
          Reasoning: ['n', 'Executes fixed arithmetic procedures; it never draws a conclusion.'],
          Planning: ['n', 'No goals, no lookahead.'],
          'Problem solving': ['p', 'Solves exactly the problems it was wired for, instantly — and nothing else.'],
          Perception: ['n', 'Key presses in, digits out.'],
          Adaptation: ['n', 'A new kind of input is simply an error.'],
          Creativity: ['n', 'Every output is fully determined by the input.'],
          Consciousness: ['n', 'Not a live question here.']
        }
      },
      chess: {
        label: 'A chess engine',
        blurb: 'Superhuman inside 64 squares, helpless one inch outside them — the archetype of narrow AI.',
        caps: {
          Learning: ['p', 'Classic engines don’t learn at all; modern ones learned by self-play, then froze.'],
          Reasoning: ['p', 'Searches millions of positions — a real, if alien, form of reasoning about consequences.'],
          Planning: ['y', 'Plans dozens of moves ahead; planning is literally its whole job.'],
          'Problem solving': ['p', 'One problem, solved better than any human ever will.'],
          Perception: ['n', 'It receives the board as data; it cannot see a physical chessboard.'],
          Adaptation: ['n', 'Change one rule of chess and it’s useless until reprogrammed.'],
          Creativity: ['p', 'Produces moves experts call brilliant — within the game, never beyond it.'],
          Consciousness: ['n', 'Nothing suggests otherwise.']
        }
      },
      spam: {
        label: 'A spam filter',
        blurb: 'The quiet workhorse of machine learning: narrow, statistical, and genuinely learning — retraining constantly as spammers adapt.',
        caps: {
          Learning: ['y', 'Learns from millions of labeled emails, and keeps learning as you click “report spam.”'],
          Reasoning: ['n', 'Weighs statistical evidence; there is no chain of logic to print.'],
          Planning: ['n', 'Classifies one message at a time.'],
          'Problem solving': ['p', 'One problem — but a genuinely adversarial, shifting one.'],
          Perception: ['p', 'Reads text and metadata; a limited but real form of sensing its world.'],
          Adaptation: ['y', 'Its whole existence is an arms race with adapting spammers.'],
          Creativity: ['n', 'Nothing is generated.'],
          Consciousness: ['n', 'No.']
        }
      },
      car: {
        label: 'Driver assistance',
        blurb: 'A stack, not a single AI: learned vision + classical planning + control engineering — and a human legally in charge.',
        caps: {
          Learning: ['p', 'Perception models are trained on millions of miles; the deployed car mostly runs frozen models.'],
          Reasoning: ['p', 'Fuses sensors into judgments (“that is a cyclist, slowing”) — statistical, not deliberative.'],
          Planning: ['y', 'Plans trajectories and lane changes seconds ahead, replanning many times per second.'],
          'Problem solving': ['p', 'Handles the driving problem’s common cases; rare “edge cases” are the hard part.'],
          Perception: ['y', 'Cameras, radar, ultrasonics — perception is the core achievement.'],
          Adaptation: ['p', 'Adapts to rain and traffic within its envelope; novel situations outside it cause handoffs.'],
          Creativity: ['n', 'By design — you don’t want a creative lane keeper.'],
          Consciousness: ['n', 'No.']
        }
      },
      llm: {
        label: 'A chatbot (LLM)',
        blurb: 'The broadest profile any machine has ever had — and still a profile with holes, which is why “jagged” is the word researchers reach for.',
        caps: {
          Learning: ['p', 'Learned from vast text during training; within a conversation it adapts context but doesn’t permanently learn.'],
          Reasoning: ['p', 'Real multi-step reasoning on many problems, with real and sometimes surprising failures on others.'],
          Planning: ['p', 'Can draft and follow multi-step plans; reliability drops as chains grow long.'],
          'Problem solving': ['y', 'Genuinely general-purpose across writing, code, analysis — the widest span on this list.'],
          Perception: ['p', 'Multimodal models see images and hear audio; they don’t inhabit or act in the physical world.'],
          Adaptation: ['y', 'Handles novel phrasings, topics, and mixed tasks without retraining — its signature strength.'],
          Creativity: ['p', 'Recombines learned patterns into genuinely new text and ideas; whether that counts as creativity is your call.'],
          Consciousness: ['n', 'Fluent first-person language is a property of the training text, not evidence of experience.']
        }
      },
      human: {
        label: 'A human',
        blurb: 'The reference point: not the best at any single row — machines beat us at several — but the only entry with every box filled, plus the one at the bottom.',
        caps: {
          Learning: ['y', 'From a handful of examples, continuously, across a lifetime.'],
          Reasoning: ['y', 'Logical, causal, moral, counterfactual — slow and biased, but general.'],
          Planning: ['y', 'From dinner tonight to a career — across timescales and shifting goals.'],
          'Problem solving': ['y', 'Including problems never before encountered by anyone.'],
          Perception: ['y', 'Rich, multi-sense, grounded in a body and a world.'],
          Adaptation: ['y', 'New cultures, tools, injuries, technologies — the species’ defining trick.'],
          Creativity: ['y', 'Whatever creativity turns out to be, this is where we point.'],
          Consciousness: ['y', 'The one row no machine touches — and, remarkably, still unexplained in humans too.']
        }
      }
    };

    var MARK = { y: 'Yes', p: 'Partly', n: 'No' };

    function render(key) {
      var sys = SYSTEMS[key];
      if (!sys) { return; }
      grid.innerHTML = '';
      CAPS.forEach(function (cap) {
        var v = sys.caps[cap];
        var li = document.createElement('li');
        li.className = 'ai-intel-cell is-' + (v[0] === 'y' ? 'yes' : (v[0] === 'p' ? 'partial' : 'no'));
        var name = document.createElement('div');
        name.className = 'ai-intel-name';
        var nm = document.createElement('span');
        nm.textContent = cap;
        var mk = document.createElement('span');
        mk.className = 'ai-intel-mark';
        mk.textContent = MARK[v[0]];
        name.appendChild(nm);
        name.appendChild(mk);
        var note = document.createElement('div');
        note.className = 'ai-intel-note';
        note.textContent = v[1];
        li.appendChild(name);
        li.appendChild(note);
        grid.appendChild(li);
      });
      setStatus(statusEl, sys.label + ': ' + sys.blurb);
    }

    chips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        chips.forEach(function (c) { c.classList.remove('is-active'); });
        chip.classList.add('is-active');
        render(chip.getAttribute('data-ai-sys'));
      });
    });

    render('calc');
  }

  /* ==========================================================================
     02 — HISTORY: stylized momentum curve + expandable timeline.
     ========================================================================== */

  function initHistory() {
    var canvas = $('#ai-hype-canvas');
    var list = $('#ai-timeline');
    if (!list) { return; }

    var marker = null; /* selected year */
    var drawCurve = null;

    if (canvas) {
      var cv = setupCanvas(canvas, function () { if (drawCurve) { drawCurve(); } });
      var ctx = cv.ctx, st = cv.state;

      /* control points of the stylized momentum curve */
      var PTS = [
        [1950, 0.10], [1956, 0.20], [1962, 0.34], [1968, 0.48], [1973, 0.50],
        [1975, 0.32], [1978, 0.20], [1981, 0.28], [1985, 0.55], [1987, 0.52],
        [1990, 0.30], [1994, 0.20], [1999, 0.24], [2005, 0.30], [2010, 0.36],
        [2012, 0.44], [2016, 0.62], [2020, 0.76], [2023, 0.90], [2025, 0.97]
      ];
      var Y0 = 1948, Y1 = 2027;
      var WINTERS = [[1974, 1980], [1987, 1995]];

      function xOf(year) { return 46 + (year - Y0) / (Y1 - Y0) * (st.w - 64); }
      function yOf(v) { return st.h - 34 - v * (st.h - 70); }

      function valueAt(year) {
        var k;
        if (year <= PTS[0][0]) { return PTS[0][1]; }
        for (k = 0; k < PTS.length - 1; k++) {
          if (year <= PTS[k + 1][0]) {
            var p = (year - PTS[k][0]) / (PTS[k + 1][0] - PTS[k][0]);
            return PTS[k][1] + (PTS[k + 1][1] - PTS[k][1]) * easeInOut(p);
          }
        }
        return PTS[PTS.length - 1][1];
      }

      drawCurve = function () {
        ctx.clearRect(0, 0, st.w, st.h);

        /* winter bands */
        WINTERS.forEach(function (w) {
          ctx.fillStyle = 'rgba(2, 132, 199, 0.08)';
          ctx.fillRect(xOf(w[0]), 12, xOf(w[1]) - xOf(w[0]), st.h - 44);
          ctx.font = '600 10px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = 'rgba(125, 211, 252, 0.6)';
          ctx.fillText('AI winter', (xOf(w[0]) + xOf(w[1])) / 2, 24);
        });

        /* axis */
        ctx.strokeStyle = C.line;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(40, st.h - 32);
        ctx.lineTo(st.w - 14, st.h - 32);
        ctx.stroke();
        ctx.font = '600 10px Inter, sans-serif';
        ctx.fillStyle = C.faint;
        ctx.textAlign = 'center';
        [1950, 1970, 1990, 2010, 2025].forEach(function (yr) {
          ctx.fillText(String(yr), xOf(yr), st.h - 16);
        });
        ctx.save();
        ctx.translate(16, st.h / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.fillText('momentum', 0, 0);
        ctx.restore();

        /* the curve */
        ctx.beginPath();
        var yr;
        for (yr = 1950; yr <= 2025; yr += 0.5) {
          var x = xOf(yr), y = yOf(valueAt(yr));
          if (yr === 1950) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
        }
        ctx.strokeStyle = C.teal;
        ctx.lineWidth = 2.2;
        ctx.stroke();
        /* soft fill under curve */
        ctx.lineTo(xOf(2025), st.h - 32);
        ctx.lineTo(xOf(1950), st.h - 32);
        ctx.closePath();
        ctx.fillStyle = 'rgba(45, 212, 191, 0.07)';
        ctx.fill();

        /* selected milestone marker */
        if (marker !== null) {
          var mx = xOf(marker), my = yOf(valueAt(marker));
          ctx.setLineDash([3, 4]);
          ctx.strokeStyle = 'rgba(217, 119, 6, 0.7)';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(mx, st.h - 32);
          ctx.lineTo(mx, my);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.arc(mx, my, 5, 0, Math.PI * 2);
          ctx.fillStyle = C.amber;
          ctx.fill();
          ctx.font = '700 11px Inter, sans-serif';
          ctx.textAlign = mx > st.w - 80 ? 'right' : 'left';
          ctx.fillStyle = C.strong;
          ctx.fillText(String(marker), mx + (mx > st.w - 80 ? -10 : 10), my - 8);
        }
      };

      drawCurve();
      onScreen(canvas, drawCurve);
    }

    $$('.ai-tl-item', list).forEach(function (item) {
      var btn = $('.ai-tl-btn', item);
      var body = $('.ai-tl-body', item);
      if (!btn || !body) { return; }
      btn.addEventListener('click', function () {
        var open = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', open ? 'false' : 'true');
        body.hidden = open;
        item.classList.toggle('is-open', !open);
        if (!open) {
          marker = parseInt(item.getAttribute('data-year'), 10) || null;
          if (drawCurve) { drawCurve(); }
        }
      });
    });
  }

  /* ==========================================================================
     03 — THE MAP OF AI: clickable branches.
     ========================================================================== */

  function initMap() {
    var detail = $('#ai-map-detail');
    var nodes = $$('#map .ai-map-node');
    if (!detail || !nodes.length) { return; }

    var BRANCHES = {
      symbolic: {
        name: 'Symbolic AI',
        what: 'Represents knowledge as explicit symbols — facts, logic, rules — and reasons by manipulating them. The founding approach of the field (chapter 4 is a working example).',
        problems: 'Problems with crisp, articulable structure: eligibility and compliance checks, configuration, formal verification, theorem proving.',
        where: 'Today: business rule engines processing claims and payrolls, tax software, the logic layer wrapped around many ML systems. Increasingly hybridized: "neuro-symbolic" systems pair learned perception with symbolic reasoning.'
      },
      ml: {
        name: 'Machine Learning',
        what: 'Learns a model from examples instead of following hand-written rules (chapter 6). Deep learning is its most powerful subfamily (chapter 7), and large language models are one application of deep learning — the nesting matters.',
        problems: 'Anything with abundant examples and rules too subtle to write: ranking, filtering, forecasting, recognizing, recommending.',
        where: 'Today: nearly everywhere — spam filters, credit scoring, search ranking, demand forecasting, medical imaging, and every generative AI product.'
      },
      search: {
        name: 'Search & Planning',
        what: 'Solves problems by systematically exploring the space of possibilities — states, moves, and goals (chapter 5 is a live demo).',
        problems: 'Routes, schedules, game moves, action sequences, resource allocation — anywhere the options branch and a best sequence must be found.',
        where: 'Today: every navigation app (A*), airline and logistics scheduling, game AI, robot motion planning, and inside hybrid systems like AlphaGo.'
      },
      vision: {
        name: 'Computer Vision',
        what: 'Extracts meaning from images and video: what objects are present, where they are, what is happening.',
        problems: 'Detection, recognition, segmentation, tracking, measurement — turning pixels into decisions.',
        where: 'Today: phone-camera face unlock and photo search, medical scan triage, factory quality inspection, driver-assistance perception. Transformed utterly by deep learning after 2012.'
      },
      nlp: {
        name: 'Natural Language Processing',
        what: 'Enables machines to read, write, and converse in human language — the field that produced the transformer and, from it, large language models.',
        problems: 'Translation, summarization, question answering, sentiment, dialogue, information extraction.',
        where: 'Today: machine translation, voice assistants, chatbots, search engines that answer rather than link, and coding assistants.'
      },
      robotics: {
        name: 'Robotics',
        what: 'Intelligence with a body: perception, planning, and control fused so a machine can act in the physical world — where friction, noise, and surprise never stop.',
        problems: 'Manipulation, locomotion, navigation, and safe operation around people.',
        where: 'Today: warehouse fleets, surgical assistants, vacuum robots, factory arms gaining learned skills. The physical world remains AI’s hardest benchmark.'
      },
      knowledge: {
        name: 'Knowledge Representation',
        what: 'How to store what a system "knows" so it can be reasoned over: ontologies, knowledge graphs, semantic networks — the librarian science of AI.',
        problems: 'Making facts queryable and combinable: what relates to what, what follows from what, what contradicts what.',
        where: 'Today: the knowledge panels beside search results, product catalogs, drug-interaction databases — and retrieval systems that ground LLMs in verified facts to curb hallucination.'
      },
      rl: {
        name: 'Reinforcement Learning',
        what: 'Learning from consequences: an agent acts, the environment rewards or punishes, and behavior improves (chapter 8 trains one live).',
        problems: 'Sequential decision-making where good strategies are unknown but outcomes are measurable: games, control, optimization.',
        where: 'Today: game-playing milestones (AlphaGo), robot skill learning, data-center energy optimization, recommendation timing — and aligning chatbots via human feedback (RLHF).'
      }
    };

    function show(key) {
      var b = BRANCHES[key];
      if (!b) { return; }
      detail.innerHTML = '';
      var h = document.createElement('h3');
      h.textContent = b.name;
      var p1 = document.createElement('p');
      p1.textContent = b.what;
      var p2 = document.createElement('p');
      p2.textContent = 'Problems it addresses: ' + b.problems;
      var p3 = document.createElement('p');
      p3.className = 'ai-map-where';
      var strong = document.createElement('strong');
      strong.textContent = 'Where you met it: ';
      p3.appendChild(strong);
      p3.appendChild(document.createTextNode(b.where));
      detail.appendChild(h);
      detail.appendChild(p1);
      detail.appendChild(p2);
      detail.appendChild(p3);
    }

    nodes.forEach(function (node) {
      node.addEventListener('click', function () {
        nodes.forEach(function (n) { n.classList.remove('is-active'); });
        node.classList.add('is-active');
        show(node.getAttribute('data-ai-branch'));
      });
    });
  }

  /* ==========================================================================
     04 — RULE-BASED AI: a tiny forward-chaining expert system.
     ========================================================================== */

  function initRules() {
    var factsBox = $('#ai-rules-facts');
    var rulesList = $('#ai-rules-list');
    var logEl = $('#ai-rules-log');
    var statusEl = $('#ai-rules-status');
    var runBtn = $('#ai-rules-run');
    var curveBtn = $('#ai-rules-curve');
    if (!factsBox || !rulesList || !runBtn) { return; }

    var FACTS = [
      { id: 'fever', label: 'Fever', on: true },
      { id: 'cough', label: 'Cough', on: true },
      { id: 'sore-throat', label: 'Sore throat', on: false },
      { id: 'runny-nose', label: 'Runny nose', on: false },
      { id: 'rash', label: 'Rash', on: false },
      { id: 'headache', label: 'Headache', on: false }
    ];
    var CURVEBALL = { id: 'purple-spots', label: 'Purple spots (the curveball)', on: true, curve: true };

    var RULES = [
      { if: ['fever', 'cough'], then: 'flu-suspected', text: 'IF fever AND cough THEN add fact: flu suspected' },
      { if: ['runny-nose', 'sore-throat'], then: 'cold-suspected', text: 'IF runny nose AND sore throat THEN add fact: common cold suspected' },
      { if: ['fever', 'rash'], then: 'measles-suspected', text: 'IF fever AND rash THEN add fact: measles suspected' },
      { if: ['flu-suspected', 'headache'], then: 'rest-and-monitor', text: 'IF flu suspected AND headache THEN advise: rest, fluids, monitor temperature' },
      { if: ['flu-suspected'], then: 'stay-home', text: 'IF flu suspected THEN advise: stay home, avoid contact with others' },
      { if: ['cold-suspected'], then: 'self-care', text: 'IF common cold suspected THEN advise: self-care; no doctor needed unless it persists' },
      { if: ['measles-suspected'], then: 'see-doctor', text: 'IF measles suspected THEN advise: contact a doctor promptly' }
    ];

    var LABELS = {
      'flu-suspected': 'flu suspected',
      'cold-suspected': 'common cold suspected',
      'measles-suspected': 'measles suspected',
      'rest-and-monitor': 'ADVICE: rest, fluids, monitor temperature',
      'stay-home': 'ADVICE: stay home, avoid contact with others',
      'self-care': 'ADVICE: self-care is enough unless symptoms persist',
      'see-doctor': 'ADVICE: contact a doctor promptly'
    };

    var timers = [];
    function clearTimers() { timers.forEach(clearTimeout); timers = []; }
    function later(fn, ms) { timers.push(setTimeout(fn, reduced() ? 0 : ms)); }

    function renderFacts() {
      factsBox.innerHTML = '';
      FACTS.forEach(function (f) {
        var lab = document.createElement('label');
        lab.className = 'ai-check' + (f.curve ? ' is-curve' : '');
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = f.on;
        cb.addEventListener('change', function () { f.on = cb.checked; });
        lab.appendChild(cb);
        lab.appendChild(document.createTextNode(' ' + f.label));
        factsBox.appendChild(lab);
      });
    }

    function renderRules() {
      rulesList.innerHTML = '';
      RULES.forEach(function (r) {
        var li = document.createElement('li');
        li.textContent = r.text;
        rulesList.appendChild(li);
      });
    }

    function run() {
      clearTimers();
      logEl.innerHTML = '';
      $$('li', rulesList).forEach(function (li) { li.classList.remove('is-fired'); });
      setStatus(statusEl, '');

      var known = {};
      FACTS.forEach(function (f) { if (f.on) { known[f.id] = true; } });
      var startFacts = Object.keys(known);

      /* forward chaining: fire every rule whose conditions hold, add its
         conclusion, repeat until nothing new fires */
      var firings = [];
      var fired = {};
      var changed = true;
      while (changed) {
        changed = false;
        RULES.forEach(function (r, idx) {
          if (fired[idx]) { return; }
          var ok = r.if.every(function (c) { return known[c]; });
          if (ok) {
            fired[idx] = true;
            known[r.then] = true;
            firings.push({ idx: idx, fact: r.then, chained: r.if.some(function (c) { return startFacts.indexOf(c) === -1; }) });
            changed = true;
          }
        });
      }

      var step = 0;
      function addLog(text, cls) {
        var li = document.createElement('li');
        li.textContent = text;
        if (cls) { li.classList.add(cls); }
        logEl.appendChild(li);
        logEl.scrollTop = logEl.scrollHeight;
      }

      later(function () {
        addLog('Working memory loaded: ' + startFacts.map(function (id) {
          var f = null;
          FACTS.forEach(function (ff) { if (ff.id === id) { f = ff; } });
          return f ? f.label.replace(' (the curveball)', '').toLowerCase() : id;
        }).join(', ') + '.');
      }, 100);

      firings.forEach(function (fr, i) {
        later(function () {
          var li = $$('li', rulesList)[fr.idx];
          if (li) { li.classList.add('is-fired'); }
          addLog('Rule R' + (fr.idx + 1) + ' fires' + (fr.chained ? ' (chained off a derived fact)' : '') + ' → ' + (LABELS[fr.fact] || fr.fact), 'is-derived');
        }, 500 + i * 650);
        step = i;
      });

      later(function () {
        var hasCurve = FACTS.some(function (f) { return f.curve && f.on; });
        if (hasCurve) {
          addLog('Fact "purple spots" matched no rule. The engine has nothing to say about it — no error, no guess, just silence.', 'is-fail');
        }
        if (!firings.length) {
          setStatus(statusEl, 'No rule matched these facts. A rule-based system without a matching rule is not cautious or curious — it is simply blank. That brittleness is the architecture’s core weakness.', 'bad');
        } else if (hasCurve) {
          setStatus(statusEl, firings.length + ' rule' + (firings.length > 1 ? 's' : '') + ' fired — but notice the curveball: a fact outside the rulebook was silently ignored. A human doctor would say “purple spots? that changes everything.” The system cannot, unless someone writes that rule.', 'bad');
        } else {
          setStatus(statusEl, firings.length + ' rule' + (firings.length > 1 ? 's' : '') + ' fired, including chains where one rule’s conclusion triggered another. Every step above is inspectable — that transparency is why rule systems still run compliance and eligibility checks today.', 'ok');
        }
      }, 700 + (step + 1) * 650);
    }

    runBtn.addEventListener('click', run);
    curveBtn.addEventListener('click', function () {
      if (!FACTS.some(function (f) { return f.curve; })) {
        FACTS.push(CURVEBALL);
        renderFacts();
      }
      CURVEBALL.on = true;
      renderFacts();
      curveBtn.disabled = true;
      setStatus(statusEl, 'A new fact appeared that no rule mentions. Run the engine and watch what happens to it.');
    });

    renderFacts();
    renderRules();
  }

  /* ==========================================================================
     05 — SEARCH & PLANNING: real BFS / DFS / greedy / A* over a maze.
     ========================================================================== */

  function initSearch() {
    var canvas = $('#ai-search-canvas');
    if (!canvas) { return; }
    var algoSel = $('#ai-search-algo');
    var runBtn = $('#ai-search-run');
    var raceBtn = $('#ai-search-compare');
    var mazeBtn = $('#ai-search-maze');
    var exploredEl = $('#ai-search-explored');
    var plenEl = $('#ai-search-plen');
    var optEl = $('#ai-search-opt');
    var statusEl = $('#ai-search-status');

    var COLS = 33, ROWS = 21;
    var START = { x: 1, y: 11 }, GOAL = { x: 31, y: 11 };
    var grid = []; /* 0 open, 1 wall */
    var rng = makeRng(20120930);

    var cv = setupCanvas(canvas, function () { drawBase(); drawOverlay(); });
    var ctx = cv.ctx, st = cv.state;

    function cellGeom() {
      var s = Math.min(st.w / COLS, st.h / ROWS);
      return { s: s, ox: (st.w - s * COLS) / 2, oy: (st.h - s * ROWS) / 2 };
    }

    function genMaze() {
      var x, y;
      grid = [];
      for (y = 0; y < ROWS; y++) {
        grid.push([]);
        for (x = 0; x < COLS; x++) { grid[y].push(1); }
      }
      /* recursive backtracker over odd cells */
      var stack = [{ x: 1, y: 1 }];
      grid[1][1] = 0;
      var DIRS = [[2, 0], [-2, 0], [0, 2], [0, -2]];
      while (stack.length) {
        var cur = stack[stack.length - 1];
        var opts = [];
        DIRS.forEach(function (d) {
          var nx = cur.x + d[0], ny = cur.y + d[1];
          if (nx > 0 && nx < COLS - 1 && ny > 0 && ny < ROWS - 1 && grid[ny][nx] === 1) {
            opts.push({ x: nx, y: ny, wx: cur.x + d[0] / 2, wy: cur.y + d[1] / 2 });
          }
        });
        if (!opts.length) { stack.pop(); continue; }
        var pick = opts[Math.floor(rng() * opts.length)];
        grid[pick.wy][pick.wx] = 0;
        grid[pick.y][pick.x] = 0;
        stack.push({ x: pick.x, y: pick.y });
      }
      /* knock out extra walls to create loops (makes heuristics meaningful) */
      var knocked = 0;
      var guard = 0;
      while (knocked < 26 && guard < 3000) {
        guard++;
        x = 1 + Math.floor(rng() * (COLS - 2));
        y = 1 + Math.floor(rng() * (ROWS - 2));
        if (grid[y][x] === 1) {
          var openN = (grid[y - 1][x] === 0 ? 1 : 0) + (grid[y + 1][x] === 0 ? 1 : 0) +
                      (grid[y][x - 1] === 0 ? 1 : 0) + (grid[y][x + 1] === 0 ? 1 : 0);
          if (openN >= 2) { grid[y][x] = 0; knocked++; }
        }
      }
      grid[START.y][START.x] = 0;
      grid[GOAL.y][GOAL.x] = 0;
    }

    /* ---- algorithms: return {order:[cells], parent:map, found:bool} ------ */

    function key(x, y) { return y * COLS + x; }
    function neighbors(x, y) {
      var out = [];
      [[1, 0], [0, 1], [-1, 0], [0, -1]].forEach(function (d) {
        var nx = x + d[0], ny = y + d[1];
        if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS && grid[ny][nx] === 0) {
          out.push({ x: nx, y: ny });
        }
      });
      return out;
    }
    function manhattan(x, y) { return Math.abs(x - GOAL.x) + Math.abs(y - GOAL.y); }

    function solve(algo) {
      var order = [];
      var parent = {};
      var seen = {};
      var found = false;
      var startK = key(START.x, START.y);
      seen[startK] = true;

      if (algo === 'bfs' || algo === 'dfs') {
        var list = [{ x: START.x, y: START.y }];
        while (list.length) {
          var cur = algo === 'bfs' ? list.shift() : list.pop();
          order.push(cur);
          if (cur.x === GOAL.x && cur.y === GOAL.y) { found = true; break; }
          neighbors(cur.x, cur.y).forEach(function (n) {
            var k = key(n.x, n.y);
            if (!seen[k]) {
              seen[k] = true;
              parent[k] = key(cur.x, cur.y);
              list.push(n);
            }
          });
        }
      } else {
        /* greedy / A*: array-scan priority queue (grid is small) */
        var open = [{ x: START.x, y: START.y, g: 0, f: manhattan(START.x, START.y) }];
        var gBest = {};
        gBest[startK] = 0;
        var closed = {};
        while (open.length) {
          var bi = 0, i;
          for (i = 1; i < open.length; i++) { if (open[i].f < open[bi].f) { bi = i; } }
          var c = open.splice(bi, 1)[0];
          var ck = key(c.x, c.y);
          if (closed[ck]) { continue; }
          closed[ck] = true;
          order.push(c);
          if (c.x === GOAL.x && c.y === GOAL.y) { found = true; break; }
          /* eslint-disable no-loop-func */
          neighbors(c.x, c.y).forEach(function (n) {
            var nk = key(n.x, n.y);
            var g = c.g + 1;
            if (closed[nk]) { return; }
            if (gBest[nk] === undefined || g < gBest[nk]) {
              gBest[nk] = g;
              parent[nk] = ck;
              open.push({ x: n.x, y: n.y, g: g, f: algo === 'astar' ? g + manhattan(n.x, n.y) : manhattan(n.x, n.y) });
            }
          });
        }
      }

      var path = [];
      if (found) {
        var k = key(GOAL.x, GOAL.y);
        while (k !== undefined) {
          path.unshift({ x: k % COLS, y: Math.floor(k / COLS) });
          k = parent[k];
        }
      }
      return { order: order, path: path, found: found };
    }

    /* ---- drawing --------------------------------------------------------- */

    var overlay = { visited: [], visCount: 0, path: [], pathCount: 0 };

    function drawCell(x, y, color, inset) {
      var g = cellGeom();
      var pad = inset || 1;
      ctx.fillStyle = color;
      ctx.fillRect(g.ox + x * g.s + pad, g.oy + y * g.s + pad, g.s - pad * 2, g.s - pad * 2);
    }

    function drawBase() {
      ctx.clearRect(0, 0, st.w, st.h);
      var g = cellGeom();
      ctx.fillStyle = C.deep;
      ctx.fillRect(g.ox, g.oy, g.s * COLS, g.s * ROWS);
      var x, y;
      for (y = 0; y < ROWS; y++) {
        for (x = 0; x < COLS; x++) {
          if (grid[y][x] === 1) { drawCell(x, y, C.free, 0.5); }
        }
      }
      drawCell(START.x, START.y, C.sky, 1);
      drawCell(GOAL.x, GOAL.y, C.amber, 1);
      ctx.font = '700 10px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = C.faint;
      ctx.fillText('start', g.ox + START.x * g.s, g.oy + START.y * g.s - 4);
      ctx.textAlign = 'right';
      ctx.fillText('goal', g.ox + (GOAL.x + 1) * g.s, g.oy + GOAL.y * g.s - 4);
    }

    function drawOverlay() {
      var i;
      for (i = 0; i < overlay.visCount; i++) {
        var c = overlay.visited[i];
        if ((c.x === START.x && c.y === START.y) || (c.x === GOAL.x && c.y === GOAL.y)) { continue; }
        drawCell(c.x, c.y, 'rgba(101, 163, 13, 0.28)', 1.5);
      }
      for (i = 0; i < overlay.pathCount; i++) {
        var p = overlay.path[i];
        if ((p.x === START.x && p.y === START.y) || (p.x === GOAL.x && p.y === GOAL.y)) { continue; }
        drawCell(p.x, p.y, C.teal, 2);
      }
    }

    /* ---- run / animate ----------------------------------------------------- */

    var anim = null;
    function cancelAnim() { if (anim) { anim.stop(); anim = null; } }

    var ALGO_NAMES = { bfs: 'Breadth-first search', dfs: 'Depth-first search', greedy: 'Greedy best-first', astar: 'A*' };
    var ALGO_NOTES = {
      bfs: 'expands evenly in every direction — it found the shortest path, but look how much of the maze it flooded to do it.',
      dfs: 'dives down one corridor at a time. Fast to something, blind to path quality — its route is usually far from shortest.',
      greedy: 'chases the goal by straight-line promise alone. Brilliant in open ground, easily trapped by walls that A* handles — and its path is not guaranteed shortest.',
      astar: 'balances distance traveled against estimated distance remaining — shortest path found while exploring a fraction of what BFS touched. This is why it navigates for you every day.'
    };

    function runOne(algo, speed, done) {
      cancelAnim();
      var res = solve(algo);
      var opt = solve('bfs');
      overlay.visited = res.order;
      overlay.path = res.path;
      exploredEl.textContent = '…';
      plenEl.textContent = '…';
      optEl.textContent = opt.found ? String(opt.path.length - 1) : '–';

      if (reduced()) {
        overlay.visCount = res.order.length;
        overlay.pathCount = res.path.length;
        drawBase();
        drawOverlay();
        exploredEl.textContent = String(res.order.length);
        plenEl.textContent = res.found ? String(res.path.length - 1) : 'no path';
        if (done) { done(res); }
        return;
      }

      overlay.visCount = 0;
      overlay.pathCount = 0;
      var perFrame = speed || Math.max(2, Math.ceil(res.order.length / 160));
      anim = makeLoop(function () {
        if (overlay.visCount < overlay.visited.length) {
          overlay.visCount = Math.min(overlay.visited.length, overlay.visCount + perFrame);
        } else if (overlay.pathCount < overlay.path.length) {
          overlay.pathCount = Math.min(overlay.path.length, overlay.pathCount + 2);
        } else {
          cancelAnim();
          exploredEl.textContent = String(res.order.length);
          plenEl.textContent = res.found ? String(res.path.length - 1) : 'no path';
          if (done) { done(res); }
          return;
        }
        drawBase();
        drawOverlay();
      });
      anim.start();
    }

    function run() {
      var algo = algoSel.value;
      setStatus(statusEl, ALGO_NAMES[algo] + ' running…');
      runOne(algo, null, function (res) {
        if (!res.found) {
          setStatus(statusEl, 'No path exists — your walls sealed the goal off. Remove a few and run again.', 'bad');
          return;
        }
        setStatus(statusEl, ALGO_NAMES[algo] + ' explored ' + res.order.length + ' cells and found a path of length ' + (res.path.length - 1) + '. It ' + ALGO_NOTES[algo], 'ok');
      });
    }

    function race() {
      var algos = ['bfs', 'dfs', 'greedy', 'astar'];
      var results = [];
      raceBtn.disabled = true;
      runBtn.disabled = true;
      function next(i) {
        if (i >= algos.length) {
          raceBtn.disabled = false;
          runBtn.disabled = false;
          var ok = results.every(function (r) { return r.found; });
          if (!ok) {
            setStatus(statusEl, 'At least one run found no path — the goal is walled off.', 'bad');
            return;
          }
          setStatus(statusEl, 'Cells explored — ' + results.map(function (r, k) {
            return ALGO_NAMES[algos[k]] + ': ' + r.order.length + ' (path ' + (r.path.length - 1) + ')';
          }).join(' · ') + '. Same maze, same goal — wildly different effort. A* matched the shortest path at a fraction of BFS’s exploration: that’s what a good heuristic buys.', 'ok');
          return;
        }
        setStatus(statusEl, 'Racing… ' + ALGO_NAMES[algos[i]]);
        runOne(algos[i], 22, function (res) {
          results.push(res);
          setTimeout(function () { next(i + 1); }, reduced() ? 0 : 450);
        });
      }
      next(0);
    }

    canvas.addEventListener('click', function (ev) {
      var rect = canvas.getBoundingClientRect();
      var g = cellGeom();
      var x = Math.floor((ev.clientX - rect.left - g.ox) / g.s);
      var y = Math.floor((ev.clientY - rect.top - g.oy) / g.s);
      if (x < 1 || x >= COLS - 1 || y < 1 || y >= ROWS - 1) { return; }
      if ((x === START.x && y === START.y) || (x === GOAL.x && y === GOAL.y)) { return; }
      grid[y][x] = grid[y][x] === 1 ? 0 : 1;
      cancelAnim();
      overlay.visCount = 0;
      overlay.pathCount = 0;
      drawBase();
    });

    runBtn.addEventListener('click', run);
    raceBtn.addEventListener('click', race);
    mazeBtn.addEventListener('click', function () {
      cancelAnim();
      genMaze();
      overlay.visCount = 0;
      overlay.pathCount = 0;
      drawBase();
      exploredEl.textContent = '–';
      plenEl.textContent = '–';
      optEl.textContent = '–';
      setStatus(statusEl, 'Fresh maze. Pick a strategy and run it — or click cells to sculpt the walls first.');
    });

    genMaze();
    drawBase();
    onScreen(canvas, function () { drawBase(); drawOverlay(); });
  }

  /* ==========================================================================
     06 — MACHINE LEARNING: a real perceptron on a 2-D toy dataset.
     ========================================================================== */

  function initMl() {
    var canvas = $('#ai-ml-canvas');
    if (!canvas) { return; }
    var trainBtn = $('#ai-ml-train');
    var addCatBtn = $('#ai-ml-addcat');
    var addDogBtn = $('#ai-ml-adddog');
    var resetBtn = $('#ai-ml-reset');
    var stageEl = $('#ai-ml-stage');
    var epochsEl = $('#ai-ml-epochs');
    var accEl = $('#ai-ml-acc');
    var statusEl = $('#ai-ml-status');
    var flowSteps = $$('#ml .ai-flow-step');

    var cv = setupCanvas(canvas, draw);
    var ctx = cv.ctx, st = cv.state;
    var rng = makeRng(19580701);

    /* data space: x = weight 0..10 kg, y = ear length 0..10 cm */
    var pts = [];
    function seedData() {
      pts = [];
      var i;
      for (i = 0; i < 14; i++) {
        pts.push({ x: 2.2 + rng() * 2.8, y: 5.2 + rng() * 3.4, c: 0 }); /* cats: light, tall ears */
      }
      for (i = 0; i < 14; i++) {
        pts.push({ x: 5.8 + rng() * 3.4, y: 1.2 + rng() * 3.4, c: 1 }); /* dogs: heavy, shorter ears */
      }
    }

    /* perceptron: w0*x + w1*y + b, class = sign */
    var model = { w0: 0, w1: 0, b: 0, trained: false };
    var addClass = 0;
    var anim = null;

    function setStage(k, label) {
      flowSteps.forEach(function (s, i) { s.classList.toggle('is-hot', i === k); });
      if (stageEl) { stageEl.textContent = label; }
    }

    function margin(px, py) { return model.w0 * px + model.w1 * py + model.b; }

    function accuracy() {
      if (!pts.length) { return 0; }
      var ok = 0;
      pts.forEach(function (p) {
        var pred = margin(p.x, p.y) >= 0 ? 1 : 0;
        if (pred === p.c) { ok++; }
      });
      return ok / pts.length;
    }

    function toPx(p) {
      var padL = 46, padB = 34, padT = 16, padR = 16;
      return {
        x: padL + (p.x / 10) * (st.w - padL - padR),
        y: st.h - padB - (p.y / 10) * (st.h - padT - padB)
      };
    }
    function fromPx(px, py) {
      var padL = 46, padB = 34, padT = 16, padR = 16;
      return {
        x: (px - padL) / (st.w - padL - padR) * 10,
        y: (st.h - padB - py) / (st.h - padT - padB) * 10
      };
    }

    function draw() {
      ctx.clearRect(0, 0, st.w, st.h);
      var padL = 46, padB = 34, padT = 16, padR = 16;

      /* tinted decision regions once a model exists */
      if (model.trained || model.w0 !== 0 || model.w1 !== 0) {
        var img = 14;
        var gx, gy;
        for (gx = 0; gx < img; gx++) {
          for (gy = 0; gy < img; gy++) {
            var dx = (gx + 0.5) / img * 10, dy = (gy + 0.5) / img * 10;
            var m = margin(dx, dy);
            ctx.fillStyle = m >= 0 ? 'rgba(217, 119, 6, 0.06)' : 'rgba(2, 132, 199, 0.07)';
            var a = toPx({ x: gx / img * 10, y: (gy + 1) / img * 10 });
            var b = toPx({ x: (gx + 1) / img * 10, y: gy / img * 10 });
            ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
          }
        }
      }

      /* axes */
      ctx.strokeStyle = C.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, padT);
      ctx.lineTo(padL, st.h - padB);
      ctx.lineTo(st.w - padR, st.h - padB);
      ctx.stroke();
      ctx.font = '600 10px Inter, sans-serif';
      ctx.fillStyle = C.faint;
      ctx.textAlign = 'center';
      ctx.fillText('weight (kg) →', (padL + st.w - padR) / 2, st.h - 12);
      ctx.save();
      ctx.translate(16, st.h / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText('ear length (cm) →', 0, 0);
      ctx.restore();

      /* decision boundary: w0*x + w1*y + b = 0 */
      if (model.w0 !== 0 || model.w1 !== 0) {
        ctx.strokeStyle = C.teal;
        ctx.lineWidth = 2;
        ctx.beginPath();
        var drawn = false;
        var t;
        for (t = 0; t <= 10; t += 0.1) {
          var lx, ly;
          if (Math.abs(model.w1) > Math.abs(model.w0)) {
            lx = t; ly = -(model.w0 * t + model.b) / model.w1;
          } else {
            ly = t; lx = -(model.w1 * t + model.b) / model.w0;
          }
          if (lx < 0 || lx > 10 || ly < 0 || ly > 10) { continue; }
          var pp = toPx({ x: lx, y: ly });
          if (!drawn) { ctx.moveTo(pp.x, pp.y); drawn = true; } else { ctx.lineTo(pp.x, pp.y); }
        }
        ctx.stroke();
      }

      /* points */
      pts.forEach(function (p) {
        var pp = toPx(p);
        ctx.beginPath();
        ctx.arc(pp.x, pp.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = p.c === 0 ? C.sky : C.amber;
        ctx.fill();
        if (model.trained) {
          var pred = margin(p.x, p.y) >= 0 ? 1 : 0;
          if (pred !== p.c) {
            ctx.strokeStyle = C.rose;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(pp.x, pp.y, 8, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      });

      /* legend */
      ctx.font = '600 11px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = C.sky;
      ctx.fillText('● cats', st.w - 106, padT + 12);
      ctx.fillStyle = C.amber;
      ctx.fillText('● dogs', st.w - 58, padT + 12);
    }

    function train() {
      if (anim) { anim.stop(); anim = null; }
      if (pts.length < 4) {
        setStatus(statusEl, 'Add a few points of each class first — a model needs data.', 'bad');
        return;
      }
      model = { w0: (rng() - 0.5) * 0.2, w1: (rng() - 0.5) * 0.2, b: 0, trained: false };
      var epoch = 0;
      var MAXE = 80;
      var LR = 0.02;
      setStage(1, 'Learning');
      setStatus(statusEl, 'Training… every misclassified point nudges the boundary toward itself.');

      function oneEpoch() {
        var mistakes = 0;
        /* fixed order is fine for a demo */
        pts.forEach(function (p) {
          var target = p.c === 1 ? 1 : -1;
          var out = margin(p.x, p.y) >= 0 ? 1 : -1;
          if (out !== target) {
            mistakes++;
            model.w0 += LR * target * p.x;
            model.w1 += LR * target * p.y;
            model.b += LR * target * 3;
          }
        });
        return mistakes;
      }

      function finish() {
        model.trained = true;
        setStage(2, 'Model');
        var acc = accuracy();
        epochsEl.textContent = String(epoch);
        accEl.textContent = Math.round(acc * 100) + '%';
        draw();
        setTimeout(function () { setStage(3, 'Predictions'); }, reduced() ? 0 : 700);
        if (acc >= 0.999) {
          setStatus(statusEl, 'Converged after ' + epoch + ' passes: the boundary separates every training point. Now click to drop a point anywhere — the tinted regions are the model’s predictions for every possible animal.', 'ok');
        } else {
          setStatus(statusEl, 'Stopped at ' + Math.round(acc * 100) + '% accuracy — the red-ringed points are misclassified. If your data isn’t separable by a straight line, no amount of training will fix it: the model is too simple for the data. (Deep learning’s answer: bend the line.)', 'ok');
        }
      }

      if (reduced()) {
        while (epoch < MAXE) {
          epoch++;
          if (oneEpoch() === 0) { break; }
        }
        finish();
        return;
      }

      var acc = 0;
      anim = makeLoop(function () {
        var mistakes = 0;
        var k;
        for (k = 0; k < 2; k++) {
          if (epoch >= MAXE) { break; }
          epoch++;
          mistakes = oneEpoch();
          if (mistakes === 0) { break; }
        }
        epochsEl.textContent = String(epoch);
        acc = accuracy();
        accEl.textContent = Math.round(acc * 100) + '%';
        draw();
        if (mistakes === 0 || epoch >= MAXE) {
          anim.stop();
          anim = null;
          finish();
        }
      });
      anim.start();
    }

    canvas.addEventListener('click', function (ev) {
      var rect = canvas.getBoundingClientRect();
      var p = fromPx(ev.clientX - rect.left, ev.clientY - rect.top);
      if (p.x < 0 || p.x > 10 || p.y < 0 || p.y > 10) { return; }
      pts.push({ x: p.x, y: p.y, c: addClass });
      setStage(0, 'Data');
      model.trained = false;
      draw();
      setStatus(statusEl, 'Added a ' + (addClass === 0 ? 'cat' : 'dog') + ' at weight ' + p.x.toFixed(1) + ' kg, ears ' + p.y.toFixed(1) + ' cm. Retrain to fold it into the model.');
    });

    function setAdd(cls) {
      addClass = cls;
      addCatBtn.classList.toggle('is-active', cls === 0);
      addDogBtn.classList.toggle('is-active', cls === 1);
      addCatBtn.setAttribute('aria-pressed', cls === 0 ? 'true' : 'false');
      addDogBtn.setAttribute('aria-pressed', cls === 1 ? 'true' : 'false');
    }
    addCatBtn.addEventListener('click', function () { setAdd(0); });
    addDogBtn.addEventListener('click', function () { setAdd(1); });

    trainBtn.addEventListener('click', train);
    resetBtn.addEventListener('click', function () {
      if (anim) { anim.stop(); anim = null; }
      seedData();
      model = { w0: 0, w1: 0, b: 0, trained: false };
      epochsEl.textContent = '–';
      accEl.textContent = '–';
      setStage(0, 'Data');
      draw();
      setStatus(statusEl, 'Fresh dataset loaded.');
    });

    seedData();
    setStage(0, 'Data');
    draw();
    onScreen(canvas, draw);
  }

  /* ==========================================================================
     07 — DEEP LEARNING: activations flowing through layers (cartoon).
     ========================================================================== */

  function initDeep() {
    var canvas = $('#ai-deep-canvas');
    if (!canvas) { return; }
    var runBtn = $('#ai-deep-run');
    var statusEl = $('#ai-deep-status');
    var digitBtns = $$('#deep .ai-seg-btn');

    var cv = setupCanvas(canvas, function () { draw(progress); });
    var ctx = cv.ctx, st = cv.state;

    /* three 8x8 input patterns (0 = dark, 1 = lit) */
    var PATTERNS = [
      { name: 'cat', px: [
        '10000001', '11000011', '11111111', '11011011',
        '11111111', '11111111', '01111110', '00111100'] },
      { name: 'dog', px: [
        '00000000', '01111110', '11111111', '11011011',
        '11111111', '11100111', '01111110', '00100100'] },
      { name: 'bird', px: [
        '00011000', '00111100', '01111110', '11011011',
        '00111100', '00011000', '00111100', '01100110'] }
    ];
    var LAYERS = [10, 8, 6];
    var LAYER_NAMES = ['edges', 'shapes', 'parts'];
    var OUT_NAMES = ['cat', 'dog', 'bird'];

    var pattern = 0;
    var progress = 0; /* 0..1 wave position; >= 1 means fully lit */
    var anim = null;

    /* deterministic pseudo-activation for neuron j of layer L given pattern */
    function act(L, j) {
      var v = Math.sin((pattern + 1) * 12.9898 + L * 78.233 + j * 37.719) * 43758.5453;
      return 0.25 + (v - Math.floor(v)) * 0.75;
    }

    function outConf() {
      /* the "network" is confident in the right class */
      var base = [0.08, 0.08, 0.08];
      base[pattern] = 0.84 - 0.06 * ((pattern * 7) % 3);
      var rest = (1 - base[pattern]) / 2;
      var out = [];
      var k;
      for (k = 0; k < 3; k++) { out.push(k === pattern ? base[pattern] : rest); }
      return out;
    }

    function geom() {
      var left = 30, right = 30;
      var imgS = Math.min(120, st.w * 0.16);
      var netL = left + imgS + 46;
      var netR = st.w - right - 128;
      var cols = [];
      var i;
      for (i = 0; i < LAYERS.length; i++) {
        cols.push(netL + (i / (LAYERS.length - 1 || 1)) * (netR - netL));
      }
      return { left: left, imgS: imgS, cols: cols, outX: st.w - right - 96 };
    }

    function neuronY(L, j) {
      var n = LAYERS[L];
      var midY = st.h / 2;
      var span = Math.min(st.h - 90, n * 34);
      return midY + (j - (n - 1) / 2) * (span / n);
    }

    function draw(prog) {
      ctx.clearRect(0, 0, st.w, st.h);
      var g = geom();
      var midY = st.h / 2;
      var i, j, k;

      /* input image */
      var cell = g.imgS / 8;
      var imgY = midY - g.imgS / 2;
      var pat = PATTERNS[pattern];
      for (j = 0; j < 8; j++) {
        for (i = 0; i < 8; i++) {
          ctx.fillStyle = pat.px[j].charAt(i) === '1' ? 'rgba(2, 132, 199, 0.85)' : C.free;
          ctx.fillRect(g.left + i * cell + 1, imgY + j * cell + 1, cell - 2, cell - 2);
        }
      }
      ctx.font = '600 11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = C.muted;
      ctx.fillText('input: ' + pat.name, g.left + g.imgS / 2, imgY + g.imgS + 18);
      ctx.fillStyle = C.faint;
      ctx.fillText('(64 pixels)', g.left + g.imgS / 2, imgY + g.imgS + 33);

      /* stage thresholds: input->L0->L1->L2->out across prog 0..1 */
      var stages = LAYERS.length + 1;
      function litAmount(stage) { return clamp(prog * stages - stage, 0, 1); }

      /* edges from image to first layer */
      for (j = 0; j < LAYERS[0]; j++) {
        var a0 = litAmount(0);
        ctx.strokeStyle = 'rgba(139, 92, 246, ' + (0.06 + 0.3 * a0 * act(0, j)) + ')';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(g.left + g.imgS, midY);
        ctx.lineTo(g.cols[0], neuronY(0, j));
        ctx.stroke();
      }
      /* edges between layers */
      for (i = 0; i < LAYERS.length - 1; i++) {
        var aL = litAmount(i + 1);
        for (j = 0; j < LAYERS[i]; j++) {
          for (k = 0; k < LAYERS[i + 1]; k++) {
            if ((j + k) % 2 === 1) { continue; }
            ctx.strokeStyle = 'rgba(139, 92, 246, ' + (0.05 + 0.28 * aL * act(i, j) * act(i + 1, k)) + ')';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(g.cols[i], neuronY(i, j));
            ctx.lineTo(g.cols[i + 1], neuronY(i + 1, k));
            ctx.stroke();
          }
        }
      }
      /* edges to output */
      var conf = outConf();
      var outYs = [midY - 52, midY, midY + 52];
      var aOut = litAmount(stages - 1);
      for (j = 0; j < LAYERS[LAYERS.length - 1]; j++) {
        for (k = 0; k < 3; k++) {
          ctx.strokeStyle = 'rgba(139, 92, 246, ' + (0.05 + 0.3 * aOut * conf[k]) + ')';
          ctx.beginPath();
          ctx.moveTo(g.cols[LAYERS.length - 1], neuronY(LAYERS.length - 1, j));
          ctx.lineTo(g.outX, outYs[k]);
          ctx.stroke();
        }
      }

      /* neurons */
      for (i = 0; i < LAYERS.length; i++) {
        var lit = litAmount(i + 1);
        for (j = 0; j < LAYERS[i]; j++) {
          var a = act(i, j) * lit;
          ctx.beginPath();
          ctx.arc(g.cols[i], neuronY(i, j), 8, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(139, 92, 246, ' + (0.12 + 0.75 * a) + ')';
          ctx.fill();
          ctx.strokeStyle = a > 0.5 ? C.violet : C.lineStrong;
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
        ctx.font = '600 11px Inter, sans-serif';
        ctx.fillStyle = C.muted;
        ctx.textAlign = 'center';
        ctx.fillText(LAYER_NAMES[i], g.cols[i], neuronY(i, LAYERS[i] - 1) + 26);
      }

      /* output bars */
      ctx.textAlign = 'left';
      for (k = 0; k < 3; k++) {
        var val = conf[k] * aOut;
        ctx.fillStyle = C.free;
        ctx.fillRect(g.outX, outYs[k] - 8, 84, 16);
        ctx.fillStyle = k === pattern ? C.teal : C.faint;
        ctx.fillRect(g.outX, outYs[k] - 8, 84 * val, 16);
        ctx.font = '600 11px Inter, sans-serif';
        ctx.fillStyle = C.text;
        ctx.fillText(OUT_NAMES[k] + (aOut >= 1 ? ' ' + Math.round(conf[k] * 100) + '%' : ''), g.outX + 88, outYs[k] + 4);
      }
      ctx.fillStyle = C.faint;
      ctx.textAlign = 'center';
      ctx.fillText('output', g.outX + 42, outYs[2] + 30);
    }

    function run() {
      if (anim) { anim.stop(); anim = null; }
      if (reduced()) {
        progress = 1;
        draw(1);
        setStatus(statusEl, 'The network settles on “' + PATTERNS[pattern].name + '” — each layer transformed the previous one’s output into something more abstract, from raw pixels to a confident label.', 'ok');
        return;
      }
      progress = 0;
      setStatus(statusEl, 'Pixels in…');
      var msgs = ['Layer 1 lights up: simple edges and contrasts…', 'Layer 2 combines edges into shapes and curves…', 'Layer 3 assembles shapes into parts — ears, muzzle, wing…'];
      var lastStage = -1;
      anim = makeLoop(function (t, dt) {
        progress += dt / 2600;
        var stage = Math.min(3, Math.floor(progress * 4));
        if (stage !== lastStage && stage < 3) {
          lastStage = stage;
          setStatus(statusEl, msgs[stage]);
        }
        if (progress >= 1) {
          progress = 1;
          anim.stop();
          anim = null;
          setStatus(statusEl, 'Verdict: “' + PATTERNS[pattern].name + '.” Nobody programmed the edge detectors or the ear detectors — training on labeled examples produced the whole hierarchy. That is the deep learning difference.', 'ok');
        }
        draw(progress);
      });
      anim.start();
    }

    digitBtns.forEach(function (btn, idx) {
      btn.addEventListener('click', function () {
        digitBtns.forEach(function (b) { b.classList.remove('is-active'); b.setAttribute('aria-pressed', 'false'); });
        btn.classList.add('is-active');
        btn.setAttribute('aria-pressed', 'true');
        pattern = idx;
        progress = 0;
        draw(0);
        setStatus(statusEl, 'Input switched. Send it through.');
      });
    });

    runBtn.addEventListener('click', run);
    draw(0);
    onScreen(canvas, function () { draw(progress); });
  }

  /* ==========================================================================
     08 — REINFORCEMENT LEARNING: tabular Q-learning in a gridworld. Real.
     ========================================================================== */

  function initRl() {
    var canvas = $('#ai-rl-canvas');
    if (!canvas) { return; }
    var trainBtn = $('#ai-rl-train');
    var resetBtn = $('#ai-rl-reset');
    var speedInput = $('#ai-rl-speed');
    var epEl = $('#ai-rl-episodes');
    var epsEl = $('#ai-rl-eps');
    var rewEl = $('#ai-rl-reward');
    var statusEl = $('#ai-rl-status');

    var cv = setupCanvas(canvas, draw);
    var ctx = cv.ctx, st = cv.state;
    var rng = makeRng(20160309);

    var COLS = 8, ROWS = 6;
    var START = { x: 0, y: 5 }, GOAL = { x: 7, y: 0 };
    var PITS = [{ x: 3, y: 2 }, { x: 5, y: 1 }, { x: 2, y: 4 }, { x: 6, y: 3 }];
    var ACTIONS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; /* up right down left */
    var ARROWS = ['↑', '→', '↓', '←'];

    var Q, episodes, eps, rewards, agent, running, milestone;

    function isPit(x, y) { return PITS.some(function (p) { return p.x === x && p.y === y; }); }

    function reset() {
      Q = [];
      var i;
      for (i = 0; i < COLS * ROWS * 4; i++) { Q.push(0); }
      episodes = 0;
      eps = 1.0;
      rewards = [];
      agent = { x: START.x, y: START.y, path: [] };
      milestone = 0;
      epEl.textContent = '0';
      epsEl.textContent = '100%';
      rewEl.textContent = '–';
    }

    function qi(x, y, a) { return (y * COLS + x) * 4 + a; }
    function maxQ(x, y) {
      var m = -Infinity, a;
      for (a = 0; a < 4; a++) { m = Math.max(m, Q[qi(x, y, a)]); }
      return m;
    }
    function bestA(x, y) {
      var m = -Infinity, bi = 0, a;
      for (a = 0; a < 4; a++) {
        if (Q[qi(x, y, a)] > m) { m = Q[qi(x, y, a)]; bi = a; }
      }
      return bi;
    }

    var ALPHA = 0.35, GAMMA = 0.92, STEP_R = -0.15;

    /* one full episode of Q-learning; returns total reward and the path */
    function runEpisode(recordPath) {
      var x = START.x, y = START.y;
      var total = 0;
      var path = recordPath ? [{ x: x, y: y }] : null;
      var steps = 0;
      while (steps < 120) {
        steps++;
        var a = rng() < eps ? Math.floor(rng() * 4) : bestA(x, y);
        var nx = clamp(x + ACTIONS[a][0], 0, COLS - 1);
        var ny = clamp(y + ACTIONS[a][1], 0, ROWS - 1);
        var r = STEP_R;
        var done = false;
        if (nx === GOAL.x && ny === GOAL.y) { r = 10; done = true; }
        else if (isPit(nx, ny)) { r = -10; done = true; }
        var target = done ? r : r + GAMMA * maxQ(nx, ny);
        Q[qi(x, y, a)] += ALPHA * (target - Q[qi(x, y, a)]);
        total += r;
        x = nx; y = ny;
        if (path) { path.push({ x: x, y: y }); }
        if (done) { break; }
      }
      episodes++;
      eps = Math.max(0.05, eps * 0.99);
      rewards.push(total);
      if (rewards.length > 400) { rewards.shift(); }
      return { total: total, path: path };
    }

    function avgReward() {
      if (rewards.length < 5) { return null; }
      var n = Math.min(20, rewards.length);
      var s = 0, i;
      for (i = rewards.length - n; i < rewards.length; i++) { s += rewards[i]; }
      return s / n;
    }

    function geom() {
      var chartH = 64;
      var s = Math.min(st.w / COLS, (st.h - chartH - 18) / ROWS);
      return { s: s, ox: (st.w - s * COLS) / 2, oy: 8, chartY: 8 + s * ROWS + 14, chartH: chartH };
    }

    function valueColor(v) {
      if (v > 0.05) {
        var a = clamp(v / 8, 0, 1);
        return 'rgba(13, 148, 136, ' + (0.08 + a * 0.45) + ')';
      }
      if (v < -0.05) {
        var b = clamp(-v / 8, 0, 1);
        return 'rgba(225, 29, 72, ' + (0.06 + b * 0.3) + ')';
      }
      return 'rgba(39, 52, 73, 0.5)';
    }

    function draw() {
      ctx.clearRect(0, 0, st.w, st.h);
      var g = geom();
      var x, y;
      for (y = 0; y < ROWS; y++) {
        for (x = 0; x < COLS; x++) {
          var px = g.ox + x * g.s, py = g.oy + y * g.s;
          var v = maxQ(x, y);
          ctx.fillStyle = valueColor(v);
          ctx.fillRect(px + 1.5, py + 1.5, g.s - 3, g.s - 3);
          ctx.strokeStyle = C.line;
          ctx.lineWidth = 1;
          ctx.strokeRect(px + 1.5, py + 1.5, g.s - 3, g.s - 3);

          if (isPit(x, y)) {
            ctx.fillStyle = C.rose;
            ctx.font = '700 ' + Math.round(g.s * 0.34) + 'px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('✕', px + g.s / 2, py + g.s / 2);
          } else if (x === GOAL.x && y === GOAL.y) {
            ctx.fillStyle = C.teal;
            ctx.font = '700 ' + Math.round(g.s * 0.34) + 'px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('+', px + g.s / 2, py + g.s / 2);
          } else if (Math.abs(v) > 0.4) {
            ctx.fillStyle = 'rgba(241, 245, 249, 0.75)';
            ctx.font = '600 ' + Math.round(g.s * 0.3) + 'px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(ARROWS[bestA(x, y)], px + g.s / 2, py + g.s / 2);
          }
        }
      }
      /* labels */
      ctx.font = '600 10px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = C.faint;
      ctx.fillText('start', g.ox + START.x * g.s + 4, g.oy + (START.y + 1) * g.s - 5);
      ctx.textAlign = 'right';
      ctx.fillText('charger +10', g.ox + (GOAL.x + 1) * g.s - 4, g.oy + GOAL.y * g.s + 12);

      /* agent */
      ctx.beginPath();
      ctx.arc(g.ox + agent.x * g.s + g.s / 2, g.oy + agent.y * g.s + g.s / 2, g.s * 0.16, 0, Math.PI * 2);
      ctx.fillStyle = C.sky;
      ctx.fill();
      ctx.strokeStyle = C.strong;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      /* reward chart */
      ctx.font = '600 10px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = C.faint;
      ctx.fillText('reward per episode', g.ox, g.chartY - 3);
      ctx.strokeStyle = C.line;
      ctx.strokeRect(g.ox, g.chartY, g.s * COLS, g.chartH);
      if (rewards.length > 1) {
        var n = Math.min(160, rewards.length);
        ctx.beginPath();
        var i;
        for (i = 0; i < n; i++) {
          var r = rewards[rewards.length - n + i];
          var vx = g.ox + (i / (n - 1)) * g.s * COLS;
          var vy = g.chartY + g.chartH - ((clamp(r, -14, 10) + 14) / 24) * g.chartH;
          if (i === 0) { ctx.moveTo(vx, vy); } else { ctx.lineTo(vx, vy); }
        }
        ctx.strokeStyle = C.lime;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    function refreshStats() {
      epEl.textContent = String(episodes);
      epsEl.textContent = Math.round(eps * 100) + '%';
      var ar = avgReward();
      rewEl.textContent = ar === null ? '–' : ar.toFixed(1);
      if (milestone === 0 && episodes >= 15) {
        milestone = 1;
        setStatus(statusEl, 'Mostly random wandering so far — exploration. But every step already updates a value estimate somewhere.');
      } else if (milestone === 1 && eps < 0.5) {
        milestone = 2;
        setStatus(statusEl, 'Exploration is winding down and a corridor of teal is forming — the agent is starting to trust what it learned.');
      } else if (milestone === 2 && (avgReward() || -99) > 5) {
        milestone = 3;
        setStatus(statusEl, 'Converged: the arrows now trace an efficient route around the pits, and reward per episode has plateaued near its maximum. Nobody showed it that route — rewards did.', 'ok');
      }
    }

    /* training loop: speed 0 = watch single episodes, 1 = medium, 2 = fast */
    var loop = null;
    var walking = null; /* animated walk state */

    function stopAll() {
      if (loop) { loop.stop(); loop = null; }
      walking = null;
      running = false;
      trainBtn.textContent = 'Train';
    }

    function start() {
      running = true;
      trainBtn.textContent = 'Pause';
      if (reduced()) {
        /* no animation: train in bulk, draw final state */
        var i;
        for (i = 0; i < 400; i++) { runEpisode(false); }
        draw();
        refreshStats();
        stopAll();
        trainBtn.textContent = 'Train more';
        return;
      }
      loop = makeLoop(function (t, dt) {
        var speed = parseInt(speedInput.value, 10);
        if (speed === 0) {
          /* animated: walk the recorded path of one episode step by step */
          if (!walking) {
            var ep = runEpisode(true);
            walking = { path: ep.path, i: 0, acc: 0 };
          }
          walking.acc += dt;
          while (walking.acc > 55 && walking.i < walking.path.length - 1) {
            walking.acc -= 55;
            walking.i++;
          }
          var pos = walking.path[walking.i];
          agent.x = pos.x;
          agent.y = pos.y;
          if (walking.i >= walking.path.length - 1) { walking = null; }
        } else {
          var per = speed === 1 ? 4 : 25;
          var k;
          for (k = 0; k < per; k++) { runEpisode(false); }
          agent.x = START.x;
          agent.y = START.y;
        }
        draw();
        refreshStats();
      });
      loop.start();
    }

    trainBtn.addEventListener('click', function () {
      if (running) { stopAll(); } else { start(); }
    });
    resetBtn.addEventListener('click', function () {
      stopAll();
      reset();
      draw();
      setStatus(statusEl, 'Memory wiped. The world looks exactly as it did before — but the agent no longer knows anything about it.');
    });

    reset();
    draw();
    onScreen(canvas, draw, function () { if (running) { stopAll(); } });
  }

  /* ==========================================================================
     09 — GENERATIVE AI: word-level Markov toy + diffusion slider.
     ========================================================================== */

  function initGen() {
    var runBtn = $('#ai-gen-run');
    var tempInput = $('#ai-gen-temp');
    var tempOut = $('#ai-gen-temp-out');
    var outEl = $('#ai-gen-out');
    var probsEl = $('#ai-gen-probs');
    var statusEl = $('#ai-gen-status');
    if (!runBtn || !outEl) { return; }

    var CORPUS = [
      'the model learns patterns from data and uses the patterns to predict the next word',
      'a language model predicts the next word from the words before it',
      'the network learns features from examples instead of following rules',
      'an agent learns a policy from reward and the policy improves with practice',
      'data shapes the model and the model shapes every prediction it makes',
      'the model predicts one word at a time and each word changes what comes next',
      'a deep network turns raw data into features and features into predictions',
      'learning turns examples into a model and the model turns input into output',
      'the next word depends on the words before it and on the data the model saw'
    ];

    /* build bigram counts */
    var STARTS = [];
    var BIGRAMS = {};
    CORPUS.forEach(function (line) {
      var words = line.split(' ');
      STARTS.push(words[0]);
      var i;
      for (i = 0; i < words.length; i++) {
        var w = words[i];
        var nxt = i + 1 < words.length ? words[i + 1] : '<end>';
        if (!BIGRAMS[w]) { BIGRAMS[w] = {}; }
        BIGRAMS[w][nxt] = (BIGRAMS[w][nxt] || 0) + 1;
      }
    });

    var rng = makeRng(20221130);
    var timers = [];
    function clearTimers() { timers.forEach(clearTimeout); timers = []; }

    function temperature() {
      return 0.05 + (parseInt(tempInput.value, 10) / 100) * 1.95;
    }

    function distribution(word) {
      var counts = BIGRAMS[word] || {};
      var keys = Object.keys(counts);
      if (!keys.length) { return []; }
      var T = temperature();
      var raw = keys.map(function (k) { return Math.pow(counts[k], 1 / Math.max(T, 0.05)); });
      var sum = raw.reduce(function (a, b) { return a + b; }, 0);
      var dist = keys.map(function (k, i) { return { word: k, p: raw[i] / sum }; });
      dist.sort(function (a, b) { return b.p - a.p; });
      return dist;
    }

    function sample(dist) {
      var T = temperature();
      if (T <= 0.1) { return dist[0]; } /* near-zero temperature: argmax */
      var r = rng();
      var acc = 0, i;
      for (i = 0; i < dist.length; i++) {
        acc += dist[i].p;
        if (r <= acc) { return dist[i]; }
      }
      return dist[dist.length - 1];
    }

    function renderProbs(dist, picked) {
      probsEl.innerHTML = '';
      dist.slice(0, 6).forEach(function (d) {
        var row = document.createElement('div');
        row.className = 'ai-gen-prob' + (picked && d.word === picked ? ' is-picked' : '');
        var w = document.createElement('span');
        w.className = 'ai-gen-prob-word';
        w.textContent = d.word === '<end>' ? '(stop)' : d.word;
        var track = document.createElement('div');
        track.className = 'ai-gen-prob-track';
        var fill = document.createElement('div');
        fill.className = 'ai-gen-prob-fill';
        fill.style.width = Math.round(d.p * 100) + '%';
        track.appendChild(fill);
        var v = document.createElement('span');
        v.className = 'ai-gen-prob-val';
        v.textContent = Math.round(d.p * 100) + '%';
        row.appendChild(w);
        row.appendChild(track);
        row.appendChild(v);
        probsEl.appendChild(row);
      });
    }

    function addWord(word, latest) {
      $$('.ai-gen-word', outEl).forEach(function (el) { el.classList.remove('is-latest'); });
      var span = document.createElement('span');
      span.className = 'ai-gen-word' + (latest ? ' is-latest' : '');
      span.textContent = word;
      outEl.appendChild(span);
      outEl.appendChild(document.createTextNode(' '));
    }

    function generate() {
      clearTimers();
      outEl.innerHTML = '';
      probsEl.innerHTML = '';
      runBtn.disabled = true;
      var word = STARTS[Math.floor(rng() * STARTS.length)];
      addWord(word, true);
      var count = 0;
      var MAXW = 20;
      var delay = reduced() ? 0 : 300;

      function step() {
        var dist = distribution(word);
        if (!dist.length || count >= MAXW) {
          finish(false);
          return;
        }
        var pick = sample(dist);
        renderProbs(dist, pick.word);
        if (pick.word === '<end>') {
          finish(true);
          return;
        }
        timers.push(setTimeout(function () {
          addWord(pick.word, true);
          word = pick.word;
          count++;
          timers.push(setTimeout(step, delay));
        }, reduced() ? 0 : 140));
      }

      function finish(clean) {
        runBtn.disabled = false;
        var T = temperature();
        var flavor;
        if (T < 0.35) {
          flavor = 'At low temperature the model almost always takes the top bar — safe, repetitive, and the same phrasing every run.';
        } else if (T < 1.0) {
          flavor = 'At medium temperature it mostly follows the high bars with occasional detours — the balance most real systems ship with.';
        } else {
          flavor = 'At high temperature the low bars win often — more surprising word choices, and quickly less coherent. Creativity and coherence trade off on one dial.';
        }
        setStatus(statusEl, (clean ? 'Reached a natural stop. ' : 'Length limit reached. ') + flavor);
      }

      timers.push(setTimeout(step, delay));
    }

    tempInput.addEventListener('input', function () {
      tempOut.textContent = temperature().toFixed(1).replace(/\.0$/, '.0');
    });
    runBtn.addEventListener('click', generate);
    tempOut.textContent = temperature().toFixed(1);
  }

  function initDiffusion() {
    var canvas = $('#ai-diff-canvas');
    if (!canvas) { return; }
    var slider = $('#ai-diff-slider');
    var out = $('#ai-diff-out');
    var playBtn = $('#ai-diff-play');

    var N = 16;
    /* target: a simple sun/face pattern in teal on slate */
    var TARGET = [
      '0000011111100000',
      '0001110000111000',
      '0011000000001100',
      '0110000000000110',
      '0100110000110010',
      '1100110000110011',
      '1000000000000001',
      '1000000110000001',
      '1000000110000001',
      '1000000000000001',
      '1100100000100011',
      '0100011111100010',
      '0110000000000110',
      '0011000000001100',
      '0001110000111000',
      '0000011111100000'
    ];
    var rng = makeRng(20210105);
    var noise = [];
    var i;
    for (i = 0; i < N * N; i++) { noise.push(rng()); }
    /* per-pixel "denoise moment": pixels lock in at different times, which is
       roughly how structure emerges from the blur in real samplers */
    var lockAt = [];
    for (i = 0; i < N * N; i++) { lockAt.push(0.15 + rng() * 0.7); }

    var cv = setupCanvas(canvas, function () { draw(val()); });
    var ctx = cv.ctx, st = cv.state;

    function val() { return parseInt(slider.value, 10) / 100; }

    function draw(t) {
      ctx.clearRect(0, 0, st.w, st.h);
      var s = Math.min(st.w, st.h) / N;
      var ox = (st.w - s * N) / 2, oy = (st.h - s * N) / 2;
      var x, y;
      for (y = 0; y < N; y++) {
        for (x = 0; x < N; x++) {
          var k = y * N + x;
          var target = TARGET[y].charAt(x) === '1' ? 1 : 0;
          /* progress toward this pixel's locked value */
          var p = clamp((t - lockAt[k] * 0.5) / (1 - lockAt[k] * 0.5), 0, 1);
          p = easeInOut(p);
          var jitter = (noise[k] - 0.5) * (1 - t) * 0.9;
          var v = noise[k] * (1 - p) + target * p + jitter * (1 - p);
          v = clamp(v, 0, 1);
          /* map value to a slate->teal ramp */
          var rC = Math.round(15 + v * (45 - 15));
          var gC = Math.round(23 + v * (212 - 23));
          var bC = Math.round(42 + v * (191 - 42));
          ctx.fillStyle = 'rgb(' + rC + ',' + gC + ',' + bC + ')';
          ctx.fillRect(ox + x * s, oy + y * s, s + 0.5, s + 0.5);
        }
      }
    }

    function label(t) {
      var step = Math.round(t * 50);
      var desc;
      if (t < 0.1) { desc = 'pure noise'; }
      else if (t < 0.45) { desc = 'faint structure emerging'; }
      else if (t < 0.8) { desc = 'shapes locking in'; }
      else if (t < 1) { desc = 'final details'; }
      else { desc = 'clean sample'; }
      out.textContent = 'step ' + step + ' — ' + desc;
    }

    slider.addEventListener('input', function () {
      var t = val();
      draw(t);
      label(t);
    });

    var anim = null;
    playBtn.addEventListener('click', function () {
      if (anim) { anim.stop(); anim = null; playBtn.textContent = 'Play'; return; }
      if (reduced()) {
        slider.value = '100';
        draw(1);
        label(1);
        return;
      }
      slider.value = '0';
      var t = 0;
      playBtn.textContent = 'Stop';
      anim = makeLoop(function (tm, dt) {
        t += dt / 3200;
        if (t >= 1) {
          t = 1;
          anim.stop();
          anim = null;
          playBtn.textContent = 'Play';
        }
        slider.value = String(Math.round(t * 100));
        draw(t);
        label(t);
      });
      anim.start();
    });

    draw(0);
    label(0);
    onScreen(canvas, function () { draw(val()); });
  }

  /* ==========================================================================
     10 — AI IN EVERYDAY LIFE: expandable dashboard cards.
     ========================================================================== */

  function initLife() {
    var grid = $('#ai-life-grid');
    if (!grid) { return; }

    var ITEMS = [
      { t: 'Search engines', tags: ['ML ranking', 'NLP', 'Knowledge graphs'],
        why: 'Hundreds of learned signals rank billions of pages in milliseconds; language models now interpret what you meant, not just what you typed.',
        lim: 'Ranking can amplify whatever gets clicks, and AI-written summaries inherit the hallucination problem.' },
      { t: 'Recommendations', tags: ['Collaborative filtering', 'Deep learning'],
        why: 'Learns taste from behavior — people who watched what you watched — surfacing choices you’d never find by browsing.',
        lim: 'Optimizing for engagement is not optimizing for your wellbeing; feedback loops can narrow what you see.' },
      { t: 'Spam filtering', tags: ['Classical ML', 'NLP'],
        why: 'A classifier retrained continuously on billions of messages catches over 99% of spam — the longest-running ML success story.',
        lim: 'Adversaries adapt daily, and false positives occasionally swallow mail that mattered.' },
      { t: 'Navigation apps', tags: ['A* search', 'ML traffic prediction'],
        why: 'The chapter 5 algorithm finds routes; learned models predict traffic from live and historical movement to weight the graph.',
        lim: 'Predictions fail on unprecedented events, and rerouting everyone the same way can create the jam it promised to avoid.' },
      { t: 'Fraud detection', tags: ['Anomaly detection', 'Classical ML'],
        why: 'Models score every transaction in milliseconds against your learned patterns — impossible at human speed and card-network scale.',
        lim: 'False alarms freeze legitimate cards; fraudsters probe the model’s blind spots constantly.' },
      { t: 'Medical imaging', tags: ['Computer vision', 'Deep learning'],
        why: 'Vision models flag suspicious regions in scans, matching specialist-level sensitivity on specific, well-studied tasks and catching cases fatigue misses.',
        lim: 'Performance can drop on new scanners or populations; deployment is (rightly) as a second reader, with clinicians deciding.' },
      { t: 'Driver assistance', tags: ['Vision', 'Planning', 'Sensor fusion'],
        why: 'Perception networks plus classical planners handle lane keeping, braking, and parking — measurably reducing certain crash types.',
        lim: 'The rare weird case — the mattress on the highway — is exactly what learned systems handle worst. Supervision remains mandatory.' },
      { t: 'Voice assistants', tags: ['Speech recognition', 'NLP'],
        why: 'Deep networks turned speech-to-text from a party trick into infrastructure; language models parse the intent behind the words.',
        lim: 'Accents and noisy rooms still degrade accuracy; complex multi-step requests still fail more than anyone admits.' },
      { t: 'Translation', tags: ['Transformers', 'NLP'],
        why: 'Neural translation made a hundred-language pocket translator ordinary — one of deep learning’s clearest gifts to daily life.',
        lim: 'Idiom, tone, and cultural nuance still slip; low-resource languages get visibly worse quality.' },
      { t: 'Customer support', tags: ['LLMs', 'Retrieval'],
        why: 'Chatbots grounded in a company’s real documentation resolve routine issues instantly, around the clock, in any language.',
        lim: 'Ungrounded bots invent policies — a hallucination with a receipt. Escalation paths to humans are the difference between help and harm.' },
      { t: 'Coding assistants', tags: ['LLMs', 'Generative AI'],
        why: 'Models trained on public code draft functions, tests, and refactors from plain-language intent — a genuine shift in how software gets written.',
        lim: 'Generated code can be subtly wrong or insecure while looking polished; review and tests remain non-negotiable.' },
      { t: 'Scientific research', tags: ['Deep learning', 'Simulation'],
        why: 'Protein structure prediction, weather models, materials screening — AI compresses years of search into days of computation.',
        lim: 'A prediction is a hypothesis, not a result; the lab bench still renders the verdict.' }
    ];

    ITEMS.forEach(function (item) {
      var card = document.createElement('div');
      card.className = 'ai-life-card';
      card.setAttribute('role', 'listitem');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ai-life-btn';
      btn.setAttribute('aria-expanded', 'false');
      btn.textContent = item.t;
      var body = document.createElement('div');
      body.className = 'ai-life-body';
      body.hidden = true;

      var tags = document.createElement('div');
      tags.className = 'ai-life-tags';
      item.tags.forEach(function (tg) {
        var s = document.createElement('span');
        s.className = 'ai-life-tag';
        s.textContent = tg;
        tags.appendChild(s);
      });
      var p1 = document.createElement('p');
      var s1 = document.createElement('strong');
      s1.textContent = 'Why AI: ';
      p1.appendChild(s1);
      p1.appendChild(document.createTextNode(item.why));
      var p2 = document.createElement('p');
      var s2 = document.createElement('strong');
      s2.textContent = 'Still imperfect: ';
      p2.appendChild(s2);
      p2.appendChild(document.createTextNode(item.lim));

      body.appendChild(tags);
      body.appendChild(p1);
      body.appendChild(p2);
      card.appendChild(btn);
      card.appendChild(body);
      grid.appendChild(card);

      btn.addEventListener('click', function () {
        var open = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', open ? 'false' : 'true');
        body.hidden = open;
        card.classList.toggle('is-open', !open);
      });
    });
  }

  /* ==========================================================================
     11 — LIMITATIONS: expandable panels.
     ========================================================================== */

  function initLimits() {
    $$('#limits .ai-limit').forEach(function (item) {
      var btn = $('.ai-limit-btn', item);
      var body = $('.ai-limit-body', item);
      if (!btn || !body) { return; }
      btn.addEventListener('click', function () {
        var open = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', open ? 'false' : 'true');
        body.hidden = open;
      });
    });
  }

  /* ==========================================================================
     13 — AI EXPLORER: problem -> approach fit, with constraints.
     ========================================================================== */

  function initExplorer() {
    var barsEl = $('#ai-exp-bars');
    var verdictEl = $('#ai-exp-verdict');
    var chips = $$('#explorer .ai-chip');
    var cExplain = $('#ai-exp-explain');
    var cSmall = $('#ai-exp-smalldata');
    var cEdge = $('#ai-exp-edge');
    if (!barsEl || !chips.length) { return; }

    var APPROACHES = [
      { id: 'rules', name: 'Rules & logic' },
      { id: 'search', name: 'Search & planning' },
      { id: 'ml', name: 'Classical ML' },
      { id: 'deep', name: 'Deep learning' },
      { id: 'rl', name: 'Reinforcement learning' }
    ];

    var PROBLEMS = {
      images: {
        base: { rules: 8, search: 6, ml: 45, deep: 95, rl: 15 },
        verdict: 'Deep learning, decisively.',
        why: 'Recognizing objects in photos is pure perception — exactly the problem where hand-written rules failed for forty years (nobody can write IF–THEN conditions for “cat”) and where learned feature hierarchies excel. Classical ML works only if a human engineers image features first, which was the pre-2012 state of the art for a reason.',
        pipeline: 'Photos → convolutional / transformer network → label + confidence.'
      },
      movies: {
        base: { rules: 22, search: 10, ml: 82, deep: 68, rl: 38 },
        verdict: 'Classical machine learning first — deep learning at scale.',
        why: 'Recommendation is a statistics problem over sparse behavior data: people who liked A and B also liked C. Collaborative filtering and gradient-boosted models are strong, cheap, and inspectable; the giant platforms layer deep models on top for sequence patterns, and RL ideas appear when optimizing long-term engagement rather than the next click.',
        pipeline: 'Watch history → similarity model → ranked suggestions.'
      },
      translate: {
        base: { rules: 15, search: 8, ml: 40, deep: 96, rl: 20 },
        verdict: 'Deep learning — this problem is why transformers exist.',
        why: 'Grammar-rule translation was attempted for half a century and plateaued at phrase-book quality; language has too many soft constraints to enumerate. Statistical ML improved it; transformer networks reading whole sentences in context now define it. The history of machine translation is a miniature history of AI itself.',
        pipeline: 'Source sentence → transformer encoder-decoder → target sentence.'
      },
      maze: {
        base: { rules: 30, search: 92, ml: 18, deep: 30, rl: 62 },
        verdict: 'Search and planning — the classical tools win.',
        why: 'A warehouse robot’s route is a graph problem with known structure: A* (chapter 5) solves it optimally, fast, and explainably. No training data needed, no surprises. Reinforcement learning becomes worth the cost when the environment’s dynamics are unknown or changing — learned locomotion, dynamic obstacle behavior — and deep vision handles seeing the shelves.',
        pipeline: 'Map + goal → A* planner → route → controller executes.'
      },
      generate: {
        base: { rules: 12, search: 5, ml: 18, deep: 95, rl: 42 },
        verdict: 'Deep learning — specifically, large language models.',
        why: 'Drafting prose is open-ended generation over language — the defining LLM task. Templates (rules) produce mail-merge stiffness; nothing else on the list generates fluent novel text at all. Note the reinforcement learning bar: RLHF is how raw language models get tuned toward helpful, honest drafts — a supporting role, not the engine.',
        pipeline: 'Prompt → autoregressive LLM → draft → human edits and owns it.'
      },
      loans: {
        base: { rules: 62, search: 8, ml: 78, deep: 42, rl: 8 },
        verdict: 'Classical ML + rules — and the constraints are the story.',
        why: 'Credit decisions are regulated: applicants are owed reasons, regulators audit for discrimination, and the chapter 11 bias trap is a legal liability here, not a philosophical one. Interpretable models (scorecards, logistic regression, constrained boosting) plus hard eligibility rules dominate — not because deep learning can’t find patterns, but because unexplainable patterns are exactly what you don’t want deciding livelihoods.',
        pipeline: 'Application → eligibility rules → interpretable risk score → human review of edge cases.'
      }
    };

    var MODS = {
      explain: { rules: 15, search: 10, ml: 6, deep: -25, rl: -15,
        note: 'Explainability pushes toward rules and simple models: a deep network’s billions of weights don’t print a reason a regulator will accept.' },
      small: { rules: 15, search: 12, ml: -12, deep: -32, rl: -18,
        note: 'Scarce data starves learning-based approaches — deep learning most of all. Rules and search need zero training examples.' },
      edge: { rules: 10, search: 6, ml: 6, deep: -20, rl: -6,
        note: 'A tiny device favors small models: rules, search, and compact classical ML fit in kilobytes; big networks need distillation or a server.' }
    };

    var current = 'images';

    function render() {
      var prob = PROBLEMS[current];
      var scores = {};
      APPROACHES.forEach(function (a) { scores[a.id] = prob.base[a.id]; });
      var notes = [];
      if (cExplain.checked) { APPROACHES.forEach(function (a) { scores[a.id] += MODS.explain[a.id]; }); notes.push(MODS.explain.note); }
      if (cSmall.checked) { APPROACHES.forEach(function (a) { scores[a.id] += MODS.small[a.id]; }); notes.push(MODS.small.note); }
      if (cEdge.checked) { APPROACHES.forEach(function (a) { scores[a.id] += MODS.edge[a.id]; }); notes.push(MODS.edge.note); }
      APPROACHES.forEach(function (a) { scores[a.id] = clamp(scores[a.id], 4, 98); });

      var best = APPROACHES[0].id;
      APPROACHES.forEach(function (a) { if (scores[a.id] > scores[best]) { best = a.id; } });

      barsEl.innerHTML = '';
      APPROACHES.forEach(function (a) {
        var row = document.createElement('div');
        row.className = 'ai-exp-row' + (a.id === best ? ' is-best' : '');
        var name = document.createElement('span');
        name.className = 'ai-exp-name';
        name.textContent = a.name;
        var track = document.createElement('div');
        track.className = 'ai-exp-track';
        var fill = document.createElement('div');
        fill.className = 'ai-exp-fill';
        fill.style.width = scores[a.id] + '%';
        track.appendChild(fill);
        var sc = document.createElement('span');
        sc.className = 'ai-exp-score';
        sc.textContent = String(scores[a.id]);
        row.appendChild(name);
        row.appendChild(track);
        row.appendChild(sc);
        barsEl.appendChild(row);
      });

      verdictEl.innerHTML = '';
      var h = document.createElement('h3');
      h.textContent = prob.verdict;
      verdictEl.appendChild(h);
      var p1 = document.createElement('p');
      p1.textContent = prob.why;
      verdictEl.appendChild(p1);
      var p2 = document.createElement('p');
      var s = document.createElement('strong');
      s.textContent = 'How it flows: ';
      p2.appendChild(s);
      p2.appendChild(document.createTextNode(prob.pipeline));
      verdictEl.appendChild(p2);
      notes.forEach(function (n) {
        var pn = document.createElement('p');
        pn.textContent = '→ ' + n;
        verdictEl.appendChild(pn);
      });

      /* constraints can dethrone the natural winner — call that out */
      var naturalBest = APPROACHES[0].id;
      APPROACHES.forEach(function (a) { if (prob.base[a.id] > prob.base[naturalBest]) { naturalBest = a.id; } });
      if (best !== naturalBest) {
        var pd = document.createElement('p');
        var sd = document.createElement('strong');
        sd.textContent = 'Note: ';
        pd.appendChild(sd);
        pd.appendChild(document.createTextNode('your constraints changed the answer — without them this problem favors a different approach. This is what real AI engineering decisions look like.'));
        verdictEl.appendChild(pd);
      }
    }

    chips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        chips.forEach(function (c) { c.classList.remove('is-active'); });
        chip.classList.add('is-active');
        current = chip.getAttribute('data-ai-problem');
        render();
      });
    });
    [cExplain, cSmall, cEdge].forEach(function (cb) {
      cb.addEventListener('change', render);
    });

    render();
  }

  /* ==========================================================================
     Boot — every widget isolated so one failure can't break the page
     ========================================================================== */

  function boot() {
    [initReveal, initRail, initHero, initIntel, initHistory, initMap,
     initRules, initSearch, initMl, initDeep, initRl, initGen,
     initDiffusion, initLife, initLimits, initExplorer].forEach(function (fn) {
      try { fn(); } catch (e) {
        if (window.console && console.error) { console.error('ai.js widget failed:', fn.name, e); }
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
