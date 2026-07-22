/* =============================================================================
   Inside a Modern GPU — interactivity
   Vanilla JS, no dependencies. Loaded with `defer` on /gpu/ only.

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

  document.documentElement.classList.add('gx-js');

  var RM = window.matchMedia('(prefers-reduced-motion: reduce)');

  function reduced() { return RM.matches; }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function fmtInt(n) { return Math.round(n).toLocaleString('en-US'); }

  function fmtSeconds(s) {
    if (s < 1e-3) { return (s * 1e6).toFixed(0) + ' µs'; }
    if (s < 1) { return (s * 1e3).toFixed(1) + ' ms'; }
    if (s < 120) { return s.toFixed(2) + ' s'; }
    return (s / 60).toFixed(1) + ' min';
  }

  var C = {
    deep: '#0b1120', line: '#1e293b', lineStrong: '#334155',
    text: '#cbd5e1', strong: '#f1f5f9', muted: '#94a3b8', faint: '#64748b',
    teal: '#2dd4bf', tealDeep: '#14b8a6',
    cTeal: '#0d9488', amber: '#d97706', sky: '#0284c7',
    rose: '#e11d48', violet: '#8b5cf6', lime: '#65a30d'
  };

  /* Fit a canvas's backing store to its CSS box (devicePixelRatio-aware).
     The onResize callback is NOT invoked during this initial synchronous fit —
     callers do their own first draw once their closure state exists — but it
     fires on every later ResizeObserver-driven refit. */
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

  /* ==========================================================================
     Reveal-on-scroll + chapter rail
     ========================================================================== */

  function initReveal() {
    var targets = $$('#gpu-experience [data-gx-reveal]').concat($$('#gpu-experience .gx-era'));
    if (!targets.length) { return; }
    $$('#gpu-experience .gx-era').forEach(function (el, i) {
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
    var dots = $$('.gx-rail-dot');
    if (!dots.length) { return; }
    var byId = {};
    dots.forEach(function (dot) {
      dot.setAttribute('aria-label', dot.getAttribute('data-label') || 'Section');
      byId[dot.getAttribute('href').slice(1)] = dot;
    });
    if (!('IntersectionObserver' in window)) { return; }
    var sections = $$('#gpu-experience .gx-section, #gpu-experience .gx-hero');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) { return; }
        var dot = byId[e.target.id];
        if (!dot) { return; }
        dots.forEach(function (d) { d.classList.remove('is-active'); });
        dot.classList.add('is-active');
      });
    }, { rootMargin: '-42% 0px -52% 0px' });
    sections.forEach(function (s) { if (s.id) { io.observe(s); } });
  }

  /* ==========================================================================
     Hero — stylized die with data flowing along circuit traces
     ========================================================================== */

  function initHero() {
    var canvas = $('#gx-hero-canvas');
    if (!canvas) { return; }

    var traces = [];
    var particles = [];
    var sprite = null;

    function makeSprite() {
      var s = document.createElement('canvas');
      s.width = 32; s.height = 32;
      var g = s.getContext('2d');
      var grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      grad.addColorStop(0, 'rgba(45,212,191,0.9)');
      grad.addColorStop(0.35, 'rgba(45,212,191,0.28)');
      grad.addColorStop(1, 'rgba(45,212,191,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 32, 32);
      return s;
    }

    function buildScene() {
      var w = cv.state.w, h = cv.state.h;
      var dw = Math.min(w * 0.34, 360);
      var dh = Math.min(h * 0.36, 230);
      var die = { x: (w - dw) / 2, y: h * 0.62 - dh / 2, w: dw, h: dh };
      traces = [];
      particles = [];

      function addTrace(pts) {
        var len = 0;
        for (var i = 1; i < pts.length; i++) {
          len += Math.abs(pts[i][0] - pts[i - 1][0]) + Math.abs(pts[i][1] - pts[i - 1][1]);
        }
        traces.push({ pts: pts, len: len });
      }

      var i, n, x0, y0, bend;
      // top + bottom edges
      n = 9;
      for (i = 0; i < n; i++) {
        x0 = die.x + die.w * (i + 0.5) / n;
        bend = x0 + (Math.random() * 120 - 60);
        addTrace([[x0, die.y], [x0, die.y - 24 - Math.random() * 30], [bend, die.y - 24 - Math.random() * 30 - 1], [bend, -20]]);
        x0 = die.x + die.w * (i + 0.5) / n;
        bend = x0 + (Math.random() * 140 - 70);
        addTrace([[x0, die.y + die.h], [x0, die.y + die.h + 18 + Math.random() * 24], [bend, die.y + die.h + 19 + Math.random() * 24], [bend, h + 20]]);
      }
      // left + right edges
      n = 5;
      for (i = 0; i < n; i++) {
        y0 = die.y + die.h * (i + 0.5) / n;
        bend = y0 + (Math.random() * 90 - 45);
        addTrace([[die.x, y0], [die.x - 30 - Math.random() * 40, y0], [die.x - 31 - Math.random() * 40, bend], [-20, bend]]);
        y0 = die.y + die.h * (i + 0.5) / n;
        bend = y0 + (Math.random() * 90 - 45);
        addTrace([[die.x + die.w, y0], [die.x + die.w + 30 + Math.random() * 40, y0], [die.x + die.w + 31 + Math.random() * 40, bend], [w + 20, bend]]);
      }

      var count = Math.min(64, Math.max(24, Math.floor(w / 22)));
      for (i = 0; i < count; i++) {
        var tr = traces[Math.floor(Math.random() * traces.length)];
        particles.push({
          trace: tr,
          t: Math.random(),
          speed: 0.06 + Math.random() * 0.12,
          dir: Math.random() > 0.45 ? 1 : -1,
          size: 4 + Math.random() * 7
        });
      }
      scene.die = die;
    }

    function pointAt(trace, t) {
      var target = t * trace.len;
      var acc = 0;
      for (var i = 1; i < trace.pts.length; i++) {
        var a = trace.pts[i - 1], b = trace.pts[i];
        var seg = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
        if (acc + seg >= target && seg > 0) {
          var f = (target - acc) / seg;
          return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
        }
        acc += seg;
      }
      return trace.pts[trace.pts.length - 1];
    }

    function drawStatic() {
      var ctx = cv.ctx, w = cv.state.w, h = cv.state.h;
      ctx.clearRect(0, 0, w, h);
      // traces
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(45, 212, 191, 0.10)';
      traces.forEach(function (tr) {
        ctx.beginPath();
        ctx.moveTo(tr.pts[0][0], tr.pts[0][1]);
        for (var i = 1; i < tr.pts.length; i++) { ctx.lineTo(tr.pts[i][0], tr.pts[i][1]); }
        ctx.stroke();
        ctx.fillStyle = 'rgba(45, 212, 191, 0.22)';
        ctx.fillRect(tr.pts[0][0] - 2, tr.pts[0][1] - 2, 4, 4);
      });
      // die
      var d = scene.die;
      ctx.fillStyle = 'rgba(17, 28, 51, 0.9)';
      ctx.strokeStyle = 'rgba(45, 212, 191, 0.35)';
      ctx.lineWidth = 1.5;
      roundRect(ctx, d.x, d.y, d.w, d.h, 10);
      ctx.fill();
      ctx.stroke();
      // inner grid of SM-ish blocks
      var cols = 6, rows = 3, pad = 10;
      var cw = (d.w - pad * 2) / cols, ch = (d.h - pad * 2 - 16) / rows;
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
      ctx.lineWidth = 1;
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          roundRect(ctx, d.x + pad + c * cw + 2, d.y + pad + r * ch + 2, cw - 4, ch - 4, 3);
          ctx.stroke();
        }
      }
      ctx.fillStyle = 'rgba(148, 163, 184, 0.28)';
      ctx.fillRect(d.x + pad, d.y + d.h - pad - 8, d.w - pad * 2, 4);
      ctx.font = '600 10px Inter, sans-serif';
      ctx.fillStyle = 'rgba(148, 163, 184, 0.5)';
      ctx.textAlign = 'left';
      ctx.fillText('GPU', d.x + pad, d.y + d.h - pad - 14);
    }

    var scene = { die: null };
    var cv;
    cv = setupCanvas(canvas, function () { buildScene(); drawStatic(); if (reduced()) { drawReducedGlow(); } });

    function drawReducedGlow() {
      var ctx = cv.ctx;
      traces.forEach(function (tr, i) {
        if (i % 3) { return; }
        var p = pointAt(tr, 0.4);
        ctx.drawImage(sprite, p[0] - 8, p[1] - 8, 16, 16);
      });
    }

    sprite = makeSprite();
    buildScene();
    drawStatic();

    var loop = makeLoop(function (t, dt) {
      drawStatic();
      var ctx = cv.ctx;
      particles.forEach(function (p) {
        p.t += (dt / 1000) * p.speed * p.dir * (220 / Math.max(220, p.trace.len));
        if (p.t > 1) { p.t = 0; }
        if (p.t < 0) { p.t = 1; }
        var pos = pointAt(p.trace, p.t);
        ctx.drawImage(sprite, pos[0] - p.size / 2, pos[1] - p.size / 2, p.size, p.size);
      });
      // soft breathing glow on the die
      var d = scene.die;
      var pulse = 0.5 + 0.5 * Math.sin(t / 1400);
      ctx.strokeStyle = 'rgba(45, 212, 191, ' + (0.25 + 0.25 * pulse) + ')';
      ctx.lineWidth = 1.5;
      roundRect(ctx, d.x, d.y, d.w, d.h, 10);
      ctx.stroke();
    });

    var visible = false;
    function sync() {
      if (visible && !reduced()) { loop.start(); }
      else { loop.stop(); drawStatic(); if (reduced()) { drawReducedGlow(); } }
    }
    onScreen(canvas, function () { visible = true; sync(); }, function () { visible = false; sync(); });
    RM.addEventListener ? RM.addEventListener('change', sync) : RM.addListener(sync);
  }

  /* ==========================================================================
     01 — CPU vs GPU race
     ========================================================================== */

  function initRace() {
    var cpuCanvas = $('#gx-race-cpu'), gpuCanvas = $('#gx-race-gpu');
    if (!cpuCanvas || !gpuCanvas) { return; }

    var N = 256, COLS = 16, ROWS = 16;
    var TICK = 45; // simulated ms per tick
    var CPU_PER_TICK = 8;         // 8 cores, 1 task per tick each
    var GPU_LANES = 128, GPU_TASK_TICKS = 2;

    var panels = {
      cpu: { cv: setupCanvas(cpuCanvas, function () { draw('cpu'); }), prog: new Float32Array(N), done: 0, finished: 0, out: $('#gx-race-cpu-done'), time: $('#gx-race-cpu-time'), color: C.amber },
      gpu: { cv: setupCanvas(gpuCanvas, function () { draw('gpu'); }), prog: new Float32Array(N), done: 0, finished: 0, out: $('#gx-race-gpu-done'), time: $('#gx-race-gpu-time'), color: C.cTeal }
    };
    var verdict = $('#gx-race-verdict');
    var simT = 0, ran = false;

    function reset() {
      simT = 0;
      ['cpu', 'gpu'].forEach(function (k) {
        var p = panels[k];
        p.prog.fill(0); p.done = 0; p.finished = 0;
        p.out.textContent = '0';
        p.time.textContent = '0.0';
        draw(k);
      });
      verdict.textContent = '';
    }

    function advance(toT) {
      // CPU: sequential blocks of 8
      var p = panels.cpu;
      var ticks = toT / TICK;
      var doneTasks = Math.min(N, Math.floor(ticks) * CPU_PER_TICK);
      var frac = ticks - Math.floor(ticks);
      for (var i = 0; i < N; i++) {
        p.prog[i] = i < doneTasks ? 1 : (i < doneTasks + CPU_PER_TICK ? frac : 0);
      }
      p.done = doneTasks;
      if (!p.finished && doneTasks >= N) { p.finished = (N / CPU_PER_TICK) * TICK; }

      // GPU: waves of 128 lanes, each task takes 2 ticks
      p = panels.gpu;
      for (i = 0; i < N; i++) {
        var wave = Math.floor(i / GPU_LANES);
        var start = wave * GPU_TASK_TICKS * TICK;
        p.prog[i] = clamp((toT - start) / (GPU_TASK_TICKS * TICK), 0, 1);
      }
      p.done = 0;
      for (i = 0; i < N; i++) { if (p.prog[i] >= 1) { p.done++; } }
      var gpuTotal = Math.ceil(N / GPU_LANES) * GPU_TASK_TICKS * TICK;
      if (!p.finished && toT >= gpuTotal) { p.finished = gpuTotal; }
    }

    function draw(kind) {
      var p = panels[kind];
      var ctx = p.cv.ctx, w = p.cv.state.w, h = p.cv.state.h;
      ctx.clearRect(0, 0, w, h);
      var pad = 8;
      var cell = Math.min((w - pad * 2) / COLS, (h - pad * 2) / ROWS);
      var ox = (w - cell * COLS) / 2, oy = (h - cell * ROWS) / 2;
      for (var i = 0; i < N; i++) {
        var cx = ox + (i % COLS) * cell, cy = oy + Math.floor(i / COLS) * cell;
        var v = p.prog[i];
        if (v <= 0) {
          ctx.fillStyle = 'rgba(30, 41, 59, 0.55)';
        } else if (v < 1) {
          ctx.fillStyle = kind === 'cpu' ? 'rgba(217, 119, 6, 0.45)' : 'rgba(13, 148, 136, 0.45)';
        } else {
          ctx.fillStyle = p.color;
        }
        ctx.fillRect(cx + 1, cy + 1, cell - 2, cell - 2);
      }
    }

    var cpuTotal = (N / CPU_PER_TICK) * TICK;
    var loop = makeLoop(function (t, dt) {
      simT += dt;
      advance(simT);
      draw('cpu'); draw('gpu');
      panels.cpu.out.textContent = fmtInt(panels.cpu.done);
      panels.gpu.out.textContent = fmtInt(panels.gpu.done);
      panels.cpu.time.textContent = (panels.cpu.finished || Math.min(simT, cpuTotal)).toFixed(0);
      var gpuTotal = Math.ceil(N / GPU_LANES) * GPU_TASK_TICKS * TICK;
      panels.gpu.time.textContent = (panels.gpu.finished || Math.min(simT, gpuTotal)).toFixed(0);
      if (panels.cpu.finished && panels.gpu.finished) {
        loop.stop();
        var ratio = panels.cpu.finished / panels.gpu.finished;
        verdict.textContent = 'Same 256 tasks. The GPU finished ' + ratio.toFixed(1) + 'x sooner — with lanes that are individually slower.';
      }
    });

    function run() {
      reset();
      if (reduced()) {
        advance(1e9);
        draw('cpu'); draw('gpu');
        panels.cpu.out.textContent = fmtInt(N); panels.gpu.out.textContent = fmtInt(N);
        panels.cpu.time.textContent = panels.cpu.finished.toFixed(0);
        panels.gpu.time.textContent = panels.gpu.finished.toFixed(0);
        verdict.textContent = 'Same 256 tasks. The GPU finished ' + (panels.cpu.finished / panels.gpu.finished).toFixed(1) + 'x sooner — with lanes that are individually slower.';
        return;
      }
      loop.start();
    }

    $('#gx-race-replay').addEventListener('click', run);
    onScreen(cpuCanvas, function () { if (!ran) { ran = true; setTimeout(run, 350); } }, function () { loop.stop(); });
    reset();
  }

  /* ==========================================================================
     02 — Die explorer
     ========================================================================== */

  function initDie() {
    var card = $('#gx-part-card');
    if (!card) { return; }
    var data = {};
    $$('#gx-part-data article').forEach(function (a) {
      data[a.getAttribute('data-part')] = {
        name: a.querySelector('h4').textContent,
        alias: a.querySelector('[data-role="alias"]').textContent,
        what: a.querySelector('[data-role="what"]').innerHTML,
        why: a.querySelector('[data-role="why"]').innerHTML,
        talks: a.querySelector('[data-role="talks"]').innerHTML
      };
    });
    var nameEl = $('#gx-part-name'), tagEl = $('#gx-part-tag'), bodyEl = $('#gx-part-body');
    var parts = $$('.gx-part');

    function select(key) {
      var d = data[key];
      if (!d) { return; }
      parts.forEach(function (g) {
        g.classList.toggle('is-active', g.getAttribute('data-part') === key);
      });
      nameEl.textContent = d.name;
      tagEl.textContent = d.alias;
      bodyEl.innerHTML =
        '<p><strong>What it does</strong><br>' + d.what + '</p>' +
        '<p><strong>Why it exists</strong><br>' + d.why + '</p>' +
        '<p><strong>How it connects</strong><br>' + d.talks + '</p>';
    }

    parts.forEach(function (g) {
      g.addEventListener('click', function () { select(g.getAttribute('data-part')); });
      g.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          select(g.getAttribute('data-part'));
        }
      });
    });
  }

  /* ==========================================================================
     03 — Massive parallelism simulator
     ========================================================================== */

  function initParallel() {
    var canvas = $('#gx-par-canvas');
    if (!canvas) { return; }

    var N = 1024, COLS = 32, ROWS = 32;
    var TICK = 30; // simulated ms per tick
    var mode = 'cpu';
    var prog = new Float32Array(N);
    var simT = 0, running = false, finishedAt = 0;

    var outs = {
      active: $('#gx-par-active'), time: $('#gx-par-time'),
      tput: $('#gx-par-tput'), util: $('#gx-par-util')
    };

    var MODES = {
      cpu: { lanes: 8, taskTicks: 1 },
      gpu: { lanes: 256, taskTicks: 4 }
    };

    function totalTicks(m) { return (N / MODES[m].lanes) * MODES[m].taskTicks; }

    var cv = setupCanvas(canvas, draw);

    function advance(toT) {
      var m = MODES[mode];
      var ticks = toT / TICK;
      var waves = N / m.lanes;
      for (var i = 0; i < N; i++) {
        var wave = mode === 'cpu' ? Math.floor(i / m.lanes) : Math.floor(i / m.lanes);
        var start = wave * m.taskTicks;
        prog[i] = clamp((ticks - start) / m.taskTicks, 0, 1);
      }
      if (!finishedAt && ticks >= waves * m.taskTicks) { finishedAt = waves * m.taskTicks * TICK; }
    }

    function counts() {
      var done = 0, active = 0;
      for (var i = 0; i < N; i++) {
        if (prog[i] >= 1) { done++; }
        else if (prog[i] > 0) { active++; }
      }
      return { done: done, active: active };
    }

    function draw() {
      var ctx = cv.ctx, w = cv.state.w, h = cv.state.h;
      ctx.clearRect(0, 0, w, h);
      var pad = 10;
      var cell = Math.min((w - pad * 2) / COLS, (h - pad * 2) / ROWS);
      var ox = (w - cell * COLS) / 2, oy = (h - cell * ROWS) / 2;
      for (var i = 0; i < N; i++) {
        var v = prog[i];
        var cx = ox + (i % COLS) * cell, cy = oy + Math.floor(i / COLS) * cell;
        if (v <= 0) {
          ctx.fillStyle = 'rgba(30, 41, 59, 0.5)';
        } else if (v < 1) {
          ctx.fillStyle = mode === 'cpu'
            ? 'rgba(217, 119, 6, ' + (0.25 + v * 0.5) + ')'
            : 'rgba(20, 184, 166, ' + (0.2 + v * 0.5) + ')';
        } else {
          // finished — alternate warp tint (groups of 32) so waves stay visible
          if (mode === 'gpu') {
            ctx.fillStyle = (Math.floor(i / 32) % 2) ? C.cTeal : '#0fa396';
          } else {
            ctx.fillStyle = C.amber;
          }
        }
        ctx.fillRect(cx + 0.5, cy + 0.5, cell - 1, cell - 1);
      }
    }

    function updateStats() {
      var c = counts();
      var t = finishedAt || simT;
      outs.active.textContent = running || (!finishedAt && simT > 0) ? fmtInt(Math.min(c.active || MODES[mode].lanes, MODES[mode].lanes)) : (finishedAt ? '0' : fmtInt(0));
      outs.time.textContent = t.toFixed(0) + ' ms';
      outs.tput.textContent = t > 0 ? (c.done / t).toFixed(1) + ' tasks/ms' : '0 tasks/ms';
      var util = running && c.active ? Math.min(100, Math.round(100 * c.active / MODES[mode].lanes)) : (finishedAt ? 100 : 0);
      outs.util.textContent = util + '%';
    }

    var loop = makeLoop(function (t, dt) {
      simT += dt;
      advance(simT);
      draw();
      updateStats();
      if (finishedAt) {
        running = false;
        updateStats();
        loop.stop();
      }
    });

    function reset() {
      loop.stop();
      running = false;
      simT = 0; finishedAt = 0;
      prog.fill(0);
      draw();
      outs.active.textContent = '0';
      outs.time.textContent = '0.0 ms';
      outs.tput.textContent = '0 tasks/ms';
      outs.util.textContent = '0%';
    }

    function run() {
      reset();
      running = true;
      if (reduced()) {
        advance(1e9);
        draw();
        running = false;
        updateStats();
        return;
      }
      loop.start();
    }

    $$('#gx-par-mode button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$('#gx-par-mode button').forEach(function (b) { b.setAttribute('aria-pressed', String(b === btn)); });
        mode = btn.getAttribute('data-mode');
        reset();
      });
    });
    $('#gx-par-run').addEventListener('click', run);
    $('#gx-par-reset').addEventListener('click', reset);
    onScreen(canvas, null, function () { loop.stop(); running = false; });
    reset();
  }

  /* ==========================================================================
     04 — Graphics pipeline
     ========================================================================== */

  function initPipeline() {
    var canvas = $('#gx-pipe-canvas');
    if (!canvas) { return; }

    var ORDER = ['vertex', 'assembly', 'raster', 'fragment', 'lighting', 'post', 'framebuffer', 'display'];
    var texts = {};
    $$('#gx-stage-data article').forEach(function (a) {
      texts[a.getAttribute('data-stage')] = a.querySelector('p').innerHTML;
    });
    var titleEl = $('#gx-stage-title'), textEl = $('#gx-stage-text');
    var buttons = $$('.gx-stage');
    var current = 'vertex';
    var stageStart = performance.now();
    var playing = false, playTimer = null;

    // Scene in unit coordinates. Gem facets + floor.
    var A = [0.50, 0.15], B = [0.27, 0.46], Cc = [0.73, 0.46], D = [0.50, 0.87], M = [0.50, 0.52];
    var TRIS = [
      { p: [A, B, M], alb: [126, 220, 208], lum: 1.0 },
      { p: [A, M, Cc], alb: [79, 184, 171], lum: 0.74 },
      { p: [B, D, M], alb: [46, 141, 132], lum: 0.55 },
      { p: [M, D, Cc], alb: [32, 108, 101], lum: 0.42 }
    ];

    function px(pt, w, h, scale, dx, dy) {
      scale = scale || 1; dx = dx || 0; dy = dy || 0;
      return [(pt[0] - 0.5) * scale * h * 0.92 + w / 2 + dx * w, (pt[1] - 0.5) * scale * h * 0.92 + h * 0.47 + dy * h];
    }

    function inTri(x, y, a, b, c) {
      var s = (a[0] - c[0]) * (y - c[1]) - (a[1] - c[1]) * (x - c[0]);
      var t = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
      if ((s < 0) !== (t < 0) && s !== 0 && t !== 0) { return false; }
      var d = (c[0] - b[0]) * (y - b[1]) - (c[1] - b[1]) * (x - b[0]);
      return d === 0 || (d < 0) === (s + t <= 0);
    }

    var cv = setupCanvas(canvas, render);

    function clearBg(ctx, w, h) {
      ctx.clearRect(0, 0, w, h);
      var g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#0d1730');
      g.addColorStop(1, '#0b1120');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    function drawFloor(ctx, w, h, lit) {
      var y = h * 0.83;
      ctx.fillStyle = lit ? '#141f38' : '#101a30';
      ctx.beginPath();
      ctx.moveTo(w * 0.06, y);
      ctx.lineTo(w * 0.94, y);
      ctx.lineTo(w * 1.0, h * 0.97);
      ctx.lineTo(w * 0.0, h * 0.97);
      ctx.closePath();
      ctx.fill();
    }

    function vertices() {
      var vs = [A, B, Cc, D, M];
      return vs;
    }

    function drawWire(ctx, w, h, alpha) {
      ctx.strokeStyle = 'rgba(45, 212, 191, ' + alpha + ')';
      ctx.lineWidth = 1.5;
      TRIS.forEach(function (t) {
        ctx.beginPath();
        var a = px(t.p[0], w, h), b = px(t.p[1], w, h), c = px(t.p[2], w, h);
        ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]);
        ctx.closePath();
        ctx.stroke();
      });
    }

    function fillTris(ctx, w, h, useLum, cells, tMs) {
      if (!cells) {
        TRIS.forEach(function (t) {
          var k = useLum ? t.lum : 1;
          ctx.fillStyle = 'rgb(' + Math.round(t.alb[0] * k) + ',' + Math.round(t.alb[1] * k) + ',' + Math.round(t.alb[2] * k) + ')';
          ctx.beginPath();
          var a = px(t.p[0], w, h), b = px(t.p[1], w, h), c = px(t.p[2], w, h);
          ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]);
          ctx.closePath();
          ctx.fill();
        });
        return;
      }
      // pixel-grid version
      var cell = Math.max(8, Math.round(h / 26));
      var reveal = tMs === undefined ? 1 : clamp(tMs / 1600, 0, 1);
      var count = 0, total = 0;
      for (var gy = 0; gy < h; gy += cell) {
        for (var gx = 0; gx < w; gx += cell) {
          var cxp = gx + cell / 2, cyp = gy + cell / 2;
          for (var ti = 0; ti < TRIS.length; ti++) {
            var t = TRIS[ti];
            var a = px(t.p[0], w, h), b = px(t.p[1], w, h), c = px(t.p[2], w, h);
            if (inTri(cxp, cyp, a, b, c)) {
              total++;
              if ((count / 90) <= reveal * 3) { /* reveal in scan order */ }
              if (cells === 'coverage') {
                var on = (gy * w + gx) % 997 / 997 < reveal * 1.4 || reveal >= 1;
                ctx.fillStyle = on ? 'rgba(45, 212, 191, 0.4)' : 'rgba(45, 212, 191, 0.08)';
              } else {
                var k2 = cells === 'lit' ? t.lum : 1;
                ctx.fillStyle = 'rgb(' + Math.round(t.alb[0] * k2) + ',' + Math.round(t.alb[1] * k2) + ',' + Math.round(t.alb[2] * k2) + ')';
              }
              ctx.fillRect(gx + 1, gy + 1, cell - 2, cell - 2);
              count++;
              break;
            }
          }
        }
      }
    }

    function drawShadow(ctx, w, h) {
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.beginPath();
      ctx.ellipse(w / 2 + h * 0.06, h * 0.855, h * 0.3, h * 0.05, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    function drawGrid(ctx, w, h) {
      var cell = Math.max(8, Math.round(h / 26));
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.09)';
      ctx.lineWidth = 1;
      for (var x = 0; x <= w; x += cell) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (var y = 0; y <= h; y += cell) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    }

    function label(ctx, w, h, s) {
      ctx.font = '600 11px "JetBrains Mono", monospace';
      ctx.fillStyle = 'rgba(148, 163, 184, 0.8)';
      ctx.textAlign = 'left';
      ctx.fillText(s, 14, h - 14);
    }

    var STAGES = {
      vertex: function (ctx, w, h, t) {
        drawFloor(ctx, w, h, false);
        // ghost of untransformed verts
        var wob = reduced() ? 0 : Math.sin(t / 700) * 0.008;
        vertices().forEach(function (v) {
          var g = px(v, w, h, 1.28, -0.14, -0.03);
          var p = px(v, w, h, 1, wob, 0);
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.3)';
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 4]);
          ctx.beginPath(); ctx.moveTo(g[0], g[1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = 'rgba(148, 163, 184, 0.4)';
          ctx.beginPath(); ctx.arc(g[0], g[1], 3, 0, 7); ctx.fill();
          ctx.fillStyle = C.teal;
          ctx.beginPath(); ctx.arc(p[0], p[1], 4.5, 0, 7); ctx.fill();
        });
        label(ctx, w, h, 'object space -> clip space');
      },
      assembly: function (ctx, w, h, t) {
        drawFloor(ctx, w, h, false);
        drawWire(ctx, w, h, 0.85);
        vertices().forEach(function (v) {
          var p = px(v, w, h);
          ctx.fillStyle = C.teal;
          ctx.beginPath(); ctx.arc(p[0], p[1], 3.5, 0, 7); ctx.fill();
        });
        // culled backface, drifting away
        var drift = reduced() ? 0.1 : clamp((t % 3000) / 3000, 0, 1) * 0.16;
        ctx.strokeStyle = 'rgba(225, 29, 72, 0.55)';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        var a = px(A, w, h, 0.9, 0.3 + drift, -0.05), b = px(B, w, h, 0.9, 0.3 + drift, -0.05), c = px(Cc, w, h, 0.9, 0.3 + drift, -0.05);
        ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '600 10px Inter, sans-serif';
        ctx.fillStyle = 'rgba(225, 29, 72, 0.7)';
        ctx.textAlign = 'center';
        ctx.fillText('BACKFACE - CULLED', (a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3 + 30);
        label(ctx, w, h, 'triangles assembled, backfaces culled');
      },
      raster: function (ctx, w, h, t) {
        drawFloor(ctx, w, h, false);
        drawGrid(ctx, w, h);
        fillTris(ctx, w, h, false, 'coverage', reduced() ? undefined : t);
        drawWire(ctx, w, h, 0.4);
        label(ctx, w, h, 'coverage: triangles -> fragments');
      },
      fragment: function (ctx, w, h) {
        drawFloor(ctx, w, h, false);
        drawGrid(ctx, w, h);
        fillTris(ctx, w, h, false, 'albedo');
        label(ctx, w, h, 'fragment shader: material + textures');
      },
      lighting: function (ctx, w, h) {
        drawFloor(ctx, w, h, true);
        drawShadow(ctx, w, h);
        drawGrid(ctx, w, h);
        fillTris(ctx, w, h, true, 'lit');
        // light direction indicator
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.7)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(w * 0.14, h * 0.12); ctx.lineTo(w * 0.24, h * 0.24); ctx.stroke();
        ctx.beginPath(); ctx.arc(w * 0.12, h * 0.1, 6, 0, 7); ctx.fillStyle = 'rgba(251, 191, 36, 0.85)'; ctx.fill();
        label(ctx, w, h, 'N · L shading + shadows');
      },
      post: function (ctx, w, h) {
        drawFloor(ctx, w, h, true);
        drawShadow(ctx, w, h);
        fillTris(ctx, w, h, true);
        // bloom
        var p = px(A, w, h);
        var g = ctx.createRadialGradient(p[0], p[1] + h * 0.12, 0, p[0], p[1] + h * 0.12, h * 0.42);
        g.addColorStop(0, 'rgba(126, 220, 208, 0.22)');
        g.addColorStop(1, 'rgba(126, 220, 208, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        // vignette
        var vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.85);
        vg.addColorStop(0, 'rgba(0,0,0,0)');
        vg.addColorStop(1, 'rgba(0,0,0,0.4)');
        ctx.fillStyle = vg;
        ctx.fillRect(0, 0, w, h);
        label(ctx, w, h, 'tone map + bloom + AA / upscale');
      },
      framebuffer: function (ctx, w, h) {
        // final image, framed as a buffer in memory
        ctx.save();
        ctx.translate(w * 0.1, h * 0.1);
        ctx.scale(0.8, 0.8);
        drawFloor(ctx, w, h, true);
        drawShadow(ctx, w, h);
        fillTris(ctx, w, h, true);
        ctx.restore();
        ctx.strokeStyle = 'rgba(139, 92, 246, 0.65)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(w * 0.1, h * 0.1, w * 0.8, h * 0.8);
        ctx.font = '600 10px "JetBrains Mono", monospace';
        ctx.fillStyle = 'rgba(139, 92, 246, 0.8)';
        ctx.textAlign = 'left';
        ctx.fillText('VRAM 0x2F000000', w * 0.1, h * 0.08);
        ctx.textAlign = 'right';
        ctx.fillText('depth + color', w * 0.9, h * 0.08);
        label(ctx, w, h, 'depth-tested, blended, stored in VRAM');
      },
      display: function (ctx, w, h, t) {
        drawFloor(ctx, w, h, true);
        drawShadow(ctx, w, h);
        fillTris(ctx, w, h, true);
        // scanout line
        var y = reduced() ? h * 0.4 : ((t % 2200) / 2200) * h;
        ctx.fillStyle = 'rgba(45, 212, 191, 0.16)';
        ctx.fillRect(0, 0, w, y);
        ctx.fillStyle = 'rgba(45, 212, 191, 0.8)';
        ctx.fillRect(0, y, w, 2);
        ctx.font = '600 10px "JetBrains Mono", monospace';
        ctx.fillStyle = 'rgba(148, 163, 184, 0.85)';
        ctx.textAlign = 'right';
        ctx.fillText('scanout 120 Hz', w - 14, 20);
        label(ctx, w, h, 'the frame reaches the glass');
      }
    };

    function render(t) {
      var ctx = cv.ctx, w = cv.state.w, h = cv.state.h;
      clearBg(ctx, w, h);
      STAGES[current](ctx, w, h, (t === undefined ? performance.now() : t) - stageStart);
    }

    function select(key, viaPlay) {
      current = key;
      stageStart = performance.now();
      buttons.forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-stage') === key)); });
      titleEl.textContent = $('.gx-stage[data-stage="' + key + '"] .gx-stage-name').textContent;
      textEl.innerHTML = texts[key] || '';
      if (!viaPlay) { stopPlay(); }
      render();
    }

    function stopPlay() {
      playing = false;
      if (playTimer) { clearTimeout(playTimer); playTimer = null; }
      $('#gx-pipe-play').textContent = 'Play all stages';
    }

    function startPlay() {
      playing = true;
      $('#gx-pipe-play').textContent = 'Pause';
      function next() {
        if (!playing) { return; }
        var idx = ORDER.indexOf(current);
        if (idx === ORDER.length - 1) { stopPlay(); return; }
        select(ORDER[idx + 1], true);
        playTimer = setTimeout(next, reduced() ? 3600 : 2600);
      }
      if (ORDER.indexOf(current) === ORDER.length - 1) { select(ORDER[0], true); }
      playTimer = setTimeout(next, reduced() ? 3600 : 2600);
    }

    buttons.forEach(function (b) {
      b.addEventListener('click', function () { select(b.getAttribute('data-stage')); });
    });
    $('#gx-pipe-play').addEventListener('click', function () { playing ? stopPlay() : startPlay(); });
    $('#gx-pipe-prev').addEventListener('click', function () {
      select(ORDER[Math.max(0, ORDER.indexOf(current) - 1)]);
    });
    $('#gx-pipe-next').addEventListener('click', function () {
      select(ORDER[Math.min(ORDER.length - 1, ORDER.indexOf(current) + 1)]);
    });

    var loop = makeLoop(function (t) { render(t); });
    onScreen(canvas,
      function () { if (!reduced()) { loop.start(); } else { render(); } },
      function () { loop.stop(); stopPlay(); });
    select('vertex');
  }

  /* ==========================================================================
     05 — VRAM memory map + bandwidth + latency
     ========================================================================== */

  function initMemory() {
    var map = $('#gx-memmap');
    if (!map) { return; }
    var detail = $('#gx-mem-detail');

    var KINDS = [
      { k: 'textures', name: 'Textures', d: 'Streamed material sets and mip chains. The biggest tenant of a game frame — and the first thing engines shrink when VRAM runs low.' },
      { k: 'meshes', name: 'Meshes', d: 'Vertex and index buffers for every model in the scene, ready for the vertex shaders.' },
      { k: 'targets', name: 'Shadow maps & render targets', d: 'Off-screen images the frame is built from: shadow maps, G-buffers, reflection probes, the framebuffer itself.' },
      { k: 'buffers', name: 'Buffers', d: 'Uniforms, instance data, compute scratch — the small but constant plumbing of every frame.' },
      { k: 'weights', name: 'Model weights', d: 'A 7B-parameter model in FP16 is ~14 GB before you type a single token. Quantization (8- or 4-bit) exists to shrink exactly this block.' },
      { k: 'kv', name: 'KV cache & activations', d: 'Attention keys/values for the running context. Grows with context length and batch size — the block that eats VRAM at inference time.' },
      { k: 'free', name: 'Free', d: 'Headroom. When this reaches zero, the driver starts paging over PCIe and performance falls off a cliff.' }
    ];

    var PRESETS = {
      game: { textures: 9.5, meshes: 3, targets: 3.5, buffers: 1.5, weights: 0, kv: 0, free: 6.5 },
      ai: { textures: 0, meshes: 0, targets: 0, buffers: 2, weights: 14, kv: 5, free: 3 }
    };

    var segs = {};
    map.innerHTML = '';
    KINDS.forEach(function (kind) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'gx-memseg';
      b.setAttribute('data-kind', kind.k);
      b.innerHTML = '<span class="gx-memseg-name"></span><span class="gx-memseg-size"></span>';
      b.addEventListener('click', function () {
        $$('.gx-memseg', map).forEach(function (s) { s.classList.remove('is-active'); });
        b.classList.add('is-active');
        detail.innerHTML = '<strong>' + kind.name + ' — ' + b.getAttribute('data-gb') + ' GB.</strong> ' + kind.d;
      });
      map.appendChild(b);
      segs[kind.k] = b;
    });

    function apply(presetKey) {
      var p = PRESETS[presetKey];
      KINDS.forEach(function (kind) {
        var gb = p[kind.k];
        var el = segs[kind.k];
        el.style.setProperty('--gb', gb > 0 ? gb : 0.0001);
        el.setAttribute('data-gb', gb);
        el.style.padding = gb > 0 ? '' : '0';
        el.tabIndex = gb > 0 ? 0 : -1;
        el.setAttribute('aria-hidden', gb > 0 ? 'false' : 'true');
        el.setAttribute('aria-label', kind.name + ', ' + gb + ' of 24 gigabytes');
        el.querySelector('.gx-memseg-name').textContent = kind.name;
        el.querySelector('.gx-memseg-size').textContent = gb + ' GB';
        el.classList.remove('is-active');
      });
      detail.textContent = presetKey === 'game'
        ? 'A 4K game frame: textures dominate. Select a segment for details.'
        : 'A 7B LLM at FP16: the weights barely fit — and the KV cache grows with every token of context.';
    }

    $$('#gx-mem-preset button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$('#gx-mem-preset button').forEach(function (b) { b.setAttribute('aria-pressed', String(b === btn)); });
        apply(btn.getAttribute('data-preset'));
      });
    });
    apply('game');

    /* --- bandwidth stream canvas --- */
    var canvas = $('#gx-bw-canvas');
    if (!canvas) { return; }
    var parts = [];
    var cv = setupCanvas(canvas, function () { seed(); });
    seed();

    function seed() {
      parts = [];
      var w = cv.state.w;
      var n = Math.min(72, Math.floor(w / 12));
      for (var i = 0; i < n; i++) {
        parts.push({ x: Math.random(), lane: Math.random(), dir: i % 4 === 0 ? -1 : 1, speed: 0.25 + Math.random() * 0.4, kind: 'vram' });
      }
      for (i = 0; i < 3; i++) {
        parts.push({ x: Math.random(), lane: Math.random(), dir: 1, speed: 0.1 + Math.random() * 0.08, kind: 'pcie' });
      }
      drawFrame(0);
    }

    function node(ctx, x, y, w, h, name, sub, color) {
      ctx.fillStyle = '#111c33';
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      roundRect(ctx, x, y, w, h, 10);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = C.strong;
      ctx.font = '700 12px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(name, x + w / 2, y + h / 2 - 4);
      ctx.fillStyle = C.faint;
      ctx.font = '500 10px Inter, sans-serif';
      ctx.fillText(sub, x + w / 2, y + h / 2 + 12);
    }

    function drawFrame(dt) {
      var ctx = cv.ctx, w = cv.state.w, h = cv.state.h;
      ctx.clearRect(0, 0, w, h);
      var nodeW = Math.min(150, w * 0.2), nodeH = h * 0.42;
      var leftX = w * 0.06, rightX = w * 0.94 - nodeW;
      var chTop = h * 0.16, chH = nodeH * 0.7;

      // main channel
      ctx.fillStyle = 'rgba(139, 92, 246, 0.06)';
      ctx.fillRect(leftX + nodeW, chTop, rightX - leftX - nodeW, chH);

      // PCIe channel
      var pTop = h * 0.72, pH = h * 0.1;
      ctx.fillStyle = 'rgba(217, 119, 6, 0.06)';
      ctx.fillRect(leftX + nodeW, pTop, rightX - leftX - nodeW, pH);

      parts.forEach(function (p) {
        if (dt) {
          p.x += p.dir * p.speed * dt / 1000;
          if (p.x > 1) { p.x = 0; } if (p.x < 0) { p.x = 1; }
        }
        var x = leftX + nodeW + p.x * (rightX - leftX - nodeW);
        if (p.kind === 'vram') {
          ctx.fillStyle = 'rgba(139, 92, 246, 0.85)';
          ctx.fillRect(x, chTop + 4 + p.lane * (chH - 10), 5, 2.5);
        } else {
          ctx.fillStyle = 'rgba(217, 119, 6, 0.9)';
          ctx.fillRect(x, pTop + 3 + p.lane * (pH - 8), 5, 2.5);
        }
      });

      node(ctx, leftX, chTop - 8, nodeW, nodeH, 'SMs + L2', 'compute', 'rgba(45, 212, 191, 0.5)');
      node(ctx, rightX, chTop - 8, nodeW, nodeH, 'VRAM', 'GDDR7', 'rgba(139, 92, 246, 0.55)');

      ctx.fillStyle = C.muted;
      ctx.font = '600 11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      var midX = (leftX + nodeW + rightX) / 2;
      ctx.fillText('~1,800 GB/s', midX, chTop - 6);
      ctx.fillText('PCIe to system RAM  ~64 GB/s', midX, pTop - 6);
    }

    var loop = makeLoop(function (t, dt) { drawFrame(dt); });
    onScreen(canvas,
      function () { if (!reduced()) { loop.start(); } else { drawFrame(0); } },
      function () { loop.stop(); });
  }

  /* ==========================================================================
     06 — Matrix multiplication
     ========================================================================== */

  function initMatmul() {
    var elA = $('#gx-mm-a');
    if (!elA) { return; }
    var elB = $('#gx-mm-b'), elC = $('#gx-mm-c');
    var read = $('#gx-mm-read'), macs = $('#gx-mm-macs');

    var Am = [[2, 0, 1, 3], [1, 4, 0, 2], [0, 1, 3, 1], [2, 2, 1, 0]];
    var Bm = [[1, 2, 0, 1], [0, 1, 3, 2], [4, 0, 1, 1], [1, 3, 2, 0]];

    function build(el, m, empty) {
      el.innerHTML = '';
      var cells = [];
      for (var i = 0; i < 4; i++) {
        for (var j = 0; j < 4; j++) {
          var c = document.createElement('span');
          c.className = 'gx-mm-cell';
          c.textContent = empty ? '' : m[i][j];
          el.appendChild(c);
          cells.push(c);
        }
      }
      return cells;
    }

    var cellsA = build(elA, Am), cellsB = build(elB, Bm), cellsC = build(elC, null, true);
    var step = 0, macCount = 0, timer = null;

    function clearHl() {
      cellsA.concat(cellsB, cellsC).forEach(function (c) { c.classList.remove('is-hl', 'is-target'); });
    }

    function doStep() {
      if (step >= 16) { return false; }
      var i = Math.floor(step / 4), j = step % 4;
      clearHl();
      var terms = [], sum = 0;
      for (var k = 0; k < 4; k++) {
        cellsA[i * 4 + k].classList.add('is-hl');
        cellsB[k * 4 + j].classList.add('is-hl');
        terms.push(Am[i][k] + '·' + Bm[k][j]);
        sum += Am[i][k] * Bm[k][j];
      }
      var target = cellsC[i * 4 + j];
      target.classList.add('is-target', 'is-done');
      target.textContent = sum;
      macCount += 4;
      macs.textContent = fmtInt(macCount);
      read.textContent = 'C[' + i + '][' + j + '] = ' + terms.join(' + ') + ' = ' + sum;
      step++;
      if (step >= 16) {
        read.textContent = '64 multiply-accumulates for one tiny 4×4 tile — a tensor core does this in a single operation.';
        clearHl();
        return false;
      }
      return true;
    }

    function reset() {
      if (timer) { clearInterval(timer); timer = null; }
      $('#gx-mm-play').textContent = 'Play';
      step = 0; macCount = 0;
      macs.textContent = '0';
      cellsC.forEach(function (c) { c.textContent = ''; c.classList.remove('is-done'); });
      clearHl();
      read.textContent = 'Press play: each output cell is one row of A dotted with one column of B.';
    }

    function play() {
      if (timer) { // pause
        clearInterval(timer); timer = null;
        $('#gx-mm-play').textContent = 'Play';
        return;
      }
      if (step >= 16) { reset(); }
      if (reduced()) {
        while (doStep()) { /* run out synchronously */ }
        return;
      }
      $('#gx-mm-play').textContent = 'Pause';
      timer = setInterval(function () {
        if (!doStep()) { clearInterval(timer); timer = null; $('#gx-mm-play').textContent = 'Play'; }
      }, 620);
    }

    $('#gx-mm-play').addEventListener('click', play);
    $('#gx-mm-step').addEventListener('click', function () {
      if (timer) { clearInterval(timer); timer = null; $('#gx-mm-play').textContent = 'Play'; }
      if (step >= 16) { reset(); }
      doStep();
    });
    $('#gx-mm-reset').addEventListener('click', reset);
  }

  /* ==========================================================================
     07 — Ray tracing vs rasterization
     ========================================================================== */

  function initRT() {
    var canvas = $('#gx-rt-canvas');
    if (!canvas) { return; }

    var W = 224, H = 126;
    var buf = document.createElement('canvas');
    buf.width = W; buf.height = H;
    var bctx = buf.getContext('2d');
    var img = bctx.createImageData(W, H);

    var giSum = new Float32Array(W * H);
    var giCnt = 0;
    var GI_CAP = 22;

    var divider = 50;
    var opts = { shadows: true, reflect: true, gi: true };
    var raysOut = $('#gx-rt-rays');
    var rayCount = 0;

    // scene
    var LX = -0.47, LY = 0.78, LZ = -0.41;
    (function () { var l = Math.hypot(LX, LY, LZ); LX /= l; LY /= l; LZ /= l; })();
    var spheres = [
      { x: 0.1, y: 1.02, z: 1.35, r: 1.02, mirror: true, col: [200, 214, 225] },
      { x: -1.85, y: 0.55, z: 0.45, r: 0.55, mirror: false, col: [24, 170, 155] },
      { x: 1.62, y: 0.42, z: -0.1, r: 0.42, mirror: false, col: [214, 60, 90] }
    ];
    var CAMX = 0, CAMY = 1.1, CAMZ = -3.6;

    function sky(dx, dy, dz) {
      var t = clamp(dy * 1.7 + 0.32, 0, 1);
      var r = 13 + (30 - 13) * (1 - t), g = 22 + (58 - 22) * (1 - t), b = 40 + (82 - 40) * (1 - t);
      var s = Math.max(0, dx * LX + dy * LY + dz * LZ);
      s = Math.pow(s, 24) * 110;
      return [r + s, g + s * 0.92, b + s * 0.7];
    }

    // returns [t, sphereIndex] or plane hit (index -1); -2 = miss
    function intersect(ox, oy, oz, dx, dy, dz, skip) {
      var bestT = 1e9, best = -2;
      for (var i = 0; i < 3; i++) {
        if (i === skip) { continue; }
        var s = spheres[i];
        var lx = s.x - ox, ly = s.y - oy, lz = s.z - oz;
        var b = lx * dx + ly * dy + lz * dz;
        var d2 = lx * lx + ly * ly + lz * lz - b * b;
        var r2 = s.r * s.r;
        if (d2 > r2) { continue; }
        var det = Math.sqrt(r2 - d2);
        var t = b - det;
        if (t < 1e-4) { t = b + det; }
        if (t > 1e-4 && t < bestT) { bestT = t; best = i; }
      }
      if (dy < -1e-6) {
        var tp = -oy / dy;
        if (tp > 1e-4 && tp < bestT) { bestT = tp; best = -1; }
      }
      return best === -2 ? null : [bestT, best];
    }

    function shadowed(px2, py2, pz2, skip) {
      rayCount++;
      return intersect(px2 + LX * 0.01, py2 + LY * 0.01, pz2 + LZ * 0.01, LX, LY, LZ, -9) !== null;
    }

    function shade(ox, oy, oz, dx, dy, dz, rtSide, depth, pixelIdx) {
      var hit = intersect(ox, oy, oz, dx, dy, dz, -9);
      if (!hit) { return sky(dx, dy, dz); }
      var t = hit[0], id = hit[1];
      var px2 = ox + dx * t, py2 = oy + dy * t, pz2 = oz + dz * t;
      var nx, ny, nz, alb;

      if (id === -1) {
        nx = 0; ny = 1; nz = 0;
        var check = ((Math.floor(px2 * 1.05) + Math.floor(pz2 * 1.05)) & 1);
        alb = check ? [46, 60, 86] : [28, 38, 58];
      } else {
        var s = spheres[id];
        nx = (px2 - s.x) / s.r; ny = (py2 - s.y) / s.r; nz = (pz2 - s.z) / s.r;
        alb = s.col;
      }

      // mirror sphere
      if (id === 0 && depth < 1) {
        var dot2 = dx * nx + dy * ny + dz * nz;
        var rx = dx - 2 * dot2 * nx, ry = dy - 2 * dot2 * ny, rz = dz - 2 * dot2 * nz;
        if (rtSide && opts.reflect) {
          rayCount++;
          var rc = shade(px2 + rx * 0.01, py2 + ry * 0.01, pz2 + rz * 0.01, rx, ry, rz, true, depth + 1, -1);
          return [rc[0] * 0.82 + 16, rc[1] * 0.82 + 18, rc[2] * 0.82 + 20];
        }
        var env = sky(rx, ry, rz); // raster fake: environment map only
        return [env[0] * 0.8 + 22, env[1] * 0.8 + 24, env[2] * 0.8 + 26];
      }

      var nl = Math.max(0, nx * LX + ny * LY + nz * LZ);
      var sh = 1;
      if (rtSide) {
        if (opts.shadows && nl > 0 && shadowed(px2, py2, pz2, id)) { sh = 0; }
      } else if (id === -1) {
        // raster fake: blob shadows under spheres
        for (var i = 0; i < 3; i++) {
          var sp = spheres[i];
          var dxx = px2 - sp.x, dzz = pz2 - sp.z;
          var dd = Math.sqrt(dxx * dxx + dzz * dzz) / (sp.r * 1.5);
          if (dd < 1) { sh *= 0.45 + 0.55 * dd * dd; }
        }
      }

      var amb = 0.34;
      if (rtSide && opts.gi && pixelIdx >= 0 && giCnt > 0) {
        amb = 0.1 + 0.5 * (giSum[pixelIdx] / giCnt);
      }

      var k = amb + 0.78 * nl * sh;
      var out = [alb[0] * k, alb[1] * k, alb[2] * k];

      // specular
      if (id >= 0 && sh > 0.5) {
        var rdx = LX - 2 * nl * nx, rdy = LY - 2 * nl * ny, rdz = LZ - 2 * nl * nz;
        var spec = Math.max(0, -(rdx * dx + rdy * dy + rdz * dz));
        spec = Math.pow(spec, 34) * 90;
        out[0] += spec; out[1] += spec; out[2] += spec;
      }
      return out;
    }

    function giSample() {
      // one ambient-visibility sample per pixel per frame, accumulated
      if (giCnt >= GI_CAP) { return; }
      var aspect = W / H;
      for (var y = 0; y < H; y++) {
        for (var x = 0; x < W; x++) {
          var u = ((x + 0.5) / W) * 2 - 1, v = 1 - ((y + 0.5) / H) * 2;
          var dx = u * 0.62 * aspect, dy = v * 0.62, dz = 1;
          var il = 1 / Math.hypot(dx, dy, dz);
          dx *= il; dy *= il; dz *= il;
          var hit = intersect(CAMX, CAMY, CAMZ, dx, dy, dz, -9);
          var idx = y * W + x;
          if (!hit) { giSum[idx] += 1; continue; }
          var t = hit[0], id = hit[1];
          var px2 = CAMX + dx * t, py2 = CAMY + dy * t, pz2 = CAMZ + dz * t;
          var nx, ny, nz;
          if (id === -1) { nx = 0; ny = 1; nz = 0; }
          else { var s = spheres[id]; nx = (px2 - s.x) / s.r; ny = (py2 - s.y) / s.r; nz = (pz2 - s.z) / s.r; }
          // cosine-ish hemisphere sample
          var rx = nx + (Math.random() * 2 - 1) * 0.9;
          var ry = ny + (Math.random() * 2 - 1) * 0.9;
          var rz = nz + (Math.random() * 2 - 1) * 0.9;
          var rl = 1 / Math.hypot(rx, ry, rz);
          rx *= rl; ry *= rl; rz *= rl;
          if (rx * nx + ry * ny + rz * nz < 0) { rx = -rx; ry = -ry; rz = -rz; }
          rayCount++;
          var occ = intersect(px2 + rx * 0.02, py2 + ry * 0.02, pz2 + rz * 0.02, rx, ry, rz, -9);
          giSum[idx] += (occ && occ[0] < 2.2) ? 0 : 1;
        }
      }
      giCnt++;
    }

    var cv = setupCanvas(canvas, function () { dirty = true; });
    var dirty = true;

    function renderFrame() {
      rayCount = 0;
      if (opts.gi) { giSample(); }
      var aspect = W / H;
      var splitX = Math.round(W * divider / 100);
      var d = img.data;
      var p = 0;
      for (var y = 0; y < H; y++) {
        for (var x = 0; x < W; x++) {
          var u = ((x + 0.5) / W) * 2 - 1, v = 1 - ((y + 0.5) / H) * 2;
          var dx = u * 0.62 * aspect, dy = v * 0.62, dz = 1;
          var il = 1 / Math.hypot(dx, dy, dz);
          dx *= il; dy *= il; dz *= il;
          rayCount++;
          var col = shade(CAMX, CAMY, CAMZ, dx, dy, dz, x >= splitX, 0, y * W + x);
          d[p] = col[0] > 255 ? 255 : col[0];
          d[p + 1] = col[1] > 255 ? 255 : col[1];
          d[p + 2] = col[2] > 255 ? 255 : col[2];
          d[p + 3] = 255;
          p += 4;
        }
      }
      bctx.putImageData(img, 0, 0);

      var ctx = cv.ctx, w = cv.state.w, h = cv.state.h;
      ctx.imageSmoothingEnabled = true;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(buf, 0, 0, w, h);

      // divider line + handle
      var lx = w * divider / 100;
      ctx.fillStyle = 'rgba(45, 212, 191, 0.9)';
      ctx.fillRect(lx - 1, 0, 2, h);
      ctx.beginPath();
      ctx.arc(lx, h / 2, 11, 0, 7);
      ctx.fillStyle = '#0b1120';
      ctx.fill();
      ctx.strokeStyle = C.teal;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = C.teal;
      ctx.font = '700 10px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('↔', lx, h / 2 + 0.5);
      ctx.textBaseline = 'alphabetic';

      raysOut.textContent = '~' + fmtInt(rayCount);
    }

    var loop = makeLoop(function () {
      var converged = !opts.gi || giCnt >= GI_CAP;
      if (!dirty && converged) { loop.stop(); return; }
      renderFrame();
      dirty = false;
    });

    function poke() { dirty = true; if (visible) { loop.start(); } }

    function resetGI() { giSum.fill(0); giCnt = 0; }

    var visible = false;
    onScreen(canvas,
      function () {
        visible = true;
        if (reduced()) {
          // converge synchronously, then draw once
          if (opts.gi) { while (giCnt < GI_CAP) { giSample(); } }
          renderFrame();
        } else { loop.start(); }
      },
      function () { visible = false; loop.stop(); });

    // divider control: range input + direct canvas drag
    var range = $('#gx-rt-divider');
    range.addEventListener('input', function () {
      divider = parseFloat(range.value);
      poke();
    });
    function dragTo(clientX) {
      var rect = canvas.getBoundingClientRect();
      divider = clamp(((clientX - rect.left) / rect.width) * 100, 5, 95);
      range.value = String(Math.round(divider));
      poke();
    }
    canvas.addEventListener('pointerdown', function (e) {
      canvas.setPointerCapture(e.pointerId);
      dragTo(e.clientX);
      function move(ev) { dragTo(ev.clientX); }
      function up() {
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', up);
        canvas.removeEventListener('pointercancel', up);
      }
      canvas.addEventListener('pointermove', move);
      canvas.addEventListener('pointerup', up);
      canvas.addEventListener('pointercancel', up);
    });

    [['#gx-rt-shadows', 'shadows'], ['#gx-rt-reflect', 'reflect'], ['#gx-rt-gi', 'gi']].forEach(function (pair) {
      var el = $(pair[0]);
      el.addEventListener('change', function () {
        opts[pair[1]] = el.checked;
        resetGI();
        if (reduced() && opts.gi) { while (giCnt < GI_CAP) { giSample(); } }
        poke();
        if (reduced()) { renderFrame(); }
      });
    });
  }

  /* ==========================================================================
     08 — Architecture widgets
     ========================================================================== */

  function initDivergence() {
    var passes = $('#gx-div-passes');
    if (!passes) { return; }
    var note = $('#gx-div-note');

    function lane(active) {
      return '<span class="gx-th' + (active ? '' : ' is-masked') + '"></span>';
    }

    function row(labelText, activeFn) {
      var lanes = '';
      for (var i = 0; i < 32; i++) { lanes += lane(activeFn(i)); }
      return '<div class="gx-pass"><span class="gx-pass-label">' + labelText + '</span><span class="gx-pass-lanes">' + lanes + '</span></div>';
    }

    function apply(mode) {
      if (mode === 'uniform') {
        passes.innerHTML = row('1 pass · path A', function () { return true; });
        note.innerHTML = 'All 32 threads chose the same path: <strong>one pass, full speed</strong>. Warps that agree are free.';
      } else {
        passes.innerHTML =
          row('pass 1 · path A', function (i) { return i % 2 === 0; }) +
          row('pass 2 · path B', function (i) { return i % 2 === 1; });
        note.innerHTML = 'Threads disagreed: the warp ran <strong>both paths with half the lanes masked — 2× the cycles</strong> for the same work. This is branch divergence.';
      }
    }

    $$('#gx-div-mode button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$('#gx-div-mode button').forEach(function (b) { b.setAttribute('aria-pressed', String(b === btn)); });
        apply(btn.getAttribute('data-div'));
      });
    });
    apply('uniform');
  }

  function initOccupancy() {
    var slider = $('#gx-occ-regs');
    if (!slider) { return; }
    var out = $('#gx-occ-regs-out'), slots = $('#gx-occ-slots'), note = $('#gx-occ-note');
    var MAX_WARPS = 48, REGFILE = 65536;

    var cells = [];
    slots.innerHTML = '';
    for (var i = 0; i < MAX_WARPS; i++) {
      var c = document.createElement('span');
      c.className = 'gx-occ-slot';
      slots.appendChild(c);
      cells.push(c);
    }

    function update() {
      var regs = parseInt(slider.value, 10);
      out.textContent = String(regs);
      var warps = Math.min(MAX_WARPS, Math.floor(REGFILE / (regs * 32)));
      cells.forEach(function (c, idx) { c.classList.toggle('is-filled', idx < warps); });
      var pct = Math.round(100 * warps / MAX_WARPS);
      var msg = '<strong>' + warps + ' of ' + MAX_WARPS + ' warp slots filled (' + pct + '% occupancy).</strong> ';
      if (pct === 100) { msg += 'Plenty of warps to swap in whenever one stalls on memory.'; }
      else if (pct >= 50) { msg += 'Still enough parallelism to hide most memory stalls.'; }
      else { msg += 'A register-hungry kernel: with few warps resident, memory stalls start reaching the ALUs.'; }
      note.innerHTML = msg;
    }

    slider.addEventListener('input', update);
    update();
  }

  function initCoalescing() {
    var viz = $('#gx-coal-viz');
    if (!viz) { return; }
    var note = $('#gx-coal-note');

    function render(mode) {
      var threads = '';
      for (var i = 0; i < 32; i++) { threads += '<span class="gx-coal-thread"></span>'; }
      var sectors = '';
      if (mode === 'coalesced') {
        for (i = 0; i < 8; i++) {
          sectors += '<span class="gx-coal-sector' + (i < 4 ? ' is-hit' : '') + '"></span>';
        }
      } else {
        for (i = 0; i < 16; i++) { sectors += '<span class="gx-coal-sector is-hit"></span>'; }
        sectors += '<span class="gx-coal-more">+16 more</span>';
      }
      viz.innerHTML =
        '<p class="gx-coal-row-label">32 threads, one 4-byte load each</p>' +
        '<div class="gx-coal-threads">' + threads + '</div>' +
        '<p class="gx-coal-row-label">32-byte memory transactions needed</p>' +
        '<div class="gx-coal-sectors">' + sectors + '</div>';
      note.innerHTML = mode === 'coalesced'
        ? '<strong>4 transactions, 128 B moved, 128 B used.</strong> Adjacent threads hit adjacent addresses, so the hardware merges the whole warp into one cache line.'
        : '<strong>32 transactions, 1,024 B moved for 128 B used — 8× wasted bandwidth.</strong> Each thread landed in its own 32-byte sector. Same instruction, same data volume, one eighth the effective bandwidth.';
    }

    $$('#gx-coal-mode button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$('#gx-coal-mode button').forEach(function (b) { b.setAttribute('aria-pressed', String(b === btn)); });
        render(btn.getAttribute('data-coal'));
      });
    });
    render('coalesced');
  }

  /* ==========================================================================
     10 — Timeline nav
     ========================================================================== */

  function initTimeline() {
    var tl = $('#gx-timeline');
    if (!tl) { return; }
    function scrollByCards(dir) {
      var card = tl.querySelector('.gx-era');
      var step = card ? (card.getBoundingClientRect().width + 16) * 2 : 500;
      tl.scrollBy({ left: dir * step, behavior: reduced() ? 'auto' : 'smooth' });
    }
    $('#gx-tl-prev').addEventListener('click', function () { scrollByCards(-1); });
    $('#gx-tl-next').addEventListener('click', function () { scrollByCards(1); });
  }

  /* ==========================================================================
     11 — Playground
     ========================================================================== */

  function initPlayground() {
    var canvas = $('#gx-pg-canvas');
    if (!canvas) { return; }

    var els = {
      sms: $('#gx-pg-sms'), clock: $('#gx-pg-clock'), bw: $('#gx-pg-bw'),
      vram: $('#gx-pg-vram'), data: $('#gx-pg-data'), preset: $('#gx-pg-preset'),
      peak: $('#gx-pg-peak'), total: $('#gx-pg-total'), verdict: $('#gx-pg-verdict'),
      bars: {
        compute: $('.gx-bar-row[data-bar="compute"]'),
        memory: $('.gx-bar-row[data-bar="memory"]'),
        pcie: $('.gx-bar-row[data-bar="pcie"]')
      }
    };

    function val(el) { return parseFloat(el.value); }

    function model() {
      var sms = val(els.sms), clock = val(els.clock), bw = val(els.bw);
      var vram = val(els.vram), dataGB = val(els.data), intensity = parseFloat(els.preset.value);
      var peakFlops = sms * 128 * 2 * clock * 1e9;
      var flops = dataGB * 1e9 * intensity;
      var tC = flops / peakFlops;
      var tM = dataGB / bw;
      var over = Math.max(0, dataGB - vram);
      var tP = over / 32; // PCIe 5.0 x16 practical ~32 GB/s sustained
      return {
        sms: sms, clock: clock, bw: bw, vram: vram, dataGB: dataGB, intensity: intensity,
        peakT: peakFlops / 1e12, tC: tC, tM: tM, tP: tP, over: over,
        total: Math.max(tC, tM) + tP
      };
    }

    function updatePeak() {
      var m = model();
      els.peak.textContent = 'Your design: ' + m.peakT.toFixed(1) + ' TFLOPS FP32 peak · ' +
        fmtInt(m.bw) + ' GB/s · ' + m.vram + ' GB VRAM · ridge at ' +
        (m.peakT * 1000 / m.bw).toFixed(1) + ' FLOP/byte';
      drawRoof(lastRun);
    }

    // slider outputs
    [['sms', 'gx-pg-sms-out', 0], ['clock', 'gx-pg-clock-out', 1], ['bw', 'gx-pg-bw-out', 0], ['vram', 'gx-pg-vram-out', 0], ['data', 'gx-pg-data-out', 0]].forEach(function (row) {
      var input = els[row[0]], out = document.getElementById(row[1]);
      input.addEventListener('input', function () {
        out.textContent = val(input).toFixed(row[2]);
        updatePeak();
      });
    });
    els.preset.addEventListener('change', updatePeak);

    var cv = setupCanvas(canvas, function () { drawSim(lastRun, 1); });
    var roofCv = setupCanvas($('#gx-pg-roof'), function () { drawRoof(lastRun); });
    var lastRun = null;

    function drawSim(m, progress) {
      var ctx = cv.ctx, w = cv.state.w, h = cv.state.h;
      ctx.clearRect(0, 0, w, h);
      if (!m) {
        ctx.fillStyle = C.faint;
        ctx.font = '600 13px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Press "Run simulation"', w / 2, h / 2);
        return;
      }
      var tMax = Math.max(m.tC, m.tM);
      var cUtil = tMax > 0 ? m.tC / tMax : 1;
      var mUtil = tMax > 0 ? m.tM / tMax : 1;
      var now = performance.now();

      // SM grid
      var pad = 14, gridH = h * 0.62;
      var cols = 16, rows = Math.ceil(m.sms / cols);
      var cell = Math.min((w - pad * 2) / cols, (gridH - pad) / rows);
      var ox = (w - cell * cols) / 2, oy = pad + 12;
      ctx.font = '600 10px Inter, sans-serif';
      ctx.fillStyle = C.faint;
      ctx.textAlign = 'left';
      ctx.fillText('SMs × ' + m.sms + ' — ' + Math.round(cUtil * 100) + '% busy (' + (cUtil < 1 ? 'waiting on memory' : 'fully fed') + ')', ox, oy - 5);
      for (var i = 0; i < m.sms; i++) {
        var x = ox + (i % cols) * cell, y = oy + Math.floor(i / cols) * cell;
        var phase = (i * 37) % 100 / 100;
        var busy = progress < 1 && ((phase + now / 900) % 1) < cUtil * 0.96;
        if (progress >= 1) { busy = false; }
        ctx.fillStyle = busy || (progress >= 1 && phase < cUtil)
          ? 'rgba(13, 148, 136, ' + (0.45 + 0.5 * cUtil) + ')'
          : 'rgba(30, 41, 59, 0.65)';
        ctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
      }

      // memory channel
      var chY = oy + rows * cell + 16, chH = Math.min(30, h - chY - 26);
      if (chH > 8) {
        ctx.fillStyle = 'rgba(139, 92, 246, 0.09)';
        ctx.fillRect(ox, chY, cell * cols, chH);
        var n = Math.round(6 + mUtil * 40);
        ctx.fillStyle = 'rgba(139, 92, 246, 0.9)';
        for (i = 0; i < n; i++) {
          var t = ((i / n) + (progress < 1 ? now / (900 - 600 * mUtil) : 0)) % 1;
          ctx.fillRect(ox + t * cell * cols, chY + 3 + ((i * 53) % (chH - 8)), 5, 2.5);
        }
        ctx.fillStyle = C.faint;
        ctx.fillText('VRAM bus — ' + Math.round(mUtil * 100) + '% saturated', ox, chY + chH + 12);
      }

      // spill warning lane
      if (m.over > 0) {
        ctx.fillStyle = 'rgba(217, 119, 6, 0.85)';
        ctx.font = '700 11px Inter, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('! ' + m.over + ' GB spilling over PCIe', w - pad, 20);
      }

      // progress
      if (progress < 1) {
        ctx.fillStyle = 'rgba(45, 212, 191, 0.25)';
        ctx.fillRect(0, h - 4, w * progress, 4);
      }
    }

    function setBar(rowEl, t, tMax, show) {
      var fill = rowEl.querySelector('.gx-bar-track i');
      var valEl = rowEl.querySelector('.gx-bar-val');
      if (!show) {
        fill.style.width = '0%';
        valEl.textContent = '—';
        return;
      }
      fill.style.width = clamp(100 * t / tMax, 1.5, 100) + '%';
      valEl.textContent = fmtSeconds(t);
    }

    function drawRoof(m) {
      var rc = roofCv.ctx, w = roofCv.state.w, h = roofCv.state.h;
      if (w < 10) { return; }
      rc.clearRect(0, 0, w, h);
      var cur = model();
      var peakG = cur.peakT * 1000;
      var L = 56, R = 14, T = 16, B = 34;
      var pw = w - L - R, ph = h - T - B;
      var xMin = -1, xMax = 3;         // log10 FLOP/byte
      var yMax = Math.log10(peakG * 2.2), yMin = Math.max(1, yMax - 4);

      function X(logI) { return L + (logI - xMin) / (xMax - xMin) * pw; }
      function Y(logP) { return T + (yMax - logP) / (yMax - yMin) * ph; }

      // grid + labels
      rc.strokeStyle = 'rgba(30, 41, 59, 0.9)';
      rc.fillStyle = C.faint;
      rc.font = '500 10px "JetBrains Mono", monospace';
      rc.textAlign = 'center';
      rc.lineWidth = 1;
      for (var e = xMin; e <= xMax; e++) {
        var x = X(e);
        rc.beginPath(); rc.moveTo(x, T); rc.lineTo(x, T + ph); rc.stroke();
        rc.fillText(String(Math.pow(10, e)), x, h - 18);
      }
      rc.textAlign = 'right';
      for (e = Math.ceil(yMin); e <= Math.floor(yMax); e++) {
        var y = Y(e);
        rc.beginPath(); rc.moveTo(L, y); rc.lineTo(L + pw, y); rc.stroke();
        rc.fillText(e >= 3 ? Math.pow(10, e - 3) + ' T' : Math.pow(10, e) + ' G', L - 6, y + 3);
      }
      rc.textAlign = 'center';
      rc.fillText('arithmetic intensity (FLOP/byte)', L + pw / 2, h - 5);

      // memory roof: perf = I * bw  ->  log(perf) = log I + log bw
      var logBW = Math.log10(cur.bw);
      var ridge = Math.log10(peakG) - logBW; // log10 of ridge intensity
      rc.strokeStyle = C.violet;
      rc.lineWidth = 2;
      rc.beginPath();
      var x0 = xMin, y0 = x0 + logBW;
      rc.moveTo(X(x0), Y(Math.max(yMin, y0)));
      rc.lineTo(X(Math.min(ridge, xMax)), Y(Math.min(ridge, xMax) + logBW));
      rc.stroke();
      // compute roof
      rc.strokeStyle = C.cTeal;
      rc.beginPath();
      rc.moveTo(X(Math.max(ridge, xMin)), Y(Math.log10(peakG)));
      rc.lineTo(X(xMax), Y(Math.log10(peakG)));
      rc.stroke();

      rc.fillStyle = C.muted;
      rc.font = '600 10px Inter, sans-serif';
      rc.textAlign = 'left';
      rc.fillText('memory-bound', L + 8, T + 14);
      rc.textAlign = 'right';
      rc.fillText('compute-bound', L + pw - 8, Y(Math.log10(peakG)) - 8);

      // the workload dot
      if (m) {
        var effG = (m.dataGB * 1e9 * m.intensity) / m.total / 1e9;
        var dx = X(clamp(Math.log10(m.intensity), xMin, xMax));
        var dy = Y(clamp(Math.log10(Math.max(1, effG)), yMin, yMax));
        rc.beginPath();
        rc.arc(dx, dy, 6, 0, 7);
        rc.fillStyle = C.strong;
        rc.fill();
        rc.strokeStyle = C.teal;
        rc.lineWidth = 2;
        rc.stroke();
        rc.fillStyle = C.text;
        rc.font = '600 10px Inter, sans-serif';
        rc.textAlign = dx > w / 2 ? 'right' : 'left';
        rc.fillText('your run', dx + (dx > w / 2 ? -10 : 10), dy - 8);
      }
    }

    var animStart = 0;
    var loop = makeLoop(function (t) {
      var progress = clamp((t - animStart) / 2400, 0, 1);
      drawSim(lastRun, progress);
      if (progress >= 1) { loop.stop(); drawSim(lastRun, 1); }
    });

    function run() {
      var m = model();
      lastRun = m;
      var tMax = Math.max(m.tC, m.tM, m.tP, 1e-9);
      setBar(els.bars.compute, m.tC, tMax, true);
      setBar(els.bars.memory, m.tM, tMax, true);
      setBar(els.bars.pcie, m.tP, tMax, m.tP > 0);
      els.total.textContent = fmtSeconds(m.total);

      var v = els.verdict;
      v.classList.remove('is-mem', 'is-spill');
      var util = Math.round(100 * m.tC / Math.max(m.tC, m.tM));
      if (m.over > 0) {
        v.classList.add('is-spill');
        v.innerHTML = '<strong>VRAM overflow.</strong> ' + m.dataGB + ' GB of data in ' + m.vram +
          ' GB of VRAM: ' + m.over + ' GB pages across PCIe at ~32 GB/s, adding ' + fmtSeconds(m.tP) +
          '. Until the workload fits, no other slider matters.';
      } else if (m.tM > m.tC * 1.15) {
        v.classList.add('is-mem');
        v.innerHTML = '<strong>Memory-bound.</strong> The bus needs ' + fmtSeconds(m.tM) + ' but the math only ' +
          fmtSeconds(m.tC) + ' — your SMs sit at ~' + util + '% utilization waiting for data. More bandwidth (or more reuse per byte) helps; more cores will not.';
      } else if (m.tC > m.tM * 1.15) {
        v.innerHTML = '<strong>Compute-bound.</strong> The lanes are saturated and the bus has slack — here more SMs and higher clocks pay off almost linearly. This is where GPUs love to live.';
      } else {
        v.innerHTML = '<strong>Balanced.</strong> Compute and memory finish nearly together — the design point architects aim for. Any cheaper component would become the bottleneck.';
      }

      drawRoof(m);
      if (reduced()) { drawSim(m, 1); return; }
      animStart = performance.now();
      loop.start();
    }

    $('#gx-pg-run').addEventListener('click', run);
    onScreen(canvas, function () { if (!lastRun) { run(); } }, function () { loop.stop(); });
    updatePeak();
    drawSim(null, 1);
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
      initReveal, initRail, initHero, initRace, initDie, initParallel,
      initPipeline, initMemory, initMatmul, initRT, initDivergence,
      initOccupancy, initCoalescing, initTimeline, initPlayground
    ];
    var failed = [];

    function tryInit(fn) {
      try { fn(); } catch (err) {
        failed.push(fn);
        if (window.console && console.error) { console.error('gpu.js: ' + (fn.name || 'init') + ' failed', err); }
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
