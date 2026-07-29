/* =============================================================================
   Understanding Machine Learning — interactivity
   Vanilla JS, no dependencies. Loaded with `defer` on /machine-learning/ only.

   Structure:
     1. Shared utilities (canvas fitting, visibility gating, rAF loops) —
        the same toolkit as the other exhibits
     2. One init function per widget, each guarded by element existence and
        wrapped in try/catch so one failure never takes down the page
     3. Everything respects prefers-reduced-motion: ambient animation is
        disabled and story animations jump to labeled final states

   Honesty notes: the supervised classifier (logistic regression), the
   k-means clusterer, the Q-learning maze, the gradient-descent runner, the
   polynomial over/underfitting fitter, and the ML Lab's tiny neural network
   are real implementations of the real algorithms — small, but genuinely
   computing. The hero scene, the paradigm animation, and the data-leakage
   numbers are honest cartoons built to teach concepts; the captions in the
   HTML say so where it matters.
   ============================================================================ */

(function () {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  document.documentElement.classList.add('ml-js');

  var RM = window.matchMedia('(prefers-reduced-motion: reduce)');
  function reduced() { return RM.matches; }

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
  var SERIES = [C.cTeal, C.amber, C.sky, C.rose, C.violet, C.lime];

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

  function onScreen(el, enter, leave) {
    if (!('IntersectionObserver' in window)) { if (enter) { enter(); } return; }
    new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { if (enter) { enter(); } }
        else if (leave) { leave(); }
      });
    }, { threshold: 0.12 }).observe(el);
  }

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

  function makeRng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function gauss(rng) {
    var u = Math.max(rng(), 1e-9);
    var v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function fmt(v, d) {
    if (!isFinite(v)) { return '∞'; }
    return v.toFixed(d === undefined ? 2 : d);
  }

  /* Simple linear system solver (Gaussian elimination w/ partial pivoting). */
  function solveLinear(A, b) {
    var n = b.length;
    var M = A.map(function (row, i) { return row.concat([b[i]]); });
    for (var col = 0; col < n; col++) {
      var piv = col;
      for (var r = col + 1; r < n; r++) {
        if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) { piv = r; }
      }
      if (Math.abs(M[piv][col]) < 1e-12) { return null; }
      var tmp = M[col]; M[col] = M[piv]; M[piv] = tmp;
      for (var r2 = 0; r2 < n; r2++) {
        if (r2 === col) { continue; }
        var f = M[r2][col] / M[col][col];
        for (var c2 = col; c2 <= n; c2++) { M[r2][c2] -= f * M[col][c2]; }
      }
    }
    return M.map(function (row, i) { return row[n] / M[i][i]; });
  }

  /* Shared plot helpers */
  function drawFrameAxes(ctx, w, h, pad, xLabel, yLabel) {
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1;
    ctx.strokeRect(pad, pad, w - 2 * pad, h - 2 * pad);
    ctx.fillStyle = C.faint;
    ctx.font = '600 11px Inter, sans-serif';
    if (xLabel) {
      ctx.textAlign = 'center';
      ctx.fillText(xLabel, w / 2, h - 8);
    }
    if (yLabel) {
      ctx.save();
      ctx.translate(12, h / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillText(yLabel, 0, 0);
      ctx.restore();
    }
  }

  /* ==========================================================================
     Reveal-on-scroll + chapter rail
     ========================================================================== */

  function initReveal() {
    var targets = $$('#ml-experience [data-ml-reveal]');
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
    var dots = $$('#ml-experience .ml-rail-dot');
    if (!dots.length || !('IntersectionObserver' in window)) { return; }
    var map = {};
    dots.forEach(function (d) {
      var id = (d.getAttribute('href') || '').slice(1);
      if (id) { map[id] = d; }
    });
    var current = null;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) { return; }
        var dot = map[e.target.id];
        if (!dot) { return; }
        if (current) { current.classList.remove('is-active'); }
        dot.classList.add('is-active');
        current = dot;
      });
    }, { rootMargin: '-35% 0px -55% 0px' });
    Object.keys(map).forEach(function (id) {
      var sec = document.getElementById(id);
      if (sec) { io.observe(sec); }
    });
  }

  /* ==========================================================================
     HERO — points organize into clusters, a boundary, a regression line
     (honest cartoon)
     ========================================================================== */

  function initHero() {
    var canvas = $('#ml-hero-canvas');
    if (!canvas) { return; }
    var cv = setupCanvas(canvas);
    var ctx = cv.ctx;
    var rng = makeRng(20260729);
    var N = 210;
    var pts = [];

    var clusterCenters = [
      { x: 0.24, y: 0.34, c: C.cTeal },
      { x: 0.56, y: 0.72, c: C.amber },
      { x: 0.8, y: 0.3, c: C.sky }
    ];

    for (var i = 0; i < N; i++) {
      var k = i % 3;
      var cc = clusterCenters[k];
      /* one target per phase, precomputed in unit space */
      var clu = { x: clamp(cc.x + gauss(rng) * 0.065, 0.03, 0.97), y: clamp(cc.y + gauss(rng) * 0.075, 0.05, 0.95) };
      var side = rng() < 0.5 ? 0 : 1;
      var bx = rng();
      var boundaryY = 0.85 - 0.55 * bx;
      var off = 0.06 + rng() * 0.3;
      var cls = { x: bx, y: clamp(boundaryY + (side ? off : -off), 0.05, 0.95) };
      var rx = rng();
      var reg = { x: rx, y: clamp(0.75 - 0.5 * rx + gauss(rng) * 0.05, 0.05, 0.95) };
      pts.push({
        x: rng(), y: rng(),
        targets: [clu, cls, reg],
        colors: [cc.c, side ? C.rose : C.sky, C.amber]
      });
    }

    var PHASES = 3;
    var phase = 0;
    var phaseT = 0;
    var MORPH = 1700;
    var HOLD = 3200;

    function draw(t) {
      var w = cv.state.w, h = cv.state.h;
      ctx.clearRect(0, 0, w, h);
      var p = clamp(phaseT / MORPH, 0, 1);
      var e = easeInOut(p);
      var prev = (phase + PHASES - 1) % PHASES;

      /* overlays: boundary line (phase 1) / regression line (phase 2) */
      var lineAlpha = phaseT > MORPH * 0.7 ? clamp((phaseT - MORPH * 0.7) / 600, 0, 1) : 0;
      if (lineAlpha > 0 && phase === 1) {
        ctx.strokeStyle = 'rgba(45,212,191,' + 0.55 * lineAlpha + ')';
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 7]);
        ctx.beginPath();
        ctx.moveTo(0, 0.85 * h);
        ctx.lineTo(w, (0.85 - 0.55) * h);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (lineAlpha > 0 && phase === 2) {
        ctx.strokeStyle = 'rgba(45,212,191,' + 0.55 * lineAlpha + ')';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, 0.75 * h);
        ctx.lineTo(w, 0.25 * h);
        ctx.stroke();
      }

      for (var i = 0; i < pts.length; i++) {
        var pt = pts[i];
        var a = pt.targets[prev];
        var b = pt.targets[phase];
        var x = (a.x + (b.x - a.x) * e) * w;
        var y = (a.y + (b.y - a.y) * e) * h;
        var col = e > 0.5 ? pt.colors[phase] : pt.colors[prev];
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.75;
        ctx.beginPath();
        ctx.arc(x, y, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    if (reduced()) {
      phase = 0;
      phaseT = MORPH;
      /* static, fully-formed clusters */
      var drawStatic = function () {
        var w = cv.state.w, h = cv.state.h;
        ctx.clearRect(0, 0, w, h);
        pts.forEach(function (pt) {
          ctx.fillStyle = pt.colors[0];
          ctx.globalAlpha = 0.75;
          ctx.beginPath();
          ctx.arc(pt.targets[0].x * w, pt.targets[0].y * h, 2.4, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.globalAlpha = 1;
      };
      drawStatic();
      onScreen(canvas, drawStatic);
      return;
    }

    var loop = makeLoop(function (t, dt) {
      phaseT += dt;
      if (phaseT > MORPH + HOLD) {
        phaseT = 0;
        phase = (phase + 1) % PHASES;
      }
      draw(t);
    });
    onScreen(canvas, function () { loop.start(); }, function () { loop.stop(); });
  }

  /* ==========================================================================
     01 — Paradigm animation (chips light up in sequence)
     ========================================================================== */

  function initParadigm() {
    var btn = $('#ml-par-play');
    if (!btn) { return; }
    var status = $('#ml-par-status');
    var trad = $$('#ml-par-trad .ml-par-chip');
    var ml1 = $$('#ml-par-ml .ml-par-flow:not(.ml-par-flow-2) .ml-par-chip');
    var ml2 = $$('#ml-par-ml .ml-par-flow-2 .ml-par-chip');
    var timers = [];
    var running = false;

    function clearAll() {
      timers.forEach(clearTimeout);
      timers = [];
      $$('#ml-experience .ml-par-chip.is-lit').forEach(function (el) { el.classList.remove('is-lit'); });
    }

    var SCRIPT = [
      { chips: trad, msg: 'Traditional: a human supplies the rules…' },
      { chips: ml1, msg: 'Training: data + answers produce a model…' },
      { chips: ml2, msg: 'Inference: the model predicts on new data.' }
    ];

    btn.addEventListener('click', function () {
      if (running) { return; }
      clearAll();
      if (reduced()) {
        trad.concat(ml1, ml2).forEach(function (el) { el.classList.add('is-lit'); });
        if (status) { status.textContent = 'Rules are written by hand; models are learned from data, then used on new data.'; }
        return;
      }
      running = true;
      var t = 0;
      SCRIPT.forEach(function (stage) {
        timers.push(setTimeout(function () {
          if (status) { status.textContent = stage.msg; }
        }, t));
        stage.chips.forEach(function (chip) {
          timers.push(setTimeout(function () { chip.classList.add('is-lit'); }, t));
          t += 550;
        });
        t += 700;
      });
      timers.push(setTimeout(function () {
        running = false;
        if (status) { status.textContent = 'Same ingredients — opposite direction.'; }
      }, t));
    });
  }

  /* ==========================================================================
     02 — Landscape (nested rings)
     ========================================================================== */

  function initLandscape() {
    var svg = $('#ml-land-svg');
    if (!svg) { return; }
    var infoH = $('#ml-land-info-h');
    var infoP = $('#ml-land-info-p');
    var INFO = {
      ai: {
        h: 'Artificial Intelligence',
        p: 'The broad ambition: machines that do things we consider ' +
          'intelligent. Includes ML, but also older rule-based systems, ' +
          'search, and planning — the whole story is on the ' +
          '<a href="/ai/">Understanding AI</a> exhibit.'
      },
      ml: {
        h: 'Machine Learning',
        p: 'This page. Systems that improve from data instead of being ' +
          'explicitly programmed — spam filters, fraud detection, ' +
          'recommendations. Every technique on this page lives in this ring.'
      },
      dl: {
        h: 'Deep Learning',
        p: 'Machine learning done with many-layered neural networks, which ' +
          'learn their own features from raw data. It is why the field took ' +
          'off after 2012 — and why <a href="/gpu/">GPUs</a> became the ' +
          'hottest hardware on earth.'
      },
      llm: {
        h: 'Large Language Models',
        p: 'Deep learning applied to text at enormous scale. ' +
          '<a href="/chatgpt/">ChatGPT</a> is one; a dedicated LLM exhibit ' +
          'is on this site’s roadmap. Everything they do rests on the ' +
          'training loop you are about to learn.'
      }
    };
    var parts = $$('[data-ring]', svg);

    function activate(key) {
      parts.forEach(function (el) {
        el.classList.toggle('is-active', el.getAttribute('data-ring') === key);
      });
      var info = INFO[key];
      if (info && infoH && infoP) {
        infoH.textContent = info.h;
        infoP.innerHTML = info.p;
      }
    }

    parts.forEach(function (el) {
      var key = el.getAttribute('data-ring');
      el.setAttribute('tabindex', '0');
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', 'Highlight ' + (INFO[key] ? INFO[key].h : key));
      el.addEventListener('mouseenter', function () { activate(key); });
      el.addEventListener('click', function () { activate(key); });
      el.addEventListener('focus', function () { activate(key); });
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(key); }
      });
    });
    activate('ai');
  }

  /* ==========================================================================
     03 — Data builder (least-squares line vs. hidden truth)
     ========================================================================== */

  function initData() {
    var canvas = $('#ml-data-canvas');
    if (!canvas) { return; }
    var cv = setupCanvas(canvas, draw);
    var ctx = cv.ctx;
    var outN = $('#ml-data-n');
    var outErr = $('#ml-data-err');
    var outVerdict = $('#ml-data-verdict');
    var rng = makeRng(7);

    /* world: floor area 50..200 m², price 0..650 k$ */
    var X0 = 50, X1 = 200, Y0 = 0, Y1 = 650;
    function truth(x) { return 30 + 2.4 * x; }

    var pts = [];
    var quality = { noisy: false, outliers: 0, corrupted: 0 };

    function addClean(n, sigma) {
      for (var i = 0; i < n; i++) {
        var x = X0 + rng() * (X1 - X0);
        pts.push({ x: x, y: truth(x) + gauss(rng) * (sigma || 20), kind: 'clean' });
      }
    }

    function reset() {
      pts = [];
      quality = { noisy: false, outliers: 0, corrupted: 0 };
      rng = makeRng(7);
      addClean(14);
      draw();
    }

    function fit() {
      if (pts.length < 2) { return null; }
      var sx = 0, sy = 0, sxx = 0, sxy = 0, n = pts.length;
      pts.forEach(function (p) { sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y; });
      var denom = n * sxx - sx * sx;
      if (Math.abs(denom) < 1e-9) { return null; }
      var m = (n * sxy - sx * sy) / denom;
      var b = (sy - m * sx) / n;
      return { m: m, b: b };
    }

    function px(x, w, pad) { return pad + (x - X0) / (X1 - X0) * (w - 2 * pad); }
    function py(y, h, pad) { return h - pad - (y - Y0) / (Y1 - Y0) * (h - 2 * pad); }

    function draw() {
      var w = cv.state.w, h = cv.state.h, pad = 34;
      ctx.clearRect(0, 0, w, h);
      drawFrameAxes(ctx, w, h, pad, 'floor area (m²)', 'price (k$)');

      /* true relationship (dashed) */
      ctx.strokeStyle = C.faint;
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px(X0, w, pad), py(truth(X0), h, pad));
      ctx.lineTo(px(X1, w, pad), py(truth(X1), h, pad));
      ctx.stroke();
      ctx.setLineDash([]);

      /* fitted line */
      var f = fit();
      if (f) {
        ctx.strokeStyle = C.teal;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(px(X0, w, pad), py(clamp(f.m * X0 + f.b, Y0 - 300, Y1 + 300), h, pad));
        ctx.lineTo(px(X1, w, pad), py(clamp(f.m * X1 + f.b, Y0 - 300, Y1 + 300), h, pad));
        ctx.stroke();
      }

      /* points */
      pts.forEach(function (p) {
        var x = px(p.x, w, pad), y = py(clamp(p.y, Y0, Y1), h, pad);
        if (p.kind === 'outlier') {
          ctx.fillStyle = C.rose;
        } else if (p.kind === 'corrupt') {
          ctx.fillStyle = C.rose;
        } else {
          ctx.fillStyle = C.amber;
        }
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        if (p.kind === 'outlier') {
          ctx.strokeStyle = C.rose;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, y, 7.5, 0, Math.PI * 2);
          ctx.stroke();
        }
      });

      /* legend */
      ctx.fillStyle = C.faint;
      ctx.font = '600 11px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('dashed = truth · teal = learned model', pad + 6, pad + 16);

      /* stats */
      if (outN) { outN.textContent = String(pts.length); }
      if (outErr) {
        if (f) {
          var se = 0, S = 40;
          for (var i = 0; i <= S; i++) {
            var xx = X0 + (X1 - X0) * i / S;
            var d = (f.m * xx + f.b) - truth(xx);
            se += d * d;
          }
          outErr.textContent = '±' + fmt(Math.sqrt(se / (S + 1)), 0) + ' k$';
        } else {
          outErr.textContent = '—';
        }
      }
      if (outVerdict) {
        var v = 'clean';
        if (quality.noisy) { v = 'noisy'; }
        if (quality.corrupted) { v = quality.corrupted + ' mislabeled'; }
        if (quality.outliers) { v = quality.outliers + ' outlier' + (quality.outliers > 1 ? 's' : ''); }
        if (quality.outliers && quality.corrupted) { v = 'a mess'; }
        outVerdict.textContent = v;
      }
    }

    canvas.addEventListener('click', function (e) {
      var rect = canvas.getBoundingClientRect();
      var pad = 34;
      var mx = e.clientX - rect.left, my = e.clientY - rect.top;
      var x = X0 + (mx - pad) / (cv.state.w - 2 * pad) * (X1 - X0);
      var y = Y0 + (cv.state.h - pad - my) / (cv.state.h - 2 * pad) * (Y1 - Y0);
      if (x < X0 || x > X1 || y < Y0 || y > Y1) { return; }
      pts.push({ x: x, y: y, kind: 'clean' });
      draw();
    });

    var bNoise = $('#ml-data-noise');
    if (bNoise) {
      bNoise.addEventListener('click', function () {
        pts.forEach(function (p) { p.y += gauss(rng) * 55; });
        quality.noisy = true;
        draw();
      });
    }
    var bOut = $('#ml-data-outlier');
    if (bOut) {
      bOut.addEventListener('click', function () {
        /* a tiny apartment "sold" for a fortune — a typo in the records */
        pts.push({ x: X0 + rng() * 30, y: 560 + rng() * 70, kind: 'outlier' });
        quality.outliers++;
        draw();
      });
    }
    var bMiss = $('#ml-data-missing');
    if (bMiss) {
      bMiss.addEventListener('click', function () {
        var n = 0;
        for (var i = 0; i < pts.length && n < 3; i++) {
          if (pts[i].kind === 'clean' && rng() < 0.3) {
            pts[i].y = Y0 + rng() * (Y1 - Y0);
            pts[i].kind = 'corrupt';
            n++;
          }
        }
        quality.corrupted += n;
        draw();
      });
    }
    var bMore = $('#ml-data-more');
    if (bMore) { bMore.addEventListener('click', function () { addClean(20); draw(); }); }
    var bReset = $('#ml-data-reset');
    if (bReset) { bReset.addEventListener('click', reset); }

    reset();
  }

  /* ==========================================================================
     04 — Supervised learning (real logistic regression, trained live)
     ========================================================================== */

  function initSupervised() {
    var canvas = $('#ml-sup-canvas');
    if (!canvas) { return; }
    var cv = setupCanvas(canvas, draw);
    var ctx = cv.ctx;
    var outN = $('#ml-sup-n');
    var outAcc = $('#ml-sup-acc');
    var rng = makeRng(11);

    var pts = [];               /* {x, y, label} in unit space; label 1 = spam */
    var W = [0, 0, 0];          /* w0*x + w1*y + b, on centered coords */
    var currentClass = 1;

    function sigmoid(z) { return 1 / (1 + Math.exp(-z)); }

    function trainEpochs(n) {
      if (!pts.length) { return; }
      var lr = 0.6;
      for (var e = 0; e < n; e++) {
        var g0 = 0, g1 = 0, g2 = 0;
        for (var i = 0; i < pts.length; i++) {
          var p = pts[i];
          var fx = p.x * 2 - 1, fy = p.y * 2 - 1;
          var err = sigmoid(W[0] * fx + W[1] * fy + W[2]) - p.label;
          g0 += err * fx; g1 += err * fy; g2 += err;
        }
        var inv = lr / pts.length;
        W[0] -= g0 * inv; W[1] -= g1 * inv; W[2] -= g2 * inv;
      }
    }

    function predict(x, y) {
      return sigmoid(W[0] * (x * 2 - 1) + W[1] * (y * 2 - 1) + W[2]);
    }

    function draw() {
      var w = cv.state.w, h = cv.state.h, pad = 34;
      var iw = w - 2 * pad, ih = h - 2 * pad;
      ctx.clearRect(0, 0, w, h);

      /* confidence field */
      if (pts.length >= 2) {
        var GX = 30, GY = 20;
        for (var gy = 0; gy < GY; gy++) {
          for (var gx = 0; gx < GX; gx++) {
            var ux = (gx + 0.5) / GX, uy = 1 - (gy + 0.5) / GY;
            var p = predict(ux, uy);
            var a = Math.abs(p - 0.5) * 0.55;
            ctx.fillStyle = p > 0.5
              ? 'rgba(225,29,72,' + a + ')'
              : 'rgba(2,132,199,' + a + ')';
            ctx.fillRect(pad + gx / GX * iw, pad + gy / GY * ih, iw / GX + 1, ih / GY + 1);
          }
        }
        /* decision boundary: W0*fx + W1*fy + W2 = 0 in centered coords */
        var segs = [];
        function boundaryY(fx) { return Math.abs(W[1]) < 1e-9 ? null : -(W[0] * fx + W[2]) / W[1]; }
        var yA = boundaryY(-1), yB = boundaryY(1);
        if (yA !== null && yB !== null) {
          segs.push([{ fx: -1, fy: yA }, { fx: 1, fy: yB }]);
        } else if (Math.abs(W[0]) > 1e-9) {
          var fx0 = -W[2] / W[0];
          segs.push([{ fx: fx0, fy: -1 }, { fx: fx0, fy: 1 }]);
        }
        segs.forEach(function (s) {
          ctx.strokeStyle = C.strong;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(pad + (s[0].fx + 1) / 2 * iw, pad + (1 - (s[0].fy + 1) / 2) * ih);
          ctx.lineTo(pad + (s[1].fx + 1) / 2 * iw, pad + (1 - (s[1].fy + 1) / 2) * ih);
          ctx.stroke();
        });
      }

      drawFrameAxes(ctx, w, h, pad, 'shouty words per email →', 'links per email →');

      /* points */
      pts.forEach(function (p) {
        ctx.fillStyle = p.label ? C.rose : C.sky;
        ctx.strokeStyle = C.deep;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(pad + p.x * iw, pad + (1 - p.y) * ih, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });

      /* legend */
      ctx.font = '600 11px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = C.rose;
      ctx.fillText('● spam', pad + 6, pad + 16);
      ctx.fillStyle = C.sky;
      ctx.fillText('● legit', pad + 60, pad + 16);

      if (outN) { outN.textContent = String(pts.length); }
      if (outAcc) {
        if (pts.length >= 2) {
          var ok = 0;
          pts.forEach(function (p) { if ((predict(p.x, p.y) > 0.5 ? 1 : 0) === p.label) { ok++; } });
          outAcc.textContent = fmt(100 * ok / pts.length, 0) + '%';
        } else {
          outAcc.textContent = '—';
        }
      }
    }

    /* continuous background training while visible */
    var loop = makeLoop(function () {
      if (pts.length >= 2) {
        trainEpochs(30);
        draw();
      }
    });
    onScreen(canvas, function () { loop.start(); }, function () { loop.stop(); });

    canvas.addEventListener('click', function (e) {
      var rect = canvas.getBoundingClientRect();
      var pad = 34;
      var x = (e.clientX - rect.left - pad) / (cv.state.w - 2 * pad);
      var y = 1 - (e.clientY - rect.top - pad) / (cv.state.h - 2 * pad);
      if (x < 0 || x > 1 || y < 0 || y > 1) { return; }
      pts.push({ x: x, y: y, label: currentClass });
      draw();
    });

    var bA = $('#ml-sup-class-a');
    var bB = $('#ml-sup-class-b');
    function setClass(c) {
      currentClass = c;
      if (bA) { bA.classList.toggle('is-active', c === 1); }
      if (bB) { bB.classList.toggle('is-active', c === 0); }
    }
    if (bA) { bA.addEventListener('click', function () { setClass(1); }); }
    if (bB) { bB.addEventListener('click', function () { setClass(0); }); }

    var bSample = $('#ml-sup-sample');
    if (bSample) {
      bSample.addEventListener('click', function () {
        for (var i = 0; i < 15; i++) {
          var spam = rng() < 0.5 ? 1 : 0;
          var cx = spam ? 0.68 : 0.32, cy = spam ? 0.66 : 0.36;
          pts.push({
            x: clamp(cx + gauss(rng) * 0.14, 0.02, 0.98),
            y: clamp(cy + gauss(rng) * 0.14, 0.02, 0.98),
            label: spam
          });
        }
        draw();
      });
    }
    var bClear = $('#ml-sup-clear');
    if (bClear) {
      bClear.addEventListener('click', function () {
        pts = [];
        W = [0, 0, 0];
        draw();
      });
    }

    draw();
  }

  /* ==========================================================================
     05 — Unsupervised learning (real k-means, animated)
     ========================================================================== */

  function initUnsupervised() {
    var canvas = $('#ml-unsup-canvas');
    if (!canvas) { return; }
    var cv = setupCanvas(canvas, draw);
    var ctx = cv.ctx;
    var kSlider = $('#ml-unsup-k');
    var kOut = $('#ml-unsup-k-out');
    var outIter = $('#ml-unsup-iter');
    var outInertia = $('#ml-unsup-inertia');
    var dataSeed = 31;
    var rng = makeRng(dataSeed);

    var pts = [];
    var centroids = [];
    var assign = [];
    var iter = 0;
    var converged = false;

    function genData() {
      rng = makeRng(dataSeed);
      pts = [];
      var centers = [];
      for (var c = 0; c < 3; c++) {
        centers.push({ x: 0.18 + rng() * 0.64, y: 0.2 + rng() * 0.6 });
      }
      for (var i = 0; i < 96; i++) {
        var cc = centers[i % 3];
        pts.push({
          x: clamp(cc.x + gauss(rng) * 0.07, 0.03, 0.97),
          y: clamp(cc.y + gauss(rng) * 0.08, 0.05, 0.95)
        });
      }
    }

    function k() { return kSlider ? parseInt(kSlider.value, 10) : 3; }

    function initCentroids() {
      var kk = k();
      centroids = [];
      var used = {};
      var r2 = makeRng(Math.floor(Math.random() * 1e9));
      while (centroids.length < kk) {
        var idx = Math.floor(r2() * pts.length);
        if (used[idx]) { continue; }
        used[idx] = true;
        centroids.push({ x: pts[idx].x, y: pts[idx].y });
      }
      assign = pts.map(function () { return 0; });
      iter = 0;
      converged = false;
    }

    function step() {
      /* assignment */
      var moved = false;
      for (var i = 0; i < pts.length; i++) {
        var best = 0, bd = Infinity;
        for (var c = 0; c < centroids.length; c++) {
          var dx = pts[i].x - centroids[c].x, dy = pts[i].y - centroids[c].y;
          var d = dx * dx + dy * dy;
          if (d < bd) { bd = d; best = c; }
        }
        if (assign[i] !== best) { assign[i] = best; moved = true; }
      }
      /* update */
      for (var c2 = 0; c2 < centroids.length; c2++) {
        var sx = 0, sy = 0, n = 0;
        for (var j = 0; j < pts.length; j++) {
          if (assign[j] === c2) { sx += pts[j].x; sy += pts[j].y; n++; }
        }
        if (n > 0) {
          var nx = sx / n, ny = sy / n;
          if (Math.abs(nx - centroids[c2].x) > 1e-5 || Math.abs(ny - centroids[c2].y) > 1e-5) { moved = true; }
          centroids[c2].x = nx;
          centroids[c2].y = ny;
        }
      }
      iter++;
      if (!moved) { converged = true; }
    }

    function inertia() {
      var s = 0;
      for (var i = 0; i < pts.length; i++) {
        var c = centroids[assign[i]];
        var dx = pts[i].x - c.x, dy = pts[i].y - c.y;
        s += Math.sqrt(dx * dx + dy * dy);
      }
      return s;
    }

    function draw() {
      var w = cv.state.w, h = cv.state.h, pad = 26;
      var iw = w - 2 * pad, ih = h - 2 * pad;
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = C.line;
      ctx.strokeRect(pad, pad, iw, ih);

      pts.forEach(function (p, i) {
        ctx.fillStyle = SERIES[assign[i] % SERIES.length];
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.arc(pad + p.x * iw, pad + (1 - p.y) * ih, 4, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;

      centroids.forEach(function (c, i) {
        var x = pad + c.x * iw, y = pad + (1 - c.y) * ih;
        ctx.strokeStyle = SERIES[i % SERIES.length];
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x - 7, y - 7); ctx.lineTo(x + 7, y + 7);
        ctx.moveTo(x - 7, y + 7); ctx.lineTo(x + 7, y - 7);
        ctx.stroke();
        ctx.strokeStyle = C.strong;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, 10, 0, Math.PI * 2);
        ctx.stroke();
      });

      if (outIter) { outIter.textContent = String(iter) + (converged ? ' (settled)' : ''); }
      if (outInertia) { outInertia.textContent = fmt(inertia(), 2); }
    }

    var acc = 0;
    var loop = makeLoop(function (t, dt) {
      if (converged) { return; }
      acc += dt;
      var interval = reduced() ? 0 : 620;
      if (acc >= interval) {
        acc = 0;
        step();
        if (reduced()) {
          /* settle instantly */
          var guard = 0;
          while (!converged && guard++ < 60) { step(); }
        }
        draw();
      }
    });
    onScreen(canvas, function () { loop.start(); }, function () { loop.stop(); });

    function restart() {
      initCentroids();
      step();
      draw();
    }

    if (kSlider) {
      kSlider.addEventListener('input', function () {
        if (kOut) { kOut.textContent = kSlider.value; }
        restart();
      });
    }
    var bRestart = $('#ml-unsup-restart');
    if (bRestart) { bRestart.addEventListener('click', restart); }
    var bNew = $('#ml-unsup-newdata');
    if (bNew) {
      bNew.addEventListener('click', function () {
        dataSeed = Math.floor(Math.random() * 1e9);
        genData();
        restart();
      });
    }

    genData();
    restart();
  }

  /* ==========================================================================
     06 — Reinforcement learning (real Q-learning on a maze)
     ========================================================================== */

  function initRL() {
    var canvas = $('#ml-rl-canvas');
    if (!canvas) { return; }
    var cv = setupCanvas(canvas, draw);
    var ctx = cv.ctx;
    var outEp = $('#ml-rl-episodes');
    var outRw = $('#ml-rl-reward');

    var COLS = 9, ROWS = 6;
    /* 0 empty, 1 wall, 2 trap, 3 goal */
    var GRID = [
      [0, 0, 0, 1, 0, 0, 0, 0, 3],
      [0, 1, 0, 1, 0, 1, 1, 0, 0],
      [0, 1, 0, 0, 0, 0, 1, 0, 1],
      [0, 0, 0, 1, 1, 0, 0, 0, 0],
      [1, 1, 0, 0, 1, 0, 1, 2, 0],
      [0, 0, 0, 1, 0, 0, 1, 0, 0]
    ];
    var START = { c: 0, r: 5 };
    var ACTIONS = [{ dc: 0, dr: -1 }, { dc: 1, dr: 0 }, { dc: 0, dr: 1 }, { dc: -1, dr: 0 }];

    var Q, episodes, agent, animating;

    function resetAll() {
      Q = [];
      for (var i = 0; i < COLS * ROWS; i++) { Q.push([0, 0, 0, 0]); }
      episodes = 0;
      agent = null;
      animating = false;
      if (outEp) { outEp.textContent = '0'; }
      if (outRw) { outRw.textContent = '—'; }
      draw();
    }

    function idx(c, r) { return r * COLS + c; }
    function eps() { return Math.max(0.05, 1 - episodes / 250); }

    function stepEnv(s, a) {
      var nc = s.c + ACTIONS[a].dc, nr = s.r + ACTIONS[a].dr;
      if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS || GRID[nr][nc] === 1) {
        return { c: s.c, r: s.r, reward: -0.4, done: false };
      }
      var cell = GRID[nr][nc];
      if (cell === 3) { return { c: nc, r: nr, reward: 10, done: true }; }
      if (cell === 2) { return { c: nc, r: nr, reward: -8, done: true }; }
      return { c: nc, r: nr, reward: -0.15, done: false };
    }

    function runEpisode(learn) {
      var s = { c: START.c, r: START.r };
      var total = 0;
      var e = learn ? eps() : 0.02;
      var trail = [{ c: s.c, r: s.r }];
      for (var t = 0; t < 120; t++) {
        var a;
        if (Math.random() < e) {
          a = Math.floor(Math.random() * 4);
        } else {
          var q = Q[idx(s.c, s.r)];
          a = 0;
          for (var i = 1; i < 4; i++) { if (q[i] > q[a]) { a = i; } }
        }
        var res = stepEnv(s, a);
        total += res.reward;
        if (learn) {
          var maxNext = res.done ? 0 : Math.max.apply(null, Q[idx(res.c, res.r)]);
          var cur = Q[idx(s.c, s.r)][a];
          Q[idx(s.c, s.r)][a] = cur + 0.25 * (res.reward + 0.92 * maxNext - cur);
        }
        s = { c: res.c, r: res.r };
        trail.push({ c: s.c, r: s.r });
        if (res.done) { break; }
      }
      if (learn) { episodes++; }
      return { total: total, trail: trail };
    }

    function cellRect(c, r) {
      var w = cv.state.w, h = cv.state.h, pad = 20;
      var cw = (w - 2 * pad) / COLS, ch = (h - 2 * pad) / ROWS;
      return { x: pad + c * cw, y: pad + r * ch, w: cw, h: ch };
    }

    function draw(trail) {
      var w = cv.state.w, h = cv.state.h;
      ctx.clearRect(0, 0, w, h);

      var maxQ = 0.001;
      Q.forEach(function (q) {
        var m = Math.max.apply(null, q);
        if (m > maxQ) { maxQ = m; }
      });

      for (var r = 0; r < ROWS; r++) {
        for (var c = 0; c < COLS; c++) {
          var rect = cellRect(c, r);
          var cell = GRID[r][c];
          if (cell === 1) {
            ctx.fillStyle = '#0d1526';
          } else if (cell === 2) {
            ctx.fillStyle = 'rgba(225,29,72,0.28)';
          } else if (cell === 3) {
            ctx.fillStyle = 'rgba(101,163,13,0.32)';
          } else {
            ctx.fillStyle = 'rgba(30,41,59,0.35)';
          }
          ctx.fillRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2);

          if (cell === 0 || cell === undefined) {
            /* policy arrow */
            var q = Q[idx(c, r)];
            var best = 0;
            for (var i = 1; i < 4; i++) { if (q[i] > q[best]) { best = i; } }
            var strength = Math.max.apply(null, q);
            if (strength > 0.05) {
              var a = ACTIONS[best];
              var cx = rect.x + rect.w / 2, cyy = rect.y + rect.h / 2;
              var len = Math.min(rect.w, rect.h) * 0.26;
              ctx.strokeStyle = 'rgba(45,212,191,' + clamp(strength / maxQ, 0.15, 0.95) + ')';
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.moveTo(cx - a.dc * len, cyy - a.dr * len);
              ctx.lineTo(cx + a.dc * len, cyy + a.dr * len);
              ctx.stroke();
              ctx.beginPath();
              ctx.arc(cx + a.dc * len, cyy + a.dr * len, 2.5, 0, Math.PI * 2);
              ctx.fillStyle = ctx.strokeStyle;
              ctx.fill();
            }
          }
        }
      }

      /* labels */
      ctx.font = '700 11px Inter, sans-serif';
      ctx.textAlign = 'center';
      var g = cellRect(8, 0);
      ctx.fillStyle = '#bef264';
      ctx.fillText('GOAL', g.x + g.w / 2, g.y + g.h / 2 + 4);
      var tr = cellRect(7, 4);
      ctx.fillStyle = '#fda4af';
      ctx.fillText('TRAP', tr.x + tr.w / 2, tr.y + tr.h / 2 + 4);
      var st = cellRect(START.c, START.r);
      ctx.fillStyle = C.muted;
      ctx.fillText('START', st.x + st.w / 2, st.y + st.h - 6);

      /* trail from a shown episode */
      if (trail && trail.length > 1) {
        ctx.strokeStyle = 'rgba(251,191,36,0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        trail.forEach(function (p, i) {
          var rc = cellRect(p.c, p.r);
          var x = rc.x + rc.w / 2, y = rc.y + rc.h / 2;
          if (i === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
        });
        ctx.stroke();
      }

      /* live agent */
      if (agent) {
        var ar = cellRect(agent.c, agent.r);
        ctx.fillStyle = '#fbbf24';
        ctx.beginPath();
        ctx.arc(ar.x + ar.w / 2, ar.y + ar.h / 2, Math.min(ar.w, ar.h) * 0.22, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    var bTrain = $('#ml-rl-train');
    if (bTrain) {
      bTrain.addEventListener('click', function () {
        if (animating) { return; }
        if (reduced()) {
          var lastR = 0;
          for (var i = 0; i < 300; i++) { lastR = runEpisode(true).total; }
          if (outEp) { outEp.textContent = String(episodes); }
          if (outRw) { outRw.textContent = fmt(lastR, 1); }
          draw();
          return;
        }
        animating = true;
        bTrain.disabled = true;
        var target = episodes + 300;
        var lastTotal = 0;
        (function chunk() {
          for (var i = 0; i < 8 && episodes < target; i++) {
            lastTotal = runEpisode(true).total;
          }
          if (outEp) { outEp.textContent = String(episodes); }
          if (outRw) { outRw.textContent = fmt(lastTotal, 1); }
          draw();
          if (episodes < target) {
            requestAnimationFrame(chunk);
          } else {
            animating = false;
            bTrain.disabled = false;
          }
        })();
      });
    }

    var bStep = $('#ml-rl-step');
    if (bStep) {
      bStep.addEventListener('click', function () {
        if (animating) { return; }
        var ep = runEpisode(true);
        if (outEp) { outEp.textContent = String(episodes); }
        if (outRw) { outRw.textContent = fmt(ep.total, 1); }
        if (reduced()) {
          draw(ep.trail);
          return;
        }
        animating = true;
        var i = 0;
        var iv = setInterval(function () {
          agent = ep.trail[i];
          draw(ep.trail.slice(0, i + 1));
          i++;
          if (i >= ep.trail.length) {
            clearInterval(iv);
            agent = null;
            animating = false;
            draw(ep.trail);
          }
        }, 70);
      });
    }

    var bReset = $('#ml-rl-reset');
    if (bReset) { bReset.addEventListener('click', resetAll); }

    resetAll();
  }

  /* ==========================================================================
     07 — Training loop (1-D linear regression by gradient descent)
     ========================================================================== */

  function initTraining() {
    var canvas = $('#ml-train-canvas');
    var lossCanvas = $('#ml-train-loss-canvas');
    if (!canvas || !lossCanvas) { return; }
    var cv = setupCanvas(canvas, drawAll);
    var lv = setupCanvas(lossCanvas, drawAll);
    var ctx = cv.ctx;
    var lctx = lv.ctx;
    var outIter = $('#ml-train-iter');
    var outLoss = $('#ml-train-loss');
    var speedSlider = $('#ml-train-speed');
    var rng = makeRng(23);

    /* unit-space data around a true line */
    var data = [];
    for (var i = 0; i < 26; i++) {
      var x = 0.06 + rng() * 0.88;
      data.push({ x: x, y: clamp(0.18 + 0.6 * x + gauss(rng) * 0.06, 0.02, 0.98) });
    }

    var m, b, it, history;
    function resetModel() {
      m = -0.9;
      b = 0.85;
      it = 0;
      history = [];
      history.push(loss());
      drawAll();
    }

    function predict(x) { return m * x + b; }

    function loss() {
      var s = 0;
      data.forEach(function (p) { var d = predict(p.x) - p.y; s += d * d; });
      return s / data.length;
    }

    function stepGD() {
      var gm = 0, gb = 0;
      data.forEach(function (p) {
        var e = predict(p.x) - p.y;
        gm += 2 * e * p.x;
        gb += 2 * e;
      });
      var lr = 0.35;
      m -= lr * gm / data.length;
      b -= lr * gb / data.length;
      it++;
      history.push(loss());
      if (history.length > 400) { history.shift(); }
    }

    function drawAll() {
      var w = cv.state.w, h = cv.state.h, pad = 30;
      var iw = w - 2 * pad, ih = h - 2 * pad;
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = C.line;
      ctx.strokeRect(pad, pad, iw, ih);

      function X(x) { return pad + x * iw; }
      function Y(y) { return pad + (1 - y) * ih; }

      /* residual stems */
      ctx.strokeStyle = 'rgba(225,29,72,0.55)';
      ctx.lineWidth = 1.4;
      data.forEach(function (p) {
        ctx.beginPath();
        ctx.moveTo(X(p.x), Y(p.y));
        ctx.lineTo(X(p.x), Y(clamp(predict(p.x), 0, 1)));
        ctx.stroke();
      });

      /* model line */
      ctx.strokeStyle = C.teal;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(X(0), Y(clamp(predict(0), -0.2, 1.2)));
      ctx.lineTo(X(1), Y(clamp(predict(1), -0.2, 1.2)));
      ctx.stroke();

      /* points */
      data.forEach(function (p) {
        ctx.fillStyle = C.amber;
        ctx.beginPath();
        ctx.arc(X(p.x), Y(p.y), 4, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.fillStyle = C.faint;
      ctx.font = '600 11px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('model (teal) · errors (red stems)', pad + 6, pad + 16);

      /* loss curve */
      var lw = lv.state.w, lh = lv.state.h, lpad = 28;
      lctx.clearRect(0, 0, lw, lh);
      lctx.strokeStyle = C.line;
      lctx.strokeRect(lpad, lpad, lw - 2 * lpad, lh - 2 * lpad);
      lctx.fillStyle = C.faint;
      lctx.font = '600 11px Inter, sans-serif';
      lctx.textAlign = 'center';
      lctx.fillText('loss over iterations', lw / 2, 18);
      if (history.length > 1) {
        var maxL = history[0];
        history.forEach(function (v) { if (v > maxL) { maxL = v; } });
        lctx.strokeStyle = C.teal;
        lctx.lineWidth = 2;
        lctx.beginPath();
        history.forEach(function (v, i) {
          var x = lpad + i / Math.max(history.length - 1, 1) * (lw - 2 * lpad);
          var y = lpad + (1 - v / (maxL || 1)) * (lh - 2 * lpad);
          if (i === 0) { lctx.moveTo(x, y); } else { lctx.lineTo(x, y); }
        });
        lctx.stroke();
      }

      if (outIter) { outIter.textContent = String(it); }
      if (outLoss) { outLoss.textContent = fmt(loss(), 4); }
    }

    var playing = false;
    var accum = 0;
    var loop = makeLoop(function (t, dt) {
      if (!playing) { return; }
      var speed = speedSlider ? parseInt(speedSlider.value, 10) : 12;
      accum += dt * speed / 1000;
      var n = Math.floor(accum);
      if (n > 0) {
        accum -= n;
        for (var i = 0; i < n && it < 4000; i++) { stepGD(); }
        drawAll();
      }
    });

    var bPlay = $('#ml-train-play');
    if (bPlay) {
      bPlay.addEventListener('click', function () {
        if (reduced() && !playing) {
          for (var i = 0; i < 250; i++) { stepGD(); }
          drawAll();
          return;
        }
        playing = !playing;
        bPlay.textContent = playing ? 'Pause' : 'Train';
        if (playing) { loop.start(); }
      });
    }
    onScreen(canvas, null, function () { playing = false; if (bPlay) { bPlay.textContent = 'Train'; } loop.stop(); });

    var bStep = $('#ml-train-step');
    if (bStep) { bStep.addEventListener('click', function () { stepGD(); drawAll(); }); }
    var bReset = $('#ml-train-reset');
    if (bReset) {
      bReset.addEventListener('click', function () {
        playing = false;
        if (bPlay) { bPlay.textContent = 'Train'; }
        resetModel();
      });
    }

    resetModel();
  }

  /* ==========================================================================
     08 — Loss (draggable line, live MSE)
     ========================================================================== */

  function initLoss() {
    var canvas = $('#ml-loss-canvas');
    if (!canvas) { return; }
    var cv = setupCanvas(canvas, draw);
    var ctx = cv.ctx;
    var outVal = $('#ml-loss-val');
    var outBest = $('#ml-loss-best');
    var rng = makeRng(41);

    var data = [];
    for (var i = 0; i < 22; i++) {
      var x = 0.05 + rng() * 0.9;
      data.push({ x: x, y: clamp(0.7 - 0.45 * x + gauss(rng) * 0.055, 0.02, 0.98) });
    }

    /* line as endpoint heights at x=0 and x=1 (unit space) */
    var yL = 0.15, yR = 0.2;
    var best = Infinity;
    var pad = 34;
    var drag = null; /* 'L' | 'R' | 'mid' */

    function lineY(x) { return yL + (yR - yL) * x; }

    function mse() {
      var s = 0;
      data.forEach(function (p) { var d = lineY(p.x) - p.y; s += d * d; });
      return s / data.length;
    }

    function lsqFit() {
      var sx = 0, sy = 0, sxx = 0, sxy = 0, n = data.length;
      data.forEach(function (p) { sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y; });
      var m = (n * sxy - sx * sy) / (n * sxx - sx * sx);
      var b = (sy - m * sx) / n;
      return { yL: b, yR: m + b };
    }

    function draw() {
      var w = cv.state.w, h = cv.state.h;
      var iw = w - 2 * pad, ih = h - 2 * pad;
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = C.line;
      ctx.strokeRect(pad, pad, iw, ih);

      function X(x) { return pad + x * iw; }
      function Y(y) { return pad + (1 - y) * ih; }

      /* residual stems + squares intuition */
      ctx.strokeStyle = 'rgba(225,29,72,0.55)';
      ctx.lineWidth = 1.4;
      data.forEach(function (p) {
        ctx.beginPath();
        ctx.moveTo(X(p.x), Y(p.y));
        ctx.lineTo(X(p.x), Y(clamp(lineY(p.x), 0, 1)));
        ctx.stroke();
      });

      /* line */
      ctx.strokeStyle = C.teal;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(X(0), Y(clamp(yL, 0, 1)));
      ctx.lineTo(X(1), Y(clamp(yR, 0, 1)));
      ctx.stroke();

      /* handles */
      [{ x: 0, y: yL }, { x: 1, y: yR }].forEach(function (hd) {
        ctx.fillStyle = C.strong;
        ctx.strokeStyle = C.teal;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(X(hd.x), Y(clamp(hd.y, 0, 1)), 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });

      /* points */
      data.forEach(function (p) {
        ctx.fillStyle = C.amber;
        ctx.beginPath();
        ctx.arc(X(p.x), Y(p.y), 4, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.fillStyle = C.faint;
      ctx.font = '600 11px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('drag the handles to move the line', pad + 6, pad + 16);

      var L = mse();
      if (L < best) { best = L; }
      if (outVal) { outVal.textContent = fmt(L, 4); }
      if (outBest) { outBest.textContent = isFinite(best) ? fmt(best, 4) : '—'; }
    }

    function ptFromEvent(e) {
      var rect = canvas.getBoundingClientRect();
      var cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      var cyv = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
      return { x: (cx - pad) / (cv.state.w - 2 * pad), y: 1 - (cyv - pad) / (cv.state.h - 2 * pad) };
    }

    function onDown(e) {
      var p = ptFromEvent(e);
      var dL = Math.abs(p.x - 0) + Math.abs(p.y - yL) * 0.8;
      var dR = Math.abs(p.x - 1) + Math.abs(p.y - yR) * 0.8;
      if (p.x < 0.25 && Math.abs(p.y - yL) < 0.18) { drag = 'L'; }
      else if (p.x > 0.75 && Math.abs(p.y - yR) < 0.18) { drag = 'R'; }
      else if (Math.abs(p.y - lineY(clamp(p.x, 0, 1))) < 0.1) { drag = 'mid'; drag = { kind: 'mid', y0: p.y, yL0: yL, yR0: yR }; }
      else { drag = dL < dR ? 'L' : 'R'; }
      if (drag) { e.preventDefault(); }
    }

    function onMove(e) {
      if (!drag) { return; }
      var p = ptFromEvent(e);
      if (drag === 'L') { yL = clamp(p.y, -0.1, 1.1); }
      else if (drag === 'R') { yR = clamp(p.y, -0.1, 1.1); }
      else if (drag.kind === 'mid') {
        var dy = p.y - drag.y0;
        yL = clamp(drag.yL0 + dy, -0.1, 1.1);
        yR = clamp(drag.yR0 + dy, -0.1, 1.1);
      }
      draw();
      e.preventDefault();
    }

    function onUp() { drag = null; }

    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('touchstart', onDown, { passive: false });
    canvas.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);

    var bBad = $('#ml-loss-bad');
    if (bBad) { bBad.addEventListener('click', function () { yL = 0.1; yR = 0.95; draw(); }); }
    var bGood = $('#ml-loss-good');
    if (bGood) {
      bGood.addEventListener('click', function () {
        var f = lsqFit();
        yL = f.yL; yR = f.yR;
        draw();
      });
    }
    var bAnim = $('#ml-loss-anim');
    if (bAnim) {
      bAnim.addEventListener('click', function () {
        var f = lsqFit();
        if (reduced()) { yL = f.yL; yR = f.yR; draw(); return; }
        var sL = 0.1, sR = 0.95;
        yL = sL; yR = sR;
        var t0 = performance.now();
        (function frame(t) {
          var p = easeInOut(clamp((t - t0) / 1800, 0, 1));
          yL = sL + (f.yL - sL) * p;
          yR = sR + (f.yR - sR) * p;
          draw();
          if (p < 1) { requestAnimationFrame(frame); }
        })(t0);
      });
    }

    draw();
  }

  /* ==========================================================================
     09 — Gradient descent playground (real GD on a crafted 1-D landscape)
     ========================================================================== */

  function initGD() {
    var canvas = $('#ml-gd-canvas');
    if (!canvas) { return; }
    var cv = setupCanvas(canvas, function () { draw(); });
    var ctx = cv.ctx;
    var lrSlider = $('#ml-gd-lr');
    var lrOut = $('#ml-gd-lr-out');
    var stepsSlider = $('#ml-gd-steps');
    var stepsOut = $('#ml-gd-steps-out');
    var outTaken = $('#ml-gd-taken');
    var outLoss = $('#ml-gd-loss');
    var outOutcome = $('#ml-gd-outcome');

    /* landscape on x ∈ [0,1]: plateau (left) → local dip → deep valley */
    function g(x, mu, s) { return Math.exp(-Math.pow((x - mu) / s, 2)); }
    function f(x) {
      return 0.55 - 0.42 * g(x, 0.78, 0.09) - 0.2 * g(x, 0.45, 0.06) + 0.06 * (1 - x);
    }
    function fp(x) {
      var d = 0;
      d += -0.42 * g(x, 0.78, 0.09) * (-2 * (x - 0.78) / (0.09 * 0.09));
      d += -0.2 * g(x, 0.45, 0.06) * (-2 * (x - 0.45) / (0.06 * 0.06));
      d += -0.06;
      return d;
    }

    var startX = 0.08;
    var trail = [];
    var running = false;

    function lr() {
      var v = lrSlider ? parseInt(lrSlider.value, 10) : 35;
      return 0.0008 * Math.pow(2500, v / 100); /* ~0.0008 .. ~2.0 */
    }
    function maxSteps() { return stepsSlider ? parseInt(stepsSlider.value, 10) : 80; }

    function updateOuts() {
      if (lrOut) { lrOut.textContent = fmt(lr(), lr() < 0.02 ? 4 : 2); }
      if (stepsOut) { stepsOut.textContent = String(maxSteps()); }
    }

    var pad = 34;
    function X(x) { return pad + x * (cv.state.w - 2 * pad); }
    function Y(y) {
      /* f ranges roughly [0.06, 0.62] */
      return pad + (1 - (y - 0.02) / 0.66) * (cv.state.h - 2 * pad);
    }

    function draw() {
      var w = cv.state.w, h = cv.state.h;
      ctx.clearRect(0, 0, w, h);

      /* terrain */
      ctx.beginPath();
      for (var i = 0; i <= 220; i++) {
        var x = i / 220;
        var y = f(x);
        if (i === 0) { ctx.moveTo(X(x), Y(y)); } else { ctx.lineTo(X(x), Y(y)); }
      }
      ctx.strokeStyle = C.lineStrong;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.lineTo(X(1), h - pad + 10);
      ctx.lineTo(X(0), h - pad + 10);
      ctx.closePath();
      ctx.fillStyle = 'rgba(30,41,59,0.5)';
      ctx.fill();

      /* labels */
      ctx.fillStyle = C.faint;
      ctx.font = '600 11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('plateau', X(0.1), Y(f(0.1)) - 14);
      ctx.fillText('local dip', X(0.45), Y(f(0.45)) - 14);
      ctx.fillText('deep valley', X(0.78), Y(f(0.78)) - 14);
      ctx.fillText('height = loss · click to place the ball', w / 2, pad - 10);

      /* trail */
      trail.forEach(function (x, i) {
        ctx.fillStyle = 'rgba(45,212,191,' + clamp(0.15 + i / trail.length * 0.6, 0, 0.8) + ')';
        ctx.beginPath();
        ctx.arc(X(clamp(x, 0, 1)), Y(f(clamp(x, 0, 1))), 3, 0, Math.PI * 2);
        ctx.fill();
      });

      /* ball */
      var bx = trail.length ? trail[trail.length - 1] : startX;
      bx = clamp(bx, 0, 1);
      ctx.fillStyle = '#fbbf24';
      ctx.strokeStyle = C.deep;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(X(bx), Y(f(bx)) - 8, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    function classify(finalX, diverged, taken) {
      if (diverged) { return 'overshot — diverged'; }
      var grad = Math.abs(fp(finalX));
      if (Math.abs(finalX - 0.78) < 0.05) { return 'converged to the deep valley ✓'; }
      if (Math.abs(finalX - 0.45) < 0.045) { return 'stuck in the local dip'; }
      if (grad < 0.09 && finalX < 0.3) { return 'stalled on the plateau'; }
      if (taken >= maxSteps()) { return 'ran out of steps'; }
      return 'still descending';
    }

    function run() {
      if (running) { return; }
      var rate = lr();
      var steps = maxSteps();
      var x = startX;
      var seq = [x];
      var diverged = false;
      for (var i = 0; i < steps; i++) {
        x = x - rate * fp(x);
        seq.push(x);
        if (x < -0.35 || x > 1.35) { diverged = true; break; }
        if (Math.abs(fp(x)) < 1e-4 && i > 3) { break; }
      }
      var show = function () {
        trail = seq;
        draw();
        var fx = clamp(seq[seq.length - 1], 0, 1);
        if (outTaken) { outTaken.textContent = String(seq.length - 1); }
        if (outLoss) { outLoss.textContent = fmt(f(fx), 3); }
        if (outOutcome) { outOutcome.textContent = classify(seq[seq.length - 1], diverged, seq.length - 1); }
      };
      if (reduced()) { show(); return; }
      running = true;
      trail = [];
      var i2 = 0;
      var iv = setInterval(function () {
        i2 = Math.min(i2 + 1, seq.length);
        trail = seq.slice(0, i2);
        draw();
        if (outTaken) { outTaken.textContent = String(Math.max(0, i2 - 1)); }
        var cx = clamp(trail[trail.length - 1], 0, 1);
        if (outLoss) { outLoss.textContent = fmt(f(cx), 3); }
        if (i2 >= seq.length) {
          clearInterval(iv);
          running = false;
          show();
        }
      }, 55);
    }

    canvas.addEventListener('click', function (e) {
      if (running) { return; }
      var rect = canvas.getBoundingClientRect();
      var x = ((e.clientX - rect.left) - pad) / (cv.state.w - 2 * pad);
      startX = clamp(x, 0.01, 0.99);
      trail = [];
      if (outTaken) { outTaken.textContent = '0'; }
      if (outLoss) { outLoss.textContent = fmt(f(startX), 3); }
      if (outOutcome) { outOutcome.textContent = '—'; }
      draw();
    });

    if (lrSlider) { lrSlider.addEventListener('input', updateOuts); }
    if (stepsSlider) { stepsSlider.addEventListener('input', updateOuts); }
    var bRun = $('#ml-gd-run');
    if (bRun) { bRun.addEventListener('click', run); }
    var bReset = $('#ml-gd-reset');
    if (bReset) {
      bReset.addEventListener('click', function () {
        trail = [];
        startX = 0.08;
        if (outTaken) { outTaken.textContent = '0'; }
        if (outLoss) { outLoss.textContent = '—'; }
        if (outOutcome) { outOutcome.textContent = '—'; }
        draw();
      });
    }

    updateOuts();
    draw();
  }

  /* ==========================================================================
     10 — Overfitting vs underfitting (real polynomial regression)
     ========================================================================== */

  function initFit() {
    var canvas = $('#ml-fit-canvas');
    var errCanvas = $('#ml-fit-err-canvas');
    if (!canvas || !errCanvas) { return; }
    var cv = setupCanvas(canvas, drawAll);
    var ev = setupCanvas(errCanvas, drawAll);
    var ctx = cv.ctx;
    var ectx = ev.ctx;
    var degSlider = $('#ml-fit-deg');
    var degOut = $('#ml-fit-deg-out');
    var verdictEl = $('#ml-fit-verdict');
    var outTrain = $('#ml-fit-train');
    var outVal = $('#ml-fit-val');
    var seed = 55;
    var MAXDEG = 15;

    function truth(x) { return 0.5 + 0.33 * Math.sin(2.4 * Math.PI * (x - 0.05)) * (0.6 + 0.4 * x); }

    var train, val, coeffsByDeg, errByDeg;

    function genData() {
      var rng = makeRng(seed);
      train = [];
      val = [];
      for (var i = 0; i < 24; i++) {
        var x = rng();
        train.push({ x: x, y: truth(x) + gauss(rng) * 0.07 });
      }
      for (var j = 0; j < 14; j++) {
        var x2 = rng();
        val.push({ x: x2, y: truth(x2) + gauss(rng) * 0.07 });
      }
      coeffsByDeg = {};
      errByDeg = null;
    }

    function features(x, deg) {
      /* powers of centered x — fine at these tiny degrees with ridge */
      var t = x * 2 - 1;
      var out = [1];
      for (var d = 1; d <= deg; d++) { out.push(Math.pow(t, d)); }
      return out;
    }

    function fitDeg(deg) {
      if (coeffsByDeg[deg]) { return coeffsByDeg[deg]; }
      var n = deg + 1;
      var A = [];
      var b = [];
      for (var r = 0; r < n; r++) {
        A.push(new Array(n).fill(0));
        b.push(0);
      }
      train.forEach(function (p) {
        var phi = features(p.x, deg);
        for (var i = 0; i < n; i++) {
          b[i] += phi[i] * p.y;
          for (var j = 0; j < n; j++) { A[i][j] += phi[i] * phi[j]; }
        }
      });
      for (var d = 0; d < n; d++) { A[d][d] += 1e-7; }
      var c = solveLinear(A, b) || new Array(n).fill(0);
      coeffsByDeg[deg] = c;
      return c;
    }

    function predictDeg(x, deg) {
      var c = fitDeg(deg);
      var phi = features(x, deg);
      var s = 0;
      for (var i = 0; i < c.length; i++) { s += c[i] * phi[i]; }
      return s;
    }

    function mseOn(set, deg) {
      var s = 0;
      set.forEach(function (p) { var d = predictDeg(p.x, deg) - p.y; s += d * d; });
      return s / set.length;
    }

    function computeErrCurves() {
      if (errByDeg) { return errByDeg; }
      errByDeg = { train: [], val: [] };
      for (var d = 1; d <= MAXDEG; d++) {
        errByDeg.train.push(mseOn(train, d));
        errByDeg.val.push(mseOn(val, d));
      }
      return errByDeg;
    }

    function deg() { return degSlider ? parseInt(degSlider.value, 10) : 1; }

    function drawAll() {
      var d = deg();
      var w = cv.state.w, h = cv.state.h, pad = 30;
      var iw = w - 2 * pad, ih = h - 2 * pad;
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = C.line;
      ctx.strokeRect(pad, pad, iw, ih);

      function X(x) { return pad + x * iw; }
      function Y(y) { return pad + (1 - clamp(y, -0.15, 1.15)) / 1.3 * ih + 0; }
      function Yc(y) { return pad + (1 - (clamp(y, -0.15, 1.15) + 0.15) / 1.3) * ih; }

      /* truth (dashed) */
      ctx.strokeStyle = C.faint;
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (var i = 0; i <= 120; i++) {
        var x = i / 120;
        var y = truth(x);
        if (i === 0) { ctx.moveTo(X(x), Yc(y)); } else { ctx.lineTo(X(x), Yc(y)); }
      }
      ctx.stroke();
      ctx.setLineDash([]);

      /* model curve */
      ctx.strokeStyle = C.teal;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (var i2 = 0; i2 <= 200; i2++) {
        var x2 = i2 / 200;
        var y2 = predictDeg(x2, d);
        if (i2 === 0) { ctx.moveTo(X(x2), Yc(y2)); } else { ctx.lineTo(X(x2), Yc(y2)); }
      }
      ctx.stroke();

      /* points: train solid amber, val hollow violet */
      train.forEach(function (p) {
        ctx.fillStyle = C.amber;
        ctx.beginPath();
        ctx.arc(X(p.x), Yc(p.y), 4, 0, Math.PI * 2);
        ctx.fill();
      });
      val.forEach(function (p) {
        ctx.strokeStyle = C.violet;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(X(p.x), Yc(p.y), 4.5, 0, Math.PI * 2);
        ctx.stroke();
      });

      ctx.fillStyle = C.faint;
      ctx.font = '600 11px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('solid = training · hollow = validation · dashed = truth', pad + 6, pad + 16);

      /* error chart */
      var curves = computeErrCurves();
      var ew = ev.state.w, eh = ev.state.h, epad = 32;
      ectx.clearRect(0, 0, ew, eh);
      ectx.strokeStyle = C.line;
      ectx.strokeRect(epad, epad, ew - 2 * epad, eh - 2 * epad);
      ectx.fillStyle = C.faint;
      ectx.font = '600 11px Inter, sans-serif';
      ectx.textAlign = 'center';
      ectx.fillText('error vs. complexity', ew / 2, 18);
      ectx.save();
      ectx.translate(12, eh / 2);
      ectx.rotate(-Math.PI / 2);
      ectx.fillText('error (log scale)', 0, 0);
      ectx.restore();

      var logs = curves.train.concat(curves.val).map(function (v) { return Math.log10(Math.max(v, 1e-6)); });
      var lmin = Math.min.apply(null, logs), lmax = Math.max.apply(null, logs);
      if (lmax - lmin < 0.5) { lmax = lmin + 0.5; }

      function EX(dg) { return epad + (dg - 1) / (MAXDEG - 1) * (ew - 2 * epad); }
      function EY(v) {
        var lg = Math.log10(Math.max(v, 1e-6));
        return epad + (1 - (lg - lmin) / (lmax - lmin)) * (eh - 2 * epad);
      }

      [['train', C.amber], ['val', C.violet]].forEach(function (pair) {
        ectx.strokeStyle = pair[1];
        ectx.lineWidth = 2;
        ectx.beginPath();
        curves[pair[0]].forEach(function (v, i3) {
          var x3 = EX(i3 + 1), y3 = EY(v);
          if (i3 === 0) { ectx.moveTo(x3, y3); } else { ectx.lineTo(x3, y3); }
        });
        ectx.stroke();
      });

      /* current degree marker */
      ectx.strokeStyle = C.teal;
      ectx.setLineDash([4, 4]);
      ectx.beginPath();
      ectx.moveTo(EX(d), epad);
      ectx.lineTo(EX(d), eh - epad);
      ectx.stroke();
      ectx.setLineDash([]);
      ectx.textAlign = 'left';
      ectx.fillStyle = C.amber;
      ectx.fillText('train', epad + 6, epad + 14);
      ectx.fillStyle = C.violet;
      ectx.fillText('validation', epad + 6, epad + 28);

      /* stats + verdict */
      var tErr = curves.train[d - 1];
      var vErr = curves.val[d - 1];
      if (outTrain) { outTrain.textContent = fmt(tErr, 4); }
      if (outVal) { outVal.textContent = fmt(vErr, 4); }
      if (degOut) { degOut.textContent = String(d); }
      if (verdictEl) {
        var minVal = Math.min.apply(null, curves.val);
        var bestDeg = curves.val.indexOf(minVal) + 1;
        var cls, label;
        if (vErr > minVal * 1.6 && d > bestDeg) { cls = 'is-over'; label = 'Overfitting'; }
        else if (vErr > minVal * 1.6 && d < bestDeg) { cls = 'is-under'; label = 'Underfitting'; }
        else { cls = 'is-good'; label = 'Good fit'; }
        verdictEl.className = 'ml-fit-verdict ' + cls;
        verdictEl.textContent = label;
      }
    }

    if (degSlider) { degSlider.addEventListener('input', drawAll); }
    var bNew = $('#ml-fit-newdata');
    if (bNew) {
      bNew.addEventListener('click', function () {
        seed = Math.floor(Math.random() * 1e9);
        genData();
        drawAll();
      });
    }

    genData();
    drawAll();
  }

  /* ==========================================================================
     11 — Train / validation / test split (illustrative numbers)
     ========================================================================== */

  function initSplit() {
    var viz = $('#ml-split-viz');
    if (!viz) { return; }
    var slider = $('#ml-split-train');
    var sliderOut = $('#ml-split-train-out');
    var leak = $('#ml-split-leak');
    var outReported = $('#ml-split-reported');
    var outReal = $('#ml-split-real');
    var N = 100;
    var cells = [];
    var order = [];

    for (var i = 0; i < N; i++) {
      var cell = document.createElement('div');
      cell.className = 'ml-split-cell';
      viz.appendChild(cell);
      cells.push(cell);
      order.push(i);
    }

    function shuffleOrder() {
      for (var i2 = order.length - 1; i2 > 0; i2--) {
        var j = Math.floor(Math.random() * (i2 + 1));
        var t = order[i2]; order[i2] = order[j]; order[j] = t;
      }
    }

    function apply() {
      var t = slider ? parseInt(slider.value, 10) : 70;
      if (sliderOut) { sliderOut.textContent = t + '%'; }
      var nTrain = t;
      var nVal = Math.ceil((N - t) / 2);
      var leaking = leak && leak.checked;

      var testIdx = [];
      order.forEach(function (idx, pos) {
        var el = cells[idx];
        el.className = 'ml-split-cell';
        el.style.transitionDelay = reduced() ? '0ms' : (pos * 4) + 'ms';
        if (pos < nTrain) { el.classList.add('is-train'); }
        else if (pos < nTrain + nVal) { el.classList.add('is-val'); }
        else { el.classList.add('is-test'); testIdx.push(idx); }
      });

      if (leaking) {
        /* some test rows were duplicated into training */
        testIdx.slice(0, Math.max(3, Math.floor(testIdx.length * 0.5))).forEach(function (idx) {
          cells[idx].classList.add('is-leak');
        });
      }

      /* illustrative scores: small val/test sets measure less reliably */
      var real = 84 + (t - 70) * 0.08;
      var reported = leaking ? 96.5 : real + 0.7;
      if (outReported) {
        outReported.textContent = fmt(reported, 1) + '%';
      }
      if (outReal) { outReal.textContent = fmt(real, 1) + '%'; }
    }

    if (slider) { slider.addEventListener('input', apply); }
    if (leak) { leak.addEventListener('change', apply); }
    var bShuffle = $('#ml-split-shuffle');
    if (bShuffle) {
      bShuffle.addEventListener('click', function () {
        shuffleOrder();
        apply();
      });
    }

    shuffleOrder();
    apply();
  }

  /* ==========================================================================
     12 — Evaluation metrics (threshold over score distributions)
     ========================================================================== */

  function initMetrics() {
    var canvas = $('#ml-met-canvas');
    if (!canvas) { return; }
    var cv = setupCanvas(canvas, draw);
    var ctx = cv.ctx;
    var slider = $('#ml-met-thresh');
    var sliderOut = $('#ml-met-thresh-out');
    var outs = {
      tp: $('#ml-met-tp'), fn: $('#ml-met-fn'), fp: $('#ml-met-fp'), tn: $('#ml-met-tn'),
      acc: $('#ml-met-acc'), prec: $('#ml-met-prec'), rec: $('#ml-met-rec'), f1: $('#ml-met-f1')
    };
    var rng = makeRng(97);

    var spam = [];
    var ham = [];
    for (var i = 0; i < 380; i++) { spam.push(clamp(64 + gauss(rng) * 14, 0, 100)); }
    for (var j = 0; j < 620; j++) { ham.push(clamp(34 + gauss(rng) * 13, 0, 100)); }

    var BINS = 50;
    function hist(arr) {
      var h = new Array(BINS).fill(0);
      arr.forEach(function (v) { h[clamp(Math.floor(v / 100 * BINS), 0, BINS - 1)]++; });
      return h;
    }
    var hSpam = hist(spam);
    var hHam = hist(ham);
    var hMax = Math.max(Math.max.apply(null, hSpam), Math.max.apply(null, hHam));

    function threshold() { return slider ? parseInt(slider.value, 10) : 50; }

    function draw() {
      var w = cv.state.w, h = cv.state.h, pad = 32;
      var iw = w - 2 * pad, ih = h - 2 * pad;
      ctx.clearRect(0, 0, w, h);
      drawFrameAxes(ctx, w, h, pad, 'spam score (model output)', 'emails');

      var T = threshold();
      var tx = pad + T / 100 * iw;

      /* flagged region */
      ctx.fillStyle = 'rgba(225,29,72,0.06)';
      ctx.fillRect(tx, pad, pad + iw - tx, ih);

      function drawHist(hh, color) {
        ctx.fillStyle = color;
        for (var b = 0; b < BINS; b++) {
          var bh = hh[b] / hMax * ih;
          ctx.fillRect(pad + b / BINS * iw + 0.5, pad + ih - bh, iw / BINS - 1, bh);
        }
      }
      drawHist(hHam, 'rgba(2,132,199,0.55)');
      drawHist(hSpam, 'rgba(225,29,72,0.5)');

      /* threshold line */
      ctx.strokeStyle = C.teal;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(tx, pad - 4);
      ctx.lineTo(tx, pad + ih);
      ctx.stroke();
      ctx.fillStyle = C.teal;
      ctx.font = '700 11px Inter, sans-serif';
      ctx.textAlign = T > 80 ? 'right' : 'left';
      ctx.fillText('flag as spam →', tx + (T > 80 ? -6 : 6), pad + 12);

      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(2,132,199,1)';
      ctx.fillText('■ legit mail', pad + 6, pad - 6);
      ctx.fillStyle = 'rgba(225,29,72,1)';
      ctx.fillText('■ spam', pad + 90, pad - 6);

      /* metrics */
      var tp = 0, fn = 0, fp = 0, tn = 0;
      spam.forEach(function (v) { if (v >= T) { tp++; } else { fn++; } });
      ham.forEach(function (v) { if (v >= T) { fp++; } else { tn++; } });
      var acc = (tp + tn) / (tp + tn + fp + fn);
      var prec = tp + fp > 0 ? tp / (tp + fp) : 0;
      var rec = tp + fn > 0 ? tp / (tp + fn) : 0;
      var f1 = prec + rec > 0 ? 2 * prec * rec / (prec + rec) : 0;

      if (outs.tp) { outs.tp.textContent = String(tp); }
      if (outs.fn) { outs.fn.textContent = String(fn); }
      if (outs.fp) { outs.fp.textContent = String(fp); }
      if (outs.tn) { outs.tn.textContent = String(tn); }
      if (outs.acc) { outs.acc.textContent = fmt(acc * 100, 1) + '%'; }
      if (outs.prec) { outs.prec.textContent = fmt(prec * 100, 1) + '%'; }
      if (outs.rec) { outs.rec.textContent = fmt(rec * 100, 1) + '%'; }
      if (outs.f1) { outs.f1.textContent = fmt(f1 * 100, 1) + '%'; }
      if (sliderOut) { sliderOut.textContent = String(T); }
    }

    if (slider) { slider.addEventListener('input', draw); }
    var bStrict = $('#ml-met-strict');
    if (bStrict) { bStrict.addEventListener('click', function () { if (slider) { slider.value = '74'; } draw(); }); }
    var bLoose = $('#ml-met-loose');
    if (bLoose) { bLoose.addEventListener('click', function () { if (slider) { slider.value = '26'; } draw(); }); }

    draw();
  }

  /* ==========================================================================
     THE ML LAB — classification (tiny MLP), regression (polynomial GD),
     clustering (k-means)
     ========================================================================== */

  function initLab() {
    var canvas = $('#ml-lab-canvas');
    var lossCanvas = $('#ml-lab-loss');
    if (!canvas || !lossCanvas) { return; }
    var cv = setupCanvas(canvas, function () { drawStage(); });
    var lv = setupCanvas(lossCanvas, function () { drawLoss(); });
    var ctx = cv.ctx;
    var lctx = lv.ctx;

    var el = {
      taskClf: $('#ml-lab-task-clf'), taskReg: $('#ml-lab-task-reg'), taskClu: $('#ml-lab-task-clu'),
      n: $('#ml-lab-n'), nOut: $('#ml-lab-n-out'),
      noise: $('#ml-lab-noise'), noiseOut: $('#ml-lab-noise-out'),
      complex: $('#ml-lab-complex'), complexOut: $('#ml-lab-complex-out'),
      lr: $('#ml-lab-lr'), lrOut: $('#ml-lab-lr-out'),
      iters: $('#ml-lab-iters'), itersOut: $('#ml-lab-iters-out'),
      train: $('#ml-lab-train'), newdata: $('#ml-lab-newdata'),
      trainm: $('#ml-lab-trainm'), valm: $('#ml-lab-valm'), diag: $('#ml-lab-diag'),
      note: $('#ml-lab-note')
    };

    var task = 'clf';
    var seed = 1234;
    var data = null;        /* {train:[], val:[]} */
    var model = null;
    var lossHist = { train: [], val: [] };
    var trainingToken = 0;

    function P(name) {
      var v = el[name] ? parseInt(el[name].value, 10) : 0;
      return v;
    }
    function labLr() { return 0.01 * Math.pow(100, P('lr') / 100); } /* 0.01 .. 1.0 */

    function refreshOuts() {
      if (el.nOut) { el.nOut.textContent = String(P('n')); }
      if (el.noiseOut) { el.noiseOut.textContent = P('noise') + '%'; }
      if (el.complexOut) { el.complexOut.textContent = String(P('complex')); }
      if (el.lrOut) { el.lrOut.textContent = fmt(labLr(), 2); }
      if (el.itersOut) { el.itersOut.textContent = String(P('iters')); }
      var lrLabel = el.lr ? el.lr.closest('.ml-slider-label') : null;
      if (lrLabel) { lrLabel.classList.toggle('is-disabled', task === 'clu'); }
    }

    /* ---------- data generation ---------- */

    function genData() {
      var rng = makeRng(seed);
      var n = P('n');
      var noise = P('noise') / 100;
      var all = [];
      if (task === 'clf') {
        /* two interleaved moons */
        for (var i = 0; i < n; i++) {
          var label = i % 2;
          var t = rng() * Math.PI;
          var x, y;
          if (label === 0) {
            x = 0.5 + 0.32 * Math.cos(t) - 0.08;
            y = 0.42 + 0.32 * Math.sin(t) - 0.05;
          } else {
            x = 0.5 - 0.32 * Math.cos(t) + 0.08;
            y = 0.58 - 0.32 * Math.sin(t) + 0.05;
          }
          x += gauss(rng) * (0.02 + noise * 0.12);
          y += gauss(rng) * (0.02 + noise * 0.12);
          all.push({ x: clamp(x, 0.02, 0.98), y: clamp(y, 0.02, 0.98), label: label });
        }
      } else if (task === 'reg') {
        for (var i2 = 0; i2 < n; i2++) {
          var xx = rng();
          var yy = 0.5 + 0.3 * Math.sin(2.2 * Math.PI * xx) + gauss(rng) * (0.01 + noise * 0.22);
          all.push({ x: xx, y: clamp(yy, -0.1, 1.1) });
        }
      } else {
        var centers = [];
        var nc = 4;
        for (var c = 0; c < nc; c++) {
          centers.push({ x: 0.15 + rng() * 0.7, y: 0.15 + rng() * 0.7 });
        }
        for (var i3 = 0; i3 < n; i3++) {
          var cc = centers[i3 % nc];
          all.push({
            x: clamp(cc.x + gauss(rng) * (0.045 + noise * 0.1), 0.02, 0.98),
            y: clamp(cc.y + gauss(rng) * (0.045 + noise * 0.1), 0.02, 0.98)
          });
        }
      }
      /* 75/25 split (clustering keeps everything in train) */
      var train = [], val = [];
      all.forEach(function (p, i4) {
        if (task !== 'clu' && i4 % 4 === 3) { val.push(p); } else { train.push(p); }
      });
      data = { train: train, val: val };
      model = null;
      lossHist = { train: [], val: [] };
    }

    /* ---------- classification model: 2 → H → 1 MLP (tanh/sigmoid) ---------- */

    function mlpInit(H) {
      var rng = makeRng(seed + 7);
      var W1 = [], b1 = [], W2 = [], b2 = 0;
      for (var i = 0; i < H; i++) {
        W1.push([gauss(rng) * 0.8, gauss(rng) * 0.8]);
        b1.push(0);
        W2.push(gauss(rng) * 0.8);
      }
      return { H: H, W1: W1, b1: b1, W2: W2, b2: b2 };
    }

    function mlpForward(m, x, y) {
      var hidden = new Array(m.H);
      var z = m.b2;
      for (var i = 0; i < m.H; i++) {
        var a = Math.tanh(m.W1[i][0] * (x * 2 - 1) + m.W1[i][1] * (y * 2 - 1) + m.b1[i]);
        hidden[i] = a;
        z += m.W2[i] * a;
      }
      return { p: 1 / (1 + Math.exp(-z)), hidden: hidden };
    }

    function mlpEpoch(m, set, lr) {
      /* full-batch gradient descent, cross-entropy loss */
      var H = m.H;
      var gW1 = m.W1.map(function () { return [0, 0]; });
      var gb1 = new Array(H).fill(0);
      var gW2 = new Array(H).fill(0);
      var gb2 = 0;
      var n = set.length;
      for (var s = 0; s < n; s++) {
        var p = set[s];
        var out = mlpForward(m, p.x, p.y);
        var dz = out.p - p.label; /* dL/dz for sigmoid + CE */
        gb2 += dz;
        for (var i = 0; i < H; i++) {
          gW2[i] += dz * out.hidden[i];
          var dh = dz * m.W2[i] * (1 - out.hidden[i] * out.hidden[i]);
          gW1[i][0] += dh * (p.x * 2 - 1);
          gW1[i][1] += dh * (p.y * 2 - 1);
          gb1[i] += dh;
        }
      }
      var inv = lr / n;
      m.b2 -= gb2 * inv;
      for (var i2 = 0; i2 < H; i2++) {
        m.W2[i2] -= gW2[i2] * inv;
        m.W1[i2][0] -= gW1[i2][0] * inv;
        m.W1[i2][1] -= gW1[i2][1] * inv;
        m.b1[i2] -= gb1[i2] * inv;
      }
    }

    function ceLoss(m, set) {
      var s = 0;
      set.forEach(function (p) {
        var pr = clamp(mlpForward(m, p.x, p.y).p, 1e-7, 1 - 1e-7);
        s += -(p.label * Math.log(pr) + (1 - p.label) * Math.log(1 - pr));
      });
      return set.length ? s / set.length : 0;
    }

    function clfAccuracy(m, set) {
      if (!set.length) { return 0; }
      var ok = 0;
      set.forEach(function (p) {
        if ((mlpForward(m, p.x, p.y).p > 0.5 ? 1 : 0) === p.label) { ok++; }
      });
      return ok / set.length;
    }

    /* ---------- regression model: polynomial trained by GD ---------- */

    function regInit(deg) {
      return { deg: deg, w: new Array(deg + 1).fill(0) };
    }

    function regFeatures(x, deg) {
      var t = x * 2 - 1;
      var out = [1];
      for (var d = 1; d <= deg; d++) { out.push(Math.pow(t, d)); }
      return out;
    }

    function regPredict(m, x) {
      var phi = regFeatures(x, m.deg);
      var s = 0;
      for (var i = 0; i < m.w.length; i++) { s += m.w[i] * phi[i]; }
      return s;
    }

    function regEpoch(m, set, lr) {
      var g = new Array(m.w.length).fill(0);
      var n = set.length;
      for (var s = 0; s < n; s++) {
        var p = set[s];
        var phi = regFeatures(p.x, m.deg);
        var e = regPredict(m, p.x) - p.y;
        for (var i = 0; i < g.length; i++) { g[i] += 2 * e * phi[i]; }
      }
      var inv = lr / n;
      for (var i2 = 0; i2 < m.w.length; i2++) { m.w[i2] -= g[i2] * inv; }
    }

    function regLoss(m, set) {
      var s = 0;
      set.forEach(function (p) { var d = regPredict(m, p.x) - p.y; s += d * d; });
      return set.length ? s / set.length : 0;
    }

    /* ---------- clustering: k-means ---------- */

    function cluInit(k) {
      var rng = makeRng(seed + 13);
      var pts = data.train;
      var centroids = [];
      var used = {};
      k = clamp(k, 1, 8);
      var guard = 0;
      while (centroids.length < k && guard++ < 500) {
        var idx = Math.floor(rng() * pts.length);
        if (used[idx]) { continue; }
        used[idx] = true;
        centroids.push({ x: pts[idx].x, y: pts[idx].y });
      }
      return { k: k, centroids: centroids, assign: pts.map(function () { return 0; }) };
    }

    function cluStep(m) {
      var pts = data.train;
      for (var i = 0; i < pts.length; i++) {
        var best = 0, bd = Infinity;
        for (var c = 0; c < m.centroids.length; c++) {
          var dx = pts[i].x - m.centroids[c].x, dy = pts[i].y - m.centroids[c].y;
          var d = dx * dx + dy * dy;
          if (d < bd) { bd = d; best = c; }
        }
        m.assign[i] = best;
      }
      for (var c2 = 0; c2 < m.centroids.length; c2++) {
        var sx = 0, sy = 0, n = 0;
        for (var j = 0; j < pts.length; j++) {
          if (m.assign[j] === c2) { sx += pts[j].x; sy += pts[j].y; n++; }
        }
        if (n > 0) { m.centroids[c2].x = sx / n; m.centroids[c2].y = sy / n; }
      }
    }

    function cluInertia(m) {
      var pts = data.train;
      var s = 0;
      for (var i = 0; i < pts.length; i++) {
        var c = m.centroids[m.assign[i]];
        var dx = pts[i].x - c.x, dy = pts[i].y - c.y;
        s += dx * dx + dy * dy;
      }
      return pts.length ? s / pts.length : 0;
    }

    /* ---------- drawing ---------- */

    function drawStage() {
      var w = cv.state.w, h = cv.state.h, pad = 26;
      var iw = w - 2 * pad, ih = h - 2 * pad;
      ctx.clearRect(0, 0, w, h);

      function X(x) { return pad + x * iw; }
      function Y(y) { return pad + (1 - y) * ih; }

      if (!data) { return; }

      if (task === 'clf') {
        if (model) {
          var GX = 34, GY = 24;
          for (var gy = 0; gy < GY; gy++) {
            for (var gx = 0; gx < GX; gx++) {
              var ux = (gx + 0.5) / GX, uy = 1 - (gy + 0.5) / GY;
              var p = mlpForward(model, ux, uy).p;
              var a = Math.abs(p - 0.5) * 0.5;
              ctx.fillStyle = p > 0.5
                ? 'rgba(225,29,72,' + a + ')'
                : 'rgba(2,132,199,' + a + ')';
              ctx.fillRect(pad + gx / GX * iw, pad + gy / GY * ih, iw / GX + 1, ih / GY + 1);
            }
          }
        }
        data.train.forEach(function (p2) {
          ctx.fillStyle = p2.label ? C.rose : C.sky;
          ctx.beginPath();
          ctx.arc(X(p2.x), Y(p2.y), 3.6, 0, Math.PI * 2);
          ctx.fill();
        });
        data.val.forEach(function (p3) {
          ctx.strokeStyle = p3.label ? C.rose : C.sky;
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.arc(X(p3.x), Y(p3.y), 4.2, 0, Math.PI * 2);
          ctx.stroke();
        });
      } else if (task === 'reg') {
        if (model) {
          ctx.strokeStyle = C.teal;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          for (var i = 0; i <= 200; i++) {
            var x = i / 200;
            var y = clamp(regPredict(model, x), -0.15, 1.15);
            var yy = pad + (1 - (y + 0.15) / 1.3) * ih;
            if (i === 0) { ctx.moveTo(X(x), yy); } else { ctx.lineTo(X(x), yy); }
          }
          ctx.stroke();
        }
        data.train.forEach(function (p4) {
          ctx.fillStyle = C.amber;
          ctx.beginPath();
          ctx.arc(X(p4.x), pad + (1 - (p4.y + 0.15) / 1.3) * ih, 3.6, 0, Math.PI * 2);
          ctx.fill();
        });
        data.val.forEach(function (p5) {
          ctx.strokeStyle = C.violet;
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.arc(X(p5.x), pad + (1 - (p5.y + 0.15) / 1.3) * ih, 4.2, 0, Math.PI * 2);
          ctx.stroke();
        });
      } else {
        data.train.forEach(function (p6, i5) {
          ctx.fillStyle = model ? SERIES[model.assign[i5] % SERIES.length] : C.muted;
          ctx.globalAlpha = 0.85;
          ctx.beginPath();
          ctx.arc(X(p6.x), Y(p6.y), 3.6, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.globalAlpha = 1;
        if (model) {
          model.centroids.forEach(function (c, i6) {
            var x2 = X(c.x), y2 = Y(c.y);
            ctx.strokeStyle = SERIES[i6 % SERIES.length];
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(x2 - 7, y2 - 7); ctx.lineTo(x2 + 7, y2 + 7);
            ctx.moveTo(x2 - 7, y2 + 7); ctx.lineTo(x2 + 7, y2 - 7);
            ctx.stroke();
          });
        }
      }

      ctx.strokeStyle = C.line;
      ctx.strokeRect(pad, pad, iw, ih);
    }

    function drawLoss() {
      var w = lv.state.w, h = lv.state.h, pad = 28;
      lctx.clearRect(0, 0, w, h);
      lctx.strokeStyle = C.line;
      lctx.strokeRect(pad, pad, w - 2 * pad, h - 2 * pad);
      lctx.fillStyle = C.faint;
      lctx.font = '600 11px Inter, sans-serif';
      lctx.textAlign = 'center';
      lctx.fillText(task === 'clu' ? 'inertia over k-means steps' : 'loss over iterations (teal = train, violet = validation)', w / 2, 17);

      var hs = [lossHist.train, lossHist.val];
      var all = hs[0].concat(hs[1]).filter(isFinite);
      if (all.length < 2) { return; }
      var maxL = Math.max.apply(null, all);
      var minL = Math.min.apply(null, all);
      if (maxL - minL < 1e-9) { maxL = minL + 1e-9; }

      [[lossHist.train, C.teal], [lossHist.val, C.violet]].forEach(function (pair) {
        var series = pair[0];
        if (series.length < 2) { return; }
        lctx.strokeStyle = pair[1];
        lctx.lineWidth = 2;
        lctx.beginPath();
        series.forEach(function (v, i) {
          var x = pad + i / (series.length - 1) * (w - 2 * pad);
          var y = pad + (1 - (clamp(v, minL, maxL) - minL) / (maxL - minL)) * (h - 2 * pad);
          if (i === 0) { lctx.moveTo(x, y); } else { lctx.lineTo(x, y); }
        });
        lctx.stroke();
      });
    }

    function updateStats(finished) {
      if (!data || !model) { return; }
      if (task === 'clf') {
        var ta = clfAccuracy(model, data.train);
        var va = clfAccuracy(model, data.val);
        if (el.trainm) { el.trainm.textContent = fmt(ta * 100, 0) + '% acc'; }
        if (el.valm) { el.valm.textContent = fmt(va * 100, 0) + '% acc'; }
        if (el.diag && finished) {
          var tl = ceLoss(model, data.train);
          var vl = ceLoss(model, data.val);
          el.diag.textContent = diagnose(tl, vl, ta, va);
        }
      } else if (task === 'reg') {
        var tr = Math.sqrt(regLoss(model, data.train));
        var vr = Math.sqrt(regLoss(model, data.val));
        if (el.trainm) { el.trainm.textContent = 'RMSE ' + fmt(tr, 3); }
        if (el.valm) { el.valm.textContent = 'RMSE ' + fmt(vr, 3); }
        if (el.diag && finished) {
          el.diag.textContent = diagnose(tr, vr, null, null);
        }
      } else {
        if (el.trainm) { el.trainm.textContent = 'inertia ' + fmt(cluInertia(model), 4); }
        if (el.valm) { el.valm.textContent = 'n/a'; }
        if (el.diag && finished) {
          el.diag.textContent = 'no labels — you judge whether k=' + model.k + ' fits the structure';
        }
      }
    }

    function diagnose(trainLoss, valLoss, trainAcc, valAcc) {
      if (!isFinite(trainLoss) || !isFinite(valLoss)) { return 'diverged — lower the learning rate'; }
      if (trainAcc !== null) {
        if (trainAcc < 0.72 && valAcc < 0.72) { return 'underfitting — model too simple or undertrained'; }
        if (trainAcc - valAcc > 0.13) { return 'overfitting — memorizing the training set'; }
        return 'healthy fit — generalizing well';
      }
      if (valLoss > trainLoss * 1.8 && trainLoss < 0.12) { return 'overfitting — memorizing noise'; }
      if (trainLoss > 0.22) { return 'underfitting — model too simple or undertrained'; }
      return 'healthy fit — generalizing well';
    }

    /* ---------- training driver ---------- */

    function train() {
      if (!data) { genData(); }
      var token = ++trainingToken;
      var iters = P('iters');
      var lr = labLr();
      var complex = P('complex');
      lossHist = { train: [], val: [] };

      if (el.diag) { el.diag.textContent = 'training…'; }

      if (task === 'clu') {
        model = cluInit(complex);
        var steps = Math.max(2, Math.round(iters / 25));
        var s = 0;
        var doStep = function () {
          if (token !== trainingToken) { return; }
          cluStep(model);
          lossHist.train.push(cluInertia(model));
          s++;
          drawStage();
          drawLoss();
          updateStats(s >= steps);
          if (s < steps) {
            if (reduced()) { doStep(); } else { setTimeout(doStep, 320); }
          }
        };
        doStep();
        return;
      }

      model = task === 'clf' ? mlpInit(complex) : regInit(clamp(complex, 1, 15));
      var done = 0;
      var chunkSize = reduced() ? iters : Math.max(2, Math.round(iters / 60));

      function record() {
        if (task === 'clf') {
          lossHist.train.push(ceLoss(model, data.train));
          lossHist.val.push(ceLoss(model, data.val));
        } else {
          lossHist.train.push(regLoss(model, data.train));
          lossHist.val.push(regLoss(model, data.val));
        }
      }

      record();
      (function chunk() {
        if (token !== trainingToken) { return; }
        for (var i = 0; i < chunkSize && done < iters; i++) {
          if (task === 'clf') { mlpEpoch(model, data.train, lr); }
          else { regEpoch(model, data.train, lr); }
          done++;
        }
        record();
        drawStage();
        drawLoss();
        var finished = done >= iters;
        updateStats(finished);
        if (!finished) { requestAnimationFrame(chunk); }
      })();
    }

    /* ---------- wiring ---------- */

    function setTask(t) {
      task = t;
      trainingToken++;
      if (el.taskClf) { el.taskClf.classList.toggle('is-active', t === 'clf'); }
      if (el.taskReg) { el.taskReg.classList.toggle('is-active', t === 'reg'); }
      if (el.taskClu) { el.taskClu.classList.toggle('is-active', t === 'clu'); }
      if (el.note) {
        el.note.textContent = t === 'clf'
          ? 'Solid dots train the model; hollow dots are held-out validation data. Complexity = hidden neurons in a tiny real neural network.'
          : t === 'reg'
            ? 'Solid dots train the model; hollow dots are validation. Complexity = polynomial degree. Crank it up with few points and watch validation loss climb.'
            : 'No labels here — complexity chooses k, and iterations become k-means steps. There is no validation score, because there are no right answers.';
      }
      if (el.trainm) { el.trainm.textContent = '—'; }
      if (el.valm) { el.valm.textContent = '—'; }
      if (el.diag) { el.diag.textContent = '—'; }
      refreshOuts();
      genData();
      drawStage();
      drawLoss();
    }

    if (el.taskClf) { el.taskClf.addEventListener('click', function () { setTask('clf'); }); }
    if (el.taskReg) { el.taskReg.addEventListener('click', function () { setTask('reg'); }); }
    if (el.taskClu) { el.taskClu.addEventListener('click', function () { setTask('clu'); }); }

    ['n', 'noise'].forEach(function (name) {
      if (el[name]) {
        el[name].addEventListener('input', function () {
          refreshOuts();
          trainingToken++;
          genData();
          drawStage();
          drawLoss();
        });
      }
    });
    ['complex', 'lr', 'iters'].forEach(function (name) {
      if (el[name]) { el[name].addEventListener('input', refreshOuts); }
    });

    if (el.train) { el.train.addEventListener('click', train); }
    if (el.newdata) {
      el.newdata.addEventListener('click', function () {
        seed = Math.floor(Math.random() * 1e9);
        trainingToken++;
        genData();
        drawStage();
        drawLoss();
        if (el.diag) { el.diag.textContent = '—'; }
      });
    }

    function setSliders(vals) {
      Object.keys(vals).forEach(function (k) {
        if (el[k]) { el[k].value = String(vals[k]); }
      });
      refreshOuts();
      trainingToken++;
      genData();
      drawStage();
      train();
    }

    var rUnder = $('#ml-lab-rec-under');
    if (rUnder) { rUnder.addEventListener('click', function () { setTask('clf'); setSliders({ n: 160, noise: 20, complex: 1, lr: 50, iters: 300 }); }); }
    var rOver = $('#ml-lab-rec-over');
    if (rOver) { rOver.addEventListener('click', function () { setTask('clf'); setSliders({ n: 30, noise: 45, complex: 16, lr: 70, iters: 600 }); }); }
    var rNoisy = $('#ml-lab-rec-noisy');
    if (rNoisy) { rNoisy.addEventListener('click', function () { setTask('clf'); setSliders({ n: 120, noise: 100, complex: 6, lr: 50, iters: 300 }); }); }
    var rWild = $('#ml-lab-rec-wild');
    if (rWild) { rWild.addEventListener('click', function () { setTask('reg'); setSliders({ n: 100, noise: 25, complex: 9, lr: 100, iters: 400 }); }); }

    refreshOuts();
    setTask('clf');
  }

  /* ==========================================================================
     Boot
     ========================================================================== */

  function boot() {
    [
      initReveal, initRail, initHero, initParadigm, initLandscape,
      initData, initSupervised, initUnsupervised, initRL,
      initTraining, initLoss, initGD, initFit, initSplit, initMetrics,
      initLab
    ].forEach(function (fn) {
      try { fn(); } catch (e) {
        if (window.console && console.warn) { console.warn('[ml] widget failed:', fn.name, e); }
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
