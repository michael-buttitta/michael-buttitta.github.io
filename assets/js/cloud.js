/* =============================================================================
   Understanding Cloud Computing — interactivity
   Vanilla JS, no dependencies. Loaded with `defer` on /cloud/ only.

   Structure:
     1. Shared utilities (canvas fitting, visibility gating, rAF loops) —
        the same toolkit as the other exhibits
     2. One init function per widget, each guarded by element existence and
        wrapped in try/catch so one failure never takes down the page
     3. Everything respects prefers-reduced-motion: ambient animation is
        disabled and story animations jump to labeled final states

   Honesty notes: the Kubernetes pod scheduler is a real least-loaded,
   capacity-constrained placement algorithm — it walks the alive nodes, picks
   the one holding the fewest pods with room left, genuinely reschedules when
   a node dies, and genuinely leaves pods Pending when the cluster is full.
   The architecture builder's scoring model is likewise real: latency, cost,
   the HA verdict, and the grade are computed from the components you pick,
   and every deduction is logged. The hero globe, the request path, the
   demand curve, the region map, the auto-scaler and serverless animations,
   and all latency and dollar figures are illustrative models with honest
   ratios, built to teach the concepts and not emulations of any provider.
   The captions in the HTML say so where it matters.
   ============================================================================ */

(function () {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  document.documentElement.classList.add('cl-js');

  var RM = window.matchMedia('(prefers-reduced-motion: reduce)');
  function reduced() { return RM.matches; }

  function fmt(n) {
    n = Math.round(n);
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

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

  function easeInOut(p) { return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; }

  /* A simple seeded PRNG so ambient scenes are repeatable. */
  function makeRng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  /* Draw a labeled node box; returns its center. */
  function drawNodeBox(ctx, x, y, w, h, label, color, opts) {
    opts = opts || {};
    roundRect(ctx, x - w / 2, y - h / 2, w, h, 8);
    ctx.fillStyle = opts.fill || C.deep;
    ctx.fill();
    ctx.lineWidth = opts.hot ? 2.2 : 1.4;
    ctx.strokeStyle = opts.hot ? C.teal : (color || C.lineStrong);
    if (opts.dashed) { ctx.setLineDash([5, 4]); }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '600 11px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = opts.hot ? C.teal : C.text;
    ctx.fillText(label, x, y);
  }

  function drawGlowDot(ctx, x, y, r, color) {
    ctx.beginPath();
    ctx.arc(x, y, r * 2.4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.14;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  /* ==========================================================================
     Reveal-on-scroll + chapter rail
     ========================================================================== */

  function initReveal() {
    var targets = $$('#cloud-experience [data-cl-reveal]');
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
    var dots = $$('#cloud-experience .cl-rail-dot');
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
     HERO — ambient scene: a stylized globe ringed by cloud regions; user
     requests stream in from the edges while each region's server stack
     gently scales up and down.
     ========================================================================== */

  function initHero() {
    var canvas = $('#cl-hero-canvas');
    if (!canvas) { return; }
    var cv = setupCanvas(canvas, function () { draw(lastT); });
    var ctx = cv.ctx, st = cv.state;
    var rng = makeRng(20260729);
    var lastT = 0;

    var regions = [];
    var users = [];
    var packets = [];
    var i;
    for (i = 0; i < 6; i++) {
      regions.push({ ang: (i / 6) * Math.PI * 2 - Math.PI / 2, phase: rng() * Math.PI * 2 });
    }
    for (i = 0; i < 14; i++) {
      users.push({ ang: rng() * Math.PI * 2, rr: 0.82 + rng() * 0.14, tw: rng() * Math.PI * 2 });
    }

    function geom() {
      var cx = st.w / 2, cy = st.h / 2;
      var R = Math.min(st.w, st.h) * 0.21;
      var orbit = Math.min(st.w, st.h) * 0.36;
      return { cx: cx, cy: cy, R: R, orbit: orbit };
    }

    function regionPos(g, r) {
      return { x: g.cx + Math.cos(r.ang) * g.orbit, y: g.cy + Math.sin(r.ang) * g.orbit * 0.82 };
    }

    function userPos(g, u) {
      var rx = st.w * 0.5 * u.rr, ry = st.h * 0.5 * u.rr;
      return { x: g.cx + Math.cos(u.ang) * rx, y: g.cy + Math.sin(u.ang) * ry };
    }

    function draw(t) {
      if (st.w < 60 || st.h < 60) { return; }
      lastT = t;
      ctx.clearRect(0, 0, st.w, st.h);
      var g = geom();

      /* globe */
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(51, 65, 85, 0.9)';
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, g.R, 0, Math.PI * 2);
      ctx.stroke();
      var k;
      for (k = 1; k <= 2; k++) {
        ctx.beginPath();
        ctx.ellipse(g.cx, g.cy, g.R, g.R * (k / 3), 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(g.cx, g.cy, g.R * (k / 3), g.R, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      /* regions + their scaling server stacks */
      regions.forEach(function (r) {
        var p = regionPos(g, r);
        ctx.strokeStyle = 'rgba(45, 212, 191, 0.16)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(g.cx + Math.cos(r.ang) * g.R, g.cy + Math.sin(r.ang) * g.R * 0.92);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();

        ctx.fillStyle = C.teal;
        drawGlowDot(ctx, p.x, p.y, 3.2, C.teal);

        var n = 2 + Math.round(1.5 + 1.5 * Math.sin(t / 2600 + r.phase));
        var b;
        for (b = 0; b < n; b++) {
          ctx.fillStyle = 'rgba(45, 212, 191, ' + (0.55 - b * 0.09) + ')';
          ctx.fillRect(p.x - 8, p.y - 10 - b * 5, 16, 3);
        }
      });

      /* users */
      users.forEach(function (u) {
        var p = userPos(g, u);
        ctx.fillStyle = 'rgba(148, 163, 184, ' + (0.35 + 0.25 * Math.sin(t / 900 + u.tw)) + ')';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.8, 0, Math.PI * 2);
        ctx.fill();
      });

      /* packets */
      packets.forEach(function (p) {
        var a = userPos(g, p.u), b = regionPos(g, p.r);
        var mx = (a.x + b.x) / 2 + p.bend, my = (a.y + b.y) / 2 - Math.abs(p.bend) * 0.4;
        var q = easeInOut(p.t);
        var x = (1 - q) * (1 - q) * a.x + 2 * (1 - q) * q * mx + q * q * b.x;
        var y = (1 - q) * (1 - q) * a.y + 2 * (1 - q) * q * my + q * q * b.y;
        ctx.fillStyle = p.back ? 'rgba(101, 163, 13, 0.9)' : 'rgba(45, 212, 191, 0.9)';
        drawGlowDot(ctx, x, y, 2, p.back ? C.lime : C.teal);
      });
    }

    if (reduced()) {
      draw(0);
      onScreen(canvas, function () { draw(0); });
      return;
    }

    var spawn = 0;
    var loop = makeLoop(function (t, dt) {
      spawn -= dt;
      if (spawn <= 0 && packets.length < 26) {
        spawn = 120 + rng() * 260;
        var back = rng() < 0.35;
        packets.push({
          u: users[Math.floor(rng() * users.length)],
          r: regions[Math.floor(rng() * regions.length)],
          bend: (rng() - 0.5) * 90,
          t: back ? 1 : 0, back: back, speed: 0.00035 + rng() * 0.00025
        });
      }
      packets.forEach(function (p) { p.t += p.speed * dt * (p.back ? -1 : 1); });
      packets = packets.filter(function (p) { return p.back ? p.t > 0.001 : p.t < 1; });
      draw(t);
    });
    onScreen(canvas, function () { loop.start(); }, function () { loop.stop(); });
  }

  /* ==========================================================================
     CH.1 — Follow a request: laptop → router → ISP → backbone → "cloud"
     (which dissolves into a data center) → server rack.
     ========================================================================== */

  function initPath() {
    var canvas = $('#cl-path-canvas');
    var runBtn = $('#cl-path-run');
    var statusEl = $('#cl-path-status');
    if (!canvas || !runBtn) { return; }
    var cv = setupCanvas(canvas, function () { draw(); });
    var ctx = cv.ctx, st = cv.state;

    var HOPS = [
      { fx: 0.08, label: 'Your laptop', note: 'The request starts on your machine — a few hundred bytes asking for a page.' },
      { fx: 0.24, label: 'Home router', note: 'Your router forwards it to your internet service provider.' },
      { fx: 0.40, label: 'ISP', note: 'The ISP hands it to the internet backbone — long-haul fiber between cities.' },
      { fx: 0.56, label: 'Backbone', note: 'A few fiber hops later, it arrives at the destination network…' },
      { fx: 0.76, label: 'Data center', note: '…which is not a cloud at all: it is a building full of servers.' },
      { fx: 0.92, label: 'Server', note: 'A specific machine in a specific rack answers. Total trip: often under 100 ms.' }
    ];

    var anim = { seg: -1, t: 0, cloudAlpha: 1, playing: false, done: false };

    function yMid() { return st.h * 0.56; }

    function drawLaptop(x, y) {
      ctx.strokeStyle = C.sky;
      ctx.lineWidth = 2;
      roundRect(ctx, x - 14, y - 12, 28, 18, 3);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 19, y + 9);
      ctx.lineTo(x + 19, y + 9);
      ctx.stroke();
    }

    function drawRouterIsp(x, y, wide) {
      ctx.strokeStyle = C.muted;
      ctx.lineWidth = 2;
      roundRect(ctx, x - (wide ? 18 : 14), y - 8, (wide ? 36 : 28), 16, 4);
      ctx.stroke();
      ctx.fillStyle = C.muted;
      ctx.beginPath();
      ctx.arc(x - 6, y, 1.6, 0, Math.PI * 2);
      ctx.arc(x + 2, y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }

    function drawBackbone(x, y) {
      ctx.strokeStyle = C.muted;
      ctx.lineWidth = 2;
      var i;
      for (i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.arc(x + i * 10, y + (i === 0 ? -6 : 4), 5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    function drawDataCenter(x, y, alpha) {
      ctx.save();
      ctx.globalAlpha = alpha;
      var w = 74, h = 54;
      roundRect(ctx, x - w / 2, y - h / 2, w, h, 5);
      ctx.fillStyle = '#101a30';
      ctx.fill();
      ctx.strokeStyle = C.amber;
      ctx.lineWidth = 2;
      ctx.stroke();
      var r, c;
      for (r = 0; r < 3; r++) {
        for (c = 0; c < 3; c++) {
          ctx.fillStyle = 'rgba(217, 119, 6, 0.5)';
          ctx.fillRect(x - w / 2 + 9 + c * 20, y - h / 2 + 9 + r * 15, 14, 9);
        }
      }
      ctx.restore();
    }

    function drawCloud(x, y, alpha) {
      if (alpha <= 0.01) { return; }
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = C.teal;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(x - 18, y + 4, 12, Math.PI * 0.45, Math.PI * 1.5);
      ctx.arc(x - 4, y - 12, 13, Math.PI * 0.9, Math.PI * 1.95);
      ctx.arc(x + 16, y - 2, 11, Math.PI * 1.25, Math.PI * 0.5);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }

    function drawServer(x, y) {
      ctx.strokeStyle = C.teal;
      ctx.lineWidth = 2;
      roundRect(ctx, x - 12, y - 16, 24, 32, 3);
      ctx.stroke();
      var i;
      for (i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(x - 7, y - 8 + i * 8);
        ctx.lineTo(x + 7, y - 8 + i * 8);
        ctx.stroke();
      }
    }

    function draw() {
      if (st.w < 60 || st.h < 60) { return; }
      ctx.clearRect(0, 0, st.w, st.h);
      var y = yMid();

      /* baseline */
      ctx.strokeStyle = C.line;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(st.w * HOPS[0].fx, y);
      ctx.lineTo(st.w * HOPS[5].fx, y);
      ctx.stroke();
      ctx.setLineDash([]);

      /* hop glyphs + labels */
      HOPS.forEach(function (hp, idx) {
        var x = st.w * hp.fx;
        if (idx === 0) { drawLaptop(x, y); }
        else if (idx === 1) { drawRouterIsp(x, y, false); }
        else if (idx === 2) { drawRouterIsp(x, y, true); }
        else if (idx === 3) { drawBackbone(x, y); }
        else if (idx === 4) { drawDataCenter(x, y, 1 - anim.cloudAlpha); drawCloud(x, y - 2, anim.cloudAlpha); }
        else { drawServer(x, y); }
        ctx.font = '600 11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = (anim.seg >= idx || anim.done) ? C.strong : C.faint;
        var lbl = (idx === 4 && anim.cloudAlpha > 0.5) ? '“The cloud”' : hp.label;
        ctx.fillText(lbl, x, y + 36);
      });

      /* the traveling request */
      if (anim.playing && anim.seg >= 0 && anim.seg < HOPS.length - 1) {
        var a = st.w * HOPS[anim.seg].fx;
        var b = st.w * HOPS[anim.seg + 1].fx;
        var x = a + (b - a) * easeInOut(anim.t);
        ctx.fillStyle = C.teal;
        drawGlowDot(ctx, x, y - 22, 3.5, C.teal);
      }
    }

    var loop = makeLoop(function (t, dt) {
      if (!anim.playing) { draw(); loop.stop(); return; }
      anim.t += dt / 850;
      if (anim.seg >= 2) {
        anim.cloudAlpha = Math.max(0, anim.cloudAlpha - dt / 900);
      }
      if (anim.t >= 1) {
        anim.t = 0;
        anim.seg += 1;
        if (anim.seg < HOPS.length) {
          setStatus(statusEl, HOPS[anim.seg].note);
        }
        if (anim.seg >= HOPS.length - 1) {
          anim.playing = false;
          anim.done = true;
          anim.cloudAlpha = 0;
          setStatus(statusEl, HOPS[5].note + ' “The cloud” was a building all along.', 'ok');
          runBtn.disabled = false;
        }
      }
      draw();
    });

    runBtn.addEventListener('click', function () {
      if (reduced()) {
        anim.seg = HOPS.length - 1;
        anim.cloudAlpha = 0;
        anim.done = true;
        draw();
        setStatus(statusEl, 'Laptop → router → ISP → backbone → data center → server. The “cloud” icon dissolves into what it really is: a building full of computers. Round trip: often under 100 ms.', 'ok');
        return;
      }
      anim.seg = 0;
      anim.t = 0;
      anim.cloudAlpha = 1;
      anim.playing = true;
      anim.done = false;
      runBtn.disabled = true;
      setStatus(statusEl, HOPS[0].note);
      loop.start();
    });

    draw();
    onScreen(canvas, function () { draw(); });
  }

  /* ==========================================================================
     CH.2 — Demand vs capacity: own servers (flat line) vs elastic cloud.
     ========================================================================== */

  function initDemand() {
    var canvas = $('#cl-demand-canvas');
    if (!canvas) { return; }
    var ownBtn = $('#cl-demand-own');
    var cloudBtn = $('#cl-demand-cloud');
    var spike = $('#cl-demand-spike');
    var spikeOut = $('#cl-demand-spike-out');
    var prov = $('#cl-demand-prov');
    var provOut = $('#cl-demand-prov-out');
    var provWrap = $('#cl-demand-prov-wrap');
    var utilEl = $('#cl-demand-util');
    var wasteEl = $('#cl-demand-waste');
    var dropEl = $('#cl-demand-drop');
    var statusEl = $('#cl-demand-status');
    var cv = setupCanvas(canvas, function () { render(); });
    var ctx = cv.ctx, st = cv.state;

    var mode = 'own';

    function demandAt(hour, spikeX) {
      /* base load 1×, small morning bump, big evening peak */
      var morning = 0.5 * Math.exp(-Math.pow(hour - 9, 2) / 5);
      var evening = (spikeX - 1) * Math.exp(-Math.pow(hour - 20, 2) / 6.5);
      return 1 + morning + Math.max(0, evening) + 0.55 * Math.exp(-Math.pow(hour - 13, 2) / 18);
    }

    function capacityAt(hour, spikeX, provX) {
      if (mode === 'own') { return provX; }
      /* elastic: track demand with 15% headroom, stepped per hour */
      return Math.ceil(demandAt(Math.floor(hour), spikeX) * 1.15 * 4) / 4;
    }

    function render() {
      if (st.w < 60 || st.h < 60) { return; }
      var spikeX = parseFloat(spike.value);
      var provX = parseFloat(prov.value);
      spikeOut.textContent = spikeX.toFixed(1) + '×';
      provOut.textContent = provX.toFixed(1) + '×';

      var padL = 44, padR = 14, padT = 18, padB = 30;
      var W = st.w - padL - padR, H = st.h - padT - padB;
      var maxY = 6.5;
      function X(hour) { return padL + (hour / 24) * W; }
      function Y(v) { return padT + H - (v / maxY) * H; }

      ctx.clearRect(0, 0, st.w, st.h);

      /* axes + gridlines */
      ctx.strokeStyle = C.line;
      ctx.lineWidth = 1;
      ctx.font = '500 10px Inter, sans-serif';
      ctx.fillStyle = C.faint;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      var v;
      for (v = 0; v <= 6; v += 2) {
        ctx.beginPath();
        ctx.moveTo(padL, Y(v));
        ctx.lineTo(st.w - padR, Y(v));
        ctx.stroke();
        ctx.fillText(v + '×', padL - 7, Y(v));
      }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      var hh;
      for (hh = 0; hh <= 24; hh += 6) {
        ctx.fillText(hh + ':00', X(hh), padT + H + 8);
      }

      var stepCount = 240;
      var sumD = 0, sumServed = 0, sumCap = 0, sumDrop = 0;

      /* shaded waste (capacity above demand) and outage (demand above capacity) */
      var iSteps;
      for (iSteps = 0; iSteps < stepCount; iSteps++) {
        var h0 = (iSteps / stepCount) * 24;
        var h1 = ((iSteps + 1) / stepCount) * 24;
        var d = demandAt(h0, spikeX);
        var cp = capacityAt(h0, spikeX, provX);
        sumD += d; sumCap += cp;
        sumServed += Math.min(d, cp);
        sumDrop += Math.max(0, d - cp);
        var x0 = X(h0), x1 = X(h1);
        if (cp > d) {
          ctx.fillStyle = 'rgba(2, 132, 199, 0.10)';
          ctx.fillRect(x0, Y(cp), x1 - x0 + 0.5, Y(d) - Y(cp));
        } else if (d > cp) {
          ctx.fillStyle = 'rgba(225, 29, 72, 0.22)';
          ctx.fillRect(x0, Y(d), x1 - x0 + 0.5, Y(cp) - Y(d));
        }
      }

      /* demand curve (lime, filled) */
      ctx.beginPath();
      ctx.moveTo(X(0), Y(0));
      for (iSteps = 0; iSteps <= stepCount; iSteps++) {
        var hr = (iSteps / stepCount) * 24;
        ctx.lineTo(X(hr), Y(demandAt(hr, spikeX)));
      }
      ctx.lineTo(X(24), Y(0));
      ctx.closePath();
      ctx.fillStyle = 'rgba(101, 163, 13, 0.14)';
      ctx.fill();
      ctx.beginPath();
      for (iSteps = 0; iSteps <= stepCount; iSteps++) {
        var hr2 = (iSteps / stepCount) * 24;
        var yy = Y(demandAt(hr2, spikeX));
        if (iSteps === 0) { ctx.moveTo(X(hr2), yy); } else { ctx.lineTo(X(hr2), yy); }
      }
      ctx.strokeStyle = C.lime;
      ctx.lineWidth = 2;
      ctx.stroke();

      /* capacity line (sky) */
      ctx.beginPath();
      for (iSteps = 0; iSteps <= stepCount; iSteps++) {
        var hr3 = (iSteps / stepCount) * 24;
        var yc = Y(capacityAt(hr3, spikeX, provX));
        if (iSteps === 0) { ctx.moveTo(X(hr3), yc); } else { ctx.lineTo(X(hr3), yc); }
      }
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.2;
      ctx.stroke();

      /* legend */
      ctx.font = '600 10.5px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = C.lime;
      ctx.fillRect(padL + 6, padT + 2, 14, 3);
      ctx.fillStyle = C.text;
      ctx.fillText('demand', padL + 25, padT + 4);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(padL + 88, padT + 2, 14, 3);
      ctx.fillStyle = C.text;
      ctx.fillText('capacity', padL + 107, padT + 4);

      var util = sumServed / sumCap;
      var waste = Math.max(0, sumCap - sumD) / sumCap;
      var dropPct = sumDrop / sumD;
      utilEl.textContent = Math.round(util * 100) + '%';
      wasteEl.textContent = Math.round(waste * 100) + '%';
      dropEl.textContent = dropPct < 0.002 ? 'none' : Math.round(dropPct * 100) + '%';

      if (mode === 'own') {
        if (dropPct >= 0.002) {
          setStatus(statusEl, 'Outage: at peak, demand exceeds the servers you own — the red region is users seeing errors. Buying more fixes tonight and wastes every quiet night for years.', 'bad');
        } else {
          setStatus(statusEl, 'No outage — but the gap between the flat blue line and the demand curve is hardware you bought that idles most of the day.');
        }
      } else {
        setStatus(statusEl, 'Elastic capacity steps with demand, holding ~15% headroom. Utilization stays high at every hour — you stop paying for midnight capacity you never use.', 'ok');
      }
    }

    function setMode(m) {
      mode = m;
      ownBtn.setAttribute('aria-pressed', String(m === 'own'));
      cloudBtn.setAttribute('aria-pressed', String(m === 'cloud'));
      prov.disabled = (m === 'cloud');
      provWrap.style.opacity = (m === 'cloud') ? '0.45' : '1';
      render();
    }

    ownBtn.addEventListener('click', function () { setMode('own'); });
    cloudBtn.addEventListener('click', function () { setMode('cloud'); });
    spike.addEventListener('input', render);
    prov.addEventListener('input', render);
    setMode('own');
    onScreen(canvas, function () { render(); });
  }

  /* ==========================================================================
     CH.10 — Provider tabs
     ========================================================================== */

  function initProviders() {
    var tabs = $$('#cloud-experience .cl-ptab');
    if (!tabs.length) { return; }
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (t) {
          var panel = document.getElementById(t.getAttribute('aria-controls'));
          var on = t === tab;
          t.setAttribute('aria-selected', String(on));
          if (panel) { panel.hidden = !on; }
        });
      });
    });
  }

  /* ==========================================================================
     CH.3 — World map: users route to the nearest region.
     ========================================================================== */

  function initMap() {
    var canvas = $('#cl-map-canvas');
    if (!canvas) { return; }
    var regionEl = $('#cl-map-region');
    var distEl = $('#cl-map-dist');
    var latEl = $('#cl-map-latency');
    var statusEl = $('#cl-map-status');
    var cv = setupCanvas(canvas, function () { draw(1); });
    var ctx = cv.ctx, st = cv.state;

    var REGIONS = [
      { name: 'N. Virginia (us-east)', lat: 38.9, lon: -77.5 },
      { name: 'Oregon (us-west)', lat: 44.1, lon: -120.9 },
      { name: 'Ireland (eu-west)', lat: 53.3, lon: -8.2 },
      { name: 'Frankfurt (eu-central)', lat: 50.1, lon: 8.7 },
      { name: 'Mumbai (ap-south)', lat: 19.1, lon: 72.9 },
      { name: 'Singapore (ap-southeast)', lat: 1.35, lon: 103.8 },
      { name: 'Tokyo (ap-northeast)', lat: 35.7, lon: 139.7 },
      { name: 'São Paulo (sa-east)', lat: -23.5, lon: -46.6 },
      { name: 'Sydney (ap-southeast-2)', lat: -33.9, lon: 151.2 }
    ];

    /* Very rough continent outlines, [lon, lat] — a deliberately stylized
       low-poly world, not survey data. */
    var LAND = [
      /* North America */
      [[-166, 68], [-152, 71], [-140, 70], [-128, 70], [-115, 72], [-95, 73], [-80, 72], [-70, 62], [-55, 52], [-65, 45], [-75, 40], [-80, 32], [-82, 25], [-90, 20], [-97, 16], [-105, 20], [-110, 24], [-117, 33], [-124, 40], [-130, 52], [-146, 60], [-160, 62]],
      /* Greenland */
      [[-52, 61], [-42, 60], [-25, 70], [-20, 79], [-32, 83], [-55, 82], [-58, 72]],
      /* South America */
      [[-82, 9], [-75, 11], [-70, 12], [-62, 10], [-52, 5], [-42, -3], [-35, -8], [-38, -15], [-40, -22], [-48, -28], [-53, -34], [-58, -39], [-65, -45], [-68, -52], [-72, -54], [-75, -45], [-72, -35], [-70, -25], [-70, -18], [-77, -10], [-80, -3]],
      /* Africa */
      [[-17, 21], [-10, 32], [0, 36], [10, 37], [20, 32], [32, 31], [43, 12], [51, 12], [46, 2], [40, -10], [35, -20], [33, -28], [26, -34], [19, -35], [14, -27], [12, -18], [9, -2], [9, 4], [-5, 5], [-13, 9]],
      /* Eurasia */
      [[-10, 36], [-9, 43], [-2, 48], [0, 51], [8, 57], [18, 56], [24, 58], [30, 70], [60, 73], [95, 77], [130, 73], [160, 70], [178, 66], [170, 60], [158, 52], [146, 44], [130, 42], [122, 30], [110, 20], [104, 2], [98, 10], [92, 22], [80, 8], [72, 20], [66, 25], [57, 25], [52, 13], [43, 13], [35, 28], [32, 31], [22, 37], [10, 38], [0, 36]],
      /* Australia */
      [[114, -22], [122, -18], [130, -12], [137, -12], [142, -11], [146, -15], [150, -22], [153, -28], [150, -35], [144, -38], [138, -35], [132, -32], [124, -33], [115, -34], [113, -26]]
    ];

    var TOP_LAT = 80, BOT_LAT = -58;
    function px(lon, lat) {
      return {
        x: ((lon + 180) / 360) * st.w,
        y: ((TOP_LAT - lat) / (TOP_LAT - BOT_LAT)) * st.h
      };
    }
    function invPx(x, y) {
      return {
        lon: (x / st.w) * 360 - 180,
        lat: TOP_LAT - (y / st.h) * (TOP_LAT - BOT_LAT)
      };
    }

    function haversineKm(a, b) {
      var R = 6371, D = Math.PI / 180;
      var dLat = (b.lat - a.lat) * D, dLon = (b.lon - a.lon) * D;
      var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(a.lat * D) * Math.cos(b.lat * D) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
      return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
    }

    var user = null;   /* {lat, lon, name} */
    var nearest = null;
    var pulse = { t: 0, active: false };

    function draw(routeProgress) {
      if (st.w < 60 || st.h < 60) { return; }
      ctx.clearRect(0, 0, st.w, st.h);

      /* graticule */
      ctx.strokeStyle = 'rgba(30, 41, 59, 0.7)';
      ctx.lineWidth = 1;
      var lon, lat;
      for (lon = -150; lon <= 150; lon += 30) {
        ctx.beginPath();
        ctx.moveTo(px(lon, TOP_LAT).x, 0);
        ctx.lineTo(px(lon, TOP_LAT).x, st.h);
        ctx.stroke();
      }
      for (lat = -40; lat <= 70; lat += 30) {
        ctx.beginPath();
        ctx.moveTo(0, px(0, lat).y);
        ctx.lineTo(st.w, px(0, lat).y);
        ctx.stroke();
      }

      /* land */
      LAND.forEach(function (poly) {
        ctx.beginPath();
        poly.forEach(function (pt, idx) {
          var p = px(pt[0], pt[1]);
          if (idx === 0) { ctx.moveTo(p.x, p.y); } else { ctx.lineTo(p.x, p.y); }
        });
        ctx.closePath();
        ctx.fillStyle = 'rgba(30, 41, 59, 0.75)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(51, 65, 85, 0.9)';
        ctx.stroke();
      });

      /* regions */
      REGIONS.forEach(function (r) {
        var p = px(r.lon, r.lat);
        var hot = nearest && nearest.name === r.name;
        ctx.fillStyle = hot ? C.teal : 'rgba(45, 212, 191, 0.65)';
        drawGlowDot(ctx, p.x, p.y, hot ? 4.5 : 3, C.teal);
      });

      /* route + user */
      if (user && nearest) {
        var a = px(user.lon, user.lat);
        var b = px(nearest.lon, nearest.lat);
        var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 - Math.min(70, Math.abs(a.x - b.x) * 0.2) - 18;
        ctx.strokeStyle = 'rgba(101, 163, 13, 0.75)';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(mx, my, b.x, b.y);
        ctx.stroke();

        var q = easeInOut(clamp(routeProgress, 0, 1));
        var xx = (1 - q) * (1 - q) * a.x + 2 * (1 - q) * q * mx + q * q * b.x;
        var yy = (1 - q) * (1 - q) * a.y + 2 * (1 - q) * q * my + q * q * b.y;
        ctx.fillStyle = C.lime;
        drawGlowDot(ctx, xx, yy, 3, C.lime);

        ctx.fillStyle = '#a3e635';
        drawGlowDot(ctx, a.x, a.y, 3.5, C.lime);
        ctx.font = '600 11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = C.strong;
        ctx.fillText(user.name, a.x, a.y - 8);
      }
    }

    var loop = makeLoop(function (t, dt) {
      pulse.t += dt / 1100;
      if (pulse.t >= 1) { pulse.t = 0; }
      draw(pulse.t);
      if (!pulse.active) { loop.stop(); }
    });

    function select(lat, lon, name) {
      user = { lat: lat, lon: lon, name: name };
      var best = null, bestKm = Infinity;
      REGIONS.forEach(function (r) {
        var km = haversineKm(user, r);
        if (km < bestKm) { bestKm = km; best = r; }
      });
      nearest = best;
      var rttMs = Math.max(3, Math.round(bestKm * 0.01 * 1.6 + 2));
      regionEl.textContent = best.name;
      distEl.textContent = fmt(bestKm) + ' km';
      latEl.textContent = '~' + rttMs + ' ms';
      setStatus(statusEl, name + ' → ' + best.name + ': light in fiber needs ~' + rttMs +
        ' ms for the round trip. That physics is why providers build regions on every continent' +
        (rttMs > 80 ? ' — and why this user would love a closer one.' : '.'), 'ok');
      if (reduced()) {
        draw(1);
      } else {
        pulse.active = true;
        pulse.t = 0;
        loop.start();
      }
    }

    canvas.addEventListener('click', function (ev) {
      var rect = canvas.getBoundingClientRect();
      var pos = invPx(ev.clientX - rect.left, ev.clientY - rect.top);
      select(pos.lat, pos.lon, 'Your pick');
    });

    $$('.cl-map-city').forEach(function (btn) {
      btn.addEventListener('click', function () {
        select(parseFloat(btn.dataset.lat), parseFloat(btn.dataset.lon), btn.textContent);
      });
    });

    draw(1);
    onScreen(canvas, function () { draw(pulse.active ? pulse.t : 1); });
  }

  /* ==========================================================================
     CH.4 — Be the hypervisor: pack VMs onto a 16-core / 64 GB host.
     ========================================================================== */

  function initVms() {
    var cpuBar = $('#cl-vm-cpu');
    var ramBar = $('#cl-vm-ram');
    var listEl = $('#cl-vm-list');
    var statusEl = $('#cl-vm-status');
    if (!cpuBar || !ramBar) { return; }

    var HOST = { cpu: 16, ram: 64 };
    var SIZES = {
      small: { label: 'Small', cpu: 2, ram: 4 },
      medium: { label: 'Medium', cpu: 4, ram: 16 },
      large: { label: 'Large', cpu: 8, ram: 32 }
    };
    var PALETTE = [C.teal, '#38bdf8', '#fbbf24', '#c4b5fd', '#a3e635', '#f472b6', '#5eead4', '#fb923c'];
    var vms = [];
    var nextId = 1;

    function used() {
      var u = { cpu: 0, ram: 0 };
      vms.forEach(function (v) { u.cpu += v.cpu; u.ram += v.ram; });
      return u;
    }

    function render() {
      cpuBar.innerHTML = '';
      ramBar.innerHTML = '';
      listEl.innerHTML = '';
      vms.forEach(function (v, idx) {
        var color = PALETTE[idx % PALETTE.length];
        var segC = document.createElement('span');
        segC.className = 'cl-seg';
        segC.style.width = (v.cpu / HOST.cpu * 100) + '%';
        segC.style.background = color;
        segC.textContent = 'VM' + v.id;
        cpuBar.appendChild(segC);
        var segR = document.createElement('span');
        segR.className = 'cl-seg';
        segR.style.width = (v.ram / HOST.ram * 100) + '%';
        segR.style.background = color;
        segR.textContent = 'VM' + v.id;
        ramBar.appendChild(segR);

        var li = document.createElement('li');
        var sw = document.createElement('span');
        sw.className = 'cl-vm-swatch';
        sw.style.background = color;
        li.appendChild(sw);
        li.appendChild(document.createTextNode('VM' + v.id + ' · ' + v.label + ' · ' + v.cpu + ' cores / ' + v.ram + ' GB'));
        var rm = document.createElement('button');
        rm.type = 'button';
        rm.setAttribute('aria-label', 'Terminate VM' + v.id);
        rm.textContent = '×';
        rm.addEventListener('click', function () {
          vms = vms.filter(function (x) { return x.id !== v.id; });
          render();
          setStatus(statusEl, 'VM' + v.id + ' terminated. Its cores and memory return to the pool instantly — nothing to unplug, nothing to sell on eBay.');
        });
        li.appendChild(rm);
        listEl.appendChild(li);
      });
    }

    function add(sizeKey) {
      var s = SIZES[sizeKey];
      var u = used();
      if (u.cpu + s.cpu > HOST.cpu || u.ram + s.ram > HOST.ram) {
        var tight = (u.cpu + s.cpu > HOST.cpu) ? 'CPU cores' : 'memory';
        setStatus(statusEl, 'Doesn’t fit — this host is out of ' + tight + '. In a real cloud the placement scheduler would simply pick another host from thousands; the customer never knows or cares which one.', 'bad');
        return;
      }
      vms.push({ id: nextId++, label: s.label, cpu: s.cpu, ram: s.ram });
      render();
      u = used();
      var full = (u.cpu === HOST.cpu || u.ram === HOST.ram);
      setStatus(statusEl,
        s.label + ' VM launched. Host now at ' + u.cpu + '/' + HOST.cpu + ' cores and ' + u.ram + '/' + HOST.ram +
        ' GB. Each tenant sees only its own slice — the hypervisor keeps them isolated.' +
        (full ? ' The host is now fully packed: this density is exactly what makes renting cheap.' : ''),
        full ? 'ok' : undefined);
    }

    $('#cl-vm-add-small').addEventListener('click', function () { add('small'); });
    $('#cl-vm-add-medium').addEventListener('click', function () { add('medium'); });
    $('#cl-vm-add-large').addEventListener('click', function () { add('large'); });
    $('#cl-vm-reset').addEventListener('click', function () {
      vms = [];
      nextId = 1;
      render();
      setStatus(statusEl, 'Host cleared.');
    });

    /* seed with two tenants so the idea is visible before any clicks */
    vms.push({ id: nextId++, label: 'Medium', cpu: 4, ram: 16 });
    vms.push({ id: nextId++, label: 'Small', cpu: 2, ram: 4 });
    render();
  }

  /* ==========================================================================
     CH.5 — Kubernetes: desired replicas, a real least-loaded scheduler,
     self-healing.
     ========================================================================== */

  function initK8s() {
    var wrap = $('#cl-k8s-nodes');
    var slider = $('#cl-k8s-replicas');
    var sliderOut = $('#cl-k8s-replicas-out');
    var killBtn = $('#cl-k8s-kill');
    var statusEl = $('#cl-k8s-status');
    if (!wrap || !slider) { return; }

    var CAP = 4;
    var nodes = [
      { id: 1, alive: true },
      { id: 2, alive: true },
      { id: 3, alive: true }
    ];
    var startingTimer = null;

    function schedule(desired) {
      /* Least-loaded placement: each pod goes to the alive node holding the
         fewest pods that is still under capacity CAP; none fits -> Pending. */
      var placed = [];
      var counts = {};
      nodes.forEach(function (n) { counts[n.id] = 0; });
      var p;
      for (p = 0; p < desired; p++) {
        var best = null;
        nodes.forEach(function (n) {
          if (!n.alive || counts[n.id] >= CAP) { return; }
          if (best === null || counts[n.id] < counts[best.id]) { best = n; }
        });
        if (best) {
          counts[best.id] += 1;
          placed.push({ pod: p + 1, node: best.id });
        } else {
          placed.push({ pod: p + 1, node: null });
        }
      }
      return placed;
    }

    var fresh = {};   /* podIndex -> true briefly, for the "starting" style */

    function render() {
      var desired = parseInt(slider.value, 10);
      sliderOut.textContent = String(desired);
      var placed = schedule(desired);
      wrap.innerHTML = '';
      nodes.forEach(function (n) {
        var box = document.createElement('div');
        box.className = 'cl-k8s-node' + (n.alive ? '' : ' is-dead');
        var title = document.createElement('div');
        title.className = 'cl-k8s-node-title';
        title.innerHTML = '<span>Node ' + n.id + '</span><span>' + (n.alive ? 'Ready' : 'NotReady') + '</span>';
        box.appendChild(title);
        var pods = document.createElement('div');
        pods.className = 'cl-k8s-pods';
        placed.forEach(function (pl) {
          if (pl.node !== n.id) { return; }
          var pod = document.createElement('span');
          pod.className = 'cl-pod' + (fresh[pl.pod] ? ' is-starting' : '');
          pod.textContent = 'pod-' + pl.pod;
          pods.appendChild(pod);
        });
        box.appendChild(pods);
        wrap.appendChild(box);
      });
      var pending = placed.filter(function (pl) { return pl.node === null; });
      if (pending.length) {
        var note = document.createElement('p');
        note.className = 'cl-k8s-pending';
        note.textContent = pending.length + ' pod(s) Pending — the cluster is out of room. A real cluster autoscaler would now add a node.';
        wrap.appendChild(note);
      }
      return { placed: placed, pending: pending.length };
    }

    function markFresh(podIds) {
      podIds.forEach(function (id) { fresh[id] = true; });
      render();
      if (startingTimer) { clearTimeout(startingTimer); }
      startingTimer = setTimeout(function () {
        fresh = {};
        render();
      }, reduced() ? 0 : 900);
    }

    var prevDesired = parseInt(slider.value, 10);
    slider.addEventListener('input', function () {
      var desired = parseInt(slider.value, 10);
      var added = [];
      var d;
      for (d = prevDesired + 1; d <= desired; d++) { added.push(d); }
      prevDesired = desired;
      var res = render();
      if (added.length) { markFresh(added); }
      setStatus(statusEl, 'Desired state: ' + desired + ' replicas. The scheduler ' +
        (res.pending ? 'placed what fits and left ' + res.pending + ' Pending.' :
          'spread them across the nodes with room to spare.'));
    });

    killBtn.addEventListener('click', function () {
      var node2 = nodes[1];
      if (!node2.alive) { return; }
      node2.alive = false;
      killBtn.disabled = true;
      render();
      setStatus(statusEl, 'Node 2 just died. Its pods are gone…', 'bad');
      setTimeout(function () {
        var desired = parseInt(slider.value, 10);
        var res = render();
        var moved = res.placed.filter(function (pl) { return pl.node !== null; }).length;
        markFresh(res.placed.map(function (pl) { return pl.pod; }));
        setStatus(statusEl, 'The controller noticed reality (' + moved +
          ' running) no longer matches desired state (' + desired +
          '), and rescheduled the missing pods onto healthy nodes. No human involved. Node 2 will rejoin shortly.', 'ok');
      }, reduced() ? 60 : 1400);
      setTimeout(function () {
        node2.alive = true;
        killBtn.disabled = false;
        render();
        setStatus(statusEl, 'Node 2 recovered and rejoined the cluster — new capacity for future scheduling. This observe-compare-correct loop runs forever.', 'ok');
      }, reduced() ? 120 : 7000);
    });

    render();
    setStatus(statusEl, 'Drag the replica slider, then kill a node and watch the cluster heal itself.');
  }

  /* ==========================================================================
     CH.6 — Networking: DNS, load balancer, subnets, security groups.
     ========================================================================== */

  function initNet() {
    var canvas = $('#cl-net-canvas');
    var runBtn = $('#cl-net-run');
    var attackBtn = $('#cl-net-attack');
    var statusEl = $('#cl-net-status');
    if (!canvas || !runBtn) { return; }
    var cv = setupCanvas(canvas, function () { draw(); });
    var ctx = cv.ctx, st = cv.state;

    /* layout fractions */
    function nodes() {
      var y = st.h * 0.58;
      return {
        user: { x: st.w * 0.08, y: y, label: 'User' },
        dns: { x: st.w * 0.2, y: st.h * 0.18, label: 'DNS' },
        lb: { x: st.w * 0.32, y: y, label: 'Load balancer' },
        web: { x: st.w * 0.52, y: y, label: 'Web server' },
        app: { x: st.w * 0.7, y: y, label: 'App server' },
        db: { x: st.w * 0.88, y: y, label: 'Database' }
      };
    }

    var anim = { steps: [], idx: -1, t: 0, playing: false, gates: {}, blockedAt: null };

    function bands() {
      return [
        { x0: 0, x1: st.w * 0.21, label: 'Internet', color: 'rgba(100, 116, 139, 0.09)' },
        { x0: st.w * 0.21, x1: st.w * 0.42, label: 'Public subnet', color: 'rgba(2, 132, 199, 0.08)' },
        { x0: st.w * 0.42, x1: st.w * 0.79, label: 'Private subnet · app tier', color: 'rgba(13, 148, 136, 0.07)' },
        { x0: st.w * 0.79, x1: st.w, label: 'Private subnet · data tier', color: 'rgba(217, 119, 6, 0.07)' }
      ];
    }

    function drawGate(x, y, state) {
      /* state: null | 'ok' | 'bad' */
      ctx.save();
      ctx.translate(x, y);
      ctx.beginPath();
      ctx.moveTo(0, -9);
      ctx.lineTo(8, -5);
      ctx.lineTo(8, 3);
      ctx.quadraticCurveTo(8, 9, 0, 11);
      ctx.quadraticCurveTo(-8, 9, -8, 3);
      ctx.lineTo(-8, -5);
      ctx.closePath();
      ctx.fillStyle = C.deep;
      ctx.fill();
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = state === 'ok' ? C.teal : (state === 'bad' ? C.rose : C.lineStrong);
      ctx.stroke();
      if (state === 'ok') {
        ctx.beginPath();
        ctx.moveTo(-3.5, 0);
        ctx.lineTo(-1, 3);
        ctx.lineTo(4, -3);
        ctx.strokeStyle = C.teal;
        ctx.stroke();
      } else if (state === 'bad') {
        ctx.beginPath();
        ctx.moveTo(-3.5, -3);
        ctx.lineTo(3.5, 3.5);
        ctx.moveTo(3.5, -3);
        ctx.lineTo(-3.5, 3.5);
        ctx.strokeStyle = C.rose;
        ctx.stroke();
      }
      ctx.restore();
    }

    function draw(packet) {
      if (st.w < 60 || st.h < 60) { return; }
      ctx.clearRect(0, 0, st.w, st.h);
      var N = nodes();

      bands().forEach(function (b) {
        ctx.fillStyle = b.color;
        ctx.fillRect(b.x0, 0, b.x1 - b.x0, st.h);
        ctx.font = '700 9.5px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = C.faint;
        ctx.fillText(b.label.toUpperCase(), (b.x0 + b.x1) / 2, 8);
        ctx.strokeStyle = 'rgba(51, 65, 85, 0.5)';
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.moveTo(b.x1, 0);
        ctx.lineTo(b.x1, st.h);
        ctx.stroke();
        ctx.setLineDash([]);
      });

      /* dns dashed link */
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(N.user.x, N.user.y - 14);
      ctx.lineTo(N.dns.x, N.dns.y + 14);
      ctx.stroke();
      ctx.setLineDash([]);

      /* chain links */
      var chain = [N.user, N.lb, N.web, N.app, N.db];
      var i;
      ctx.strokeStyle = 'rgba(51, 65, 85, 0.9)';
      ctx.lineWidth = 1.5;
      for (i = 0; i < chain.length - 1; i++) {
        ctx.beginPath();
        ctx.moveTo(chain[i].x + 34, chain[i].y);
        ctx.lineTo(chain[i + 1].x - 34, chain[i + 1].y);
        ctx.stroke();
      }

      /* nodes */
      drawNodeBox(ctx, N.user.x, N.user.y, 56, 34, N.user.label, C.lime, { hot: anim.hot === 'user' });
      drawNodeBox(ctx, N.dns.x, N.dns.y, 52, 30, N.dns.label, C.sky, { hot: anim.hot === 'dns' });
      drawNodeBox(ctx, N.lb.x, N.lb.y, 86, 34, N.lb.label, C.sky, { hot: anim.hot === 'lb' });
      drawNodeBox(ctx, N.web.x, N.web.y, 78, 34, N.web.label, C.cTeal, { hot: anim.hot === 'web' });
      drawNodeBox(ctx, N.app.x, N.app.y, 78, 34, N.app.label, C.cTeal, { hot: anim.hot === 'app' });
      drawNodeBox(ctx, N.db.x, N.db.y, 72, 34, N.db.label, C.amber, { hot: anim.hot === 'db' });

      /* gates between hops */
      var gatePts = [
        { key: 'g-lb', x: (N.user.x + N.lb.x) / 2, y: N.user.y },
        { key: 'g-web', x: (N.lb.x + N.web.x) / 2, y: N.user.y },
        { key: 'g-app', x: (N.web.x + N.app.x) / 2, y: N.user.y },
        { key: 'g-db', x: (N.app.x + N.db.x) / 2, y: N.user.y }
      ];
      gatePts.forEach(function (gp) { drawGate(gp.x, gp.y, anim.gates[gp.key] || null); });

      if (packet) {
        ctx.fillStyle = packet.color;
        drawGlowDot(ctx, packet.x, packet.y, 3.5, packet.color);
      }
    }

    function playSteps(steps, doneMsg, doneKind) {
      if (anim.playing) { return; }
      anim.gates = {};
      anim.hot = null;
      if (reduced()) {
        steps.forEach(function (s) {
          if (s.gate) { anim.gates[s.gate] = s.gateState || 'ok'; }
          if (s.hotEnd) { anim.hot = s.hotEnd; }
          if (s.note) { setStatus(statusEl, s.note, s.kind); }
        });
        setStatus(statusEl, doneMsg, doneKind);
        draw();
        return;
      }
      anim.playing = true;
      runBtn.disabled = true;
      attackBtn.disabled = true;
      var idx = 0;
      var t = 0;
      var loop = makeLoop(function (_, dt) {
        var s = steps[idx];
        if (!s) {
          loop.stop();
          anim.playing = false;
          runBtn.disabled = false;
          attackBtn.disabled = false;
          setStatus(statusEl, doneMsg, doneKind);
          draw();
          return;
        }
        if (t === 0 && s.note) { setStatus(statusEl, s.note, s.kind); }
        t += dt / (s.dur || 700);
        var q = easeInOut(clamp(t, 0, 1));
        var x = s.from.x + (s.to.x - s.from.x) * q;
        var y = s.from.y + (s.to.y - s.from.y) * q - (s.arc ? Math.sin(q * Math.PI) * 26 : 0);
        if (s.gate && q > 0.5 && !anim.gates[s.gate]) {
          anim.gates[s.gate] = s.gateState || 'ok';
        }
        draw({ x: x, y: y, color: s.color || C.teal });
        if (t >= 1) {
          if (s.hotEnd) { anim.hot = s.hotEnd; }
          idx += 1;
          t = 0;
        }
      });
      loop.start();
    }

    runBtn.addEventListener('click', function () {
      var N = nodes();
      var up = { color: C.teal };
      playSteps([
        { from: N.user, to: N.dns, arc: true, dur: 600, color: '#38bdf8', hotEnd: 'dns',
          note: '1. DNS: “where is app.example.com?” → an IP address for the load balancer.' },
        { from: N.dns, to: N.user, arc: true, dur: 500, color: '#38bdf8', hotEnd: 'user' },
        { from: N.user, to: N.lb, gate: 'g-lb', color: up.color, hotEnd: 'lb',
          note: '2. The request crosses the internet to the load balancer — the only thing with a public address. Its security group allows port 443 from anywhere.' },
        { from: N.lb, to: N.web, gate: 'g-web', color: up.color, hotEnd: 'web',
          note: '3. The load balancer picks a healthy web server in the private subnet. The web tier’s security group only accepts traffic *from the load balancer*.' },
        { from: N.web, to: N.app, gate: 'g-app', color: up.color, hotEnd: 'app',
          note: '4. The web tier calls the application tier — business logic, sessions, APIs. Again: only reachable from the tier before it.' },
        { from: N.app, to: N.db, gate: 'g-db', color: up.color, hotEnd: 'db',
          note: '5. The app queries the database. Its security group allows port 5432 from the app tier only — deny is the default for everything else.' },
        { from: N.db, to: N.user, arc: true, dur: 1100, color: C.lime, hotEnd: 'user',
          note: '6. The response flows back — typically a few milliseconds inside the network.' }
      ], 'Delivered. Four checkpoints, each with an explicit allow rule — and the database was never exposed to the internet at any point.', 'ok');
    });

    attackBtn.addEventListener('click', function () {
      var N = nodes();
      playSteps([
        { from: N.user, to: { x: (N.app.x + N.db.x) / 2 - 14, y: N.user.y }, dur: 1300, color: C.rose,
          gate: 'g-db', gateState: 'bad',
          note: 'An attacker on the internet tries to connect straight to the database’s port…' },
        { from: { x: (N.app.x + N.db.x) / 2 - 14, y: N.user.y }, to: { x: (N.app.x + N.db.x) / 2 - 60, y: N.user.y - 30 }, dur: 500, color: C.rose }
      ], 'Blocked twice over: the database has no public IP (private subnet), and its security group only allows the app tier. Layered defaults like this are why one mistake rarely equals one breach.', 'bad');
    });

    draw();
    onScreen(canvas, function () { draw(); });
  }

  /* ==========================================================================
     CH.7 — Storage quiz
     ========================================================================== */

  function initStore() {
    var statusEl = $('#cl-store-status');
    var cards = $$('#cloud-experience .cl-store-card');
    if (!cards.length) { return; }
    var ANSWERS = {
      object: 'Object storage. Millions of write-once, read-many files with no need for a filesystem — cheap, effectively infinite, and every photo gets a URL.',
      block: 'Block storage. A database engine wants a fast, low-latency virtual disk it fully controls — that’s exactly what block volumes are.',
      db: 'A managed database. You could build one on block storage yourself — but backups, replication, and failover come included with the managed service.',
      file: 'File storage. Twenty machines mounting one shared directory tree is the textbook network-filesystem workload.'
    };
    $$('#cloud-experience .cl-store-q').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var target = btn.dataset.target;
        cards.forEach(function (c) { c.classList.toggle('is-hit', c.dataset.kind === target); });
        setStatus(statusEl, ANSWERS[target] || '', 'ok');
        var hit = cards.filter(function (c) { return c.dataset.kind === target; })[0];
        if (hit && !reduced()) { hit.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
      });
    });
  }

  /* ==========================================================================
     CH.8 — Auto scaling & load balancing simulation.
     ========================================================================== */

  function initScale() {
    var canvas = $('#cl-scale-canvas');
    var slider = $('#cl-scale-users');
    var sliderOut = $('#cl-scale-users-out');
    var spikeBtn = $('#cl-scale-spike');
    var instEl = $('#cl-scale-instances');
    var utilEl = $('#cl-scale-util');
    var costEl = $('#cl-scale-cost');
    var fixedEl = $('#cl-scale-fixed');
    var statusEl = $('#cl-scale-status');
    if (!canvas || !slider) { return; }
    var cv = setupCanvas(canvas, function () { draw(); });
    var ctx = cv.ctx, st = cv.state;
    var rng = makeRng(424242);

    var PER_INSTANCE = 2000;      /* users one instance can handle at 100% */
    var TARGET_UTIL = 0.7;
    var RATE = 0.10;              /* $/instance-hour */
    var MAX_SHOWN = 24;

    var fleet = [];               /* {state:'boot'|'run'|'drain', p:0..1, wobble} */
    var i;
    for (i = 0; i < 2; i++) { fleet.push({ state: 'run', p: 1, wobble: rng() * 7 }); }
    var spikeMult = 1;
    var spikeUntil = 0;
    var packets = [];
    var adjustTimer = 0;

    function usersNow() {
      return Math.round(Math.pow(10, parseFloat(slider.value)) * spikeMult);
    }

    function desiredCount() {
      return clamp(Math.ceil(usersNow() / (PER_INSTANCE * TARGET_UTIL)), 2, 999);
    }

    function aliveCount() {
      return fleet.filter(function (f) { return f.state !== 'drain'; }).length;
    }

    function runningCount() {
      return fleet.filter(function (f) { return f.state === 'run'; }).length;
    }

    function adjust(instant) {
      var want = desiredCount();
      var have = aliveCount();
      var n;
      if (want > have) {
        var add = instant ? (want - have) : Math.min(want - have, Math.max(1, Math.round((want - have) / 3)));
        for (n = 0; n < add; n++) {
          fleet.push({ state: instant ? 'run' : 'boot', p: instant ? 1 : 0, wobble: rng() * 7 });
        }
      } else if (want < have) {
        var cut = instant ? (have - want) : Math.min(have - want, Math.max(1, Math.round((have - want) / 3)));
        for (n = fleet.length - 1; n >= 0 && cut > 0; n--) {
          if (fleet[n].state !== 'drain') {
            if (instant) { fleet.splice(n, 1); } else { fleet[n].state = 'drain'; fleet[n].p = 1; }
            cut -= 1;
          }
        }
      }
    }

    function updateStats() {
      var users = usersNow();
      var run = Math.max(1, runningCount());
      var util = clamp(users / (run * PER_INSTANCE), 0, 1.35);
      var count = aliveCount();
      instEl.textContent = fmt(count) + (fleet.some(function (f) { return f.state === 'boot'; }) ? ' (booting…)' : '');
      utilEl.textContent = Math.round(util * 100) + '%';
      costEl.textContent = '$' + (count * RATE).toFixed(2) + '/hr';
      var peak = Math.ceil(1000000 / (PER_INSTANCE * TARGET_UTIL));
      fixedEl.textContent = '$' + (peak * RATE).toFixed(2) + '/hr';
      sliderOut.textContent = fmt(Math.pow(10, parseFloat(slider.value)));
      return util;
    }

    function boxLayout() {
      var count = aliveCount();
      var shown = Math.min(count, MAX_SHOWN);
      var per = Math.ceil(count / Math.max(1, shown));
      var cols = Math.ceil(Math.sqrt(shown * 1.6));
      var rows = Math.ceil(shown / cols);
      var x0 = st.w * 0.34, x1 = st.w * 0.97;
      var y0 = 34, y1 = st.h - 16;
      var bw = Math.min(92, (x1 - x0) / cols - 8);
      var bh = Math.min(46, (y1 - y0) / rows - 8);
      return { shown: shown, per: per, cols: cols, rows: rows, x0: x0, y0: y0, bw: bw, bh: bh,
               cw: (x1 - x0) / cols, ch: (y1 - y0) / rows };
    }

    function boxPos(L, idx) {
      var cx = L.x0 + (idx % L.cols) * L.cw + L.cw / 2;
      var cy = L.y0 + Math.floor(idx / L.cols) * L.ch + L.ch / 2;
      return { x: cx, y: cy };
    }

    function draw(t) {
      if (st.w < 60 || st.h < 60) { return; }
      t = t || 0;
      ctx.clearRect(0, 0, st.w, st.h);
      var users = usersNow();
      var util = clamp(users / (Math.max(1, runningCount()) * PER_INSTANCE), 0, 1.3);
      var L = boxLayout();

      /* users cloud + lb */
      var lbX = st.w * 0.17, lbY = st.h * 0.5;
      ctx.font = '600 11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = C.muted;
      ctx.fillText(fmt(users) + ' users', st.w * 0.08, st.h * 0.16);
      var u;
      for (u = 0; u < 9; u++) {
        var ux = st.w * 0.05 + (u % 3) * st.w * 0.032;
        var uy = st.h * 0.26 + Math.floor(u / 3) * 20;
        ctx.fillStyle = 'rgba(163, 230, 53, ' + (0.35 + 0.3 * Math.sin(t / 700 + u)) + ')';
        ctx.beginPath();
        ctx.arc(ux, uy, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      drawNodeBox(ctx, lbX, lbY, 90, 40, 'Load balancer', C.sky, { hot: false });

      /* instance boxes */
      var alive = fleet.filter(function (f) { return f.state !== 'drain' || f.p > 0; });
      var shownList = alive.slice(0, L.shown);
      shownList.forEach(function (f, idx) {
        var p = boxPos(L, idx);
        var w = L.bw, h = L.bh;
        roundRect(ctx, p.x - w / 2, p.y - h / 2, w, h, 6);
        ctx.fillStyle = '#101a30';
        ctx.fill();
        ctx.lineWidth = 1.4;
        if (f.state === 'boot') {
          ctx.setLineDash([4, 3]);
          ctx.strokeStyle = C.amber;
        } else if (f.state === 'drain') {
          ctx.strokeStyle = 'rgba(100, 116, 139, ' + f.p + ')';
        } else {
          ctx.strokeStyle = util > 0.95 ? C.rose : C.cTeal;
        }
        ctx.stroke();
        ctx.setLineDash([]);
        /* utilization fill */
        if (f.state === 'run') {
          var uu = clamp(util + 0.06 * Math.sin(t / 900 + f.wobble), 0, 1);
          ctx.fillStyle = uu > 0.95 ? 'rgba(225, 29, 72, 0.4)' : 'rgba(13, 148, 136, 0.35)';
          ctx.fillRect(p.x - w / 2 + 2, p.y + h / 2 - 2 - (h - 4) * uu, w - 4, (h - 4) * uu);
        }
        ctx.font = '600 9px Inter, sans-serif';
        ctx.fillStyle = f.state === 'boot' ? C.amber : C.muted;
        ctx.textAlign = 'center';
        ctx.fillText(f.state === 'boot' ? 'booting' : (f.state === 'drain' ? 'draining' : 'server'), p.x, p.y - 2);
        if (L.per > 1 && f.state === 'run') {
          ctx.fillStyle = C.faint;
          ctx.fillText('×' + L.per, p.x, p.y + 10);
        }
      });

      /* packets from lb to instances */
      packets.forEach(function (pk) {
        var p = boxPos(L, pk.target % Math.max(1, L.shown));
        var q = easeInOut(pk.t);
        var x = lbX + 45 + (p.x - lbX - 45) * q;
        var y = lbY + (p.y - lbY) * q;
        ctx.fillStyle = 'rgba(163, 230, 53, 0.9)';
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
      });

      /* left link users->lb */
      ctx.strokeStyle = 'rgba(51, 65, 85, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(st.w * 0.08, st.h * 0.36);
      ctx.lineTo(lbX - 46, lbY);
      ctx.stroke();
    }

    function narrate() {
      var users = usersNow();
      var want = desiredCount();
      if (spikeMult > 1.01) {
        setStatus(statusEl, 'Traffic spike! Utilization jumped, the scaling policy fired, and ' + fmt(want) +
          ' instances are the new target. Boot time is why fleets keep a little headroom.', 'bad');
      } else if (users >= 500000) {
        setStatus(statusEl, fmt(users) + ' concurrent users → ' + fmt(want) +
          ' instances. Same architecture as at 100 users — that’s the point. Nothing about the design changed; only the count did.', 'ok');
      } else if (users <= 300) {
        setStatus(statusEl, 'Quiet hours: the fleet floor is 2 instances — never one, because a single machine is a single point of failure.');
      } else {
        setStatus(statusEl, fmt(users) + ' users → target ' + fmt(want) +
          ' instances at ~70% utilization. The load balancer spreads requests; the policy resizes the fleet.');
      }
    }

    var loop = makeLoop(function (t, dt) {
      adjustTimer -= dt;
      if (adjustTimer <= 0) {
        adjustTimer = 600;
        adjust(false);
      }
      if (spikeUntil && t > spikeUntil) {
        spikeMult = Math.max(1, spikeMult - dt / 1400);
        if (spikeMult === 1) { spikeUntil = 0; narrate(); }
      }
      fleet.forEach(function (f) {
        if (f.state === 'boot') {
          f.p += dt / 1500;
          if (f.p >= 1) { f.state = 'run'; f.p = 1; }
        } else if (f.state === 'drain') {
          f.p -= dt / 900;
        }
      });
      fleet = fleet.filter(function (f) { return !(f.state === 'drain' && f.p <= 0); });

      if (packets.length < 30 && rng() < 0.5) {
        packets.push({ t: 0, target: Math.floor(rng() * 1000) });
      }
      packets.forEach(function (pk) { pk.t += dt / 650; });
      packets = packets.filter(function (pk) { return pk.t < 1; });

      updateStats();
      draw(t);
    });

    slider.addEventListener('input', function () {
      if (reduced()) {
        adjust(true);
        updateStats();
        draw();
      }
      narrate();
    });

    spikeBtn.addEventListener('click', function () {
      spikeMult = 4;
      spikeUntil = performance.now() + 5200;
      if (reduced()) {
        adjust(true);
        updateStats();
        draw();
        setStatus(statusEl, 'Spike: users ×4 for a moment → the fleet target jumps to ' + fmt(desiredCount()) +
          ' instances, then shrinks back as traffic fades. That round trip is elasticity.', 'ok');
        spikeMult = 1;
        spikeUntil = 0;
        setTimeout(function () { adjust(true); updateStats(); draw(); }, 2500);
        return;
      }
      narrate();
    });

    updateStats();
    if (reduced()) {
      adjust(true);
      updateStats();
      draw();
      narrate();
      onScreen(canvas, function () { draw(); });
    } else {
      onScreen(canvas, function () { loop.start(); }, function () { loop.stop(); });
      narrate();
    }
  }

  /* ==========================================================================
     CH.9 — Serverless: environments appear on demand, stay warm, vanish.
     ========================================================================== */

  function initFn() {
    var canvas = $('#cl-fn-canvas');
    var oneBtn = $('#cl-fn-one');
    var burstBtn = $('#cl-fn-burst');
    var invEl = $('#cl-fn-invocations');
    var coldEl = $('#cl-fn-cold');
    var billedEl = $('#cl-fn-billed');
    var vmEl = $('#cl-fn-vm');
    var statusEl = $('#cl-fn-status');
    if (!canvas || !oneBtn) { return; }
    var cv = setupCanvas(canvas, function () { draw(); });
    var ctx = cv.ctx, st = cv.state;

    var COLD_MS = 700, EXEC_MS = 320, WARM_MS = 6000, MAX_ENVS = 12;
    var envs = [];        /* {state:'cold'|'busy'|'warm', p, warmLeft, id} */
    var queue = [];       /* pending requests (dots waiting for an env) */
    var nextEnv = 1;
    var stats = { inv: 0, cold: 0, billedMs: 0, firstAt: 0 };

    function request() {
      stats.inv += 1;
      if (!stats.firstAt) { stats.firstAt = performance.now(); }
      var warm = envs.filter(function (e) { return e.state === 'warm'; })[0];
      if (warm) {
        warm.state = 'busy';
        warm.p = 0;
      } else if (envs.length < MAX_ENVS) {
        stats.cold += 1;
        envs.push({ state: 'cold', p: 0, id: nextEnv++ });
      } else {
        queue.push(1);
      }
      updateStats();
    }

    function updateStats() {
      invEl.textContent = fmt(stats.inv);
      coldEl.textContent = fmt(stats.cold);
      billedEl.textContent = (stats.billedMs / 1000).toFixed(1) + ' s';
      if (stats.firstAt) {
        vmEl.textContent = ((performance.now() - stats.firstAt) / 1000).toFixed(0) + ' s (always on)';
      }
    }

    function draw() {
      if (st.w < 60 || st.h < 60) { return; }
      ctx.clearRect(0, 0, st.w, st.h);

      ctx.font = '600 11px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = C.muted;
      ctx.fillText('Events in', 16, 24);
      ctx.fillText('Execution environments (created on demand)', st.w * 0.3, 24);

      /* queue dots */
      var q;
      for (q = 0; q < Math.min(queue.length, 12); q++) {
        ctx.fillStyle = 'rgba(163, 230, 53, 0.85)';
        ctx.beginPath();
        ctx.arc(24 + (q % 4) * 14, 52 + Math.floor(q / 4) * 14, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      if (!queue.length) {
        ctx.fillStyle = C.faint;
        ctx.font = '500 10px Inter, sans-serif';
        ctx.fillText('(none waiting)', 16, 52);
      }

      var cols = 4;
      var x0 = st.w * 0.3, y0 = 46;
      var bw = Math.min(120, (st.w * 0.66) / cols - 10), bh = 52;
      envs.forEach(function (e, idx) {
        var x = x0 + (idx % cols) * (bw + 12);
        var y = y0 + Math.floor(idx / cols) * (bh + 12);
        var alpha = e.state === 'warm' ? 0.45 + 0.55 * (e.warmLeft / WARM_MS) : 1;
        ctx.save();
        ctx.globalAlpha = alpha;
        roundRect(ctx, x, y, bw, bh, 7);
        ctx.fillStyle = '#101a30';
        ctx.fill();
        ctx.lineWidth = 1.5;
        if (e.state === 'cold') {
          ctx.setLineDash([4, 3]);
          ctx.strokeStyle = C.amber;
        } else if (e.state === 'busy') {
          ctx.strokeStyle = '#38bdf8';
        } else {
          ctx.strokeStyle = 'rgba(45, 212, 191, 0.7)';
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '700 9.5px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = e.state === 'cold' ? C.amber : (e.state === 'busy' ? '#38bdf8' : C.teal);
        ctx.fillText(e.state === 'cold' ? 'cold start…' : (e.state === 'busy' ? 'running' : 'warm'), x + bw / 2, y + 16);
        ctx.fillStyle = C.faint;
        ctx.font = '500 9px Inter, sans-serif';
        ctx.fillText('env ' + e.id, x + bw / 2, y + 30);
        /* progress bar */
        if (e.state !== 'warm') {
          ctx.fillStyle = 'rgba(51, 65, 85, 0.8)';
          ctx.fillRect(x + 10, y + bh - 12, bw - 20, 4);
          ctx.fillStyle = e.state === 'cold' ? C.amber : '#38bdf8';
          ctx.fillRect(x + 10, y + bh - 12, (bw - 20) * clamp(e.p, 0, 1), 4);
        }
        ctx.restore();
      });

      if (!envs.length) {
        ctx.font = '500 11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = C.faint;
        ctx.fillText('No environments running. No cost accruing. Send a request →', st.w * 0.62, st.h * 0.5);
      }
    }

    var loop = makeLoop(function (t, dt) {
      envs.forEach(function (e) {
        if (e.state === 'cold') {
          e.p += dt / COLD_MS;
          if (e.p >= 1) { e.state = 'busy'; e.p = 0; }
        } else if (e.state === 'busy') {
          e.p += dt / EXEC_MS;
          if (e.p >= 1) {
            stats.billedMs += EXEC_MS;
            if (queue.length) {
              queue.shift();
              e.p = 0; /* immediately reused — warm reuse, no cold start */
            } else {
              e.state = 'warm';
              e.warmLeft = WARM_MS;
            }
            updateStats();
          }
        } else if (e.state === 'warm') {
          e.warmLeft -= dt;
        }
      });
      envs = envs.filter(function (e) { return !(e.state === 'warm' && e.warmLeft <= 0); });
      updateStats();
      draw();
      if (!envs.length && !queue.length) { loop.stop(); }
    });

    function ensureLoop() {
      if (reduced()) {
        /* resolve instantly without animation */
        envs.forEach(function (e) {
          if (e.state === 'cold' || e.state === 'busy') {
            stats.billedMs += EXEC_MS;
            e.state = 'warm';
            e.warmLeft = WARM_MS;
          }
        });
        while (queue.length) { queue.shift(); stats.billedMs += EXEC_MS; }
        updateStats();
        draw();
        setTimeout(function () {
          envs = [];
          draw();
        }, 3000);
        return;
      }
      loop.start();
    }

    oneBtn.addEventListener('click', function () {
      request();
      ensureLoop();
      var hadWarm = envs.some(function (e) { return e.state === 'busy' && e.id < nextEnv - 1; });
      setStatus(statusEl, stats.cold === stats.inv ?
        'Cold start: no environment existed, so the platform is creating one — runtime, your code, then execution. Later requests reuse it warm.' :
        (hadWarm || stats.inv > stats.cold ? 'Warm invocation — an existing environment answered in milliseconds. You were billed only for the execution time.' : 'Request dispatched.'), 'ok');
    });

    burstBtn.addEventListener('click', function () {
      var n;
      for (n = 0; n < 20; n++) { request(); }
      ensureLoop();
      setStatus(statusEl, '20 concurrent events → the platform fans out to many environments at once. This is scaling you didn’t configure, provision, or babysit — and in a few seconds it will all be gone again.', 'ok');
    });

    draw();
    onScreen(canvas, function () { draw(); }, function () { if (!envs.length) { loop.stop(); } });
  }

  /* ==========================================================================
     CH.11 — Shared responsibility model
     ========================================================================== */

  function initSec() {
    var layersEl = $('#cl-sec-layers');
    var statusEl = $('#cl-sec-status');
    if (!layersEl) { return; }

    var MODELS = {
      iaas: {
        text: 'IaaS (renting VMs): the provider runs everything up to the hypervisor. The guest OS, its patches, the runtime, your code, your data, and every access policy are yours.',
        owners: { identity: 'customer', data: 'customer', app: 'customer', runtime: 'customer', os: 'customer', hv: 'provider', net: 'provider', dc: 'provider' }
      },
      paas: {
        text: 'PaaS (renting a platform — managed databases, app platforms): the provider also patches the OS and runtime. You still own your code, data, and access policies.',
        owners: { identity: 'customer', data: 'customer', app: 'customer', runtime: 'provider', os: 'provider', hv: 'provider', net: 'provider', dc: 'provider' }
      },
      saas: {
        text: 'SaaS (renting a finished app — email, CRM): the provider runs the application itself. But look what never moves: your data and who can access it are still your responsibility.',
        owners: { identity: 'customer', data: 'customer', app: 'provider', runtime: 'provider', os: 'provider', hv: 'provider', net: 'provider', dc: 'provider' }
      }
    };

    function apply(model) {
      var m = MODELS[model];
      $$('li', layersEl).forEach(function (li) {
        var who = m.owners[li.dataset.layer];
        li.classList.remove('is-provider', 'is-customer', 'is-shared');
        li.classList.add('is-' + who);
        $('.cl-sec-who', li).textContent = who === 'provider' ? 'Provider' : 'You';
      });
      setStatus(statusEl, m.text);
    }

    $$('#cloud-experience .cl-sec-model').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$('#cloud-experience .cl-sec-model').forEach(function (b) {
          b.setAttribute('aria-pressed', String(b === btn));
        });
        apply(btn.dataset.model);
      });
    });

    apply('iaas');
  }

  /* ==========================================================================
     CH.12 — A request's journey through the canonical architecture.
     ========================================================================== */

  function initArch() {
    var runBtn = $('#cl-arch-run');
    var resetBtn = $('#cl-arch-reset');
    var detailEl = $('#cl-arch-detail');
    var statusEl = $('#cl-arch-status');
    var nodesEls = $$('#cloud-experience .cl-arch-node');
    if (!runBtn || !nodesEls.length) { return; }

    var INFO = {
      browser: '<strong>Browser.</strong> Resolves DNS, opens a TLS connection (see the cryptography exhibit), sends the HTTP request, renders the response. Everything below exists to answer it quickly.',
      cdn: '<strong>CDN edge.</strong> Hundreds of small caches placed near users worldwide. Static assets — images, scripts, video — are served from the nearest edge, often 10&ndash;30 ms away, without touching your servers.',
      lb: '<strong>Load balancer.</strong> The application’s single front door. Terminates TLS, health-checks every app server, spreads requests across the auto scaling group.',
      app1: '<strong>App server 1.</strong> One of N identical, stateless instances running your code. Identical and stateless is the trick: any server can answer any request, so servers become replaceable.',
      app2: '<strong>App server 2.</strong> Interchangeable with its siblings — which is why the auto scaler can add or remove instances freely.',
      app3: '<strong>App server 3.</strong> If it dies mid-request, the load balancer retries elsewhere and the auto scaler replaces it. Users never know.',
      cache: '<strong>Cache.</strong> An in-memory store (think Redis) holding hot data — sessions, rendered fragments, query results. Reads in ~1 ms instead of ~25 ms, and it absorbs traffic the database never has to see.',
      db: '<strong>Database.</strong> The system of record, replicated to a standby in another availability zone. Deliberately the most protected and least-touched component in the stack.',
      s3: '<strong>Object storage.</strong> Every uploaded photo and generated report lives here — replicated across zones, addressed by URL, feeding the CDN.'
    };

    var byName = {};
    nodesEls.forEach(function (el) { byName[el.dataset.node] = el; });

    nodesEls.forEach(function (el) {
      el.addEventListener('click', function () {
        nodesEls.forEach(function (n) { n.classList.remove('is-selected'); });
        el.classList.add('is-selected');
        detailEl.innerHTML = '<p>' + INFO[el.dataset.node] + '</p>';
      });
    });

    var warm = false;
    var playing = false;
    var timers = [];

    function clearHot() {
      nodesEls.forEach(function (n) { n.classList.remove('is-hot'); });
    }

    function run() {
      if (playing) { return; }
      playing = true;
      runBtn.disabled = true;
      clearHot();
      var appPick = 'app' + (1 + Math.floor(Math.random() * 3));
      var steps;
      if (!warm) {
        steps = [
          { n: 'browser', ms: 0, add: 48, txt: 'DNS + TLS handshake: ~48 ms before the first byte of the request even leaves.' },
          { n: 'cdn', add: 8, txt: 'CDN edge: MISS — this asset has never been requested here. The edge forwards to the origin (and will remember the answer).' },
          { n: 'lb', add: 3, txt: 'Load balancer: picks a healthy app server.' },
          { n: appPick, add: 14, txt: 'App server: runs your code — needs user data.' },
          { n: 'cache', add: 2, txt: 'Cache: MISS — first request, nothing cached yet. Falling through to the database (and writing the result back on the way out).' },
          { n: 'db', add: 26, txt: 'Database: the real query. Correct, durable, and the slowest hop in the chain.' },
          { n: 's3', add: 17, txt: 'Object storage: the page’s image is fetched so the CDN can cache it at the edge.' },
          { n: 'browser', add: 20, txt: 'Response rendered.' }
        ];
      } else {
        steps = [
          { n: 'browser', ms: 0, add: 12, txt: 'Connection reused — no handshake cost this time.' },
          { n: 'cdn', add: 9, txt: 'CDN edge: HIT — static assets served from ~20 ms away. Your servers never hear about them.' },
          { n: 'lb', add: 3, txt: 'Load balancer: API call routed to a healthy instance.' },
          { n: appPick, add: 11, txt: 'App server: runs your code.' },
          { n: 'cache', add: 2, txt: 'Cache: HIT — 1&ndash;2 ms, and the database never sees the query.' },
          { n: 'browser', add: 14, txt: 'Response rendered.' }
        ];
      }
      var total = 0;
      var stepDelay = reduced() ? 0 : 950;
      steps.forEach(function (s, idx) {
        timers.push(setTimeout(function () {
          clearHot();
          var el = byName[s.n];
          if (el) { el.classList.add('is-hot'); }
          total += s.add;
          detailEl.innerHTML = '<p><strong>' + (idx + 1) + '/' + steps.length + ' · ~' + total + ' ms so far.</strong> ' + s.txt + '</p>';
        }, idx * stepDelay));
      });
      timers.push(setTimeout(function () {
        playing = false;
        runBtn.disabled = false;
        if (!warm) {
          warm = true;
          setStatus(statusEl, 'Cold path: ~' + total + ' ms, dominated by misses and the database. Now trace it again — the CDN and cache remember.', 'ok');
          runBtn.textContent = 'Trace it again (caches warm)';
        } else {
          setStatus(statusEl, 'Warm path: ~' + total + ' ms — roughly 3× faster, and the database did no work at all. Cache hit-rates, not server speed, dominate real-world latency.', 'ok');
        }
      }, steps.length * stepDelay + 40));
    }

    runBtn.addEventListener('click', run);
    resetBtn.addEventListener('click', function () {
      timers.forEach(clearTimeout);
      timers = [];
      playing = false;
      warm = false;
      runBtn.disabled = false;
      runBtn.textContent = 'Trace a request';
      clearHot();
      nodesEls.forEach(function (n) { n.classList.remove('is-selected'); });
      detailEl.innerHTML = '<p>Caches emptied. The next trace pays full price again.</p>';
      setStatus(statusEl, '');
    });
  }

  /* ==========================================================================
     CH.14 — Misconception cards
     ========================================================================== */

  function initMyths() {
    $$('#cloud-experience .cl-myth-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var open = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!open));
        var verdict = btn.parentElement.querySelector('.cl-myth-verdict');
        if (verdict) { verdict.hidden = open; }
      });
    });
  }

  /* ==========================================================================
     CH.15 — Architecture builder (capstone).
     ========================================================================== */

  function initBuilder() {
    var diagram = $('#cl-build-diagram');
    var traffic = $('#cl-build-traffic');
    var trafficOut = $('#cl-build-traffic-out');
    var runBtn = $('#cl-build-run');
    var presetBtn = $('#cl-build-preset');
    var logEl = $('#cl-build-log');
    var latEl = $('#cl-build-latency');
    var costEl = $('#cl-build-cost');
    var haEl = $('#cl-build-ha');
    var scoreEl = $('#cl-build-score');
    var statusEl = $('#cl-build-status');
    if (!diagram || !runBtn) { return; }

    var LABELS = {
      cdn: 'CDN', lb: 'Load balancer', vm: 'Virtual machines', k8s: 'Containers',
      fn: 'Functions', autoscale: 'Auto scaling', cache: 'Cache', db: 'Database',
      dbha: 'DB standby', s3: 'Object storage', mon: 'Monitoring', iam: 'IAM & MFA'
    };
    var TIERS = [
      { label: 'Users', comps: ['users'] },
      { label: 'Edge', comps: ['cdn'] },
      { label: 'Traffic', comps: ['lb'] },
      { label: 'Compute', comps: ['vm', 'k8s', 'fn', 'autoscale'] },
      { label: 'Data', comps: ['cache', 'db', 'dbha', 's3'] },
      { label: 'Ops', comps: ['mon', 'iam'] }
    ];
    var TRAFFIC = [
      { label: 'Quiet · ~2k users', users: 2000, mult: 0.4 },
      { label: 'Growing · ~20k users', users: 20000, mult: 1 },
      { label: 'Viral · ~500k users', users: 500000, mult: 8 }
    ];

    var sel = {};
    var boxEls = {};
    var running = false;

    function has(c) { return !!sel[c]; }

    function render() {
      diagram.innerHTML = '';
      boxEls = {};
      var any = false;
      TIERS.forEach(function (tier) {
        var comps = tier.comps.filter(function (c) { return c === 'users' || has(c); });
        if (!comps.length) { return; }
        var row = document.createElement('div');
        row.className = 'cl-build-tier';
        var lbl = document.createElement('span');
        lbl.className = 'cl-build-tier-label';
        lbl.textContent = tier.label;
        row.appendChild(lbl);
        comps.forEach(function (c) {
          var box = document.createElement('span');
          box.className = 'cl-build-box';
          box.textContent = c === 'users' ? 'Users' : LABELS[c];
          row.appendChild(box);
          boxEls[c] = box;
          if (c !== 'users') { any = true; }
        });
        diagram.appendChild(row);
      });
      if (!any) {
        var empty = document.createElement('p');
        empty.className = 'cl-build-empty';
        empty.textContent = 'Users are waiting… toggle components above to build something for them to reach.';
        diagram.appendChild(empty);
      }
    }

    $$('#cloud-experience .cl-build-add').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (running) { return; }
        var c = btn.dataset.comp;
        sel[c] = !sel[c];
        btn.setAttribute('aria-pressed', String(!!sel[c]));
        render();
      });
    });

    traffic.addEventListener('input', function () {
      trafficOut.innerHTML = TRAFFIC[parseInt(traffic.value, 10)].label.replace('·', '&middot;');
    });

    presetBtn.addEventListener('click', function () {
      if (running) { return; }
      sel = { cdn: true, lb: true, vm: true, autoscale: true, cache: true, db: true, dbha: true, s3: true, mon: true, iam: true };
      $$('#cloud-experience .cl-build-add').forEach(function (btn) {
        btn.setAttribute('aria-pressed', String(!!sel[btn.dataset.comp]));
      });
      render();
      setStatus(statusEl, 'Loaded the canonical stack from chapter 12. Run it — then try deleting pieces and see what each one was protecting you from.');
    });

    function unpulseAll() {
      Object.keys(boxEls).forEach(function (c) {
        boxEls[c].classList.remove('is-pulse', 'is-fail');
      });
    }

    function run() {
      if (running) { return; }
      running = true;
      runBtn.disabled = true;
      logEl.innerHTML = '';
      unpulseAll();
      var T = TRAFFIC[parseInt(traffic.value, 10)];
      var compute = has('vm') || has('k8s') || has('fn');
      var elastic = has('fn') || has('autoscale');
      var steps = [];
      var score = 100;
      var latency = 120;
      var cost = 0;
      var survived = null;

      function log(txt, cls) {
        steps.push({ txt: txt, cls: cls });
      }

      /* ---- evaluate the architecture -------------------------------- */
      log(fmt(T.users) + ' users start arriving…');

      if (!compute) {
        log('Requests arrive — and nothing exists to serve them. Every user sees a connection error.', 'is-bad');
        score = 5;
        latency = 0;
        survived = false;
      } else {
        /* edge & traffic */
        if (has('cdn')) {
          latency -= 40;
          log('CDN serves static assets from edges near each user — and absorbs a big share of total requests.', 'is-good');
        } else {
          log('No CDN: distant users pay full round-trip latency for every image and script.', 'is-warn');
          score -= 8;
        }
        if (has('lb')) {
          log('Load balancer spreads traffic across your compute and health-checks it.', 'is-good');
        } else if (!has('fn')) {
          log('No load balancer: all traffic hits one address, and there’s no way to add servers behind it.', 'is-warn');
          score -= 12;
          latency += 30;
        }

        /* compute under load */
        if (T.mult >= 8 && !elastic) {
          log('The viral spike hits a fixed-size fleet: servers saturate, latency explodes, some requests time out.', 'is-bad');
          score -= 25;
          latency += 160;
        } else if (T.mult >= 8) {
          log(has('fn') ? 'Functions fan out automatically — the platform absorbs the spike.' :
            'Auto scaling reacts: the fleet grows to meet the spike, then shrinks after it.', 'is-good');
          latency += 15;
        }

        /* data tier */
        if (has('db')) {
          if (has('cache')) {
            latency -= 25;
            log('Cache absorbs most reads; the database only sees what matters.', 'is-good');
          } else if (T.mult >= 1) {
            log('Every read hits the database directly — it becomes the bottleneck as traffic grows.', 'is-warn');
            score -= 10;
            latency += 25;
          }
        } else {
          if (has('cache')) { log('A cache with no database behind it: caching nothing, twice as fast.', 'is-warn'); score -= 5; }
          if (!has('s3')) { log('No database and no object storage — this app remembers nothing. Fine for a demo, fatal for a product.', 'is-warn'); score -= 10; }
        }
        if (has('s3')) { log('Uploads and assets land in replicated object storage.', 'is-good'); }

        /* the failure injection */
        log('⚡ Failure injected: one compute instance dies mid-request.');
        if (has('fn')) {
          survived = true;
          log('Serverless platform simply routes events to other environments. Non-event.', 'is-good');
        } else if (has('lb') && (has('vm') || has('k8s'))) {
          survived = true;
          log((has('k8s') ? 'Kubernetes reschedules the lost pods; the' : 'The') +
            ' load balancer’s health checks stop routing to the dead instance within seconds.', 'is-good');
        } else {
          survived = false;
          score -= 20;
          log('Single server, no failover: the site is DOWN.', 'is-bad');
        }
        if (!survived) {
          if (has('mon')) {
            log('Monitoring pages you at once — you restart it in minutes.', 'is-warn');
          } else {
            log('No monitoring either: you find out from angry users on social media.', 'is-bad');
            score -= 8;
          }
        } else if (has('mon')) {
          log('Monitoring recorded the blip; nobody was woken up. That’s the goal.', 'is-good');
        } else {
          log('It self-healed — but without monitoring you’ll never know it happened, or how often it does.', 'is-warn');
          score -= 5;
        }

        /* db resilience + security */
        if (has('db') && !has('dbha') && T.mult >= 1) {
          log('Note: the database runs in a single availability zone — a zone outage would take everything down with it.', 'is-warn');
          score -= 8;
        } else if (has('dbha')) {
          log('Database has a standby in a second availability zone — even a data-center outage fails over.', 'is-good');
        }
        if (has('iam')) {
          log('IAM with least privilege and MFA on every account — the most common real-world breach path is closed.', 'is-good');
        } else {
          log('Security gap: shared credentials, no MFA. Most real cloud breaches start exactly here.', 'is-bad');
          score -= 15;
        }
      }

      /* ---- cost model (illustrative) -------------------------------- */
      if (has('cdn')) { cost += 20 * T.mult; }
      if (has('lb')) { cost += 25; }
      if (has('vm')) { cost += 70 * (elastic ? Math.max(1, 2 * T.mult) : Math.max(4, 2 * T.mult)); }
      if (has('k8s')) { cost += 160 + 45 * T.mult; }
      if (has('fn')) { cost += 4 * T.mult * 10; }
      if (has('cache')) { cost += 50; }
      if (has('db')) { cost += 120; }
      if (has('dbha')) { cost += 110; }
      if (has('s3')) { cost += 15 * T.mult; }
      if (has('mon')) { cost += 15; }

      latency = Math.max(30, Math.round(latency));
      score = clamp(Math.round(score), 0, 100);
      var grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';

      /* ---- play the log --------------------------------------------- */
      var stepDelay = reduced() ? 0 : 620;
      steps.forEach(function (s, idx) {
        setTimeout(function () {
          var li = document.createElement('li');
          li.textContent = s.txt;
          if (s.cls) { li.classList.add(s.cls); }
          logEl.appendChild(li);
          logEl.scrollTop = logEl.scrollHeight;
        }, idx * stepDelay);
      });
      setTimeout(function () {
        latEl.textContent = compute ? '~' + latency + ' ms' : 'n/a';
        costEl.textContent = '$' + fmt(cost) + '/mo';
        haEl.textContent = survived === null ? '–' : (survived ? 'Yes' : 'No');
        scoreEl.textContent = grade + ' (' + score + '/100)';
        Object.keys(boxEls).forEach(function (c) {
          if (c !== 'users') { boxEls[c].classList.add('is-pulse'); }
        });
        var msg;
        if (!compute) {
          msg = 'Add some compute — virtual machines, containers, or functions — and try again.';
        } else if (score >= 90) {
          msg = 'This is a production-shaped architecture: fast, elastic, fault-tolerant, and secured at the identity layer. You just designed what chapter 12 described.';
        } else if (score >= 60) {
          msg = 'It works — the log above shows exactly where it would hurt at scale. Toggle the flagged pieces and run it again.';
        } else {
          msg = 'It ran, barely. Read the log: each red line maps to a chapter on this page with the fix.';
        }
        setStatus(statusEl, msg, score >= 75 ? 'ok' : (score < 40 ? 'bad' : undefined));
        running = false;
        runBtn.disabled = false;
      }, steps.length * stepDelay + 60);
    }

    runBtn.addEventListener('click', run);
    trafficOut.innerHTML = TRAFFIC[1].label.replace('·', '&middot;');
    render();
  }

  /* ==========================================================================
     Boot — every widget isolated so one failure can't break the page
     ========================================================================== */

  function boot() {
    [initReveal, initRail, initHero, initPath, initDemand, initProviders,
     initMap, initVms, initK8s, initNet, initStore, initScale, initFn,
     initSec, initArch, initMyths, initBuilder].forEach(function (fn) {
      try { fn(); } catch (e) {
        if (window.console && console.error) { console.error('cloud.js widget failed:', fn.name, e); }
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
