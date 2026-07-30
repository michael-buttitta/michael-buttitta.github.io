/* =============================================================================
   Understanding Blockchain — interactivity
   Vanilla JS, no dependencies. Loaded with `defer` on /blockchain/ only.

   Structure:
     1. A real synchronous SHA-256 (UTF-8 in, hex out) that powers the hash
        sandbox, the block inspector, the tamper demo, and the playground miner
     2. Shared utilities (canvas fitting, visibility gating, rAF loops)
     3. One init function per widget, each guarded by element existence
     4. Everything respects prefers-reduced-motion: ambient animation is
        disabled and user-triggered simulations jump to their final state.

   The network/consensus simulations are illustrative models, not protocol
   emulation — the captions in the HTML say so where it matters. The hashes,
   however, are real.
   ============================================================================ */

(function () {
  'use strict';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function fmtInt(n) { return Math.round(n).toLocaleString('en-US'); }

  /* ==========================================================================
     SHA-256 — compact, synchronous, correct.
     UTF-8 encodes the input string and returns a 64-char lowercase hex digest.
     Verified against FIPS 180-4 test vectors in the console during development
     (sha256('') === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      sha256('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad').
     ========================================================================== */

  var SHA_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function utf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') { return new TextEncoder().encode(str); }
    var out = [], i, c;
    for (i = 0; i < str.length; i++) {
      c = str.codePointAt(i);
      if (c > 0xffff) { i++; }
      if (c < 0x80) { out.push(c); }
      else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 63)); }
      else if (c < 0x10000) { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
      else { out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
    }
    return new Uint8Array(out);
  }

  function sha256(str) {
    var msg = utf8Bytes(str);
    var bitLen = msg.length * 8;
    var padded = new Uint8Array((((msg.length + 8) >> 6) + 1) << 6);
    padded.set(msg);
    padded[msg.length] = 0x80;
    var dv = new DataView(padded.buffer);
    dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
    dv.setUint32(padded.length - 4, bitLen >>> 0);

    var h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a,
        h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    var w = new Int32Array(64);
    var i, j, a, b, c, d, e, f, g, h, t1, t2, s0, s1, ch, maj;

    for (i = 0; i < padded.length; i += 64) {
      for (j = 0; j < 16; j++) { w[j] = dv.getInt32(i + j * 4); }
      for (j = 16; j < 64; j++) {
        a = w[j - 15];
        s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
        b = w[j - 2];
        s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
        w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
      }
      a = h0; b = h1; c = h2; d = h3; e = h4; f = h5; g = h6; h = h7;
      for (j = 0; j < 64; j++) {
        s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        ch = (e & f) ^ (~e & g);
        t1 = (h + s1 + ch + SHA_K[j] + w[j]) | 0;
        s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        maj = (a & b) ^ (a & c) ^ (b & c);
        t2 = (s0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0;
        d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
      h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
    }

    function hex(n) {
      var s = (n >>> 0).toString(16);
      while (s.length < 8) { s = '0' + s; }
      return s;
    }
    return hex(h0) + hex(h1) + hex(h2) + hex(h3) + hex(h4) + hex(h5) + hex(h6) + hex(h7);
  }

  /* Count differing bits between two equal-length hex strings. */
  function hexBitDiff(a, b) {
    var bits = 0, i, x;
    for (i = 0; i < a.length; i++) {
      x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
      while (x) { bits += x & 1; x >>= 1; }
    }
    return bits;
  }

  function shortHash(h) { return h.slice(0, 10) + '…'; }

  var ZERO64 = new Array(65).join('0');

  /* Under Node the file exports the hash core and stops (no DOM), so the
     shipped artifact is directly unit-testable — same pattern as bitcoin.js.
     Calling convention: sha256(str) -> 64-char hex string. String in, unlike
     bitcoin.js's byte-oriented sha256(Uint8Array); pass raw bytes through
     utf8Bytes() if you need them. The canonical vector:
     node -e "const K=require('./assets/js/blockchain.js');console.log(K.sha256('abc')==='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')" */
  if (typeof window === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = { sha256: sha256, hexBitDiff: hexBitDiff, utf8Bytes: utf8Bytes };
    }
    return;
  }

  document.documentElement.classList.add('bc-js');

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
    var targets = $$('#blockchain-experience [data-bc-reveal]').concat($$('#blockchain-experience .bc-era'));
    if (!targets.length) { return; }
    $$('#blockchain-experience .bc-era').forEach(function (el, i) {
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
    var dots = $$('#blockchain-experience .bc-rail-dot');
    if (!dots.length || !('IntersectionObserver' in window)) { return; }
    var byId = {};
    dots.forEach(function (d) {
      var id = (d.getAttribute('href') || '').slice(1);
      if (id) { byId[id] = d; }
    });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var dot = byId[e.target.id];
        if (!dot) { return; }
        if (e.isIntersecting) {
          dots.forEach(function (d) { d.classList.remove('is-active'); });
          dot.classList.add('is-active');
        }
      });
    }, { rootMargin: '-35% 0px -55% 0px' });
    Object.keys(byId).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) { io.observe(el); }
    });
  }

  /* ==========================================================================
     HERO — an ambient network exchanging blocks
     ========================================================================== */

  function initHero() {
    var canvas = $('#bc-hero-canvas');
    if (!canvas) { return; }
    var cv = setupCanvas(canvas);
    var ctx = cv.ctx, st = cv.state;
    var rng = makeRng(20080131);

    var N = 42;
    var nodes = [];
    var i, j;
    for (i = 0; i < N; i++) {
      nodes.push({
        x: rng(), y: rng(),
        vx: (rng() - 0.5) * 0.004, vy: (rng() - 0.5) * 0.004,
        pulse: 0
      });
    }
    var packets = [];   /* {a, b, t, speed, block} */

    function neighbors(idx, k) {
      var n = nodes[idx];
      return nodes
        .map(function (m, mi) {
          var dx = m.x - n.x, dy = m.y - n.y;
          return { i: mi, d: dx * dx + dy * dy };
        })
        .filter(function (e) { return e.i !== idx; })
        .sort(function (a, b) { return a.d - b.d; })
        .slice(0, k)
        .map(function (e) { return e.i; });
    }

    function spawnPacket() {
      var a = Math.floor(rng() * N);
      var ns = neighbors(a, 4);
      var b = ns[Math.floor(rng() * ns.length)];
      var block = rng() < 0.22;
      packets.push({ a: a, b: b, t: 0, speed: 0.35 + rng() * 0.5, block: block });
      if (block) { nodes[a].pulse = 1; }
    }

    function draw(dt) {
      var w = st.w, h = st.h;
      if (w < 2) { return; }
      ctx.clearRect(0, 0, w, h);

      var k;
      for (k = 0; k < N; k++) {
        var n = nodes[k];
        n.x += n.vx * dt * 0.06;
        n.y += n.vy * dt * 0.06;
        if (n.x < 0.02 || n.x > 0.98) { n.vx *= -1; }
        if (n.y < 0.02 || n.y > 0.98) { n.vy *= -1; }
        n.pulse = Math.max(0, n.pulse - dt / 900);
      }

      /* edges to near neighbors */
      ctx.lineWidth = 1;
      for (k = 0; k < N; k++) {
        var ns = neighbors(k, 3);
        for (j = 0; j < ns.length; j++) {
          if (ns[j] < k) { continue; }
          var m = nodes[ns[j]];
          ctx.strokeStyle = 'rgba(51, 65, 85, 0.5)';
          ctx.beginPath();
          ctx.moveTo(nodes[k].x * w, nodes[k].y * h);
          ctx.lineTo(m.x * w, m.y * h);
          ctx.stroke();
        }
      }

      /* packets */
      packets = packets.filter(function (p) {
        p.t += (dt / 1000) * p.speed;
        var a = nodes[p.a], b = nodes[p.b];
        if (p.t >= 1) { b.pulse = Math.max(b.pulse, 0.7); return false; }
        var x = (a.x + (b.x - a.x) * p.t) * w;
        var y = (a.y + (b.y - a.y) * p.t) * h;
        if (p.block) {
          ctx.fillStyle = C.teal;
          roundRect(ctx, x - 4, y - 4, 8, 8, 2);
          ctx.fill();
        } else {
          ctx.fillStyle = 'rgba(2, 132, 199, 0.85)';
          ctx.beginPath();
          ctx.arc(x, y, 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
        return true;
      });

      /* nodes */
      for (k = 0; k < N; k++) {
        var nd = nodes[k];
        var x2 = nd.x * w, y2 = nd.y * h;
        if (nd.pulse > 0) {
          ctx.fillStyle = 'rgba(45, 212, 191, ' + (0.25 * nd.pulse) + ')';
          ctx.beginPath();
          ctx.arc(x2, y2, 10 + 8 * (1 - nd.pulse), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = nd.pulse > 0.4 ? C.teal : C.lineStrong;
        ctx.beginPath();
        ctx.arc(x2, y2, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (reduced()) {
      draw(0);
      return;
    }

    var acc = 0;
    var loop = makeLoop(function (t, dt) {
      acc += dt;
      if (acc > 260) { acc = 0; spawnPacket(); }
      draw(dt);
    });
    onScreen(canvas, function () { loop.start(); }, function () { loop.stop(); });
  }

  /* ==========================================================================
     01 · THE TRUST PROBLEM
     ========================================================================== */

  function initTrust() {
    var canvas = $('#bc-trust-canvas');
    if (!canvas) { return; }
    var els = {
      own: $('#bc-trust-own'), central: $('#bc-trust-central'),
      trades: $('#bc-trust-trades'), disputes: $('#bc-trust-disputes'),
      referee: $('#bc-trust-referee'), status: $('#bc-trust-status')
    };
    var cv = setupCanvas(canvas, function () { draw(); });
    var ctx = cv.ctx, st = cv.state;
    var rng = makeRng(1991);

    var NC = 10;
    var mode = 'own';           /* 'own' | 'central' */
    var trades = 0, disputes = 0;
    var flights = [];           /* {ax,ay,bx,by, t, speed, bad, via} */
    var flash = new Array(NC + 1).fill(0);   /* index NC = the bookkeeper */

    function companyPos(i) {
      var cx = st.w / 2, cy = st.h / 2;
      var r = Math.min(st.w, st.h) * 0.38;
      var ang = (i / NC) * Math.PI * 2 - Math.PI / 2;
      return { x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r };
    }

    function setOuts() {
      els.trades.textContent = fmtInt(trades);
      els.disputes.textContent = mode === 'own' ? fmtInt(disputes) : '0';
      els.referee.textContent = mode === 'own' ? 'lawyers & audits' : 'the bookkeeper';
      els.status.textContent = mode === 'own'
        ? 'Ten sets of books, ten versions of the truth. Every red flash is two ledgers that now disagree.'
        : 'One set of books — disagreements vanish, but so does independence: everyone now trusts the purple company’s honesty, competence, and uptime.';
    }

    function spawnTrade() {
      var a = Math.floor(rng() * NC);
      var b = (a + 1 + Math.floor(rng() * (NC - 1))) % NC;
      var pa = companyPos(a), pb = companyPos(b);
      var bad = mode === 'own' && rng() < 0.18;
      flights.push({ a: a, b: b, ax: pa.x, ay: pa.y, bx: pb.x, by: pb.y, t: 0, speed: 0.8 + rng() * 0.5, bad: bad, leg: 0 });
    }

    function draw(dt) {
      dt = dt || 0;
      var w = st.w, h = st.h;
      if (w < 2) { return; }
      ctx.clearRect(0, 0, w, h);
      var cx = w / 2, cy = h / 2;
      var i;

      /* central bookkeeper */
      if (mode === 'central') {
        ctx.strokeStyle = 'rgba(139, 92, 246, 0.25)';
        ctx.lineWidth = 1;
        for (i = 0; i < NC; i++) {
          var pp = companyPos(i);
          ctx.beginPath(); ctx.moveTo(pp.x, pp.y); ctx.lineTo(cx, cy); ctx.stroke();
        }
        ctx.fillStyle = flash[NC] > 0 ? C.violet : 'rgba(139, 92, 246, 0.8)';
        roundRect(ctx, cx - 16, cy - 12, 32, 24, 5);
        ctx.fill();
        ctx.fillStyle = C.strong;
        ctx.font = '600 9px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('LEDGER', cx, cy + 3);
      }

      /* flights */
      flights = flights.filter(function (f) {
        f.t += (dt / 1000) * f.speed;
        var sx, sy, ex, ey;
        if (mode === 'central') {
          if (f.leg === 0) { sx = f.ax; sy = f.ay; ex = cx; ey = cy; }
          else { sx = cx; sy = cy; ex = f.bx; ey = f.by; }
        } else {
          sx = f.ax; sy = f.ay; ex = f.bx; ey = f.by;
        }
        if (f.t >= 1) {
          if (mode === 'central' && f.leg === 0) { f.leg = 1; f.t = 0; flash[NC] = 1; return true; }
          trades++;
          if (f.bad) { disputes++; flash[f.a] = -1; flash[f.b] = -1; }
          else { flash[f.b] = 1; }
          setOuts();
          return false;
        }
        var x = sx + (ex - sx) * f.t;
        var y = sy + (ey - sy) * f.t;
        ctx.fillStyle = f.bad ? C.rose : C.sky;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
        return true;
      });

      /* companies + their ledgers */
      for (i = 0; i < NC; i++) {
        var p = companyPos(i);
        var fl = flash[i];
        flash[i] = fl > 0 ? Math.max(0, fl - dt / 600) : Math.min(0, fl + dt / 600);
        var col = fl < -0.05 ? C.rose : (fl > 0.05 ? C.teal : C.lineStrong);
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.5;
        ctx.fillStyle = C.deep;
        roundRect(ctx, p.x - 13, p.y - 10, 26, 20, 4);
        ctx.fill();
        ctx.stroke();
        /* mini ledger lines */
        ctx.strokeStyle = fl < -0.05 ? 'rgba(225, 29, 72, 0.8)' : 'rgba(148, 163, 184, 0.55)';
        ctx.lineWidth = 1;
        var l;
        for (l = 0; l < 3; l++) {
          ctx.beginPath();
          ctx.moveTo(p.x - 8, p.y - 4 + l * 4.5);
          ctx.lineTo(p.x + 8, p.y - 4 + l * 4.5);
          ctx.stroke();
        }
      }
      flash[NC] = Math.max(0, flash[NC] - dt / 500);
    }

    function setMode(m) {
      mode = m;
      trades = 0; disputes = 0; flights = [];
      els.own.setAttribute('aria-pressed', String(m === 'own'));
      els.central.setAttribute('aria-pressed', String(m === 'central'));
      setOuts();
      if (reduced()) { draw(0); }
    }

    els.own.addEventListener('click', function () { setMode('own'); });
    els.central.addEventListener('click', function () { setMode('central'); });

    setMode('own');

    if (reduced()) {
      draw(0);
      trades = 240; disputes = 43;
      setOuts();
      return;
    }

    var acc = 0;
    var loop = makeLoop(function (t, dt) {
      acc += dt;
      if (acc > 380) { acc = 0; spawnTrade(); }
      draw(dt);
    });
    onScreen(canvas, function () { loop.start(); }, function () { loop.stop(); });
  }

  /* ==========================================================================
     02 · CENTRALIZED VS DECENTRALIZED TOPOLOGY
     ========================================================================== */

  function initSystems() {
    var canvas = $('#bc-sys-canvas');
    if (!canvas) { return; }
    var els = {
      central: $('#bc-sys-central'), decentral: $('#bc-sys-decentral'),
      fail: $('#bc-sys-fail'), heal: $('#bc-sys-heal'),
      served: $('#bc-sys-served'), failed: $('#bc-sys-failed'), status: $('#bc-sys-status')
    };
    var cv = setupCanvas(canvas, function () { draw(0); });
    var ctx = cv.ctx, st = cv.state;
    var rng = makeRng(2009);

    var NP = 12;
    var mode = 'central';
    var downSet = {};          /* node index -> true (index -1 = the central server) */
    var served = 0, failed = 0;
    var flights = [];          /* {sx,sy,ex,ey,t,speed,ok} */

    function peerPos(i) {
      var cx = st.w / 2, cy = st.h / 2;
      var r = Math.min(st.w, st.h) * 0.38;
      var ang = (i / NP) * Math.PI * 2 - Math.PI / 2;
      return { x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r };
    }

    function anyUp() {
      var n = 0, i;
      for (i = 0; i < NP; i++) { if (!downSet[i]) { n++; } }
      return n;
    }

    function statusText() {
      if (mode === 'central') {
        return downSet[-1]
          ? 'OUTAGE — the server is down, so 100% of clients are dead in the water.'
          : 'Healthy — fast and simple, as long as the server stays up.';
      }
      var up = anyUp();
      if (up === NP) { return 'Healthy — every peer serves and verifies.'; }
      return 'Degraded but alive — ' + (NP - up) + ' of ' + NP + ' nodes down, the rest carry on.';
    }

    function setOuts() {
      els.served.textContent = fmtInt(served);
      els.failed.textContent = fmtInt(failed);
      els.status.textContent = statusText();
    }

    function spawnRequest() {
      var from = Math.floor(rng() * NP);
      var p = peerPos(from);
      if (mode === 'central') {
        var ok = !downSet[-1];
        flights.push({ sx: p.x, sy: p.y, ex: st.w / 2, ey: st.h / 2, t: 0, speed: 1.1, ok: ok });
      } else {
        if (downSet[from]) { from = (from + 1) % NP; }
        var tries = 0, to = from;
        do { to = Math.floor(rng() * NP); tries++; } while ((to === from || downSet[to]) && tries < 24);
        var ok2 = !downSet[to] && to !== from;
        var q = peerPos(to);
        flights.push({ sx: p.x, sy: p.y, ex: q.x, ey: q.y, t: 0, speed: 1.1, ok: ok2 });
      }
    }

    function draw(dt) {
      var w = st.w, h = st.h;
      if (w < 2) { return; }
      ctx.clearRect(0, 0, w, h);
      var cx = w / 2, cy = h / 2;
      var i, j;

      /* wiring */
      ctx.lineWidth = 1;
      if (mode === 'central') {
        for (i = 0; i < NP; i++) {
          var p = peerPos(i);
          ctx.strokeStyle = downSet[-1] ? 'rgba(225, 29, 72, 0.18)' : 'rgba(51, 65, 85, 0.55)';
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(cx, cy); ctx.stroke();
        }
      } else {
        for (i = 0; i < NP; i++) {
          for (j = i + 1; j < NP; j++) {
            var d = Math.min((j - i), NP - (j - i));
            if (d > 3) { continue; }
            var a = peerPos(i), b = peerPos(j);
            ctx.strokeStyle = (downSet[i] || downSet[j]) ? 'rgba(225, 29, 72, 0.12)' : 'rgba(51, 65, 85, 0.45)';
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
      }

      /* flights */
      flights = flights.filter(function (f) {
        f.t += (dt / 1000) * f.speed;
        if (f.t >= 1) {
          if (f.ok) { served++; } else { failed++; }
          setOuts();
          return false;
        }
        var x = f.sx + (f.ex - f.sx) * f.t;
        var y = f.sy + (f.ey - f.sy) * f.t;
        ctx.fillStyle = f.ok ? C.sky : C.rose;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
        return true;
      });

      /* central server */
      if (mode === 'central') {
        var dn = downSet[-1];
        ctx.fillStyle = dn ? 'rgba(225, 29, 72, 0.18)' : 'rgba(139, 92, 246, 0.85)';
        ctx.strokeStyle = dn ? C.rose : C.violet;
        ctx.lineWidth = 1.5;
        roundRect(ctx, cx - 18, cy - 14, 36, 28, 6);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = dn ? C.rose : C.strong;
        ctx.font = '700 9px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(dn ? 'DOWN' : 'SERVER', cx, cy + 3);
      }

      /* peers */
      for (i = 0; i < NP; i++) {
        var pp = peerPos(i);
        var down = downSet[i];
        ctx.fillStyle = C.deep;
        ctx.strokeStyle = down ? C.rose : (mode === 'central' ? C.lineStrong : C.cTeal);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(pp.x, pp.y, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        if (down) {
          ctx.strokeStyle = C.rose;
          ctx.beginPath();
          ctx.moveTo(pp.x - 4, pp.y - 4); ctx.lineTo(pp.x + 4, pp.y + 4);
          ctx.moveTo(pp.x + 4, pp.y - 4); ctx.lineTo(pp.x - 4, pp.y + 4);
          ctx.stroke();
        }
      }
    }

    function setMode(m) {
      mode = m;
      downSet = {};
      served = 0; failed = 0; flights = [];
      els.central.setAttribute('aria-pressed', String(m === 'central'));
      els.decentral.setAttribute('aria-pressed', String(m === 'decentral'));
      setOuts();
      if (reduced()) { draw(0); }
    }

    els.central.addEventListener('click', function () { setMode('central'); });
    els.decentral.addEventListener('click', function () { setMode('decentral'); });
    els.fail.addEventListener('click', function () {
      if (mode === 'central') {
        downSet[-1] = true;
      } else {
        var i;
        for (i = 0; i < NP; i++) { if (!downSet[i]) { downSet[i] = true; break; } }
      }
      setOuts();
      if (reduced()) { draw(0); }
    });
    els.heal.addEventListener('click', function () {
      downSet = {};
      setOuts();
      if (reduced()) { draw(0); }
    });

    setMode('central');

    if (reduced()) {
      draw(0);
      return;
    }
    var acc = 0;
    var loop = makeLoop(function (t, dt) {
      acc += dt;
      if (acc > 300) { acc = 0; spawnRequest(); }
      draw(dt);
    });
    onScreen(canvas, function () { loop.start(); }, function () { loop.stop(); });
  }

  /* ==========================================================================
     Block element factory (03, 05, playground)
     ========================================================================== */

  function blockEl(opts) {
    /* opts: {n, label, sub, prev, hash, valid, broken, badge, clickable, genesis} */
    var li = document.createElement('li');
    li.className = 'bc-block' + (opts.broken ? ' is-broken is-linkbroken' : (opts.valid ? ' is-valid' : ''));
    var inner = document.createElement(opts.clickable ? 'button' : 'div');
    inner.className = 'bc-block-inner';
    if (opts.clickable) { inner.type = 'button'; inner.setAttribute('aria-pressed', 'false'); }

    var head = document.createElement('span');
    head.className = 'bc-block-head';
    head.innerHTML = '<span>Block #' + opts.n + '</span>' +
      '<span class="bc-block-badge">' + opts.badge + '</span>';
    inner.appendChild(head);

    var sub = document.createElement('span');
    sub.className = 'bc-block-sub';
    sub.textContent = opts.sub;
    inner.appendChild(sub);

    var prevRow = document.createElement('span');
    prevRow.className = 'bc-block-hashrow';
    prevRow.innerHTML = '<span class="bc-block-hlabel">prev</span><code>' +
      (opts.genesis ? '(none)' : shortHash(opts.prev)) + '</code>';
    inner.appendChild(prevRow);

    var hashRow = document.createElement('span');
    hashRow.className = 'bc-block-hashrow is-hash';
    hashRow.innerHTML = '<span class="bc-block-hlabel">hash</span><code>' + shortHash(opts.hash) + '</code>';
    inner.appendChild(hashRow);

    li.appendChild(inner);
    return li;
  }

  /* ==========================================================================
     03 · WHAT IS A BLOCKCHAIN? — inspectable chain
     ========================================================================== */

  function initAnatomy() {
    var chainEl = $('#bc-anatomy-chain');
    var detailEl = $('#bc-anatomy-detail');
    if (!chainEl || !detailEl) { return; }

    var blocks = [
      { txs: [], ts: '2026-07-01 09:00:00 UTC', nonce: 0, note: 'The genesis block — hard-coded into the software, the one block with no parent.' },
      { txs: ['Ava → Ben · 20 coins', 'Cleo → Dan · 5 coins'], ts: '2026-07-01 09:10:12 UTC', nonce: 831, note: 'An ordinary block: a bundle of transactions plus the header fields.' },
      { txs: ['Ben → Cleo · 12 coins', 'Dan → Ava · 3 coins', 'Ava → Dan · 7 coins'], ts: '2026-07-01 09:19:47 UTC', nonce: 204, note: 'Its “previous hash” is literally Block #2’s fingerprint — that field is the chain.' },
      { txs: ['Cleo → Ava · 9 coins'], ts: '2026-07-01 09:31:05 UTC', nonce: 1377, note: 'The newest block. When the next one arrives, this hash becomes its “previous hash.”' }
    ];

    /* compute the real linked hashes */
    var i;
    for (i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      b.prev = i === 0 ? ZERO64 : blocks[i - 1].hash;
      b.hash = sha256(i + '|' + b.ts + '|' + b.txs.join(';') + '|' + b.prev + '|' + b.nonce);
    }

    var lis = [];
    function select(idx) {
      lis.forEach(function (li, k) {
        li.classList.toggle('is-selected', k === idx);
        li.querySelector('button').setAttribute('aria-pressed', String(k === idx));
      });
      var b = blocks[idx];
      var txHtml = b.txs.length
        ? '<ul class="bc-bd-txs">' + b.txs.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul>'
        : '<span>(none — genesis)</span>';
      detailEl.innerHTML =
        '<h3 class="bc-bd-title">Block #' + (idx + 1) + '</h3>' +
        '<dl class="bc-bd">' +
        '<div><dt>Transactions</dt><dd>' + txHtml + '</dd></div>' +
        '<div><dt>Timestamp</dt><dd>' + b.ts + '</dd></div>' +
        '<div><dt>Previous hash</dt><dd><code>' + (idx === 0 ? '0 (no parent)' : b.prev) + '</code></dd></div>' +
        '<div><dt>Nonce</dt><dd>' + b.nonce + '</dd></div>' +
        '<div><dt>Current hash</dt><dd><code class="bc-bd-hash">' + b.hash + '</code></dd></div>' +
        '<div><dt>Note</dt><dd>' + b.note + '</dd></div>' +
        '</dl>';
    }

    blocks.forEach(function (b, idx) {
      var li = blockEl({
        n: idx + 1,
        sub: b.txs.length ? b.txs.length + ' transaction' + (b.txs.length > 1 ? 's' : '') : 'genesis · no transactions',
        prev: b.prev, hash: b.hash,
        valid: true, broken: false,
        badge: idx === 0 ? 'genesis' : 'linked ✓',
        clickable: true, genesis: idx === 0
      });
      li.querySelector('button').addEventListener('click', function () { select(idx); });
      chainEl.appendChild(li);
      lis.push(li);
    });

    select(1);
  }

  /* ==========================================================================
     04 · HASHING SANDBOX
     ========================================================================== */

  function initHashing() {
    var input = $('#bc-hash-input');
    var hexOut = $('#bc-hash-hex');
    if (!input || !hexOut) { return; }
    var lenOut = $('#bc-hash-len');
    var flipsOut = $('#bc-hash-flips');
    var note = $('#bc-hash-note');

    var prevText = null, prevHash = null;
    var flashTimer = null;

    function update() {
      var text = input.value;
      var hash = sha256(text);
      hexOut.textContent = hash;
      lenOut.textContent = fmtInt(text.length) + ' chars';
      if (prevHash !== null && hash !== prevHash) {
        var flips = hexBitDiff(hash, prevHash);
        flipsOut.textContent = flips + ' of 256 (' + Math.round(flips / 256 * 100) + '%)';
        var delta = Math.abs(text.length - (prevText || '').length);
        note.textContent = (delta <= 1
          ? 'A tiny edit flipped ' + flips + ' output bits — the avalanche effect at work. '
          : 'New input, new fingerprint: ' + flips + ' bits differ from the last one. ') +
          'Roughly half the bits change on any edit, so nothing about the old hash survives.';
        if (!reduced()) {
          hexOut.classList.add('is-flash');
          clearTimeout(flashTimer);
          flashTimer = setTimeout(function () { hexOut.classList.remove('is-flash'); }, 250);
        }
      } else if (prevHash === null) {
        flipsOut.textContent = '–';
        note.textContent = 'Edit the text — change one letter — and watch how many bits flip.';
      }
      prevText = text;
      prevHash = hash;
    }

    input.addEventListener('input', update);
    update();
  }

  /* ==========================================================================
     05 · TAMPER DEMO — break the chain, then pay to fix it
     ========================================================================== */

  function initTamper() {
    var chainEl = $('#bc-tamper-chain');
    if (!chainEl) { return; }
    var els = {
      modify: $('#bc-tamper-modify'), remine: $('#bc-tamper-remine'), reset: $('#bc-tamper-reset'),
      valid: $('#bc-tamper-valid'), broken: $('#bc-tamper-broken'),
      work: $('#bc-tamper-work'), status: $('#bc-tamper-status')
    };

    var PREFIX = '00';   /* 2 hex zeros ≈ 256 attempts per block on average */
    var TS = ['09:00:00', '09:10:12', '09:19:47', '09:31:05', '09:42:33'];
    var TXS = [
      [],
      ['Ava → Ben · 20 coins'],
      ['Ben → Cleo · 12 coins', 'Dan → Ava · 3 coins'],
      ['Cleo → Dan · 8 coins'],
      ['Dan → Ben · 15 coins', 'Ava → Cleo · 4 coins']
    ];

    var blocks = [];
    var mining = false;
    var runToken = 0;

    function blockData(i, b) {
      return i + '|' + b.ts + '|' + b.txs.join(';') + '|' + b.prev + '|' + b.nonce;
    }

    function mineSync(i, b) {
      var n = 0, h;
      b.nonce = 0;
      for (;;) {
        h = sha256(blockData(i, b));
        n++;
        if (h.slice(0, PREFIX.length) === PREFIX) { b.hash = h; return n; }
        b.nonce++;
        if (n > 500000) { b.hash = h; return n; }   /* safety valve, never hit at '00' */
      }
    }

    function build() {
      blocks = [];
      var i;
      for (i = 0; i < 5; i++) {
        var b = { txs: TXS[i].slice(), ts: '2026-07-01 ' + TS[i] + ' UTC', nonce: 0, prev: i === 0 ? ZERO64 : blocks[i - 1].hash, hash: '' };
        mineSync(i, b);
        blocks.push(b);
      }
    }

    function validity() {
      /* Once any block is invalid, every descendant is too — its ancestry is
         no longer anchored, even if its own fields are internally consistent. */
      var out = [], broken = false, i;
      for (i = 0; i < blocks.length; i++) {
        var b = blocks[i];
        var contentOk = b.hash === sha256(blockData(i, b));
        var minedOk = b.hash.slice(0, PREFIX.length) === PREFIX;
        var linkOk = i === 0 || b.prev === blocks[i - 1].hash;
        if (!(contentOk && minedOk && linkOk)) { broken = true; }
        out.push(broken ? 'invalid' : 'ok');
      }
      return out;
    }

    function render(miningIdx) {
      chainEl.innerHTML = '';
      var v = validity();
      blocks.forEach(function (b, i) {
        var bad = v[i] !== 'ok';
        var li = blockEl({
          n: i + 1,
          sub: b.txs.length ? b.txs.join(' · ') : 'genesis · no transactions',
          prev: b.prev, hash: b.hash,
          valid: !bad, broken: bad,
          badge: i === 0 ? 'genesis' : (bad ? '✗ invalid' : 'mined ✓'),
          clickable: false, genesis: i === 0
        });
        if (i === miningIdx) { li.classList.add('is-mining'); li.classList.remove('is-broken'); }
        chainEl.appendChild(li);
      });
      var okCount = v.filter(function (s) { return s === 'ok'; }).length;
      els.valid.textContent = okCount + ' of 5';
      els.broken.textContent = String(5 - okCount);
    }

    function reset() {
      runToken++;
      mining = false;
      build();
      render(-1);
      els.work.textContent = '–';
      els.remine.disabled = true;
      els.modify.disabled = false;
      els.status.textContent = 'The chain is intact: every hash meets the difficulty target (it starts with “' + PREFIX + '”) and matches the next block’s “prev” field.';
    }

    els.modify.addEventListener('click', function () {
      if (mining) { return; }
      var b = blocks[1];
      b.txs[0] = 'Ava → Ben · 2,000 coins';
      /* the attacker recomputes the hash — but it no longer meets the
         difficulty target, and every child’s “prev” now points at a ghost */
      b.hash = sha256(blockData(1, b));
      render(-1);
      els.remine.disabled = false;
      els.modify.disabled = true;
      els.work.textContent = '~1,024 expected';
      els.status.textContent = 'Block #2 now says Ava paid 2,000 coins instead of 20. Its recomputed hash no longer starts with “' + PREFIX + '”, and blocks #3–#5 still point at the old fingerprint — four blocks invalid from one edit.';
    });

    els.remine.addEventListener('click', function () {
      if (mining) { return; }
      mining = true;
      els.remine.disabled = true;
      var token = ++runToken;
      var total = 0;
      var idx = 1;

      if (reduced()) {
        for (idx = 1; idx < 5; idx++) {
          if (idx > 1) { blocks[idx].prev = blocks[idx - 1].hash; }
          total += mineSync(idx, blocks[idx]);
        }
        mining = false;
        render(-1);
        els.work.textContent = fmtInt(total);
        els.status.textContent = 'Repaired — after ' + fmtInt(total) + ' hash attempts across four blocks. On a real network the difficulty is ~20 orders of magnitude higher, and the honest chain kept growing while you worked.';
        return;
      }

      function mineOne() {
        if (token !== runToken) { return; }
        if (idx >= 5) {
          mining = false;
          render(-1);
          els.status.textContent = 'Repaired — after ' + fmtInt(total) + ' hash attempts across four blocks. That was difficulty “' + PREFIX + '”. Bitcoin’s target is ~19 more zeros, and while you re-mined, the honest network kept extending the real chain — you would still lose the race.';
          return;
        }
        if (idx > 1) { blocks[idx].prev = blocks[idx - 1].hash; }
        var b = blocks[idx];
        b.nonce = 0;
        render(idx);
        function chunk() {
          if (token !== runToken) { return; }
          var i2;
          for (i2 = 0; i2 < 64; i2++) {
            var h = sha256(blockData(idx, b));
            total++;
            if (h.slice(0, PREFIX.length) === PREFIX) {
              b.hash = h;
              els.work.textContent = fmtInt(total);
              idx++;
              render(idx < 5 ? -1 : -1);
              mineOne();
              return;
            }
            b.nonce++;
          }
          els.work.textContent = fmtInt(total);
          els.status.textContent = 'Re-mining block #' + (idx + 1) + '… nonce ' + fmtInt(b.nonce) + ', still searching for a hash starting with “' + PREFIX + '”.';
          /* setTimeout, not rAF: the miner must keep grinding even if the tab
             is backgrounded mid-run (rAF freezes when the page is hidden) */
          setTimeout(chunk, 16);
        }
        chunk();
      }
      mineOne();
    });

    els.reset.addEventListener('click', reset);
    reset();
  }

  /* ==========================================================================
     06 · DISTRIBUTED CONSENSUS — gossip, validation, forks
     ========================================================================== */

  function initConsensusNet() {
    var canvas = $('#bc-net-canvas');
    if (!canvas) { return; }
    var els = {
      tx: $('#bc-net-tx'), fork: $('#bc-net-fork'), reset: $('#bc-net-reset'),
      nodes: $('#bc-net-nodes'), height: $('#bc-net-height'),
      agree: $('#bc-net-agree'), phase: $('#bc-net-phase'), status: $('#bc-net-status')
    };
    var cv = setupCanvas(canvas, function () { placeNodes(); drawStatic(); });
    var ctx = cv.ctx, st = cv.state;
    var rng = makeRng(31337);

    var N = 110;
    var CLUSTERS = [[0.15, 0.32], [0.30, 0.68], [0.46, 0.22], [0.60, 0.55], [0.80, 0.30], [0.74, 0.80], [0.90, 0.62]];
    var nodes = [];        /* {x,y} in unit space */
    var height = 0;
    var phase = 'idle';    /* 'idle' | 'tx' | 'fork' */
    var elapsed = 0;
    var sim = null;        /* per-run precomputed distances */
    var V = 0.38;          /* wave speed, unit distance per second */

    (function initNodes() {
      var i;
      for (i = 0; i < N; i++) {
        var c = CLUSTERS[Math.floor(rng() * CLUSTERS.length)];
        nodes.push({
          x: clamp(c[0] + (rng() + rng() - 1) * 0.11, 0.03, 0.97),
          y: clamp(c[1] + (rng() + rng() - 1) * 0.13, 0.06, 0.94)
        });
      }
    })();

    function placeNodes() { /* positions are relative; nothing to do on resize */ }

    function dist(a, b) {
      var dx = nodes[a].x - nodes[b].x, dy = nodes[a].y - nodes[b].y;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function distancesFrom(src) {
      var out = new Array(N), i;
      for (i = 0; i < N; i++) { out[i] = dist(src, i); }
      return out;
    }

    function setOuts(agree, phaseLabel) {
      els.nodes.textContent = String(N);
      els.height.textContent = String(height);
      els.agree.textContent = agree;
      els.phase.textContent = phaseLabel;
    }

    function nodeColor(i) {
      /* returns a fill style for node i given the current phase & elapsed time */
      if (phase === 'idle' || !sim) { return C.lineStrong; }
      var e = elapsed;
      if (phase === 'tx') {
        var a = sim.dSrc[i] / V * 1000;
        if (e > sim.produceAt) {
          var tb = sim.produceAt + sim.dProd[i] / V * 1000;
          if (e > tb) { return C.teal; }
        }
        if (e < a) { return C.lineStrong; }
        if (e < a + 320) { return C.sky; }
        if (e < a + 950) { return C.amber; }
        return 'rgba(148, 163, 184, 0.8)';
      }
      /* fork */
      var tA = sim.dA[i] / V * 1000;
      var tB = sim.dB[i] / V * 1000;
      if (e > sim.resolveAt) {
        var tw = sim.resolveAt + sim.dA[i] / V * 1000;
        if (e > tw) { return C.teal; }
      }
      if (e < Math.min(tA, tB)) { return C.lineStrong; }
      return tA <= tB ? C.teal : C.lime;
    }

    function countAgree() {
      if (phase === 'idle' || !sim) { return N + ' / ' + N; }
      var i, teal = 0, lime = 0, other = 0;
      for (i = 0; i < N; i++) {
        var c = nodeColor(i);
        if (c === C.teal) { teal++; }
        else if (c === C.lime) { lime++; }
        else { other++; }
      }
      if (phase === 'fork' && lime > 0) { return Math.max(teal, lime) + ' / ' + N + ' (split)'; }
      return (phase === 'tx' && teal === 0 ? N : teal) + ' / ' + N;
    }

    function draw() {
      var w = st.w, h = st.h;
      if (w < 2) { return; }
      ctx.clearRect(0, 0, w, h);
      var i;

      /* faint links inside clusters for texture */
      ctx.lineWidth = 0.6;
      ctx.strokeStyle = 'rgba(51, 65, 85, 0.28)';
      for (i = 0; i < N; i += 3) {
        var j = (i + 7) % N;
        if (dist(i, j) < 0.16) {
          ctx.beginPath();
          ctx.moveTo(nodes[i].x * w, nodes[i].y * h);
          ctx.lineTo(nodes[j].x * w, nodes[j].y * h);
          ctx.stroke();
        }
      }

      /* expanding wavefronts */
      if (sim && phase !== 'idle') {
        var fronts = [];
        if (phase === 'tx') {
          fronts.push({ src: sim.src, t0: 0, col: 'rgba(2, 132, 199, 0.35)' });
          if (elapsed > sim.produceAt) { fronts.push({ src: sim.prod, t0: sim.produceAt, col: 'rgba(45, 212, 191, 0.4)' }); }
        } else {
          fronts.push({ src: sim.pA, t0: 0, col: 'rgba(45, 212, 191, 0.4)' });
          fronts.push({ src: sim.pB, t0: 0, col: 'rgba(101, 163, 13, 0.4)' });
          if (elapsed > sim.resolveAt) { fronts.push({ src: sim.pA, t0: sim.resolveAt, col: 'rgba(45, 212, 191, 0.5)' }); }
        }
        fronts.forEach(function (f) {
          var r = ((elapsed - f.t0) / 1000) * V;
          if (r <= 0 || r > 1.4) { return; }
          ctx.strokeStyle = f.col;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(nodes[f.src].x * w, nodes[f.src].y * h, r * Math.min(w, h), 0, Math.PI * 2);
          ctx.stroke();
        });
      }

      for (i = 0; i < N; i++) {
        ctx.fillStyle = nodeColor(i);
        ctx.beginPath();
        ctx.arc(nodes[i].x * w, nodes[i].y * h, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function drawStatic() { draw(); }

    var loop = makeLoop(function (t, dt) {
      if (phase === 'idle') { draw(); return; }
      elapsed += dt;
      if (phase === 'tx' && elapsed > sim.doneAt) {
        phase = 'idle';
        height++;
        els.status.textContent = 'Done: the transaction reached every node (blue), each validated it (amber), one node bundled it into a block, and all ' + N + ' replicas appended it (teal). Height is now ' + height + ' everywhere.';
        setOuts(N + ' / ' + N, 'idle');
      } else if (phase === 'fork' && elapsed > sim.doneAt) {
        phase = 'idle';
        height += 2;
        els.status.textContent = 'Fork resolved: two blocks appeared at the same height and the network briefly split (teal vs. olive). The teal branch found the next block first, so it became the longer chain — every node discarded the olive block and converged. This is why fresh blocks are treated as tentative.';
        setOuts(N + ' / ' + N, 'idle');
      } else {
        var label = phase === 'tx'
          ? (elapsed < sim.produceAt ? 'broadcast + validate' : 'block propagation')
          : (elapsed < sim.resolveAt ? 'competing blocks' : 'converging');
        setOuts(countAgree(), label);
      }
      draw();
    });

    function startTx() {
      if (phase !== 'idle') { return; }
      var src = Math.floor(rng() * N);
      var prod = Math.floor(rng() * N);
      var dSrc = distancesFrom(src);
      var dProd = distancesFrom(prod);
      var maxSrc = Math.max.apply(null, dSrc) / V * 1000;
      var maxProd = Math.max.apply(null, dProd) / V * 1000;
      sim = { src: src, prod: prod, dSrc: dSrc, dProd: dProd, produceAt: maxSrc + 1150, doneAt: maxSrc + 1150 + maxProd + 450 };
      elapsed = 0;
      phase = 'tx';
      els.status.textContent = 'A node broadcasts a signed transaction; peers validate it and pass it on…';
      if (reduced()) {
        phase = 'idle';
        height++;
        setOuts(N + ' / ' + N, 'idle');
        els.status.textContent = 'The transaction was broadcast, validated by every node, mined into a block, and appended to all ' + N + ' replicas. Height is now ' + height + '.';
        sim = null;
        draw();
      }
    }

    function startFork() {
      if (phase !== 'idle') { return; }
      var pA = Math.floor(rng() * N);
      var pB = Math.floor(rng() * N);
      if (pB === pA) { pB = (pA + 40) % N; }
      var dA = distancesFrom(pA);
      var dB = distancesFrom(pB);
      var maxD = Math.max(Math.max.apply(null, dA), Math.max.apply(null, dB)) / V * 1000;
      sim = { pA: pA, pB: pB, dA: dA, dB: dB, resolveAt: maxD + 1500, doneAt: maxD + 1500 + maxD + 450 };
      elapsed = 0;
      phase = 'fork';
      els.status.textContent = 'Two nodes produced a block at the same height at nearly the same instant — each half of the network heard a different one first…';
      if (reduced()) {
        phase = 'idle';
        height += 2;
        setOuts(N + ' / ' + N, 'idle');
        els.status.textContent = 'Two competing blocks split the network briefly; the branch that grew longer won and every node converged on it. Height is now ' + height + '.';
        sim = null;
        draw();
      }
    }

    function reset() {
      phase = 'idle';
      sim = null;
      height = 0;
      elapsed = 0;
      setOuts(N + ' / ' + N, 'idle');
      els.status.textContent = '';
      draw();
    }

    els.tx.addEventListener('click', startTx);
    els.fork.addEventListener('click', startFork);
    els.reset.addEventListener('click', reset);

    reset();
    if (!reduced()) {
      onScreen(canvas, function () { loop.start(); }, function () { loop.stop(); });
    }
  }

  /* ==========================================================================
     07 · CONSENSUS MECHANISMS
     ========================================================================== */

  function initMechanisms() {
    var tabs = $$('#blockchain-experience .bc-mech-tabs .bc-mode-tab');
    var barsEl = $('#bc-mech-bars');
    if (!tabs.length || !barsEl) { return; }
    var nameEl = $('#bc-mech-name'), descEl = $('#bc-mech-desc'), usedEl = $('#bc-mech-used');

    var DATA = {
      pow: {
        name: 'Proof of Work',
        desc: 'Block producers (“miners”) race to find a nonce that makes their block’s hash meet a difficulty target — exactly what the tamper demo above made you do by hand. Winning is proportional to computation spent, so rewriting history means out-computing the entire honest network. Security is bought with electricity; it is the battle-tested option for fully open, adversarial networks, and the most energy-hungry by design.',
        used: 'Used by: Bitcoin, Litecoin, Monero. Deep dive: the Understanding Bitcoin exhibit.',
        m: { security: 95, speed: 15, energy: 8, finality: 30, decent: 88 }
      },
      pos: {
        name: 'Proof of Stake',
        desc: 'Validators lock up (“stake”) the network’s own asset for the right to propose and attest blocks; the protocol picks proposers roughly in proportion to stake. Misbehavior is punished by destroying (“slashing”) the offender’s stake, so attacking the network means burning your own capital. Energy use drops by ~99.9% vs. proof of work and finality arrives in minutes, at the cost of newer, more complex protocol machinery.',
        used: 'Used by: Ethereum (since 2022), Cardano, Solana (hybrid), Polkadot.',
        m: { security: 85, speed: 55, energy: 92, finality: 72, decent: 70 }
      },
      pbft: {
        name: 'PBFT-style voting',
        desc: 'A known committee of validators exchanges votes in rounds; once more than two-thirds sign off, the block is final — instantly and irreversibly. Practical Byzantine Fault Tolerance descends from classic distributed-systems research and tolerates up to one-third of the committee being faulty or malicious. The catch: everyone must know who the committee is, so it fits consortium networks, not open ones.',
        used: 'Used by (variants): Hyperledger Fabric ordering, Tendermint / Cosmos chains, many permissioned platforms.',
        m: { security: 68, speed: 90, energy: 96, finality: 100, decent: 30 }
      },
      poa: {
        name: 'Proof of Authority',
        desc: 'A short, published list of approved validators takes turns producing blocks. There is no puzzle and no stake — accountability is reputational and contractual: validators are known legal entities who signed an agreement. It is extremely fast and cheap, and exactly as trustworthy as the authorities themselves, which makes it a pragmatic choice for private networks and test networks rather than systems meant to minimize trust.',
        used: 'Used by: enterprise/private deployments, several public testnets, some sidechains.',
        m: { security: 50, speed: 96, energy: 98, finality: 100, decent: 12 }
      }
    };

    function select(key) {
      tabs.forEach(function (t) { t.setAttribute('aria-pressed', String(t.getAttribute('data-mech') === key)); });
      var d = DATA[key];
      nameEl.textContent = d.name;
      descEl.textContent = d.desc;
      usedEl.textContent = d.used;
      $$('.bc-mech-bar i', barsEl).forEach(function (bar) {
        bar.style.setProperty('--w', String(d.m[bar.getAttribute('data-metric')] || 0));
      });
    }

    tabs.forEach(function (t) {
      t.addEventListener('click', function () { select(t.getAttribute('data-mech')); });
    });

    select('pow');
  }

  /* ==========================================================================
     09 · SMART CONTRACT DEMO — deterministic execution on four nodes
     ========================================================================== */

  function initContracts() {
    var nodesWrap = $('#bc-sc-nodes');
    if (!nodesWrap) { return; }
    var els = {
      deliver: $('#bc-sc-deliver'), late: $('#bc-sc-late'), status: $('#bc-sc-status')
    };
    var flowNodes = $$('#contracts .bc-flow-node');
    var scNodes = $$('.bc-scnode', nodesWrap);
    var timers = [];

    function clearTimers() {
      timers.forEach(clearTimeout);
      timers = [];
    }

    function run(delivered) {
      clearTimers();
      els.deliver.disabled = true;
      els.late.disabled = true;
      flowNodes.forEach(function (n) { n.classList.remove('is-live'); });
      scNodes.forEach(function (n) {
        n.classList.remove('is-run', 'is-agree');
        $('.bc-scnode-out', n).textContent = 'awaiting input…';
      });

      var result = delivered
        ? 'input: DELIVERED → release 50 coins to seller'
        : 'input: DEADLINE PASSED → refund 50 coins to buyer';
      var summary = delivered
        ? 'All 4 nodes executed the same code on the same input and reached the identical result: the seller is paid. That unanimity — not any single machine — is what updates the ledger.'
        : 'All 4 nodes executed the same code on the same input and reached the identical result: the buyer is refunded. No node had to trust another’s answer; each computed it independently.';

      if (reduced()) {
        flowNodes.forEach(function (n) { n.classList.add('is-live'); });
        scNodes.forEach(function (n) {
          n.classList.add('is-agree');
          $('.bc-scnode-out', n).textContent = result;
        });
        els.status.textContent = summary;
        els.deliver.disabled = false;
        els.late.disabled = false;
        return;
      }

      var STEP = 420;
      flowNodes.forEach(function (n, i) {
        timers.push(setTimeout(function () { n.classList.add('is-live'); }, i * STEP));
      });
      var base = flowNodes.length * STEP + 150;
      scNodes.forEach(function (n, i) {
        timers.push(setTimeout(function () {
          n.classList.add('is-run');
          $('.bc-scnode-out', n).textContent = 'executing contract…';
        }, base + i * 230));
        timers.push(setTimeout(function () {
          n.classList.remove('is-run');
          n.classList.add('is-agree');
          $('.bc-scnode-out', n).textContent = result;
        }, base + i * 230 + 420));
      });
      timers.push(setTimeout(function () {
        els.status.textContent = summary;
        els.deliver.disabled = false;
        els.late.disabled = false;
      }, base + scNodes.length * 230 + 550));
    }

    els.deliver.addEventListener('click', function () { run(true); });
    els.late.addEventListener('click', function () { run(false); });
  }

  /* ==========================================================================
     11 · TRIAGE QUIZ
     ========================================================================== */

  function initQuiz() {
    var quiz = $('#bc-quiz');
    if (!quiz) { return; }
    var verdictEl = $('#bc-quiz-verdict');
    var answers = { writers: null, trusted: null, verify: null, perf: null };

    function verdict() {
      var a = answers;
      if (a.writers === null || a.trusted === null || a.verify === null || a.perf === null) {
        var left = ['writers', 'trusted', 'verify', 'perf'].filter(function (k) { return a[k] === null; }).length;
        return left + ' question' + (left > 1 ? 's' : '') + ' to go…';
      }
      if (a.writers === 0) {
        return 'Verdict: use a regular database. With one writer there is no trust gap for a blockchain to close — PostgreSQL (or a cloud database) will be faster, cheaper, and easier to run.' +
          (a.verify === 1 ? ' For tamper evidence, add a signed, hash-chained audit log — you get the integrity without the consensus overhead.' : '');
      }
      if (a.trusted === 1) {
        if (a.verify === 0) {
          return 'Verdict: a shared database hosted by the trusted party. Multiple writers, but someone everyone trusts can simply run it — that is an access-control problem, not a consensus problem.';
        }
        return 'Verdict: mostly a database problem. Let the trusted party host the data, and add cryptographic receipts — signed entries in a hash-chained log, optionally anchoring periodic hashes somewhere public. A full permissioned blockchain is defensible here, but not required.';
      }
      if (a.perf === 1) {
        return 'Verdict: blockchain territory, with a catch. Multiple mutually-distrustful writers point toward a (likely permissioned) blockchain — but your throughput/privacy requirements fight the replicate-everything model. Keep bulk data off-chain with only hashes on-chain, and prototype the load before committing.';
      }
      return 'Verdict: a genuine blockchain candidate. Multiple independent writers, no host everyone trusts' +
        (a.verify === 1 ? ', and a need for verifiable history' : '') +
        ' — this is the exact shape the technology was built for. Choose permissioned if participants are known organizations, public if participation must stay open.';
    }

    $$('.bc-mode-tab', quiz).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var q = btn.getAttribute('data-q');
        answers[q] = parseInt(btn.getAttribute('data-val'), 10);
        $$('.bc-mode-tab[data-q="' + q + '"]', quiz).forEach(function (b) {
          b.setAttribute('aria-pressed', String(b === btn));
        });
        verdictEl.textContent = verdict();
      });
    });
  }

  /* ==========================================================================
     PLAYGROUND · THE BLOCKCHAIN BUILDER
     ========================================================================== */

  function initPlayground() {
    var chainEl = $('#bc-pg-chain');
    if (!chainEl) { return; }
    var els = {
      from: $('#bc-pg-from'), to: $('#bc-pg-to'), amt: $('#bc-pg-amt'), addtx: $('#bc-pg-addtx'),
      mempool: $('#bc-pg-mempool'),
      diff: $('#bc-pg-diff'), diffOut: $('#bc-pg-diff-out'),
      mine: $('#bc-pg-mine'), minestat: $('#bc-pg-minestat'),
      nodes: $('#bc-pg-nodes'), nodesOut: $('#bc-pg-nodes-out'),
      modeD: $('#bc-pg-mode-d'), modeC: $('#bc-pg-mode-c'),
      tamper: $('#bc-pg-tamper'), sync: $('#bc-pg-sync'), reset: $('#bc-pg-reset'),
      nodegrid: $('#bc-pg-nodegrid'), netlabel: $('#bc-pg-netlabel'),
      height: $('#bc-pg-height'), attempts: $('#bc-pg-attempts'), verdict: $('#bc-pg-verdict'),
      log: $('#bc-pg-log')
    };

    var state = {
      chain: [],
      pristine: [],
      mempool: [],
      attempts: 0,
      tampered: false,
      mining: false,
      mode: 'd'
    };
    var runToken = 0;

    function blockData(i, b) {
      return i + '|' + b.txs.join(';') + '|' + b.prev + '|' + b.nonce;
    }

    function makeGenesis() {
      var g = { txs: [], prev: ZERO64, nonce: 0, diff: 0, hash: '' };
      g.hash = sha256(blockData(0, g));
      return g;
    }

    function snapshot() {
      state.pristine = JSON.parse(JSON.stringify(state.chain));
    }

    function prefixFor(d) { return '000'.slice(0, d); }

    function blockValid(i) {
      var b = state.chain[i];
      var contentOk = b.hash === sha256(blockData(i, b));
      var minedOk = i === 0 || b.hash.slice(0, b.diff) === prefixFor(b.diff);
      var linkOk = i === 0 || b.prev === state.chain[i - 1].hash;
      return contentOk && minedOk && linkOk;
    }

    function renderChain(miningLabel) {
      chainEl.innerHTML = '';
      var anyBroken = false;
      state.chain.forEach(function (b, i) {
        var ok = blockValid(i) && !anyBroken;
        if (!ok) { anyBroken = true; }
        chainEl.appendChild(blockEl({
          n: i + 1,
          sub: i === 0 ? 'genesis' : b.txs.length + ' tx · difficulty ' + b.diff,
          prev: b.prev, hash: b.hash,
          valid: ok, broken: !ok,
          badge: i === 0 ? 'genesis' : (ok ? 'mined ✓' : '✗ invalid'),
          clickable: false, genesis: i === 0
        }));
      });
      if (miningLabel) {
        var li = document.createElement('li');
        li.className = 'bc-block is-mining';
        li.innerHTML = '<div class="bc-block-inner"><span class="bc-block-head"><span>Block #' +
          (state.chain.length + 1) + '</span><span class="bc-block-badge">mining…</span></span>' +
          '<span class="bc-block-sub">' + miningLabel + '</span></div>';
        chainEl.appendChild(li);
      }
    }

    function renderMempool() {
      els.mempool.innerHTML = '';
      if (!state.mempool.length) {
        var empty = document.createElement('li');
        empty.className = 'bc-mempool-empty';
        empty.textContent = 'empty — add a transaction';
        els.mempool.appendChild(empty);
        return;
      }
      state.mempool.forEach(function (tx) {
        var li = document.createElement('li');
        li.innerHTML = '<span>' + tx.from + ' → ' + tx.to + '</span><span class="bc-mem-amt">' + tx.amt + ' coins</span>';
        els.mempool.appendChild(li);
      });
    }

    function renderNodes() {
      var n = parseInt(els.nodes.value, 10);
      els.nodegrid.innerHTML = '';
      var h = state.chain.length;
      var i;
      for (i = 0; i < n; i++) {
        var div = document.createElement('div');
        var name, stateTxt, cls;
        if (state.mode === 'c') {
          if (i === 0) {
            name = 'Central DB (you)';
            stateTxt = 'height ' + h + ' · authoritative';
            cls = 'bc-pgnode is-central';
          } else {
            name = 'Client ' + i;
            stateTxt = 'trusts central copy';
            cls = 'bc-pgnode';
          }
        } else {
          if (i === 0) {
            name = 'You';
            if (state.tampered) { stateTxt = 'height ' + h + ' · ✗ altered'; cls = 'bc-pgnode is-bad'; }
            else { stateTxt = 'height ' + h + ' ✓'; cls = 'bc-pgnode is-ok'; }
          } else {
            name = 'Node ' + (i + 1);
            var ph = state.tampered ? state.pristine.length : h;
            stateTxt = 'height ' + ph + ' ✓' + (state.tampered ? ' · rejects yours' : '');
            cls = 'bc-pgnode is-ok';
          }
        }
        div.className = cls;
        div.innerHTML = '<span class="bc-pgnode-name">' + name + '</span><span class="bc-pgnode-state">' + stateTxt + '</span>';
        els.nodegrid.appendChild(div);
      }
      els.netlabel.textContent = state.mode === 'c' ? 'Central server + clients' : 'Network replicas';
    }

    function renderStats() {
      els.height.textContent = String(state.chain.length);
      els.attempts.textContent = fmtInt(state.attempts);
      if (!state.tampered) {
        els.verdict.textContent = 'in sync';
      } else if (state.mode === 'd') {
        var n = parseInt(els.nodes.value, 10);
        els.verdict.textContent = (n - 1) + ' of ' + n + ' reject your chain';
      } else {
        els.verdict.textContent = 'accepted — nobody checks';
      }
    }

    function renderAll() {
      renderChain(null);
      renderMempool();
      renderNodes();
      renderStats();
    }

    function log(msg) { els.log.textContent = msg; }

    /* --- transactions -------------------------------------------------- */

    els.addtx.addEventListener('click', function () {
      var from = els.from.value, to = els.to.value;
      var amt = clamp(parseInt(els.amt.value, 10) || 0, 1, 999);
      if (from === to) {
        log(from + ' paying themselves is legal but pointless. Pick two different people.');
        return;
      }
      if (state.mempool.length >= 6) {
        log('The mempool is full for this toy block — mine what you have first.');
        return;
      }
      state.mempool.push({ from: from, to: to, amt: amt });
      renderMempool();
      log('Transaction queued: ' + from + ' → ' + to + ', ' + amt + ' coins. It is not real until it is mined into a block.');
    });

    /* --- mining --------------------------------------------------------- */

    els.diff.addEventListener('input', function () {
      els.diffOut.textContent = els.diff.value + ' zero' + (els.diff.value === '1' ? '' : 's');
    });
    els.nodes.addEventListener('input', function () {
      els.nodesOut.textContent = els.nodes.value;
      renderNodes();
      renderStats();
    });

    els.mine.addEventListener('click', function () {
      if (state.mining) { return; }
      if (state.tampered) {
        log('Your chain is currently tampered — run the consensus check (or reset) before mining on top of it.');
        return;
      }
      if (!state.mempool.length) {
        log('Nothing to mine — add at least one transaction first.');
        return;
      }
      var d = parseInt(els.diff.value, 10);
      var prefix = prefixFor(d);
      var idx = state.chain.length;
      var b = {
        txs: state.mempool.map(function (t) { return t.from + '→' + t.to + ':' + t.amt; }),
        prev: state.chain[idx - 1].hash,
        nonce: 0, diff: d, hash: ''
      };
      state.mining = true;
      els.mine.disabled = true;
      var token = ++runToken;
      var attempts = 0;

      function finish() {
        state.chain.push(b);
        state.mempool = [];
        state.attempts += attempts;
        state.mining = false;
        els.mine.disabled = false;
        snapshot();
        renderAll();
        els.minestat.textContent = 'Found: nonce ' + fmtInt(b.nonce) + ' → ' + shortHash(b.hash);
        log('Block #' + (idx + 1) + ' mined after ' + fmtInt(attempts) + ' attempt' + (attempts === 1 ? '' : 's') +
          ' and broadcast. ' + (state.mode === 'd'
            ? 'Every node verified the proof-of-work and the link, then appended it.'
            : 'The central database committed it; clients take its word.'));
      }

      if (reduced()) {
        var guard = 0;
        for (;;) {
          b.hash = sha256(blockData(idx, b));
          attempts++;
          if (b.hash.slice(0, d) === prefix) { break; }
          b.nonce++;
          if (++guard > 400000) { break; }
        }
        finish();
        return;
      }

      renderChain(state.mempool.length + ' tx · searching nonce…');
      function chunk() {
        if (token !== runToken) { return; }
        var i;
        for (i = 0; i < 64; i++) {
          b.hash = sha256(blockData(idx, b));
          attempts++;
          if (b.hash.slice(0, d) === prefix) { finish(); return; }
          b.nonce++;
        }
        els.minestat.textContent = 'nonce ' + fmtInt(b.nonce) + ' → ' + shortHash(b.hash) + ' ✗ (needs “' + prefix + '…”)';
        setTimeout(chunk, 16);   /* not rAF — must survive a hidden tab */
      }
      chunk();
    });

    /* --- network: mode, tamper, consensus ------------------------------- */

    function setMode(m) {
      state.mode = m;
      els.modeD.setAttribute('aria-pressed', String(m === 'd'));
      els.modeC.setAttribute('aria-pressed', String(m === 'c'));
      renderNodes();
      renderStats();
      log(m === 'd'
        ? 'Decentralized: every node keeps a full copy and verifies everything it hears.'
        : 'Centralized: one authoritative database; everyone else just trusts it. Faster — and try the tamper button now.');
    }
    els.modeD.addEventListener('click', function () { setMode('d'); });
    els.modeC.addEventListener('click', function () { setMode('c'); });

    els.tamper.addEventListener('click', function () {
      if (state.mining) { return; }
      if (state.chain.length < 3) {
        log('Mine at least two blocks first — then there will be history worth rewriting.');
        return;
      }
      if (state.tampered) {
        log('Already tampered. Run the consensus check to see the network’s reaction, or reset.');
        return;
      }
      var b = state.chain[1];
      b.txs[0] = (b.txs[0] || 'Ava→Ben:25').replace(/:\d+$/, ':900');
      b.hash = sha256(blockData(1, b));
      state.tampered = true;
      renderAll();
      if (state.mode === 'd') {
        log('You rewrote block #2 on your copy: the payment is now 900 coins. Your hash no longer meets its difficulty target, every later block points at a ghost — and the other nodes still hold the honest chain. Run the consensus check.');
      } else {
        log('You rewrote block #2 on the central database. No independent copies exist, no one re-checks the hashes — as far as the world can tell, the 900-coin payment always happened. This is the failure mode decentralization exists to prevent.');
      }
    });

    els.sync.addEventListener('click', function () {
      if (state.mining) { return; }
      var n = parseInt(els.nodes.value, 10);
      if (state.mode === 'c') {
        log('Consensus check? Against what? The central copy is the only copy — whatever it says is “true”' +
          (state.tampered ? ', including your rewrite, which is now permanent history.' : '.'));
        return;
      }
      if (!state.tampered) {
        log('All ' + n + ' nodes compared chains: identical, height ' + state.chain.length + '. The network is in consensus.');
        return;
      }
      state.chain = JSON.parse(JSON.stringify(state.pristine));
      state.tampered = false;
      renderAll();
      log('The other ' + (n - 1) + ' nodes rejected your altered chain — invalid proof-of-work, broken links, and it disagrees with the majority. Your node re-synced to the honest chain. Tampering cost you everything and changed nothing.');
    });

    els.reset.addEventListener('click', function () {
      runToken++;
      state.chain = [makeGenesis()];
      state.mempool = [];
      state.attempts = 0;
      state.tampered = false;
      state.mining = false;
      els.mine.disabled = false;
      els.minestat.textContent = '';
      snapshot();
      renderAll();
      log('Fresh start: one genesis block, an empty mempool, and a patient network.');
    });

    /* --- boot ----------------------------------------------------------- */

    state.chain = [makeGenesis()];
    snapshot();
    els.diffOut.textContent = els.diff.value + ' zeros';
    els.nodesOut.textContent = els.nodes.value;
    renderAll();
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
      initReveal, initRail, initHero, initTrust, initSystems, initAnatomy,
      initHashing, initTamper, initConsensusNet, initMechanisms,
      initContracts, initQuiz, initPlayground
    ];
    var failed = [];

    function tryInit(fn) {
      try { fn(); } catch (err) {
        failed.push(fn);
        if (window.console && console.error) { console.error('blockchain.js: ' + (fn.name || 'init') + ' failed', err); }
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
