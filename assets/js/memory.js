/* =============================================================================
   Inside Computer Memory — interactivity
   Vanilla JS, no dependencies. Loaded with `defer` on /memory/ only.

   Structure:
     1. Shared utilities (canvas fitting, visibility gating, rAF loops)
     2. One init function per widget, each guarded by element existence
     3. Everything respects prefers-reduced-motion: ambient animation is
        disabled and user-triggered simulations jump to their final state.

   Simulations are illustrative models with honest ratios, not cycle-accurate
   hardware emulation — the captions in the HTML say so where it matters.
   ============================================================================ */

(function () {
  'use strict';

  document.documentElement.classList.add('mx-js');

  var RM = window.matchMedia('(prefers-reduced-motion: reduce)');

  function reduced() { return RM.matches; }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function fmtInt(n) { return Math.round(n).toLocaleString('en-US'); }

  /* Format a duration given in nanoseconds. */
  function fmtNs(ns) {
    if (ns < 1e3) { return (ns < 10 ? ns.toFixed(1) : Math.round(ns)) + ' ns'; }
    if (ns < 1e6) { return (ns / 1e3 < 10 ? (ns / 1e3).toFixed(1) : Math.round(ns / 1e3)) + ' µs'; }
    if (ns < 1e9) { return (ns / 1e6 < 10 ? (ns / 1e6).toFixed(1) : Math.round(ns / 1e6)) + ' ms'; }
    return (ns / 1e9).toFixed(1) + ' s';
  }

  function fmtSecondsHuman(s) {
    if (s < 90) { return Math.round(s) + ' second' + (Math.round(s) === 1 ? '' : 's'); }
    if (s < 5400) { return Math.round(s / 60) + ' minutes'; }
    if (s < 172800) { return Math.round(s / 3600) + ' hours'; }
    if (s < 5184000) { return Math.round(s / 86400) + ' days'; }
    if (s < 63072000) { return Math.round(s / 2592000) + ' months'; }
    return (s / 31536000).toFixed(1) + ' years';
  }

  var C = {
    deep: '#0b1120', line: '#1e293b', lineStrong: '#334155',
    text: '#cbd5e1', strong: '#f1f5f9', muted: '#94a3b8', faint: '#64748b',
    teal: '#2dd4bf', tealDeep: '#14b8a6',
    cTeal: '#0d9488', amber: '#d97706', sky: '#0284c7',
    rose: '#e11d48', violet: '#8b5cf6', lime: '#65a30d', free: '#273449'
  };

  /* Fit a canvas's backing store to its CSS box (devicePixelRatio-aware). */
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

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* A simple seeded PRNG so runs are repeatable. */
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
    var targets = $$('#memory-experience [data-mx-reveal]').concat($$('#memory-experience .mx-era'));
    if (!targets.length) { return; }
    $$('#memory-experience .mx-era').forEach(function (el, i) {
      el.style.transitionDelay = (i % 4) * 70 + 'ms';
    });
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
    var dots = $$('.mx-rail-dot');
    if (!dots.length) { return; }
    var byId = {};
    dots.forEach(function (dot) {
      dot.setAttribute('aria-label', dot.getAttribute('data-label') || 'Section');
      byId[dot.getAttribute('href').slice(1)] = dot;
    });
    var sections = Object.keys(byId)
      .map(function (id) { return document.getElementById(id); })
      .filter(Boolean);
    if (!sections.length || !('IntersectionObserver' in window)) { return; }
    var current = null;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) { return; }
        var dot = byId[e.target.id];
        if (!dot || dot === current) { return; }
        if (current) { current.classList.remove('is-active'); }
        current = dot;
        dot.classList.add('is-active');
      });
    }, { rootMargin: '-35% 0px -55% 0px', threshold: 0 });
    sections.forEach(function (s) { io.observe(s); });
  }

  /* ==========================================================================
     Hero — stylized motherboard with data flowing between components
     ========================================================================== */

  function initHero() {
    var canvas = $('#mx-hero-canvas');
    if (!canvas) { return; }
    var cv = setupCanvas(canvas, function () { layout(); drawStatic(); });
    var ctx = cv.ctx;
    var nodes = [];
    var traces = [];
    var packets = [];
    var rng = makeRng(7);

    function layout() {
      var w = cv.state.w, h = cv.state.h;
      var cx = w * 0.5, cy = h * 0.52;
      nodes = [
        { id: 'cpu', label: 'CPU', x: cx, y: cy, w: 92, h: 92 },
        { id: 'ram', label: 'RAM', x: cx + w * 0.2, y: cy - h * 0.16, w: 26, h: 110 },
        { id: 'ram2', label: '', x: cx + w * 0.2 + 38, y: cy - h * 0.16, w: 26, h: 110 },
        { id: 'gpu', label: 'GPU', x: cx - w * 0.24, y: cy + h * 0.2, w: 130, h: 56 },
        { id: 'ssd', label: 'SSD', x: cx + w * 0.24, y: cy + h * 0.22, w: 110, h: 44 },
        { id: 'chip', label: 'I/O', x: cx - w * 0.22, y: cy - h * 0.2, w: 64, h: 64 },
        { id: 'net', label: 'NET', x: cx + w * 0.38, y: cy + h * 0.02, w: 56, h: 40 }
      ];
      var byId = {};
      nodes.forEach(function (n) { byId[n.id] = n; });
      traces = [
        { a: byId.cpu, b: byId.ram, c: C.violet },
        { a: byId.cpu, b: byId.gpu, c: C.cTeal },
        { a: byId.cpu, b: byId.chip, c: C.sky },
        { a: byId.cpu, b: byId.ssd, c: C.amber },
        { a: byId.ssd, b: byId.net, c: C.sky }
      ];
    }

    function drawNode(n, glow) {
      ctx.save();
      ctx.translate(n.x, n.y);
      ctx.strokeStyle = glow ? 'rgba(45,212,191,0.75)' : C.lineStrong;
      ctx.fillStyle = 'rgba(21, 31, 54, 0.9)';
      ctx.lineWidth = 1.4;
      roundRect(ctx, -n.w / 2, -n.h / 2, n.w, n.h, 8);
      ctx.fill();
      ctx.stroke();
      if (n.label) {
        ctx.fillStyle = 'rgba(148, 163, 184, 0.8)';
        ctx.font = '600 11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(n.label, 0, 0);
      }
      ctx.restore();
    }

    function drawStatic() {
      var w = cv.state.w, h = cv.state.h;
      if (w < 60 || h < 60) { return; }
      ctx.clearRect(0, 0, w, h);
      /* faint pcb grid */
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = 'rgba(30, 41, 59, 0.7)';
      ctx.lineWidth = 1;
      var step = 46;
      for (var gx = step / 2; gx < w; gx += step) {
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke();
      }
      for (var gy = step / 2; gy < h; gy += step) {
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
      }
      ctx.restore();
      traces.forEach(function (t) {
        ctx.strokeStyle = 'rgba(51, 65, 85, 0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(t.a.x, t.a.y);
        ctx.lineTo(t.b.x, t.b.y);
        ctx.stroke();
      });
      nodes.forEach(function (n) { drawNode(n, false); });
    }

    function spawn() {
      var t = traces[Math.floor(rng() * traces.length)];
      var toB = rng() > 0.4;
      packets.push({ tr: t, p: 0, dir: toB ? 1 : -1, speed: 0.25 + rng() * 0.5 });
    }

    var loop = makeLoop(function (t, dt) {
      drawStatic();
      if (packets.length < 14 && rng() < 0.15) { spawn(); }
      var glowing = {};
      packets = packets.filter(function (pk) {
        pk.p += (dt / 1000) * pk.speed;
        if (pk.p >= 1) {
          glowing[(pk.dir === 1 ? pk.tr.b : pk.tr.a).id] = true;
          return false;
        }
        var f = pk.dir === 1 ? pk.p : 1 - pk.p;
        var x = pk.tr.a.x + (pk.tr.b.x - pk.tr.a.x) * f;
        var y = pk.tr.a.y + (pk.tr.b.y - pk.tr.a.y) * f;
        ctx.save();
        ctx.shadowColor = pk.tr.c;
        ctx.shadowBlur = 10;
        ctx.fillStyle = pk.tr.c;
        ctx.beginPath();
        ctx.arc(x, y, 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return true;
      });
      nodes.forEach(function (n) { if (glowing[n.id]) { drawNode(n, true); } });
    });

    layout();
    drawStatic();
    if (!reduced()) {
      onScreen(canvas, function () { loop.start(); }, function () { loop.stop(); });
    }
  }

  /* ==========================================================================
     01 — hierarchy flow: open a file / save your work
     ========================================================================== */

  function initFlow() {
    var chain = $('#mx-flow-chain');
    var status = $('#mx-flow-status');
    var btnOpen = $('#mx-flow-open');
    var btnSave = $('#mx-flow-save');
    if (!chain || !btnOpen || !btnSave) { return; }
    var nodes = {};
    $$('.mx-flow-node', chain).forEach(function (el) { nodes[el.getAttribute('data-node')] = el; });

    var OPEN = [
      ['ssd', 'The file wakes up on the SSD — it has been sitting there, powered or not.'],
      ['ram', 'The OS copies it into RAM so it can be worked on at speed.'],
      ['cache', 'As the CPU touches it, hot pieces are copied again into cache.'],
      ['reg', 'The exact bytes being edited land in registers…'],
      ['cpu', '…where the CPU computes on them — the only place work actually happens.'],
      ['program', 'To your program, it just looks like “the file opened.”']
    ];
    var SAVE = [
      ['cpu', 'You hit save. The freshest values are in the CPU…'],
      ['reg', '…in registers, which write back to cache…'],
      ['cache', '…cache flushes the changed lines to RAM…'],
      ['ram', '…and the OS writes the RAM pages out to the SSD.'],
      ['ssd', 'Now it survives power-off. This is the durability line.'],
      ['cloud', 'Later, a sync service copies it to the cloud — the slowest, safest layer.']
    ];

    var timer = null;

    function clear() {
      if (timer) { clearInterval(timer); timer = null; }
      Object.keys(nodes).forEach(function (k) { nodes[k].classList.remove('is-live'); });
      btnOpen.setAttribute('aria-pressed', 'false');
      btnSave.setAttribute('aria-pressed', 'false');
    }

    function run(script, btn) {
      clear();
      btn.setAttribute('aria-pressed', 'true');
      if (reduced()) {
        script.forEach(function (s) { nodes[s[0]].classList.add('is-live'); });
        status.textContent = script[script.length - 1][1];
        return;
      }
      var i = 0;
      function step() {
        if (i > 0) { nodes[script[i - 1][0]].classList.remove('is-live'); }
        if (i >= script.length) {
          clearInterval(timer);
          timer = null;
          btn.setAttribute('aria-pressed', 'false');
          return;
        }
        nodes[script[i][0]].classList.add('is-live');
        status.textContent = script[i][1];
        i++;
      }
      step();
      timer = setInterval(step, 1500);
    }

    btnOpen.addEventListener('click', function () { run(OPEN, btnOpen); });
    btnSave.addEventListener('click', function () { run(SAVE, btnSave); });
  }

  /* ==========================================================================
     02 — hierarchy pyramid + latency chart
     ========================================================================== */

  var LEVELS = [
    { name: 'Registers', cap: 'a few hundred bytes', lat: 0.3, latText: '~0.3 ns — one CPU cycle', cost: 'n/a — part of the core itself', use: 'the handful of numbers being computed this instant', c: C.teal },
    { name: 'L1 cache', cap: '32–64 KB per core', lat: 1.2, latText: '~1 ns — 4–5 cycles', cost: 'n/a — on-die SRAM', use: 'the innermost loop: the exact data being crunched', c: C.cTeal },
    { name: 'L2 cache', cap: '0.5–2 MB per core', lat: 4, latText: '~4 ns — ~14 cycles', cost: 'n/a — on-die SRAM', use: 'the current function’s working set', c: C.cTeal },
    { name: 'L3 cache', cap: '8–96 MB, shared by all cores', lat: 14, latText: '~14 ns — ~45 cycles', cost: 'n/a — on-die SRAM', use: 'data shared between cores; overflow from L2', c: C.cTeal },
    { name: 'RAM (DDR5 DRAM)', cap: '8–64 GB typical', lat: 80, latText: '~80 ns — ~250 cycles', cost: '~$2–4 per GB', use: 'every running program, open file, and OS structure', c: C.violet },
    { name: 'SSD (NVMe flash)', cap: '0.5–8 TB', lat: 6e4, latText: '~60 µs random — ~200,000 cycles', cost: '~$0.06–0.10 per GB', use: 'installed apps, documents, the OS itself', c: C.amber },
    { name: 'Hard drive', cap: '1–20 TB', lat: 8e6, latText: '~8 ms random — ~25 million cycles', cost: '~$0.015–0.025 per GB', use: 'bulk archives, backups, cold media libraries', c: C.amber },
    { name: 'Cloud storage', cap: 'effectively unlimited', lat: 5e7, latText: '50+ ms — network round trip, then someone else’s disks', cost: 'pennies per GB-month', use: 'backup, sync, and sharing — the safety net', c: C.sky }
  ];

  function humanScale(latNs) {
    /* anchored: one 0.3 ns cycle = one second */
    return fmtSecondsHuman(latNs / 0.3);
  }

  function initHierarchy() {
    var wrap = $('#mx-hier');
    if (!wrap) { return; }
    var els = {
      name: $('#mx-hd-name'), cap: $('#mx-hd-cap'), lat: $('#mx-hd-lat'),
      cost: $('#mx-hd-cost'), use: $('#mx-hd-use'), human: $('#mx-hd-human')
    };
    var buttons = $$('.mx-level', wrap);
    function select(i) {
      buttons.forEach(function (b, j) { b.setAttribute('aria-pressed', j === i ? 'true' : 'false'); });
      var L = LEVELS[i];
      els.name.textContent = L.name;
      els.cap.textContent = L.cap;
      els.lat.textContent = L.latText;
      els.cost.textContent = L.cost;
      els.use.textContent = L.use;
      els.human.textContent = 'if one cycle were one second: ' +
        (i === 0 ? 'instant recall' : humanScale(L.lat) + ' per access');
    }
    buttons.forEach(function (b, i) {
      b.addEventListener('click', function () { select(i); });
    });
    select(0);
  }

  function initLatChart() {
    var chart = $('#mx-latchart');
    var btnNs = $('#mx-lat-ns');
    var btnHuman = $('#mx-lat-human');
    if (!chart || !btnNs || !btnHuman) { return; }

    var minLog = Math.log10(0.3);
    var maxLog = Math.log10(5e7);
    var rows = LEVELS.map(function (L) {
      var row = document.createElement('div');
      row.className = 'mx-lat-row';
      var name = document.createElement('span');
      name.className = 'mx-lat-name';
      name.textContent = L.name.replace(/ \(.*\)/, '');
      var bar = document.createElement('span');
      bar.className = 'mx-lat-bar';
      var fill = document.createElement('i');
      var w = 4 + 96 * (Math.log10(L.lat) - minLog) / (maxLog - minLog);
      fill.style.setProperty('--w', w.toFixed(1));
      fill.style.setProperty('--c', L.c);
      bar.appendChild(fill);
      var val = document.createElement('span');
      val.className = 'mx-lat-val';
      row.appendChild(name);
      row.appendChild(bar);
      row.appendChild(val);
      chart.appendChild(row);
      return { val: val, L: L };
    });

    function render(human) {
      btnNs.setAttribute('aria-pressed', human ? 'false' : 'true');
      btnHuman.setAttribute('aria-pressed', human ? 'true' : 'false');
      rows.forEach(function (r) {
        r.val.textContent = human
          ? (r.L.lat === 0.3 ? '1 second' : humanScale(r.L.lat))
          : fmtNs(r.L.lat);
      });
    }
    btnNs.addEventListener('click', function () { render(false); });
    btnHuman.addEventListener('click', function () { render(true); });
    render(false);
  }

  /* ==========================================================================
     03 — registers: a tiny machine summing a list
     ========================================================================== */

  function initRegisters() {
    var code = $('#mx-reg-code');
    var status = $('#mx-reg-status');
    if (!code || !status) { return; }
    var lines = $$('li', code);
    var regs = {
      pc: $('#mx-reg-pc'), sp: $('#mx-reg-sp'), flags: $('#mx-reg-flags'),
      r0: $('#mx-reg-r0'), r1: $('#mx-reg-r1'), r2: $('#mx-reg-r2')
    };
    var boxes = {};
    $$('.mx-reg').forEach(function (el) { boxes[el.getAttribute('data-reg')] = el; });
    var btnStep = $('#mx-reg-step');
    var btnPlay = $('#mx-reg-play');
    var btnReset = $('#mx-reg-reset');

    var LIST = [4, 7, 2];
    var st;
    var timer = null;

    function flash(name, kind) {
      var box = boxes[name];
      if (!box) { return; }
      box.classList.remove('is-read', 'is-write');
      /* force restart of the highlight */
      void box.offsetWidth;
      box.classList.add(kind);
      setTimeout(function () { box.classList.remove(kind); }, 700);
    }

    function render() {
      regs.pc.textContent = String(st.pc);
      regs.flags.textContent = st.flags === null ? '–' : (st.flags ? 'Z' : 'NZ');
      regs.r0.textContent = String(st.r0);
      regs.r1.textContent = String(st.r1);
      regs.r2.textContent = String(st.r2);
      lines.forEach(function (li, i) {
        li.classList.toggle('is-current', !st.done && i === st.pc);
      });
    }

    function reset() {
      if (timer) { clearInterval(timer); timer = null; btnPlay.textContent = 'Play'; }
      st = { pc: 0, r0: 0, r1: 0, r2: 0, flags: null, i: 0, done: false };
      render();
      status.textContent = 'Press Step or Play to run the program.';
    }

    function step() {
      if (st.done) { return; }
      var pc = st.pc;
      switch (pc) {
        case 0:
          st.r0 = 0; flash('r0', 'is-write');
          status.textContent = 'R0 ← 0. The running total starts empty.';
          st.pc = 1; break;
        case 1:
          st.r2 = 3; flash('r2', 'is-write');
          status.textContent = 'R2 ← 3. Three list items remain.';
          st.pc = 2; break;
        case 2:
          st.r1 = LIST[st.i]; st.i++;
          flash('r1', 'is-write');
          status.textContent = 'R1 ← ' + st.r1 + ', loaded from memory — the only slow step in the loop.';
          st.pc = 3; break;
        case 3:
          flash('r0', 'is-read'); flash('r1', 'is-read');
          st.r0 = st.r0 + st.r1;
          flash('r0', 'is-write');
          status.textContent = 'R0 ← R0 + R1 = ' + st.r0 + '. Pure register arithmetic — one cycle.';
          st.pc = 4; break;
        case 4:
          flash('r2', 'is-read');
          st.r2 = st.r2 - 1;
          st.flags = (st.r2 === 0);
          flash('r2', 'is-write'); flash('flags', 'is-write');
          status.textContent = 'R2 ← ' + st.r2 + '. FLAGS records ' + (st.flags ? 'zero — the loop is finished.' : 'not-zero — more items remain.');
          st.pc = 5; break;
        case 5:
          flash('flags', 'is-read'); flash('pc', 'is-write');
          if (!st.flags) {
            st.pc = 2;
            status.textContent = 'FLAGS says not-zero → PC jumps back to line 2. This is what a loop is.';
          } else {
            st.pc = 6;
            status.textContent = 'FLAGS says zero → no jump. PC falls through to line 6.';
          }
          break;
        case 6:
          flash('r0', 'is-read');
          status.textContent = 'total ← R0. The answer, ' + st.r0 + ', is written back to memory. Done.';
          st.done = true;
          if (timer) { clearInterval(timer); timer = null; btnPlay.textContent = 'Play'; }
          break;
      }
      flash('pc', 'is-write');
      render();
    }

    btnStep.addEventListener('click', function () {
      if (timer) { clearInterval(timer); timer = null; btnPlay.textContent = 'Play'; }
      if (st.done) { reset(); }
      step();
    });
    btnPlay.addEventListener('click', function () {
      if (timer) {
        clearInterval(timer); timer = null; btnPlay.textContent = 'Play';
        return;
      }
      if (st.done) { reset(); }
      btnPlay.textContent = 'Pause';
      if (reduced()) {
        while (!st.done) { step(); }
        btnPlay.textContent = 'Play';
        return;
      }
      timer = setInterval(step, 1100);
    });
    btnReset.addEventListener('click', reset);
    reset();
  }

  /* ==========================================================================
     04 — cache simulator
     ========================================================================== */

  function initCache() {
    var canvas = $('#mx-cache-canvas');
    if (!canvas) { return; }
    var cv = setupCanvas(canvas, function () { draw(); });
    var ctx = cv.ctx;
    var els = {
      l1: $('#mx-cs-l1'), l2: $('#mx-cs-l2'), l3: $('#mx-cs-l3'), ram: $('#mx-cs-ram'),
      rate: $('#mx-cs-rate'), speedup: $('#mx-cs-speedup'),
      verdict: $('#mx-cache-verdict'), run: $('#mx-cache-run')
    };
    var tabs = $$('.mx-mode-tab[data-workload]');
    var workload = 'seq';

    var MEM_LINES = 128;      /* memory cache-lines shown in the grid */
    var WORDS = 8;            /* words per line — spatial locality */
    var CAP = { l1: 8, l2: 16, l3: 32 };
    var COST = { l1: 4, l2: 12, l3: 40, ram: 250 };

    var sim = null;
    var loop = makeLoop(tick);

    function makeAccesses(kind) {
      var rng = makeRng(kind === 'seq' ? 11 : kind === 'loop' ? 23 : 37);
      var list = [];
      var i, j;
      if (kind === 'seq') {
        for (i = 0; i < MEM_LINES; i++) {
          for (j = 0; j < WORDS; j++) { list.push(i); }
        }
      } else if (kind === 'loop') {
        var set = [40, 41, 42, 43, 44, 45];
        for (i = 0; i < 900; i++) { list.push(set[i % set.length]); }
      } else {
        for (i = 0; i < 500; i++) { list.push(Math.floor(rng() * MEM_LINES)); }
      }
      return list;
    }

    function freshSim() {
      return {
        acc: makeAccesses(workload),
        pos: 0,
        caches: { l1: [], l2: [], l3: [] },
        stats: { l1: 0, l2: 0, l3: 0, ram: 0, cycles: 0 },
        last: null,       /* { line, level } */
        done: false
      };
    }

    /* Fully-associative LRU per level; hits promote to L1 like real inclusive
       hierarchies roughly behave. Returns the serving level. */
    function access(s, line) {
      var lvls = ['l1', 'l2', 'l3'];
      var hit = null;
      for (var k = 0; k < lvls.length; k++) {
        var arr = s.caches[lvls[k]];
        var idx = arr.indexOf(line);
        if (idx !== -1) {
          hit = lvls[k];
          arr.splice(idx, 1);
          break;
        }
      }
      var served = hit || 'ram';
      s.stats[served]++;
      s.stats.cycles += COST[served];
      /* promote into L1, cascading evictions downward */
      var move = line;
      for (var m = 0; m < lvls.length && move !== undefined; m++) {
        var cache = s.caches[lvls[m]];
        cache.unshift(move);
        move = cache.length > CAP[lvls[m]] ? cache.pop() : undefined;
      }
      return served;
    }

    function gridPos(i, w) {
      var cols = 32;
      var cw = (w - 40) / cols;
      return {
        x: 20 + (i % cols) * cw + cw / 2,
        y: 34 + Math.floor(i / cols) * 18,
        s: Math.min(cw - 3, 14)
      };
    }

    function draw() {
      var w = cv.state.w, h = cv.state.h;
      if (w < 60 || h < 60) { return; }
      ctx.clearRect(0, 0, w, h);
      var s = sim || freshSim();

      ctx.font = '600 11px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = C.faint;
      ctx.fillText('RAM — ' + MEM_LINES + ' cache lines', 20, 18);

      var inCache = {};
      ['l1', 'l2', 'l3'].forEach(function (k) {
        s.caches[k].forEach(function (line) { if (!(line in inCache)) { inCache[line] = k; } });
      });

      for (var i = 0; i < MEM_LINES; i++) {
        var p = gridPos(i, w);
        var lvl = inCache[i];
        ctx.fillStyle = lvl === 'l1' ? C.teal : lvl === 'l2' ? C.cTeal : lvl === 'l3' ? '#0f766e' : C.free;
        roundRect(ctx, p.x - p.s / 2, p.y - p.s / 2, p.s, p.s, 3);
        ctx.fill();
      }

      /* cache level lanes */
      var laneY = 34 + 4 * 18 + 26;
      var lanes = [
        { k: 'l1', label: 'L1 · ' + CAP.l1 + ' lines · 4 cycles', c: C.teal },
        { k: 'l2', label: 'L2 · ' + CAP.l2 + ' lines · 12 cycles', c: C.cTeal },
        { k: 'l3', label: 'L3 · ' + CAP.l3 + ' lines · 40 cycles', c: '#0f766e' },
        { k: 'ram', label: 'RAM · everything · 250 cycles', c: C.violet }
      ];
      lanes.forEach(function (lane, li) {
        var y = laneY + li * ((h - laneY - 14) / 4);
        ctx.fillStyle = C.faint;
        ctx.fillText(lane.label, 20, y + 4);
        var slotX = 190;
        var slotW = (w - slotX - 20);
        ctx.strokeStyle = C.line;
        ctx.lineWidth = 1;
        roundRect(ctx, slotX, y - 8, slotW, 18, 5);
        ctx.stroke();
        if (lane.k !== 'ram') {
          var arr = s.caches[lane.k];
          var cap = CAP[lane.k];
          var cw2 = Math.min(18, (slotW - 8) / cap);
          arr.forEach(function (line, j) {
            ctx.fillStyle = lane.c;
            roundRect(ctx, slotX + 4 + j * cw2, y - 4, cw2 - 3, 10, 2);
            ctx.fill();
          });
        }
        if (s.last && s.last.level === lane.k) {
          ctx.save();
          ctx.strokeStyle = lane.k === 'ram' ? C.rose : lane.c;
          ctx.lineWidth = 2;
          roundRect(ctx, slotX - 3, y - 11, slotW + 6, 24, 7);
          ctx.stroke();
          ctx.restore();
        }
      });

      /* current access marker */
      if (s.last) {
        var lp = gridPos(s.last.line, w);
        ctx.save();
        ctx.strokeStyle = s.last.level === 'ram' ? C.rose : C.strong;
        ctx.lineWidth = 2;
        roundRect(ctx, lp.x - lp.s / 2 - 2.5, lp.y - lp.s / 2 - 2.5, lp.s + 5, lp.s + 5, 4);
        ctx.stroke();
        ctx.restore();
      }
    }

    function setStats(s) {
      var total = s.stats.l1 + s.stats.l2 + s.stats.l3 + s.stats.ram;
      els.l1.textContent = fmtInt(s.stats.l1);
      els.l2.textContent = fmtInt(s.stats.l2);
      els.l3.textContent = fmtInt(s.stats.l3);
      els.ram.textContent = fmtInt(s.stats.ram);
      if (total) {
        var hits = total - s.stats.ram;
        els.rate.textContent = (100 * hits / total).toFixed(1) + '%';
        els.speedup.textContent = (total * COST.ram / s.stats.cycles).toFixed(1) + '×';
      } else {
        els.rate.textContent = '–';
        els.speedup.textContent = '–';
      }
    }

    function verdictFor(s) {
      var total = s.stats.l1 + s.stats.l2 + s.stats.l3 + s.stats.ram;
      var rate = total ? (total - s.stats.ram) / total : 0;
      if (workload === 'loop') {
        return 'The whole working set fits in L1 and never leaves — ' +
          (rate * 100).toFixed(1) + '% hits. Temporal locality at its best: this code runs at nearly full CPU speed.';
      }
      if (workload === 'seq') {
        return 'Every new line misses once, then the next ' + (WORDS - 1) +
          ' accesses hit — spatial locality turns one RAM trip into ' + WORDS + ' useful reads.';
      }
      return 'Random jumps defeat both kinds of locality: most accesses fall through to RAM and the CPU spends its time waiting. Same hardware, ~10× slower than the loop.';
    }

    function finish(s) {
      s.done = true;
      s.last = null;
      loop.stop();
      draw();
      setStats(s);
      els.verdict.textContent = verdictFor(s);
    }

    function tick() {
      var s = sim;
      if (!s || s.done) { loop.stop(); return; }
      var perFrame = Math.max(2, Math.round(s.acc.length / 240));
      for (var i = 0; i < perFrame && s.pos < s.acc.length; i++) {
        var line = s.acc[s.pos++];
        var served = access(s, line);
        s.last = { line: line, level: served };
      }
      draw();
      setStats(s);
      if (s.pos >= s.acc.length) { finish(s); }
    }

    function run() {
      loop.stop();
      sim = freshSim();
      els.verdict.textContent = '';
      if (reduced()) {
        while (sim.pos < sim.acc.length) {
          var line = sim.acc[sim.pos++];
          sim.last = { line: line, level: access(sim, line) };
        }
        finish(sim);
        return;
      }
      loop.start();
    }

    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (t) { t.setAttribute('aria-pressed', t === tab ? 'true' : 'false'); });
        workload = tab.getAttribute('data-workload');
        run();
      });
    });
    els.run.addEventListener('click', run);

    setStats(freshSim());
    draw();
    var seen = false;
    onScreen(canvas, function () {
      if (!seen) { seen = true; run(); }
    }, function () { loop.stop(); });
  }

  /* ==========================================================================
     05 — RAM module: apps occupy memory
     ========================================================================== */

  function initRam() {
    var grid = $('#mx-ram-grid');
    if (!grid) { return; }
    var CELLS = 64;              /* 16 GB, 256 MB per cell */
    var GB_PER_CELL = 0.25;
    var APPS = {
      os: { cells: 8, color: '#475569', name: 'the operating system' },
      browser: { cells: 16, color: C.cTeal, name: 'the browser' },
      game: { cells: 32, color: C.violet, name: 'the game' },
      editor: { cells: 20, color: C.amber, name: 'the photo editor' },
      music: { cells: 4, color: C.sky, name: 'the music player' }
    };
    var cells = [];
    for (var i = 0; i < CELLS; i++) {
      var d = document.createElement('div');
      d.className = 'mx-ram-cell';
      grid.appendChild(d);
      cells.push({ el: d, owner: null });
    }
    var meter = $('#mx-ram-meter-fill');
    var usage = $('#mx-ram-usage');
    var note = $('#mx-ram-note');
    var power = $('#mx-ram-power');
    var buttons = {};
    $$('.mx-app').forEach(function (b) { buttons[b.getAttribute('data-app')] = b; });
    var rng = makeRng(99);

    function freeCells() {
      return cells.filter(function (c) { return c.owner === null; });
    }

    function used() {
      return cells.filter(function (c) { return c.owner !== null; }).length;
    }

    function updateMeter() {
      var gb = used() * GB_PER_CELL;
      var pct = 100 * used() / CELLS;
      meter.style.width = pct + '%';
      meter.classList.toggle('is-full', pct > 85);
      usage.textContent = gb.toFixed(gb % 1 ? 2 : 0).replace(/\.00$/, '') + ' GB of 16 GB in use';
    }

    function allocate(app, animate) {
      var spec = APPS[app];
      var free = freeCells();
      if (free.length < spec.cells) { return false; }
      /* scattered allocation: shuffle the free list */
      for (var i = free.length - 1; i > 0; i--) {
        var j = Math.floor(rng() * (i + 1));
        var tmp = free[i]; free[i] = free[j]; free[j] = tmp;
      }
      free.slice(0, spec.cells).forEach(function (c, k) {
        c.owner = app;
        if (animate && !reduced()) {
          setTimeout(function () { c.el.style.backgroundColor = spec.color; }, k * 22);
        } else {
          c.el.style.backgroundColor = spec.color;
        }
      });
      return true;
    }

    function release(app) {
      cells.forEach(function (c) {
        if (c.owner === app) {
          c.owner = null;
          c.el.style.backgroundColor = '';
        }
      });
    }

    function toggle(app) {
      var btn = buttons[app];
      var open = btn.getAttribute('aria-pressed') === 'true';
      if (open) {
        release(app);
        btn.setAttribute('aria-pressed', 'false');
        note.textContent = 'Closed ' + APPS[app].name + ' — its pages are freed instantly. Nothing is written back unless it had unsaved data.';
      } else {
        if (!allocate(app, true)) {
          note.textContent = 'Not enough free RAM for ' + APPS[app].name + ' (' +
            (APPS[app].cells * GB_PER_CELL) + ' GB needed). A real OS would start paging — that story is next, in chapter 06.';
          return;
        }
        btn.setAttribute('aria-pressed', 'true');
        note.textContent = 'Opened ' + APPS[app].name + ' — notice the pages scatter wherever free space exists.';
      }
      updateMeter();
    }

    Object.keys(buttons).forEach(function (app) {
      if (app === 'os') { return; }
      buttons[app].addEventListener('click', function () { toggle(app); });
    });

    power.addEventListener('click', function () {
      note.textContent = 'Power lost — every capacitor drains within moments. RAM is blank.';
      cells.forEach(function (c) {
        if (c.owner !== null && !reduced()) { c.el.classList.add('is-dying'); }
        c.owner = null;
      });
      Object.keys(buttons).forEach(function (app) {
        if (app !== 'os') { buttons[app].setAttribute('aria-pressed', 'false'); }
      });
      setTimeout(function () {
        cells.forEach(function (c) {
          c.el.classList.remove('is-dying');
          c.el.style.backgroundColor = '';
        });
        allocate('os', true);
        updateMeter();
        note.textContent = 'Power restored. RAM came back empty — the OS reloaded itself from the SSD, and everything else must reopen from disk too.';
      }, reduced() ? 0 : 950);
    });

    allocate('os', false);
    updateMeter();
  }

  /* ==========================================================================
     06 — virtual memory & paging walkthrough
     ========================================================================== */

  function initVirtualMemory() {
    var ramGrid = $('#mx-vm-ram');
    var swapGrid = $('#mx-vm-swap');
    if (!ramGrid || !swapGrid) { return; }
    var FRAMES = 32, SLOTS = 16;
    var ram = [], swap = [];
    var i, d;
    for (i = 0; i < FRAMES; i++) {
      d = document.createElement('div');
      d.className = 'mx-vm-cell';
      ramGrid.appendChild(d);
      ram.push(d);
    }
    for (i = 0; i < SLOTS; i++) {
      d = document.createElement('div');
      d.className = 'mx-vm-cell';
      swapGrid.appendChild(d);
      swap.push(d);
    }
    var steps = $$('#mx-vm-steps li');
    var status = $('#mx-vm-status');
    var btnNext = $('#mx-vm-next');
    var btnReset = $('#mx-vm-reset');

    var COLOR = { os: '#475569', game: C.violet, browser: C.cTeal, editor: C.amber, call: C.sky };

    function paint(list, arr) {
      /* arr: array of owner keys or null, one per cell */
      arr.forEach(function (owner, k) {
        var el = list[k];
        el.classList.remove('is-fault');
        el.classList.toggle('is-used', !!owner);
        el.style.backgroundColor = owner ? COLOR[owner] : '';
      });
    }

    function fill(owner, count) {
      var out = [];
      for (var k = 0; k < count; k++) { out.push(owner); }
      return out;
    }

    function pad(arr, len) {
      while (arr.length < len) { arr.push(null); }
      return arr;
    }

    /* Precomputed cell states per step — clarity over cleverness. */
    var GAME = 12, BROWSER = 10, EDITOR = 6, OS = 4, CALL = 10;
    var S = [];
    /* step 0: initial — empty */
    S.push({
      ram: pad([], FRAMES), swap: pad([], SLOTS), faults: [],
      text: 'Press “Next step” to walk through a day in the life of your RAM.'
    });
    /* step 1: three apps + OS fill RAM */
    var base = fill('os', OS).concat(fill('game', GAME), fill('browser', BROWSER), fill('editor', EDITOR));
    S.push({
      ram: pad(base.slice(), FRAMES), swap: pad([], SLOTS), faults: [],
      text: '30 of 32 page frames are in use: the OS, a paused game, your browser, and an editor. Everything feels fine.'
    });
    /* step 2: call wants memory */
    S.push({
      ram: pad(base.slice(), FRAMES), swap: pad([], SLOTS), faults: [],
      text: 'A video call needs 10 frames — but only 2 are free. Twenty years ago this meant “out of memory.” Today, the OS has a trick.'
    });
    /* step 3: evict game pages to swap */
    var afterEvict = fill('os', OS).concat(fill('game', 4), fill('browser', BROWSER), fill('editor', EDITOR));
    S.push({
      ram: pad(afterEvict.slice(), FRAMES), swap: pad(fill('game', 8), SLOTS), faults: [],
      text: 'The game hasn’t been touched in an hour, so the OS writes 8 of its least-recently-used pages to the swap file and reclaims the frames. The game doesn’t know.'
    });
    /* step 4: call allocated */
    var withCall = afterEvict.concat(fill('call', CALL));
    S.push({
      ram: pad(withCall.slice(), FRAMES), swap: pad(fill('game', 8), SLOTS), faults: [],
      text: 'The call gets real frames and runs at full speed. Total RAM promised to programs now exceeds physical RAM — that is virtual memory doing its job.'
    });
    /* step 5: switch to game — faults */
    var faultIdx = [];
    for (i = OS; i < OS + 4; i++) { faultIdx.push(i); }
    S.push({
      ram: pad(withCall.slice(), FRAMES), swap: pad(fill('game', 8), SLOTS), faults: faultIdx,
      text: 'You click the game. It touches pages that are no longer mapped — the CPU raises page faults and the OS must fetch each one from the SSD: ~1000× slower than RAM. This is the stutter you feel.'
    });
    /* step 6: game back, browser out */
    var final = fill('os', OS).concat(fill('game', GAME), fill('browser', 4), fill('editor', EDITOR), fill('call', 6));
    S.push({
      ram: pad(final.slice(), FRAMES), swap: pad(fill('browser', 6).concat(fill('call', 4)), SLOTS), faults: [],
      text: 'The game’s pages stream back in; now background browser tabs and part of the idle call get paged out instead. Memory pressure never went away — it just moved to whoever is idle.'
    });

    var pos = 0;

    function show(k) {
      pos = k;
      var s = S[k];
      paint(ram, s.ram);
      paint(swap, s.swap);
      s.faults.forEach(function (idx) { ram[idx].classList.add('is-fault'); });
      steps.forEach(function (li, j) {
        li.classList.toggle('is-current', j === k - 1);
        li.classList.toggle('is-done', j < k - 1);
      });
      status.textContent = s.text;
      btnNext.disabled = (k === S.length - 1);
      btnNext.textContent = k === S.length - 1 ? 'Done' : 'Next step';
    }

    btnNext.addEventListener('click', function () {
      if (pos < S.length - 1) { show(pos + 1); }
    });
    btnReset.addEventListener('click', function () { show(0); });
    show(0);
  }

  /* ==========================================================================
     07 — SSD vs HDD race
     ========================================================================== */

  function initDrives() {
    var canvas = $('#mx-drive-canvas');
    if (!canvas) { return; }
    var cv = setupCanvas(canvas, function () { draw(); });
    var ctx = cv.ctx;
    var els = {
      hdd: $('#mx-dr-hdd'), ssd: $('#mx-dr-ssd'), adv: $('#mx-dr-adv'),
      verdict: $('#mx-drive-verdict'), run: $('#mx-drive-run')
    };
    var tabs = $$('.mx-mode-tab[data-race]');
    var mode = 'big';

    /* simulated total times in ms */
    var TIMES = {
      big: { hdd: 5100, ssd: 300, files: 1 },
      small: { hdd: 2400, ssd: 15, files: 200 }
    };
    var VERDICT = {
      big: 'Streaming one large file is the hard drive’s best case — one seek, then pure sequential transfer at ~200 MB/s. The SSD still wins ~17× on raw bandwidth.',
      small: 'Scattered small reads are the mechanical worst case: every file costs a seek plus half a platter rotation, ~12 ms of pure waiting each. The SSD answers each in ~60 µs — a ~160× rout. This is why an SSD transforms boot and app-launch times.'
    };

    var st = null;   /* { t, total:{hdd,ssd}, prog:{hdd,ssd}, arm, armTarget, spin } */
    var rng = makeRng(5);
    var loop = makeLoop(tick);

    function fresh() {
      return {
        t: 0,
        spec: TIMES[mode],
        prog: { hdd: 0, ssd: 0 },
        spin: 0,
        arm: 0.5,
        armTarget: 0.5,
        armTimer: 0,
        litBlocks: 0
      };
    }

    function draw() {
      var w = cv.state.w, h = cv.state.h;
      if (w < 60 || h < 60) { return; }
      ctx.clearRect(0, 0, w, h);
      var s = st || fresh();
      var mid = w / 2;

      ctx.strokeStyle = C.line;
      ctx.beginPath();
      ctx.moveTo(mid, 12);
      ctx.lineTo(mid, h - 12);
      ctx.stroke();

      ctx.font = '700 12px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = C.muted;
      ctx.fillText('HARD DRIVE', mid / 2, 24);
      ctx.fillText('SSD', mid + mid / 2, 24);

      /* --- HDD: platter + arm --- */
      var pcx = mid / 2, pcy = h / 2 + 10;
      var pr = Math.min(mid / 2 - 30, h / 2 - 46);
      ctx.save();
      ctx.translate(pcx, pcy);
      ctx.fillStyle = '#12203a';
      ctx.strokeStyle = C.lineStrong;
      ctx.beginPath();
      ctx.arc(0, 0, pr, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      /* rotation marks */
      ctx.rotate(s.spin);
      ctx.strokeStyle = 'rgba(51,65,85,0.7)';
      for (var k = 0; k < 3; k++) {
        ctx.beginPath();
        ctx.arc(0, 0, pr * (0.45 + k * 0.2), 0.3, 1.4);
        ctx.stroke();
      }
      ctx.restore();
      /* hub */
      ctx.fillStyle = C.lineStrong;
      ctx.beginPath();
      ctx.arc(pcx, pcy, 7, 0, Math.PI * 2);
      ctx.fill();
      /* arm: pivot bottom-left of platter */
      var pivX = pcx - pr - 8, pivY = pcy + pr * 0.75;
      var armAngle = Math.atan2(pcy - pivY, pcx - pivX) + (s.arm - 0.5) * 0.55;
      var armLen = pr * 1.35;
      ctx.strokeStyle = C.amber;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(pivX, pivY);
      ctx.lineTo(pivX + Math.cos(armAngle) * armLen, pivY + Math.sin(armAngle) * armLen);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.fillStyle = C.amber;
      ctx.beginPath();
      ctx.arc(pivX, pivY, 6, 0, Math.PI * 2);
      ctx.fill();
      /* hdd progress bar */
      drawProgress(20, h - 26, mid - 40, s.prog.hdd, C.amber);

      /* --- SSD: flash block grid --- */
      var gx0 = mid + 24, gy0 = 44;
      var cols = 10, rows = 6;
      var gw = (mid - 48) / cols, gh = (h - 90) / rows;
      var totalBlocks = cols * rows;
      var lit = Math.round(s.prog.ssd * totalBlocks);
      for (var b = 0; b < totalBlocks; b++) {
        var bx = gx0 + (b % cols) * gw;
        var by = gy0 + Math.floor(b / cols) * gh;
        ctx.fillStyle = b < lit ? C.cTeal : '#16233f';
        roundRect(ctx, bx, by, gw - 4, gh - 4, 3);
        ctx.fill();
      }
      drawProgress(mid + 20, h - 26, mid - 40, s.prog.ssd, C.cTeal);
    }

    function drawProgress(x, y, w, p, color) {
      ctx.fillStyle = C.free;
      roundRect(ctx, x, y, w, 8, 4);
      ctx.fill();
      if (p > 0) {
        ctx.fillStyle = color;
        roundRect(ctx, x, y, Math.max(4, w * clamp(p, 0, 1)), 8, 4);
        ctx.fill();
      }
    }

    function setOuts(s) {
      els.hdd.textContent = (Math.min(s.t, s.spec.hdd) / 1000).toFixed(2) + ' s' + (s.prog.hdd >= 1 ? ' ✓' : '');
      var ssdMs = Math.min(s.t, s.spec.ssd);
      els.ssd.textContent = (s.spec.ssd < 100 ? ssdMs.toFixed(0) + ' ms' : (ssdMs / 1000).toFixed(2) + ' s') + (s.prog.ssd >= 1 ? ' ✓' : '');
      els.adv.textContent = (s.spec.hdd / s.spec.ssd).toFixed(0) + '× faster';
    }

    function tick(t, dt) {
      var s = st;
      if (!s) { loop.stop(); return; }
      /* compress simulated time: whole race plays in ~5.5s of wall time */
      var scale = s.spec.hdd / 5200;
      s.t += dt * scale;
      s.spin += dt * 0.02;
      s.prog.hdd = clamp(s.t / s.spec.hdd, 0, 1);
      s.prog.ssd = clamp(s.t / s.spec.ssd, 0, 1);
      /* arm behavior: big file = one seek then settle; small = constant seeking */
      s.armTimer -= dt;
      if (s.armTimer <= 0 && s.prog.hdd < 1) {
        s.armTarget = mode === 'small' ? rng() : 0.35 + s.prog.hdd * 0.3;
        s.armTimer = mode === 'small' ? 160 : 700;
      }
      s.arm += (s.armTarget - s.arm) * Math.min(1, dt / 120);
      draw();
      setOuts(s);
      if (s.prog.hdd >= 1) {
        loop.stop();
        els.verdict.textContent = VERDICT[mode];
      }
    }

    function run() {
      loop.stop();
      st = fresh();
      els.verdict.textContent = '';
      if (reduced()) {
        st.t = st.spec.hdd;
        st.prog.hdd = 1;
        st.prog.ssd = 1;
        draw();
        setOuts(st);
        els.verdict.textContent = VERDICT[mode];
        return;
      }
      loop.start();
    }

    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (x) { x.setAttribute('aria-pressed', x === tab ? 'true' : 'false'); });
        mode = tab.getAttribute('data-race');
        run();
      });
    });
    els.run.addEventListener('click', run);

    draw();
    var seen = false;
    onScreen(canvas, function () {
      if (!seen) { seen = true; run(); }
    }, function () { loop.stop(); });
  }

  /* ==========================================================================
     08 — flash: one NAND cell + wear leveling
     ========================================================================== */

  function initNandCell() {
    var svg = $('#mx-nand-svg');
    if (!svg) { return; }
    var group = $('#mx-nand-electrons');
    var trap = $('#mx-nand-trap');
    var status = $('#mx-nand-status');
    var btnP = $('#mx-nand-program');
    var btnE = $('#mx-nand-erase');
    var NS = 'http://www.w3.org/2000/svg';
    var electrons = [];
    var cycles = 0;

    for (var i = 0; i < 8; i++) {
      var e = document.createElementNS(NS, 'circle');
      e.setAttribute('class', 'mx-nand-electron');
      e.setAttribute('r', '4');
      e.setAttribute('cx', String(95 + i * 22));
      e.setAttribute('cy', '218');
      e.setAttribute('opacity', '0');
      group.appendChild(e);
      electrons.push(e);
    }

    function setElectrons(inTrap) {
      electrons.forEach(function (e, k) {
        e.setAttribute('opacity', inTrap ? '1' : '0');
        if (reduced()) {
          e.setAttribute('cy', inTrap ? '158' : '218');
        } else {
          /* stagger the tunneling */
          (function (el, delay, cy) {
            setTimeout(function () { el.setAttribute('cy', cy); }, delay);
          })(e, k * 60, inTrap ? '158' : '218');
        }
      });
    }

    btnP.addEventListener('click', function () {
      cycles++;
      trap.classList.add('is-charged');
      setElectrons(true);
      status.innerHTML = 'A high voltage on the control gate pulled electrons through the oxide ' +
        'into the trap. The stored charge shifts the transistor’s threshold — the cell now reads as ' +
        '<strong>0</strong>, and keeps reading 0 with no power at all. ' +
        '(Program/erase cycles so far: ' + cycles + ' — each one slightly wears the oxide.)';
    });
    btnE.addEventListener('click', function () {
      trap.classList.remove('is-charged');
      setElectrons(false);
      status.innerHTML = 'An opposite voltage pulled the electrons back out. The cell reads as ' +
        '<strong>1</strong> again. Real drives can’t erase one cell — only whole blocks of them at once, ' +
        'which is why SSD controllers shuffle data before erasing.';
    });
  }

  function initWear() {
    var grid = $('#mx-wear-grid');
    if (!grid) { return; }
    var N = 100, LIFE = 3000;
    var blocks = [];
    for (var i = 0; i < N; i++) {
      var d = document.createElement('div');
      d.className = 'mx-wear-block';
      grid.appendChild(d);
      blocks.push({ el: d, wear: 0 });
    }
    var toggle = $('#mx-wear-toggle');
    var run = $('#mx-wear-run');
    var status = $('#mx-wear-status');
    var leveling = true;
    var rng = makeRng(41);
    var running = false;

    function color(b) {
      if (b.wear >= LIFE) { b.el.classList.add('is-dead'); return; }
      var f = b.wear / LIFE;
      /* slate -> amber ramp */
      var r = Math.round(39 + f * (217 - 39));
      var g = Math.round(52 + f * (119 - 52));
      var bl = Math.round(73 + f * (6 - 73));
      b.el.style.backgroundColor = 'rgb(' + r + ',' + g + ',' + bl + ')';
    }

    function reset() {
      blocks.forEach(function (b) {
        b.wear = 0;
        b.el.classList.remove('is-dead');
        b.el.style.backgroundColor = '';
      });
    }

    function report() {
      var dead = blocks.filter(function (b) { return b.wear >= LIFE; }).length;
      if (dead) {
        status.textContent = 'Without wear leveling, the ' + dead + ' “hot” blocks that hold ' +
          'frequently rewritten data burned through their ~' + fmtInt(LIFE) + ' program/erase cycles years early. ' +
          'The drive is degraded even though 88% of it is barely used.';
      } else {
        var avg = blocks.reduce(function (a, b) { return a + b.wear; }, 0) / N;
        status.textContent = 'With wear leveling, the controller remapped hot data across all blocks: ' +
          'every block sits near ' + Math.round(100 * avg / LIFE) + '% of its life and none has failed. ' +
          'Same writes, same flash — just smarter bookkeeping.';
      }
    }

    /* 12 hot logical blocks receive 85% of writes; leveling spreads them */
    function simulate(totalWrites, onDone) {
      var stepWrites = reduced() ? totalWrites : Math.ceil(totalWrites / 90);
      var writtenTotal = 0;
      function stepFrame() {
        for (var wDone = 0; wDone < stepWrites && writtenTotal < totalWrites; wDone++, writtenTotal++) {
          var hot = rng() < 0.85;
          var target;
          if (leveling) {
            /* pick the least-worn block (approximate: random sample of 6) */
            target = blocks[Math.floor(rng() * N)];
            for (var s2 = 0; s2 < 5; s2++) {
              var cand = blocks[Math.floor(rng() * N)];
              if (cand.wear < target.wear) { target = cand; }
            }
          } else {
            target = hot ? blocks[Math.floor(rng() * 12)] : blocks[12 + Math.floor(rng() * (N - 12))];
          }
          if (target.wear < LIFE * 1.02) { target.wear++; }
        }
        blocks.forEach(color);
        if (writtenTotal < totalWrites) {
          requestAnimationFrame(stepFrame);
        } else {
          onDone();
        }
      }
      stepFrame();
    }

    toggle.addEventListener('click', function () {
      leveling = !leveling;
      toggle.setAttribute('aria-pressed', leveling ? 'true' : 'false');
      toggle.textContent = 'Wear leveling: ' + (leveling ? 'on' : 'off');
    });
    run.addEventListener('click', function () {
      if (running) { return; }
      running = true;
      run.disabled = true;
      reset();
      status.textContent = 'Writing…';
      simulate(36000, function () {
        running = false;
        run.disabled = false;
        report();
      });
    });
    status.textContent = 'Turn leveling on or off, then fast-forward five years of writes.';
  }

  /* ==========================================================================
     09 — how a program starts
     ========================================================================== */

  function initLaunch() {
    var svg = $('#mx-launch-svg');
    if (!svg) { return; }
    var parts = {};
    $$('.mx-ln-part', svg).forEach(function (g) { parts[g.getAttribute('data-part')] = g; });
    var pulse = $('#mx-ln-pulse');
    var title = $('#mx-launch-title');
    var text = $('#mx-launch-text');
    var btnPrev = $('#mx-launch-prev');
    var btnNext = $('#mx-launch-next');
    var btnPlay = $('#mx-launch-play');
    var dotsWrap = $('#mx-launch-dots');

    /* node x-positions along the wire (viewBox coordinates) */
    var X = { click: 104, ssd: 235, ram: 430, cpu: 620, screen: 810 };

    var STEPS = [
      { at: 'click', live: ['click'],
        t: '1 · You double-click an icon',
        d: 'The OS looks up the application’s executable file in the file system — it is sitting on the SSD, inert, like a recipe in a closed book.' },
      { at: 'ssd', live: ['ssd'],
        t: '2 · The SSD reads the executable',
        d: 'The drive streams the file’s first blocks — headers that tell the OS what kind of program this is, what libraries it needs, and where execution should begin.' },
      { at: 'ram', live: ['ssd', 'ram'],
        t: '3 · The loader builds a process',
        d: 'The OS creates a fresh virtual address space and maps the executable into it. Almost nothing is copied yet — pages will be pulled in on demand, exactly as chapter 06 described.' },
      { at: 'ram', live: ['ram'],
        t: '4 · Code and data land in RAM',
        d: 'As the program’s first pages are touched, page faults quietly pull machine code and data from the SSD into free RAM frames. The stack and heap are set up.' },
      { at: 'cpu', live: ['cpu'],
        t: '5 · The CPU jumps to the entry point',
        d: 'The program counter register is set to the program’s first instruction, and the fetch–decode–execute cycle begins pulling instructions out of RAM.' },
      { at: 'cpu', live: ['cpu'],
        t: '6 · Registers and caches warm up',
        d: 'The very first accesses all miss — cold caches. Within microseconds, the startup code’s hot loops live in L1 and its variables live in registers, and the CPU hits full stride.' },
      { at: 'screen', live: ['screen'],
        t: '7 · The window appears',
        d: 'The program asks the OS to draw; the GPU composites the frame; pixels change. One or two seconds have passed — and nearly all of it was memory movement, not computation.' }
    ];

    var dots = STEPS.map(function () {
      var d = document.createElement('i');
      dotsWrap.appendChild(d);
      return d;
    });

    var pos = 0;
    var playTimer = null;
    var pulseAnim = null;

    function movePulse(fromX, toX) {
      if (reduced()) { pulse.setAttribute('opacity', '0'); return; }
      if (pulseAnim) { cancelAnimationFrame(pulseAnim); pulseAnim = null; }
      var t0 = null;
      var dur = 550;
      pulse.setAttribute('opacity', '0.9');
      function frame(ts) {
        if (t0 === null) { t0 = ts; }
        var f = clamp((ts - t0) / dur, 0, 1);
        var ease = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
        pulse.setAttribute('cx', String(fromX + (toX - fromX) * ease));
        if (f < 1) { pulseAnim = requestAnimationFrame(frame); }
        else { pulse.setAttribute('opacity', '0'); pulseAnim = null; }
      }
      pulseAnim = requestAnimationFrame(frame);
    }

    function show(k, animate) {
      var prev = STEPS[pos];
      pos = clamp(k, 0, STEPS.length - 1);
      var s = STEPS[pos];
      Object.keys(parts).forEach(function (p) {
        parts[p].classList.toggle('is-live', s.live.indexOf(p) !== -1);
      });
      if (animate && prev && X[prev.at] !== X[s.at]) {
        movePulse(X[prev.at], X[s.at]);
      }
      title.textContent = s.t;
      text.textContent = s.d;
      dots.forEach(function (d, j) { d.classList.toggle('is-on', j <= pos); });
      btnPrev.disabled = pos === 0;
      btnNext.disabled = pos === STEPS.length - 1;
    }

    function stopPlay() {
      if (playTimer) { clearInterval(playTimer); playTimer = null; }
      btnPlay.textContent = 'Play the journey';
    }

    btnPrev.addEventListener('click', function () { stopPlay(); show(pos - 1, true); });
    btnNext.addEventListener('click', function () { stopPlay(); show(pos + 1, true); });
    btnPlay.addEventListener('click', function () {
      if (playTimer) { stopPlay(); return; }
      if (pos === STEPS.length - 1) { show(0, false); }
      if (reduced()) { show(STEPS.length - 1, false); return; }
      btnPlay.textContent = 'Pause';
      playTimer = setInterval(function () {
        if (pos >= STEPS.length - 1) { stopPlay(); return; }
        show(pos + 1, true);
      }, 2600);
    });

    show(0, false);
  }

  /* ==========================================================================
     10 — latency vs bandwidth
     ========================================================================== */

  function initBandwidth() {
    var canvas = $('#mx-bw-canvas');
    if (!canvas) { return; }
    var cv = setupCanvas(canvas, function () { draw(0); });
    var ctx = cv.ctx;
    var els = {
      lat: $('#mx-bw-lat'), latOut: $('#mx-bw-lat-out'),
      bw: $('#mx-bw-bw'), bwOut: $('#mx-bw-bw-out'),
      first: $('#mx-bw-first'), total: $('#mx-bw-total'), dom: $('#mx-bw-dom')
    };
    var tabs = $$('.mx-mode-tab[data-bw]');
    var mode = 'stream';

    /* latency slider: 100 ns .. 10 ms (log). bandwidth: 0.1 .. 50 GB/s (log) */
    function latNs() { return Math.pow(10, 2 + (els.lat.value / 100) * 5); }
    function bwGBs() { return Math.pow(10, -1 + (els.bw.value / 100) * 2.7); }

    function model() {
      var lat = latNs();          /* ns per request */
      var bw = bwGBs();           /* GB/s */
      var m;
      if (mode === 'stream') {
        var xferNs = (4 / bw) * 1e9;
        m = { first: lat, total: lat + xferNs, latPart: lat, bwPart: xferNs };
      } else {
        var reqs = 100000;
        var xfer = (reqs * 4096 / 1e9 / bw) * 1e9;
        var latTotal = reqs * lat;
        m = { first: lat, total: latTotal + xfer, latPart: latTotal, bwPart: xfer };
      }
      m.dom = m.latPart > m.bwPart * 1.5 ? 'latency' : (m.bwPart > m.latPart * 1.5 ? 'bandwidth' : 'both equally');
      return m;
    }

    function syncOuts() {
      els.latOut.textContent = fmtNs(latNs());
      var bw = bwGBs();
      els.bwOut.textContent = bw < 1 ? (bw * 1000).toFixed(0) + ' MB/s' : bw.toFixed(bw < 10 ? 1 : 0) + ' GB/s';
      var m = model();
      els.first.textContent = fmtNs(m.first);
      els.total.textContent = fmtNs(m.total);
      els.dom.textContent = m.dom;
    }

    /* ambient animation: packets crossing a pipe */
    var packets = [];
    var rng = makeRng(3);
    var loop = makeLoop(function (t, dt) { draw(dt); });

    function draw(dt) {
      var w = cv.state.w, h = cv.state.h;
      if (w < 260 || h < 60) { return; }
      ctx.clearRect(0, 0, w, h);
      var lat = latNs(), bw = bwGBs();
      /* pipe geometry: height from bandwidth (log), crossing time from latency (log) */
      var pipeH = 12 + 70 * (Math.log10(bw) + 1) / 2.7;
      var crossMs = 300 + 2200 * (Math.log10(lat) - 2) / 5;
      var x0 = 120, x1 = w - 120;
      var cy = h / 2;

      ctx.font = '700 12px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = C.muted;

      ctx.fillStyle = '#151f36';
      ctx.strokeStyle = C.lineStrong;
      roundRect(ctx, 24, cy - 44, 84, 88, 10);
      ctx.fill(); ctx.stroke();
      roundRect(ctx, w - 108, cy - 44, 84, 88, 10);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = C.text;
      ctx.fillText('MEMORY', 66, cy + 4);
      ctx.fillText('CPU', w - 66, cy + 4);

      /* pipe */
      ctx.fillStyle = 'rgba(30, 41, 59, 0.6)';
      ctx.strokeStyle = C.line;
      roundRect(ctx, x0, cy - pipeH / 2, x1 - x0, pipeH, 8);
      ctx.fill(); ctx.stroke();

      ctx.fillStyle = C.faint;
      ctx.font = '600 11px Inter, sans-serif';
      ctx.fillText('width = bandwidth', (x0 + x1) / 2, cy + pipeH / 2 + 18);
      ctx.fillText('travel time = latency', (x0 + x1) / 2, cy - pipeH / 2 - 10);

      if (dt) {
        var lanes = Math.max(1, Math.floor(pipeH / 12));
        var spawnRate = mode === 'stream' ? lanes * 1.2 : lanes * 0.5;
        if (packets.length < 60 && rng() < (spawnRate * dt) / 1000 * 6) {
          packets.push({ p: 0, lane: Math.floor(rng() * lanes) });
        }
        packets = packets.filter(function (pk) {
          pk.p += dt / crossMs;
          if (pk.p >= 1) { return false; }
          var lanes2 = Math.max(1, Math.floor(pipeH / 12));
          if (pk.lane >= lanes2) { pk.lane = lanes2 - 1; }
          var y = cy - pipeH / 2 + 6 + pk.lane * (pipeH - 12) / Math.max(1, lanes2 - 1 || 1);
          var x = x0 + 8 + (x1 - x0 - 16) * pk.p;
          ctx.fillStyle = C.teal;
          roundRect(ctx, x - 4, y - 3, 8, 6, 2);
          ctx.fill();
          return true;
        });
      }
    }

    ['input', 'change'].forEach(function (evt) {
      els.lat.addEventListener(evt, syncOuts);
      els.bw.addEventListener(evt, syncOuts);
    });
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (x) { x.setAttribute('aria-pressed', x === tab ? 'true' : 'false'); });
        mode = tab.getAttribute('data-bw');
        packets = [];
        syncOuts();
      });
    });

    syncOuts();
    draw(0);
    if (!reduced()) {
      onScreen(canvas, function () { loop.start(); }, function () { loop.stop(); });
    }
  }

  /* ==========================================================================
     Playground — build a memory system
     ========================================================================== */

  function initPlayground() {
    var canvas = $('#mx-pg-canvas');
    if (!canvas) { return; }
    var cv = setupCanvas(canvas, function () { draw(); });
    var ctx = cv.ctx;

    var CACHE = [4, 8, 16, 32, 64, 128];              /* MB */
    var RAMS = [4, 8, 16, 32, 64, 128];               /* GB */
    var BWS = [12.5, 25, 50, 100, 200];               /* GB/s */
    var STORES = [
      { name: 'Hard drive', lat: 8e6, note: 'mechanical' },
      { name: 'SATA SSD', lat: 1e5, note: 'flash' },
      { name: 'NVMe SSD', lat: 6e4, note: 'flash, PCIe' }
    ];
    var SETS = [1, 2, 4, 8, 16];                      /* GB per app */

    var els = {
      cache: $('#mx-pg-cache'), cacheOut: $('#mx-pg-cache-out'),
      ram: $('#mx-pg-ram'), ramOut: $('#mx-pg-ram-out'),
      bw: $('#mx-pg-bw'), bwOut: $('#mx-pg-bw-out'),
      store: $('#mx-pg-store'), storeOut: $('#mx-pg-store-out'),
      apps: $('#mx-pg-apps'), appsOut: $('#mx-pg-apps-out'),
      set: $('#mx-pg-set'), setOut: $('#mx-pg-set-out'),
      run: $('#mx-pg-run'),
      hit: $('#mx-pg-hit'), util: $('#mx-pg-util'), faults: $('#mx-pg-faults'),
      lat: $('#mx-pg-lat'), io: $('#mx-pg-io'), score: $('#mx-pg-score'),
      verdict: $('#mx-pg-verdict')
    };

    function cfg() {
      return {
        cacheMB: CACHE[els.cache.value],
        ramGB: RAMS[els.ram.value],
        bw: BWS[els.bw.value],
        store: STORES[els.store.value],
        apps: +els.apps.value,
        setGB: SETS[els.set.value]
      };
    }

    /* The conceptual model. Honest ratios, not hardware emulation. */
    function model() {
      var c = cfg();
      /* ~15% of each app's data is "hot" at any moment */
      var hotMB = c.apps * c.setGB * 1024 * 0.15;
      var pressure = hotMB / c.cacheMB;
      var missRate = clamp(0.014 * Math.pow(pressure, 0.3), 0.004, 0.7);
      var hitRate = 1 - missRate;

      var need = c.apps * c.setGB + 3;                 /* GB incl. OS */
      var util = need / c.ramGB;
      var overflow = Math.max(0, 1 - c.ramGB / need);  /* fraction paged out */
      /* fraction of RAM-bound accesses that fault to storage */
      var faultFrac = overflow * 0.3;

      /* bandwidth pressure: heavier multi-app working sets demand more GB/s */
      var demand = 6 + c.apps * 3.5;
      var bwPenalty = Math.max(1, demand / c.bw);

      var ramLat = 80 * bwPenalty;
      var avgNs = hitRate * 9 + missRate * (ramLat + faultFrac * c.store.lat);

      var faultsLabel = overflow <= 0 ? 'none' :
        overflow < 0.15 ? 'occasional' : overflow < 0.4 ? 'frequent' : 'constant';

      var ioMBs = overflow <= 0 ? 0 :
        Math.min(c.store.lat > 1e6 ? 150 : 2500, overflow * 3500);

      var score = clamp(Math.round(100 * Math.pow(10 / avgNs, 0.38)), 1, 100);
      var label = score > 85 ? 'Snappy' : score > 55 ? 'Smooth' : score > 25 ? 'Sluggish' : 'Thrashing';

      return {
        c: c, hitRate: hitRate, util: util, overflow: overflow, faultFrac: faultFrac,
        avgNs: avgNs, faultsLabel: faultsLabel, ioMBs: ioMBs, score: score, label: label
      };
    }

    function verdictFor(m) {
      if (m.overflow > 0.3 && m.c.store.lat > 1e6) {
        return 'Severe thrashing on a hard drive: applications need ' + (m.c.apps * m.c.setGB + 3) +
          ' GB but only ' + m.c.ramGB + ' GB exists, and every page fault costs ~8 ms of mechanical seeking. ' +
          'Add RAM, close apps, or at minimum switch to an SSD — any of the three transforms this machine.';
      }
      if (m.overflow > 0.3) {
        return 'Heavy paging: RAM is oversubscribed ' + Math.round(m.util * 100) +
          '%, and the SSD is absorbing constant page traffic. It works — flash makes thrashing survivable — but more RAM is the real fix.';
      }
      if (m.overflow > 0) {
        return 'Mild memory pressure: the OS is paging out idle data now and then. Most users would not notice — this is virtual memory earning its keep.';
      }
      if (m.hitRate < 0.9) {
        return 'RAM is plentiful but working sets spill far past the cache, so the CPU makes frequent ~80 ns RAM trips. More cache (or software with better locality) is what would help here — not more RAM.';
      }
      if (m.c.bw < 6 + m.c.apps * 3.5) {
        return 'Compute-friendly hit rates, but memory bandwidth is the ceiling: with this many active applications, the bus is saturated and every core queues for its turn.';
      }
      return 'A balanced machine: hot data lives in cache, everything running fits in RAM with room to spare, and storage sits idle except for file I/O. This is what “fast” feels like.';
    }

    function setOuts(m) {
      els.hit.textContent = (m.hitRate * 100).toFixed(1) + '%';
      els.util.textContent = Math.round(m.util * 100) + '%';
      els.faults.textContent = m.faultsLabel;
      els.lat.textContent = fmtNs(m.avgNs);
      els.io.textContent = m.ioMBs ? fmtInt(m.ioMBs) + ' MB/s' : 'idle';
      els.score.textContent = m.label;
    }

    function syncSliders() {
      var c = cfg();
      els.cacheOut.textContent = c.cacheMB + ' MB';
      els.ramOut.textContent = c.ramGB + ' GB';
      els.bwOut.textContent = c.bw + ' GB/s';
      els.storeOut.textContent = c.store.name;
      els.appsOut.textContent = String(c.apps);
      els.setOut.textContent = c.setGB + ' GB';
    }

    /* ---- drawing: CPU on top, then cache / RAM / storage lanes ---- */
    var lastM = null;
    var flows = [];   /* animated access dots: {p, dest: 0 cache | 1 ram | 2 store} */
    var rng = makeRng(17);
    var anim = { t: 0, dur: 4200 };
    var loop = makeLoop(function (t, dt) {
      anim.t += dt;
      var f = clamp(anim.t / anim.dur, 0, 1);
      draw(f, dt);
      if (f >= 1) {
        loop.stop();
        setOuts(lastM);
        els.verdict.textContent = verdictFor(lastM);
      }
    });

    function laneGeom() {
      var w = cv.state.w, h = cv.state.h;
      var left = 30, right = w - 30;
      return {
        w: w, h: h, left: left, right: right,
        cpu: { y: 34, h: 34 },
        lanes: [
          { name: 'CACHE', y: h * 0.30, h: 44, c: C.cTeal },
          { name: 'RAM', y: h * 0.55, h: 44, c: C.violet },
          { name: 'STORAGE', y: h * 0.80, h: 44, c: C.amber }
        ]
      };
    }

    function draw(progress, dt) {
      var g = laneGeom();
      if (g.w < 100 || g.h < 100) { return; }
      var m = lastM || model();
      ctx.clearRect(0, 0, g.w, g.h);

      /* CPU bar */
      ctx.fillStyle = '#151f36';
      ctx.strokeStyle = C.lineStrong;
      roundRect(ctx, g.left, g.cpu.y - g.cpu.h / 2, g.right - g.left, g.cpu.h, 8);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = C.text;
      ctx.font = '700 12px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('CPU — issuing memory accesses', g.w / 2, g.cpu.y + 4);

      /* lanes */
      g.lanes.forEach(function (lane, i) {
        ctx.fillStyle = 'rgba(21, 31, 54, 0.85)';
        ctx.strokeStyle = C.line;
        roundRect(ctx, g.left, lane.y - lane.h / 2, g.right - g.left, lane.h, 8);
        ctx.fill(); ctx.stroke();
        ctx.textAlign = 'left';
        ctx.fillStyle = C.muted;
        ctx.font = '700 11px Inter, sans-serif';
        var label = lane.name;
        if (i === 0) { label += ' · ' + m.c.cacheMB + ' MB'; }
        if (i === 1) { label += ' · ' + m.c.ramGB + ' GB'; }
        if (i === 2) { label += ' · ' + m.c.store.name; }
        ctx.fillText(label, g.left + 12, lane.y - lane.h / 2 - 6);
      });

      /* RAM fill meter inside the RAM lane */
      var ramLane = g.lanes[1];
      var fillW = (g.right - g.left - 16) * clamp(m.util, 0, 1);
      ctx.fillStyle = m.util > 1 ? 'rgba(225, 29, 72, 0.45)' : 'rgba(139, 92, 246, 0.35)';
      roundRect(ctx, g.left + 8, ramLane.y - 10, Math.max(4, fillW), 20, 5);
      ctx.fill();
      ctx.fillStyle = C.faint;
      ctx.font = '600 10px Inter, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(Math.round(m.util * 100) + '% full' + (m.util > 1 ? ' — paging!' : ''), g.right - 12, ramLane.y + 4);

      /* animated access dots */
      if (dt && !reduced()) {
        if (flows.length < 46) {
          var n = 2 + Math.floor(rng() * 2);
          for (var s = 0; s < n; s++) {
            var r = rng();
            var dest = r < m.hitRate ? 0 : (rng() < m.faultFrac ? 2 : 1);
            flows.push({ p: 0, x: 0.08 + rng() * 0.84, dest: dest, speed: dest === 0 ? 2.4 : dest === 1 ? 1.5 : 0.55 });
          }
        }
        flows = flows.filter(function (fl) {
          fl.p += (dt / 1000) * fl.speed;
          var lane = g.lanes[fl.dest];
          var y0 = g.cpu.y + g.cpu.h / 2;
          var y1 = lane.y - lane.h / 2;
          if (fl.p >= 1) { return false; }
          var x = g.left + (g.right - g.left) * fl.x;
          var y = y0 + (y1 - y0) * fl.p;
          ctx.fillStyle = fl.dest === 0 ? C.teal : fl.dest === 1 ? C.violet : C.rose;
          ctx.beginPath();
          ctx.arc(x, y, fl.dest === 2 ? 4 : 3, 0, Math.PI * 2);
          ctx.fill();
          return true;
        });
      }
    }

    function run() {
      loop.stop();
      lastM = model();
      flows = [];
      if (reduced()) {
        draw(1, 0);
        setOuts(lastM);
        els.verdict.textContent = verdictFor(lastM);
        return;
      }
      els.verdict.textContent = 'Running…';
      anim.t = 0;
      loop.start();
    }

    ['cache', 'ram', 'bw', 'store', 'apps', 'set'].forEach(function (k) {
      els[k].addEventListener('input', syncSliders);
    });
    els.run.addEventListener('click', run);

    syncSliders();
    draw(0, 0);
    var seen = false;
    onScreen(canvas, function () {
      if (!seen) { seen = true; run(); }
    }, function () { loop.stop(); });
  }

  /* ==========================================================================
     boot
     ========================================================================== */

  /* Each widget boots in isolation: one failure (e.g. a canvas context that
     is transiently unavailable while the page loads hidden/prerendered) must
     not take the other widgets down. Failed inits are retried once when the
     page becomes visible or the user first interacts. */
  function boot() {
    var inits = [
      initReveal, initRail, initHero, initFlow, initHierarchy, initLatChart,
      initRegisters, initCache, initRam, initVirtualMemory, initDrives,
      initNandCell, initWear, initLaunch, initBandwidth, initPlayground
    ];
    var failed = [];

    function tryInit(fn) {
      try { fn(); } catch (err) {
        failed.push(fn);
        if (window.console && console.error) { console.error('memory.js: ' + (fn.name || 'init') + ' failed', err); }
      }
    }

    inits.forEach(tryInit);

    if (failed.length) {
      var retry = function () {
        document.removeEventListener('visibilitychange', retry);
        window.removeEventListener('pointerdown', retry, true);
        window.removeEventListener('keydown', retry, true);
        var again = failed;
        failed = [];
        again.forEach(tryInit);
      };
      document.addEventListener('visibilitychange', retry);
      window.addEventListener('pointerdown', retry, true);
      window.addEventListener('keydown', retry, true);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
