/* =============================================================================
   Understanding Cryptography — interactivity
   Vanilla JS, no dependencies. Loaded with `defer` on /cryptography/ only.

   Structure:
     1. A real synchronous SHA-256 (UTF-8 in, hex out) powering the hash
        playground, the password-breach demo, and the lab, plus a Caesar
        cipher for the history chapter
     2. Shared utilities (canvas fitting, visibility gating, rAF loops)
     3. One init function per widget, each guarded by element existence and
        wrapped in try/catch so one failure never takes down the page
     4. The AES-GCM / RSA-OAEP / ECDSA demos use the browser's Web Crypto API
        (crypto.subtle) — real cryptography, not simulations. Widgets degrade
        with a visible message where subtle crypto is unavailable.
     5. Everything respects prefers-reduced-motion: ambient animation is
        disabled and story animations jump to labeled final states.

   The network / handshake / paint-mixing animations are illustrative models,
   not protocol emulation — the captions in the HTML say so where it matters.
   The hashes, ciphers, and signatures, however, are real.
   ============================================================================ */

(function () {
  'use strict';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* ==========================================================================
     SHA-256 — compact, synchronous, correct.
     UTF-8 encodes the input string and returns a 64-char lowercase hex digest.
     Verified against FIPS 180-4 test vectors
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

  /* Caesar cipher — uppercase/lowercase letters shift, everything else passes. */
  function caesar(str, shift) {
    var out = '', i, c;
    shift = ((shift % 26) + 26) % 26;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c >= 65 && c <= 90) { out += String.fromCharCode(((c - 65 + shift) % 26) + 65); }
      else if (c >= 97 && c <= 122) { out += String.fromCharCode(((c - 97 + shift) % 26) + 97); }
      else { out += str[i]; }
    }
    return out;
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

  /* Under Node the file exports the cipher core and stops (no DOM), so the
     shipped artifact is directly unit-testable — same pattern as bitcoin.js:
     node -e "const C=require('./assets/js/cryptography.js'); console.log(C.sha256('abc'))"

     The surface is string-oriented, unlike bitcoin.js's byte-oriented core:
     sha256(str) -> 64-char lowercase hex · caesar(str, shift) -> string ·
     hexBitDiff(hexA, hexB) -> int · utf8Bytes(str) -> Uint8Array.
     Canonical assertion:
     sha256('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' */
  if (typeof window === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = { sha256: sha256, caesar: caesar, hexBitDiff: hexBitDiff, utf8Bytes: utf8Bytes };
    }
    return;
  }

  document.documentElement.classList.add('cy-js');

  var RM = window.matchMedia('(prefers-reduced-motion: reduce)');
  function reduced() { return RM.matches; }

  var SUBTLE = (window.crypto && window.crypto.subtle) ? window.crypto.subtle : null;

  /* ==========================================================================
     Shared byte / hex helpers
     ========================================================================== */

  function bytesToHex(buf) {
    var b = new Uint8Array(buf), s = '', i;
    for (i = 0; i < b.length; i++) { s += (b[i] < 16 ? '0' : '') + b[i].toString(16); }
    return s;
  }

  function hexToBytes(hex) {
    var out = new Uint8Array(hex.length >> 1), i;
    for (i = 0; i < out.length; i++) { out[i] = parseInt(hex.substr(i * 2, 2), 16); }
    return out;
  }

  function randBytes(n) {
    var b = new Uint8Array(n);
    window.crypto.getRandomValues(b);
    return b;
  }

  function shortHex(hex, n) { return hex.slice(0, n || 16) + '…'; }

  function setStatus(el, msg, kind) {
    if (!el) { return; }
    el.textContent = msg;
    el.classList.remove('is-ok', 'is-bad');
    if (kind === 'ok') { el.classList.add('is-ok'); }
    if (kind === 'bad') { el.classList.add('is-bad'); }
  }

  function noSubtle(statusEl, buttons) {
    setStatus(statusEl, 'This live demo needs the Web Crypto API (crypto.subtle), which your browser is not exposing here. The explanation above still applies.', 'bad');
    (buttons || []).forEach(function (b) { if (b) { b.disabled = true; } });
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

  /* ---- shared little glyphs (all drawn around a center point) ------------ */

  function drawActor(ctx, x, y, label, color, r) {
    r = r || 22;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = C.deep;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();
    /* head + shoulders */
    ctx.beginPath();
    ctx.arc(x, y - r * 0.28, r * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y + r * 0.62, r * 0.5, Math.PI, 0);
    ctx.fill();
    ctx.font = '600 12px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = C.text;
    ctx.fillText(label, x, y + r + 7);
  }

  function drawKeyGlyph(ctx, x, y, color, scale) {
    var s = scale || 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(-7, 0, 5.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-1.5, 0);
    ctx.lineTo(13, 0);
    ctx.moveTo(8, 0); ctx.lineTo(8, 5);
    ctx.moveTo(12, 0); ctx.lineTo(12, 5);
    ctx.stroke();
    ctx.restore();
  }

  function drawLockGlyph(ctx, x, y, color, open, scale) {
    var s = scale || 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    /* body */
    roundRect(ctx, -8, -2, 16, 13, 3);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 4.5, 1.9, 0, Math.PI * 2);
    ctx.fill();
    /* shackle */
    ctx.beginPath();
    if (open) {
      ctx.arc(-2, -6, 6, Math.PI, Math.PI * 1.85);
    } else {
      ctx.arc(0, -3, 6, Math.PI, 0);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawEnvelope(ctx, x, y, w, h, color) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    roundRect(ctx, x - w / 2, y - h / 2, w, h, 3);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y - h / 2);
    ctx.lineTo(x, y + 1);
    ctx.lineTo(x + w / 2, y - h / 2);
    ctx.stroke();
  }

  var HEXCHARS = '0123456789abcdef';
  function randHexString(n, rng) {
    var s = '', i;
    for (i = 0; i < n; i++) { s += HEXCHARS[Math.floor((rng ? rng() : Math.random()) * 16)]; }
    return s;
  }

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
    var targets = $$('#crypto-experience [data-cy-reveal]').concat($$('#crypto-experience .cy-era'));
    if (!targets.length) { return; }
    $$('#crypto-experience .cy-era').forEach(function (el, i) {
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
    var dots = $$('#crypto-experience .cy-rail-dot');
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
     HERO — ambient scene: packets of ciphertext streaming between devices,
     locks pulsing where streams terminate.
     ========================================================================== */

  function initHero() {
    var canvas = $('#cy-hero-canvas');
    if (!canvas) { return; }
    var cv = setupCanvas(canvas, function () { refit(); });
    var ctx = cv.ctx, st = cv.state;
    var rng = makeRng(0xC0FFEE);

    var NODES = [];
    var EDGES = [];
    var PACKETS = [];

    function layout() {
      NODES = [];
      EDGES = [];
      PACKETS = [];
      var i, j, n = 14;
      for (i = 0; i < n; i++) {
        NODES.push({
          x: (0.06 + 0.88 * rng()) * st.w,
          y: (0.08 + 0.84 * rng()) * st.h,
          r: 2.5 + rng() * 2.5,
          pulse: rng() * Math.PI * 2,
          lock: rng() < 0.35
        });
      }
      for (i = 0; i < n; i++) {
        for (j = i + 1; j < n; j++) {
          var dx = NODES[i].x - NODES[j].x, dy = NODES[i].y - NODES[j].y;
          var d = Math.sqrt(dx * dx + dy * dy);
          if (d < st.w * 0.24 && EDGES.length < 26) { EDGES.push([i, j, d]); }
        }
      }
      for (i = 0; i < 12; i++) { spawnPacket(); }
    }

    /* Node positions are absolute pixels, so a resize invalidates the scene.
       This is also the refit path for a canvas that booted below the guard. */
    function refit() {
      NODES = [];
      if (loop.running()) { return; } /* the loop re-lays out on its next frame */
      if (st.w < 60 || st.h < 60) { return; }
      layout();
      draw(0);
    }

    function spawnPacket() {
      if (!EDGES.length) { return; }
      var e = EDGES[Math.floor(rng() * EDGES.length)];
      PACKETS.push({
        e: e, p: rng(), speed: 0.00006 + rng() * 0.00012,
        dir: rng() < 0.5 ? 1 : -1, text: randHexString(6, rng)
      });
    }

    function draw(t) {
      if (st.w < 60 || st.h < 60) { return; }
      ctx.clearRect(0, 0, st.w, st.h);
      var i;
      ctx.lineWidth = 1;
      for (i = 0; i < EDGES.length; i++) {
        var a = NODES[EDGES[i][0]], b = NODES[EDGES[i][1]];
        ctx.strokeStyle = 'rgba(51, 65, 85, 0.5)';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      for (i = 0; i < PACKETS.length; i++) {
        var pk = PACKETS[i];
        var na = NODES[pk.e[0]], nb = NODES[pk.e[1]];
        pk.p += pk.speed * pk.dir * 16.7 * 60;
        if (pk.p > 1 || pk.p < 0) {
          PACKETS.splice(i, 1); i--;
          spawnPacket();
          continue;
        }
        var x = na.x + (nb.x - na.x) * pk.p;
        var y = na.y + (nb.y - na.y) * pk.p;
        ctx.fillStyle = 'rgba(45, 212, 191, 0.85)';
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = '10px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = 'rgba(148, 163, 184, 0.4)';
        ctx.fillText(pk.text, x, y - 5);
      }
      for (i = 0; i < NODES.length; i++) {
        var nd = NODES[i];
        var pulse = 0.6 + 0.4 * Math.sin(t * 0.0012 + nd.pulse);
        ctx.beginPath();
        ctx.arc(nd.x, nd.y, nd.r + pulse, 0, Math.PI * 2);
        ctx.fillStyle = nd.lock ? 'rgba(139, 92, 246, 0.7)' : 'rgba(45, 212, 191, 0.55)';
        ctx.fill();
        if (nd.lock) {
          drawLockGlyph(ctx, nd.x, nd.y - 16, 'rgba(139, 92, 246, ' + (0.25 + 0.3 * pulse) + ')', false, 0.7);
        }
      }
    }

    var loop = makeLoop(function (t) {
      if (st.w < 60 || st.h < 60) { return; }
      if (!NODES.length) { layout(); }
      draw(t);
    });

    if (reduced()) {
      /* One static frame, no motion. */
      var tryStatic = function () {
        if (st.w < 60 || st.h < 60) { requestAnimationFrame(tryStatic); return; }
        layout();
        draw(0);
      };
      tryStatic();
      return;
    }
    onScreen(canvas, function () { loop.start(); }, function () { loop.stop(); });
  }

  /* ==========================================================================
     01 — EAVESDROPPER DEMO
     A message travels Alice → relays → Bob; Eve taps the middle relay.
     ========================================================================== */

  function initIntercept() {
    var canvas = $('#cy-intercept-canvas');
    if (!canvas) { return; }
    var btnPlain = $('#cy-intercept-plain');
    var btnEnc = $('#cy-intercept-enc');
    var outSent = $('#cy-intercept-sent');
    var outSeen = $('#cy-intercept-seen');
    var outBob = $('#cy-intercept-bob');
    var statusEl = $('#cy-intercept-status');
    var cv = setupCanvas(canvas, function () {
      if (!loop.running()) { drawScene(anim.delivered ? 1 : null); }
    });
    var ctx = cv.ctx, st = cv.state;

    var MSG = 'Meet me at noon';
    var CT = null; /* lazily derived fake-looking ciphertext (hex of real sha256, truncated) */

    var anim = { mode: null, t: 0, captured: false, delivered: false };

    function pts() {
      var y = st.h * 0.42;
      return {
        alice: { x: st.w * 0.08, y: y },
        r1: { x: st.w * 0.31, y: y },
        r2: { x: st.w * 0.5, y: y },
        r3: { x: st.w * 0.69, y: y },
        bob: { x: st.w * 0.92, y: y },
        eve: { x: st.w * 0.5, y: st.h * 0.82 }
      };
    }

    function drawScene(prog) {
      if (st.w < 60 || st.h < 60) { return; }
      ctx.clearRect(0, 0, st.w, st.h);
      var P = pts();
      /* wire */
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = C.lineStrong;
      ctx.beginPath();
      ctx.moveTo(P.alice.x, P.alice.y);
      ctx.lineTo(P.bob.x, P.bob.y);
      ctx.stroke();
      /* Eve's tap */
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(225, 29, 72, 0.7)';
      ctx.beginPath();
      ctx.moveTo(P.r2.x, P.r2.y);
      ctx.lineTo(P.eve.x, P.eve.y - 26);
      ctx.stroke();
      ctx.setLineDash([]);
      /* relays */
      [P.r1, P.r2, P.r3].forEach(function (r, i) {
        ctx.beginPath();
        ctx.arc(r.x, r.y, 7, 0, Math.PI * 2);
        ctx.fillStyle = C.deep;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = i === 1 ? 'rgba(225, 29, 72, 0.8)' : C.lineStrong;
        ctx.stroke();
        ctx.font = '600 10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = C.faint;
        ctx.fillText('relay', r.x, r.y + 12);
      });
      drawActor(ctx, P.alice.x, P.alice.y, 'Alice', C.teal);
      drawActor(ctx, P.bob.x, P.bob.y, 'Bob', C.teal);
      drawActor(ctx, P.eve.x, P.eve.y, 'Eve (listening)', C.rose, 18);

      if (anim.mode && prog !== null) {
        var enc = anim.mode === 'enc';
        var x = P.alice.x + (P.bob.x - P.alice.x) * prog;
        var y = P.alice.y - 22;
        var label = enc ? CT.slice(0, 10) + '…' : '“' + MSG + '”';
        ctx.font = '11px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = enc ? '#c4b5fd' : C.strong;
        ctx.fillText(label, clamp(x, 60, st.w - 60), y - 10);
        if (enc) {
          drawLockGlyph(ctx, x, y, '#c4b5fd', false, 0.85);
        } else {
          drawEnvelope(ctx, x, y, 22, 15, C.strong);
        }
        /* capture flash while crossing Eve's relay */
        if (Math.abs(prog - 0.5) < 0.05) {
          ctx.strokeStyle = 'rgba(225, 29, 72, 0.9)';
          ctx.lineWidth = 2.5;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(P.r2.x, P.r2.y);
          ctx.lineTo(P.eve.x, P.eve.y - 26);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }

    function ensureCT() {
      if (!CT) { CT = sha256(MSG).slice(0, 32); }
    }

    var DURATION = 3200;
    var loop = makeLoop(function (t, dt) {
      anim.t += dt;
      var prog = easeInOut(clamp(anim.t / DURATION, 0, 1));
      drawScene(prog);
      if (prog >= 0.5 && !anim.captured) {
        anim.captured = true;
        outSeen.textContent = anim.mode === 'enc' ? CT.slice(0, 24) + '…' : '“' + MSG + '”';
      }
      if (prog >= 1 && !anim.delivered) {
        anim.delivered = true;
        outBob.textContent = '“' + MSG + '”';
        setStatus(statusEl,
          anim.mode === 'enc'
            ? 'Same message, same route, same eavesdropper — but Eve captured only ciphertext. Bob, holding the key, reads it perfectly.'
            : 'Eve read every word without Alice or Bob ever knowing. On an open network, sending plaintext is publishing.',
          anim.mode === 'enc' ? 'ok' : 'bad');
        loop.stop();
      }
    });

    function run(mode) {
      ensureCT();
      anim = { mode: mode, t: 0, captured: false, delivered: false };
      btnPlain.setAttribute('aria-pressed', String(mode === 'plain'));
      btnEnc.setAttribute('aria-pressed', String(mode === 'enc'));
      outSent.textContent = '“' + MSG + '”' + (mode === 'enc' ? ' (encrypted)' : ' (plaintext)');
      outSeen.textContent = '…';
      outBob.textContent = '…';
      setStatus(statusEl, mode === 'enc' ? 'The message crosses the network sealed…' : 'The message crosses the network in the clear…');
      if (reduced()) {
        anim.t = DURATION;
        anim.captured = true;
        anim.delivered = true;
        outSeen.textContent = mode === 'enc' ? CT.slice(0, 24) + '…' : '“' + MSG + '”';
        outBob.textContent = '“' + MSG + '”';
        drawScene(1);
        setStatus(statusEl,
          mode === 'enc'
            ? 'Eve captured only ciphertext; Bob, holding the key, reads the message perfectly.'
            : 'Eve read every word. On an open network, sending plaintext is publishing.',
          mode === 'enc' ? 'ok' : 'bad');
        return;
      }
      loop.stop();
      loop.start();
    }

    btnPlain.addEventListener('click', function () { run('plain'); });
    btnEnc.addEventListener('click', function () { run('enc'); });

    /* idle scene */
    onScreen(canvas, function () { if (!loop.running()) { drawScene(null); } });
  }

  /* ==========================================================================
     02 — CAESAR CIPHER
     ========================================================================== */

  function initCaesar() {
    var inp = $('#cy-caesar-in');
    if (!inp) { return; }
    var shiftEl = $('#cy-caesar-shift');
    var shiftVal = $('#cy-caesar-shiftval');
    var out = $('#cy-caesar-out');
    var crackBtn = $('#cy-caesar-crack');
    var crackedEl = $('#cy-caesar-cracked');

    function update() {
      shiftVal.textContent = shiftEl.value;
      out.textContent = caesar(inp.value || '', parseInt(shiftEl.value, 10));
      crackedEl.innerHTML = '';
    }

    function crack() {
      var ct = out.textContent;
      var trueShift = parseInt(shiftEl.value, 10);
      crackedEl.innerHTML = '';
      var frag = document.createDocumentFragment();
      var i;
      for (i = 1; i <= 25; i++) {
        var div = document.createElement('div');
        div.className = 'cy-caesar-try' + (i === trueShift ? ' is-hit' : '');
        var shiftNo = document.createElement('span');
        shiftNo.className = 'cy-caesar-shiftno';
        shiftNo.textContent = '−' + i;
        div.appendChild(shiftNo);
        div.appendChild(document.createTextNode(caesar(ct, -i)));
        frag.appendChild(div);
      }
      crackedEl.appendChild(frag);
    }

    inp.addEventListener('input', update);
    shiftEl.addEventListener('input', update);
    crackBtn.addEventListener('click', crack);
    update();
  }

  /* ==========================================================================
     03 — SYMMETRIC: real AES-256-GCM via Web Crypto
     Ciphertext layout: salt(16) ‖ iv(12) ‖ ct+tag, hex-encoded.
     ========================================================================== */

  function deriveAesKey(passphrase, salt, usages) {
    return SUBTLE.importKey('raw', utf8Bytes(passphrase), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return SUBTLE.deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: 100000, hash: 'SHA-256' },
          base, { name: 'AES-GCM', length: 256 }, false, usages
        );
      });
  }

  function initSymmetric() {
    var btnEnc = $('#cy-sym-encrypt');
    if (!btnEnc) { return; }
    var btnDec = $('#cy-sym-decrypt');
    var msgEl = $('#cy-sym-msg');
    var keyEl = $('#cy-sym-key');
    var key2El = $('#cy-sym-key2');
    var ctEl = $('#cy-sym-ct');
    var outEl = $('#cy-sym-out');
    var statusEl = $('#cy-sym-status');

    if (!SUBTLE) { noSubtle(statusEl, [btnEnc, btnDec]); return; }

    var lastHex = null;

    btnEnc.addEventListener('click', function () {
      var msg = msgEl.value;
      var pass = keyEl.value;
      if (!pass) { setStatus(statusEl, 'Enter a passphrase first.', 'bad'); return; }
      btnEnc.disabled = true;
      var salt = randBytes(16);
      var iv = randBytes(12);
      deriveAesKey(pass, salt, ['encrypt'])
        .then(function (key) {
          return SUBTLE.encrypt({ name: 'AES-GCM', iv: iv }, key, utf8Bytes(msg));
        })
        .then(function (ct) {
          lastHex = bytesToHex(salt) + bytesToHex(iv) + bytesToHex(ct);
          ctEl.textContent = lastHex;
          outEl.textContent = '–';
          btnDec.disabled = false;
          setStatus(statusEl, 'Encrypted with AES-256-GCM (key derived from your passphrase via PBKDF2, 100,000 rounds, random salt). Note the ciphertext changes every time you encrypt — a fresh random salt and nonce are part of doing this correctly.', 'ok');
        })
        .catch(function () { setStatus(statusEl, 'Encryption failed unexpectedly.', 'bad'); })
        .then(function () { btnEnc.disabled = false; });
    });

    btnDec.addEventListener('click', function () {
      if (!lastHex) { return; }
      var pass = key2El.value;
      var bytes = hexToBytes(lastHex);
      var salt = bytes.slice(0, 16);
      var iv = bytes.slice(16, 28);
      var ct = bytes.slice(28);
      btnDec.disabled = true;
      deriveAesKey(pass, salt, ['decrypt'])
        .then(function (key) {
          return SUBTLE.decrypt({ name: 'AES-GCM', iv: iv }, key, ct);
        })
        .then(function (pt) {
          outEl.textContent = new TextDecoder().decode(pt);
          setStatus(statusEl, 'Decrypted. Same passphrase → same key → the ciphertext opens.', 'ok');
        })
        .catch(function () {
          outEl.textContent = '✗ decryption failed';
          setStatus(statusEl, 'Decryption failed: the derived key is wrong, so AES-GCM’s built-in authentication check rejected it outright. Notice you don’t get "almost right" garbage — with a wrong key you get nothing at all.', 'bad');
        })
        .then(function () { btnDec.disabled = false; });
    });
  }

  /* ==========================================================================
     04 — ASYMMETRIC: storyboard animation + real RSA-OAEP demo
     ========================================================================== */

  function initAsymAnim() {
    var canvas = $('#cy-asym-canvas');
    if (!canvas) { return; }
    var btnPlay = $('#cy-asym-play');
    var btnEve = $('#cy-asym-eve');
    var statusEl = $('#cy-asym-status');
    var cv = setupCanvas(canvas, function () { refit(); });
    var ctx = cv.ctx, st = cv.state;

    /* Storyboard: list of {dur, caption, draw(p, P)} — p eased 0..1 in-phase */
    function pts() {
      return {
        alice: { x: st.w * 0.12, y: st.h * 0.38 },
        bob: { x: st.w * 0.88, y: st.h * 0.38 },
        eve: { x: st.w * 0.5, y: st.h * 0.8 },
        mid: { x: st.w * 0.5, y: st.h * 0.38 }
      };
    }

    /* Refit path: redraw whatever the storyboard last settled on. */
    function refit() {
      if (loop.running() || st.w < 60 || st.h < 60) { return; }
      if (story) { story[story.length - 1].draw(1, pts()); }
      else { base(pts()); }
    }

    function base(P) {
      if (st.w < 60 || st.h < 60) { return; }
      ctx.clearRect(0, 0, st.w, st.h);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = C.lineStrong;
      ctx.beginPath();
      ctx.moveTo(P.alice.x + 30, P.alice.y);
      ctx.lineTo(P.bob.x - 30, P.bob.y);
      ctx.stroke();
      drawActor(ctx, P.alice.x, P.alice.y, 'Alice', C.teal);
      drawActor(ctx, P.bob.x, P.bob.y, 'Bob', C.teal);
      drawActor(ctx, P.eve.x, P.eve.y, 'Eve (watching)', C.rose, 18);
      ctx.font = '600 11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = C.faint;
      ctx.fillText('the open internet', P.mid.x, P.mid.y - 46);
    }

    function keyPair(P, showPub) {
      drawKeyGlyph(ctx, P.bob.x + 4, P.bob.y - 44, '#fbbf24', 1);
      ctx.font = '10px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fbbf24';
      ctx.fillText('private', P.bob.x + 2, P.bob.y - 58);
      if (showPub) {
        drawKeyGlyph(ctx, P.bob.x - 40, P.bob.y - 44, '#38bdf8', 1);
        ctx.fillStyle = '#38bdf8';
        ctx.fillText('public', P.bob.x - 42, P.bob.y - 58);
      }
    }

    function lockedBox(x, y, locked) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = locked ? '#c4b5fd' : C.strong;
      roundRect(ctx, x - 15, y - 11, 30, 22, 4);
      ctx.stroke();
      if (locked) { drawLockGlyph(ctx, x, y - 18, '#c4b5fd', false, 0.7); }
      else { drawEnvelope(ctx, x, y, 20, 13, C.strong); }
    }

    var story = null;

    function makeStory(evil) {
      return [
        { dur: 1400, caption: 'Bob generates a key pair: a private key he keeps, and a public key meant for the whole world.',
          draw: function (p, P) { base(P); ctx.globalAlpha = p; keyPair(P, true); ctx.globalAlpha = 1; } },
        { dur: 1600, caption: 'Bob publishes the public key. Eve sees it too — that’s fine. It can only lock, never unlock.',
          draw: function (p, P) {
            base(P); keyPair(P, true);
            var x = P.bob.x - 40 + (P.alice.x + 20 - (P.bob.x - 40)) * p;
            drawKeyGlyph(ctx, x, P.bob.y - 44, '#38bdf8', 1);
          } },
        { dur: 1400, caption: 'Alice seals her message inside a box locked with Bob’s public key.',
          draw: function (p, P) {
            base(P); keyPair(P, false);
            drawKeyGlyph(ctx, P.alice.x + 20, P.alice.y - 44, '#38bdf8', 1);
            lockedBox(P.alice.x + 46, P.alice.y - 8, p > 0.5);
          } },
        evil
          ? { dur: 1800, caption: 'Eve snatches the box off the wire…',
              draw: function (p, P) {
                base(P); keyPair(P, false);
                var half = Math.min(1, p * 2);
                var x, y;
                if (p < 0.5) { x = (P.alice.x + 46) + (P.mid.x - (P.alice.x + 46)) * half; y = P.alice.y - 8; }
                else { x = P.mid.x; y = (P.alice.y - 8) + (P.eve.y - 40 - (P.alice.y - 8)) * ((p - 0.5) * 2); }
                lockedBox(x, y, true);
              } }
          : { dur: 1800, caption: 'The locked box crosses the open internet, straight past Eve.',
              draw: function (p, P) {
                base(P); keyPair(P, false);
                var x = (P.alice.x + 46) + (P.bob.x - 46 - (P.alice.x + 46)) * p;
                lockedBox(x, P.alice.y - 8, true);
              } },
        evil
          ? { dur: 2200, caption: '…but her copy of the public key won’t open it. Locking is one-way: only Bob’s private key reverses it.',
              draw: function (p, P) {
                base(P); keyPair(P, false);
                lockedBox(P.mid.x, P.eve.y - 40, true);
                drawKeyGlyph(ctx, P.mid.x - 34, P.eve.y - 40, '#38bdf8', 1);
                if (p > 0.4) {
                  ctx.lineWidth = 3;
                  ctx.strokeStyle = C.rose;
                  ctx.beginPath();
                  ctx.moveTo(P.mid.x - 10, P.eve.y - 50);
                  ctx.lineTo(P.mid.x + 10, P.eve.y - 30);
                  ctx.moveTo(P.mid.x + 10, P.eve.y - 50);
                  ctx.lineTo(P.mid.x - 10, P.eve.y - 30);
                  ctx.stroke();
                }
              } }
          : { dur: 2000, caption: 'Only Bob’s private key opens the box. The message was never readable in transit — and the keys never traveled together.',
              draw: function (p, P) {
                base(P); keyPair(P, false);
                drawKeyGlyph(ctx, P.bob.x - 46, P.bob.y - 30, '#fbbf24', 1);
                lockedBox(P.bob.x - 46, P.bob.y - 2, p < 0.5);
                if (p >= 0.5) {
                  ctx.lineWidth = 2.5;
                  ctx.strokeStyle = C.teal;
                  ctx.beginPath();
                  ctx.moveTo(P.bob.x - 54, P.bob.y - 2);
                  ctx.lineTo(P.bob.x - 48, P.bob.y + 4);
                  ctx.lineTo(P.bob.x - 36, P.bob.y - 8);
                  ctx.stroke();
                }
              } }
      ];
    }

    var anim = { t: 0, idx: 0 };
    var loop = makeLoop(function (t, dt) {
      if (st.w < 60 || st.h < 60) { return; }
      anim.t += dt;
      var seg = story[anim.idx];
      var p = clamp(anim.t / seg.dur, 0, 1);
      seg.draw(easeInOut(p), pts());
      if (p >= 1) {
        anim.idx++;
        anim.t = 0;
        if (anim.idx >= story.length) { loop.stop(); return; }
        setStatus(statusEl, story[anim.idx].caption);
      }
    });

    function play(evil) {
      story = makeStory(evil);
      if (reduced()) {
        var lastSeg = story[story.length - 1];
        lastSeg.draw(1, pts());
        setStatus(statusEl, story.map(function (s) { return s.caption; }).join(' '));
        return;
      }
      loop.stop();
      anim = { t: 0, idx: 0 };
      setStatus(statusEl, story[0].caption);
      loop.start();
    }

    btnPlay.addEventListener('click', function () { play(false); });
    btnEve.addEventListener('click', function () { play(true); });
    onScreen(canvas, function () { if (!loop.running() && !story) { base(pts()); } });
  }

  function initAsymRSA() {
    var btnGen = $('#cy-asym-gen');
    if (!btnGen) { return; }
    var btnEnc = $('#cy-asym-encrypt');
    var btnDec = $('#cy-asym-decrypt');
    var btnPub = $('#cy-asym-trypub');
    var pubEl = $('#cy-asym-pub');
    var privEl = $('#cy-asym-priv');
    var msgEl = $('#cy-asym-msg');
    var ctEl = $('#cy-asym-ct');
    var outEl = $('#cy-asym-out');

    if (!SUBTLE) { noSubtle(outEl, [btnGen, btnEnc, btnDec, btnPub]); return; }

    var keys = null;
    var ct = null;

    btnGen.addEventListener('click', function () {
      btnGen.disabled = true;
      setStatus(outEl, 'Generating a 2048-bit RSA key pair — finding two large primes takes a moment…');
      SUBTLE.generateKey(
        { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
        true, ['encrypt', 'decrypt']
      ).then(function (kp) {
        keys = kp;
        ct = null;
        ctEl.textContent = '–';
        return SUBTLE.exportKey('spki', kp.publicKey);
      }).then(function (spki) {
        pubEl.textContent = shortHex(bytesToHex(spki), 64) + '  (' + Math.round(spki.byteLength) + ' bytes — post it anywhere)';
        privEl.textContent = '●●●●●●●●●●●●  (exists only inside this page’s memory)';
        btnEnc.disabled = false;
        btnDec.disabled = true;
        btnPub.disabled = true;
        setStatus(outEl, 'Key pair ready. The two keys are mathematically linked, but deriving the private key from the public one would require factoring a 617-digit number.', 'ok');
      }).catch(function () {
        setStatus(outEl, 'Key generation failed unexpectedly.', 'bad');
      }).then(function () { btnGen.disabled = false; });
    });

    btnEnc.addEventListener('click', function () {
      if (!keys) { return; }
      SUBTLE.encrypt({ name: 'RSA-OAEP' }, keys.publicKey, utf8Bytes(msgEl.value))
        .then(function (buf) {
          ct = buf;
          ctEl.textContent = bytesToHex(buf);
          btnDec.disabled = false;
          btnPub.disabled = false;
          setStatus(outEl, 'Encrypted with the public key. Encrypt the same message again and the ciphertext will differ — OAEP mixes in fresh randomness every time.', 'ok');
        })
        .catch(function () { setStatus(outEl, 'Encryption failed (message may be too long for RSA-OAEP’s ~190-byte limit).', 'bad'); });
    });

    btnDec.addEventListener('click', function () {
      if (!keys || !ct) { return; }
      SUBTLE.decrypt({ name: 'RSA-OAEP' }, keys.privateKey, ct)
        .then(function (pt) {
          setStatus(outEl, 'Decrypted with the private key: “' + new TextDecoder().decode(pt) + '”', 'ok');
        })
        .catch(function () { setStatus(outEl, 'Decryption failed.', 'bad'); });
    });

    btnPub.addEventListener('click', function () {
      if (!keys || !ct) { return; }
      /* The Web Crypto API won't even let a public key attempt decryption —
         its usages are enforced. That refusal IS the lesson. */
      SUBTLE.decrypt({ name: 'RSA-OAEP' }, keys.publicKey, ct)
        .then(function () {
          setStatus(outEl, 'This should be impossible — please report a browser bug!', 'bad');
        })
        .catch(function () {
          setStatus(outEl, '✗ The browser refused outright: a public key has no decryption capability — not “hard,” but mathematically absent. What the public key locks, only the private key opens.', 'bad');
        });
    });
  }

  /* ==========================================================================
     05 — HASH PLAYGROUND
     ========================================================================== */

  function initHash() {
    var inp = $('#cy-hash-in');
    if (!inp) { return; }
    var out = $('#cy-hash-out');
    var diffEl = $('#cy-hash-diff');
    var grid = $('#cy-hash-grid');
    var gctx = grid.getContext('2d');

    var prev = null;
    var flashUntil = 0;
    var changedBits = null;

    function hashBits(hex) {
      var bits = [], i, j, v;
      for (i = 0; i < hex.length; i++) {
        v = parseInt(hex[i], 16);
        for (j = 3; j >= 0; j--) { bits.push((v >> j) & 1); }
      }
      return bits;
    }

    function drawGrid(hex) {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var cssW = grid.clientWidth || 272;
      if (grid.width !== Math.round(cssW * dpr)) {
        grid.width = Math.round(cssW * dpr);
        grid.height = Math.round(cssW * dpr);
      }
      gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var size = cssW;
      var cell = size / 16;
      var bits = hashBits(hex);
      gctx.clearRect(0, 0, size, size);
      var now = performance.now();
      var flashing = now < flashUntil && changedBits;
      var i, x, y;
      for (i = 0; i < 256; i++) {
        x = (i % 16) * cell;
        y = Math.floor(i / 16) * cell;
        gctx.fillStyle = bits[i] ? 'rgba(45, 212, 191, 0.75)' : 'rgba(39, 52, 73, 0.9)';
        gctx.fillRect(x + 1, y + 1, cell - 2, cell - 2);
        if (flashing && changedBits[i]) {
          var alpha = clamp((flashUntil - now) / 700, 0, 1) * 0.9;
          gctx.strokeStyle = 'rgba(251, 191, 36, ' + alpha + ')';
          gctx.lineWidth = 1.5;
          gctx.strokeRect(x + 1.5, y + 1.5, cell - 3, cell - 3);
        }
      }
      if (flashing) { requestAnimationFrame(function () { drawGrid(hex); }); }
    }

    var current = '';

    function update() {
      var hex = sha256(inp.value);
      current = hex;
      out.textContent = hex;
      if (prev !== null && prev !== hex) {
        var pb = hashBits(prev), nb = hashBits(hex);
        changedBits = [];
        var n = 0, i;
        for (i = 0; i < 256; i++) {
          changedBits[i] = pb[i] !== nb[i];
          if (changedBits[i]) { n++; }
        }
        diffEl.textContent = n + ' / 256 (' + (n / 2.56).toFixed(1) + '%)';
        flashUntil = reduced() ? 0 : performance.now() + 700;
      }
      prev = hex;
      drawGrid(hex);
    }

    var debounce = null;
    inp.addEventListener('input', function () {
      if (debounce) { cancelAnimationFrame(debounce); }
      debounce = requestAnimationFrame(update);
    });
    update();
    onScreen(grid, function () { drawGrid(current); });
  }

  /* ==========================================================================
     06 — DIGITAL SIGNATURES: real ECDSA P-256
     ========================================================================== */

  function initSignatures() {
    var btnSign = $('#cy-sig-sign');
    if (!btnSign) { return; }
    var btnRestore = $('#cy-sig-restore');
    var docEl = $('#cy-sig-doc');
    var sigEl = $('#cy-sig-out');
    var verdict = $('#cy-sig-verdict');
    var verdictText = verdict ? verdict.querySelector('.cy-verdict-text') : null;

    function setVerdict(state, msg) {
      if (!verdict) { return; }
      verdict.setAttribute('data-state', state);
      verdictText.textContent = msg;
    }

    if (!SUBTLE) {
      setVerdict('invalid', 'This demo needs the Web Crypto API, which your browser is not exposing here.');
      btnSign.disabled = true;
      return;
    }

    var keys = null;
    var signature = null;
    var signedText = null;
    var verifySeq = 0;

    function verifyNow() {
      if (!keys || !signature) { return; }
      var text = docEl.value;
      var seq = ++verifySeq;
      SUBTLE.verify({ name: 'ECDSA', hash: 'SHA-256' }, keys.publicKey, signature, utf8Bytes(text))
        .then(function (ok) {
          if (seq !== verifySeq) { return; } /* a newer edit superseded this check */
          if (ok) {
            setVerdict('valid', 'Signature VALID — this is exactly the text Alice signed, and only her private key could have signed it.');
          } else {
            var delta = text === signedText ? '' : ' The document differs from the signed original' +
              (Math.abs(text.length - signedText.length) <= 2 ? ' — even a tiny edit is fatal.' : '.');
            setVerdict('invalid', 'Signature INVALID — verification failed.' + delta);
          }
          btnRestore.disabled = text === signedText;
        });
    }

    btnSign.addEventListener('click', function () {
      btnSign.disabled = true;
      var p = keys ? Promise.resolve(keys)
        : SUBTLE.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
      p.then(function (kp) {
        keys = kp;
        signedText = docEl.value;
        return SUBTLE.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, utf8Bytes(signedText));
      }).then(function (sig) {
        signature = sig;
        sigEl.textContent = bytesToHex(sig);
        setVerdict('valid', 'Signed and verified. Now edit the document above — watch what happens.');
        btnRestore.disabled = true;
      }).catch(function () {
        setVerdict('invalid', 'Signing failed unexpectedly.');
      }).then(function () { btnSign.disabled = false; });
    });

    docEl.addEventListener('input', verifyNow);
    btnRestore.addEventListener('click', function () {
      if (signedText === null) { return; }
      docEl.value = signedText;
      verifyNow();
    });
  }

  /* ==========================================================================
     07 — TLS HANDSHAKE STEPPER
     ========================================================================== */

  function initTls() {
    var canvas = $('#cy-tls-canvas');
    if (!canvas) { return; }
    var btnPlay = $('#cy-tls-play');
    var btnStep = $('#cy-tls-step');
    var btnReset = $('#cy-tls-reset');
    var statusEl = $('#cy-tls-status');
    var stepsList = $$('#cy-tls-steps li');
    var cv = setupCanvas(canvas, function () { drawStep(cur, 1); });
    var ctx = cv.ctx, st = cv.state;

    var cur = -1; /* -1 = idle */
    var STEP_DUR = 1500;

    function pts() {
      return {
        browser: { x: st.w * 0.14, y: st.h * 0.55 },
        server: { x: st.w * 0.86, y: st.h * 0.55 },
        ca: { x: st.w * 0.5, y: st.h * 0.16 }
      };
    }

    function drawBrowserBox(P) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = C.teal;
      roundRect(ctx, P.browser.x - 34, P.browser.y - 26, 68, 46, 6);
      ctx.stroke();
      ctx.strokeStyle = C.lineStrong;
      ctx.beginPath();
      ctx.moveTo(P.browser.x - 34, P.browser.y - 14);
      ctx.lineTo(P.browser.x + 34, P.browser.y - 14);
      ctx.stroke();
      ctx.font = '600 12px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = C.text;
      ctx.fillText('Browser', P.browser.x, P.browser.y + 28);
    }

    function drawServerBox(P) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = C.sky;
      roundRect(ctx, P.server.x - 26, P.server.y - 30, 52, 54, 6);
      ctx.stroke();
      var i;
      for (i = 0; i < 3; i++) {
        ctx.strokeStyle = C.lineStrong;
        ctx.beginPath();
        ctx.moveTo(P.server.x - 26, P.server.y - 30 + 14 + i * 14);
        ctx.lineTo(P.server.x + 26, P.server.y - 30 + 14 + i * 14);
        ctx.stroke();
        ctx.fillStyle = C.sky;
        ctx.beginPath();
        ctx.arc(P.server.x + 17, P.server.y - 23 + i * 14, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.font = '600 12px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = C.text;
      ctx.fillText('yourbank.com', P.server.x, P.server.y + 32);
    }

    function drawCa(P, active) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = active ? '#c4b5fd' : C.lineStrong;
      ctx.beginPath();
      ctx.arc(P.ca.x, P.ca.y, 20, 0, Math.PI * 2);
      ctx.stroke();
      /* rosette ribbon */
      ctx.beginPath();
      ctx.moveTo(P.ca.x - 7, P.ca.y + 17);
      ctx.lineTo(P.ca.x - 10, P.ca.y + 30);
      ctx.moveTo(P.ca.x + 7, P.ca.y + 17);
      ctx.lineTo(P.ca.x + 10, P.ca.y + 30);
      ctx.stroke();
      ctx.font = '600 10px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = active ? '#c4b5fd' : C.faint;
      ctx.fillText('CA', P.ca.x, P.ca.y - 4);
      ctx.fillText('root of trust', P.ca.x, P.ca.y + 40);
    }

    function arrow(from, to, p, color, label, dy) {
      dy = dy || 0;
      var x1 = from.x, y1 = from.y + dy, x2 = from.x + (to.x - from.x) * p, y2 = from.y + (to.y - from.y) * p + dy;
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      if (p > 0.15) {
        var ang = Math.atan2(to.y - from.y, to.x - from.x);
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - 8 * Math.cos(ang - 0.4), y2 - 8 * Math.sin(ang - 0.4));
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - 8 * Math.cos(ang + 0.4), y2 - 8 * Math.sin(ang + 0.4));
        ctx.stroke();
      }
      if (label) {
        ctx.font = '11px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = color;
        ctx.fillText(label, (x1 + x2) / 2, Math.min(y1, y2) - 8);
      }
    }

    function certCard(x, y, alpha) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = '#c4b5fd';
      roundRect(ctx, x - 16, y - 11, 32, 22, 3);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 10, y - 4); ctx.lineTo(x + 6, y - 4);
      ctx.moveTo(x - 10, y + 1); ctx.lineTo(x + 2, y + 1);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x + 9, y + 4, 3.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    function drawStep(step, p) {
      if (st.w < 60 || st.h < 60) { return; }
      var P = pts();
      ctx.clearRect(0, 0, st.w, st.h);
      drawBrowserBox(P);
      drawServerBox(P);
      drawCa(P, step === 2);
      var midY = { x: (P.browser.x + P.server.x) / 2, y: P.browser.y };
      if (step < 0) {
        ctx.font = '12px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = C.faint;
        ctx.fillText('Press play — five steps from stranger to sealed channel.', midY.x, P.browser.y - 60);
        return;
      }
      var bEdge = { x: P.browser.x + 40, y: P.browser.y };
      var sEdge = { x: P.server.x - 34, y: P.server.y };
      if (step >= 0) { arrow(bEdge, sEdge, step === 0 ? p : 1, C.sky, step === 0 ? 'ClientHello · random · ciphers' : null, -14); }
      if (step >= 1) {
        arrow(sEdge, bEdge, step === 1 ? p : 1, '#c4b5fd', step === 1 ? 'Certificate + ServerHello' : null, 2);
        certCard(bEdge.x + (sEdge.x - bEdge.x) * 0.5, P.browser.y + 2 - 16, step === 1 ? p : 1);
      }
      if (step >= 2) {
        ctx.setLineDash([4, 4]);
        arrow({ x: P.browser.x + 10, y: P.browser.y - 28 }, { x: P.ca.x - 8, y: P.ca.y + 24 }, step === 2 ? p : 1, '#c4b5fd', null, 0);
        ctx.setLineDash([]);
        if (step > 2 || p > 0.8) {
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = C.teal;
          ctx.beginPath();
          ctx.moveTo(P.ca.x - 26, P.ca.y + 28);
          ctx.lineTo(P.ca.x - 20, P.ca.y + 34);
          ctx.lineTo(P.ca.x - 9, P.ca.y + 22);
          ctx.stroke();
        }
      }
      if (step >= 3) {
        var kp = step === 3 ? p : 1;
        arrow(bEdge, sEdge, kp, '#fbbf24', step === 3 ? 'key exchange' : null, 16);
        arrow(sEdge, bEdge, kp, '#fbbf24', null, 24);
        if (step > 3 || p > 0.7) {
          drawKeyGlyph(ctx, P.browser.x, P.browser.y - 44, '#a3e635', 1);
          drawKeyGlyph(ctx, P.server.x, P.server.y - 48, '#a3e635', 1);
          ctx.font = '10px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = '#a3e635';
          ctx.fillText('session key', P.browser.x, P.browser.y - 58);
          ctx.fillText('session key', P.server.x, P.server.y - 62);
        }
      }
      if (step >= 4) {
        var dashOffset = (performance.now() / 40) % 16;
        ctx.save();
        ctx.setLineDash([8, 8]);
        ctx.lineDashOffset = -dashOffset;
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = C.teal;
        ctx.beginPath();
        ctx.moveTo(bEdge.x, P.browser.y + 38);
        ctx.lineTo(sEdge.x, P.server.y + 38);
        ctx.stroke();
        ctx.restore();
        drawLockGlyph(ctx, midY.x, P.browser.y + 24, C.teal, false, 1.2);
        ctx.font = '600 11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = C.teal;
        ctx.fillText('AES-encrypted application data', midY.x, P.browser.y + 56);
      }
    }

    function markSteps(step) {
      stepsList.forEach(function (li, i) {
        li.classList.toggle('is-active', i === step);
        li.classList.toggle('is-done', i < step);
      });
    }

    var mode = null; /* 'play' | null */
    var t = 0;
    var loop = makeLoop(function (_, dt) {
      t += dt;
      var p = clamp(t / STEP_DUR, 0, 1);
      drawStep(cur, easeInOut(p));
      if (p >= 1) {
        if (mode === 'play' && cur < 4) {
          cur++;
          t = 0;
          markSteps(cur);
          setStatus(statusEl, 'Step ' + (cur + 1) + ' of 5');
        } else if (cur >= 4) {
          markSteps(5);
          setStatus(statusEl, 'Handshake complete — everything from here on is fast symmetric AES under the session key.', 'ok');
          if (reduced()) { loop.stop(); }
          /* keep looping for the animated traffic dashes unless reduced */
        } else {
          loop.stop();
        }
      }
    });

    function goTo(step, animate) {
      cur = step;
      markSteps(cur);
      if (!animate || reduced()) {
        drawStep(cur, 1);
        if (cur >= 4) { markSteps(5); setStatus(statusEl, 'Handshake complete — everything from here on is fast symmetric AES under the session key.', 'ok'); }
        else if (cur >= 0) { setStatus(statusEl, 'Step ' + (cur + 1) + ' of 5'); }
        loop.stop();
        return;
      }
      t = 0;
      loop.stop();
      loop.start();
    }

    btnPlay.addEventListener('click', function () {
      mode = 'play';
      /* Under reduced motion goTo() draws its target and returns instead of
         animating forward, so goTo(0) would leave Play behaving exactly like
         Step — the visitor would have to press Step four more times to reach
         the sealed channel. Jump to the labeled final state, which is what
         every other story widget on this page does. */
      if (reduced()) { goTo(4, true); return; }
      goTo(0, true);
      setStatus(statusEl, 'Step 1 of 5');
    });
    btnStep.addEventListener('click', function () {
      mode = null;
      goTo(Math.min(cur + 1, 4), true);
      if (cur >= 0 && cur < 4) { setStatus(statusEl, 'Step ' + (cur + 1) + ' of 5'); }
    });
    btnReset.addEventListener('click', function () {
      mode = null;
      cur = -1;
      loop.stop();
      markSteps(-1);
      drawStep(-1, 1);
      setStatus(statusEl, '');
    });

    onScreen(canvas, function () { if (!loop.running()) { drawStep(cur, 1); } }, function () { if (mode !== 'play') { loop.stop(); } });
  }

  /* ==========================================================================
     08 — PASSWORD BREACH SIMULATOR
     ========================================================================== */

  function initPasswords() {
    var addBtn = $('#cy-pw-add');
    if (!addBtn) { return; }
    var breachBtn = $('#cy-pw-breach');
    var userEl = $('#cy-pw-user');
    var pwEl = $('#cy-pw-in');
    var plainBody = $('#cy-pw-plain-table tbody');
    var hashBody = $('#cy-pw-hash-table tbody');
    var plainWrap = $('#cy-pw-plain-wrap');
    var hashWrap = $('#cy-pw-hash-wrap');
    var statusEl = $('#cy-pw-status');

    var users = [
      { user: 'alice', pw: 'sunshine' },
      { user: 'bob', pw: 'Tr0ub4dor&3' },
      { user: 'dana', pw: 'password123' },
      { user: 'erin', pw: 'password123' }
    ];
    users.forEach(function (u) { u.salt = randHexHalf(); });
    var breached = false;

    function randHexHalf() {
      return bytesToHex(randBytes(4));
    }

    function saltedHash(u) {
      return sha256(u.salt + u.pw);
    }

    function dupPasswords() {
      var seen = {}, dups = {};
      users.forEach(function (u) {
        if (seen[u.pw]) { dups[u.pw] = true; }
        seen[u.pw] = true;
      });
      return dups;
    }

    function render() {
      var dups = dupPasswords();
      plainBody.innerHTML = '';
      hashBody.innerHTML = '';
      users.forEach(function (u) {
        var isDup = dups[u.pw];
        var tr = document.createElement('tr');
        if (isDup && breached) { tr.className = 'cy-pw-dup'; }
        var td1 = document.createElement('td');
        td1.textContent = u.user;
        var td2 = document.createElement('td');
        td2.textContent = breached ? u.pw : '•'.repeat(Math.min(u.pw.length, 12));
        if (breached) { td2.className = 'cy-pw-exposed'; }
        tr.appendChild(td1);
        tr.appendChild(td2);
        plainBody.appendChild(tr);

        var tr2 = document.createElement('tr');
        if (isDup && breached) { tr2.className = 'cy-pw-dup'; }
        var td3 = document.createElement('td');
        td3.textContent = u.user;
        var td4 = document.createElement('td');
        td4.textContent = u.salt;
        var td5 = document.createElement('td');
        td5.textContent = saltedHash(u).slice(0, 16) + '…';
        if (breached) { td5.className = 'cy-pw-safe'; }
        tr2.appendChild(td3);
        tr2.appendChild(td4);
        tr2.appendChild(td5);
        hashBody.appendChild(tr2);
      });
    }

    addBtn.addEventListener('click', function () {
      var name = (userEl.value || 'you').trim().slice(0, 16) || 'you';
      var pw = pwEl.value || 'hunter2';
      /* replace an existing row with the same username so re-clicks don't pile up */
      users = users.filter(function (u) { return u.user !== name; });
      users.push({ user: name, pw: pw, salt: randHexHalf() });
      render();
      setStatus(statusEl, 'Account “' + name + '” created on both sites. Site A wrote your password down verbatim; Site B stored a random salt and sha256(salt + password) — and immediately forgot the password itself.');
    });

    breachBtn.addEventListener('click', function () {
      breached = true;
      render();
      plainWrap.classList.add('is-breached');
      hashWrap.classList.add('is-breached-safe');
      setStatus(statusEl,
        'Both databases just leaked. Site A’s attacker walks away with every password, ready to try on your email and bank (people reuse passwords — note dana and erin). Site B’s attacker holds salted hashes: the same shared password produced two unrelated hashes, so precomputed rainbow tables are useless and every single account must be brute-forced separately — against a deliberately slow hash, that’s years per strong password.',
        'bad');
    });

    render();
  }

  /* ==========================================================================
     09 — DIFFIE–HELLMAN PAINT MIXING
     ========================================================================== */

  function initDh() {
    var canvas = $('#cy-dh-canvas');
    if (!canvas) { return; }
    var btnPlay = $('#cy-dh-play');
    var btnReset = $('#cy-dh-reset');
    var statusEl = $('#cy-dh-status');
    var cv = setupCanvas(canvas, function () { if (idle) { drawIdle(); } });
    var ctx = cv.ctx, st = cv.state;

    var BASE = [234, 179, 8];     /* public yellow */
    var A_SECRET = [225, 29, 72]; /* Alice's private rose */
    var B_SECRET = [2, 132, 199]; /* Bob's private sky */

    function mix(a, b) {
      return [Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2), Math.round((a[2] + b[2]) / 2)];
    }
    function mix3(a, b, c) {
      return [Math.round((a[0] + b[0] + c[0]) / 3), Math.round((a[1] + b[1] + c[1]) / 3), Math.round((a[2] + b[2] + c[2]) / 3)];
    }
    function css(rgb) { return 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')'; }

    var A_MIX = mix(BASE, A_SECRET);
    var B_MIX = mix(BASE, B_SECRET);
    var SHARED = mix3(BASE, A_SECRET, B_SECRET);

    function pts() {
      return {
        alice: { x: st.w * 0.14, y: st.h * 0.3 },
        bob: { x: st.w * 0.86, y: st.h * 0.3 },
        eve: { x: st.w * 0.5, y: st.h * 0.78 },
        wireY: st.h * 0.3
      };
    }

    function swatch(x, y, rgb, label, r, outline) {
      r = r || 13;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = css(rgb);
      ctx.fill();
      if (outline) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = outline;
        ctx.stroke();
      }
      if (label) {
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = C.muted;
        ctx.fillText(label, x, y + r + 4);
      }
    }

    /* Returns null when the canvas has no real box yet — every caller
       dereferences the point set, so every caller must bail too. */
    function scene() {
      if (st.w < 60 || st.h < 60) { return null; }
      ctx.clearRect(0, 0, st.w, st.h);
      var P = pts();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = C.lineStrong;
      ctx.beginPath();
      ctx.moveTo(P.alice.x + 30, P.wireY);
      ctx.lineTo(P.bob.x - 30, P.wireY);
      ctx.stroke();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(225, 29, 72, 0.6)';
      ctx.beginPath();
      ctx.moveTo(st.w * 0.5, P.wireY);
      ctx.lineTo(P.eve.x, P.eve.y - 30);
      ctx.stroke();
      ctx.setLineDash([]);
      drawActor(ctx, P.alice.x, P.alice.y, 'Alice', C.teal);
      drawActor(ctx, P.bob.x, P.bob.y, 'Bob', C.teal);
      drawActor(ctx, P.eve.x, P.eve.y, 'Eve (records everything)', C.rose, 18);
      return P;
    }

    var idle = true;
    function drawIdle() {
      var P = scene();
      if (!P) { return; }
      swatch(st.w * 0.5, P.wireY - 34, BASE, 'public start color — everyone sees it', 11);
    }

    var story = [
      { dur: 1500, caption: 'Step 1 — a public starting color is agreed in the open. Alice, Bob, and Eve all have it.',
        draw: function (p, P) {
          swatch(st.w * 0.5, P.wireY - 34, BASE, 'public color', 11);
          var xa = st.w * 0.5 + (P.alice.x - st.w * 0.5) * p;
          var xb = st.w * 0.5 + (P.bob.x - st.w * 0.5) * p;
          swatch(xa, P.wireY - 34, BASE, null, 9);
          swatch(xb, P.wireY - 34, BASE, null, 9);
          swatch(P.eve.x + 34, P.eve.y, BASE, null, 8);
        } },
      { dur: 1800, caption: 'Step 2 — each picks a private color and mixes it in. The private colors never leave home.',
        draw: function (p, P) {
          swatch(P.alice.x, P.wireY - 34, BASE, null, 9);
          swatch(P.bob.x, P.wireY - 34, BASE, null, 9);
          swatch(P.eve.x + 34, P.eve.y, BASE, null, 8);
          swatch(P.alice.x - 34, P.alice.y + 44, A_SECRET, 'private', 9, C.line);
          swatch(P.bob.x + 34, P.bob.y + 44, B_SECRET, 'private', 9, C.line);
          if (p > 0.5) {
            swatch(P.alice.x + 34, P.alice.y + 44, A_MIX, 'mixture', 11);
            swatch(P.bob.x - 34, P.bob.y + 44, B_MIX, 'mixture', 11);
          }
        } },
      { dur: 2000, caption: 'Step 3 — the mixtures cross the wire in public. Eve copies both. But un-mixing paint is a one-way problem.',
        draw: function (p, P) {
          swatch(P.alice.x - 34, P.alice.y + 44, A_SECRET, 'private', 9, C.line);
          swatch(P.bob.x + 34, P.bob.y + 44, B_SECRET, 'private', 9, C.line);
          var xa = (P.alice.x + 34) + (P.bob.x - 34 - (P.alice.x + 34)) * p;
          var xb = (P.bob.x - 34) + (P.alice.x + 34 - (P.bob.x - 34)) * p;
          swatch(xa, P.wireY - 12, A_MIX, null, 11);
          swatch(xb, P.wireY + 12, B_MIX, null, 11);
          swatch(P.eve.x + 34, P.eve.y, BASE, null, 8);
          if (p > 0.45) {
            swatch(P.eve.x + 52, P.eve.y, A_MIX, null, 8);
            swatch(P.eve.x + 70, P.eve.y, B_MIX, null, 8);
          }
        } },
      { dur: 2200, caption: 'Step 4 — each mixes their private color into the other’s mixture. Both arrive at the identical shared secret — which never crossed the wire. Eve holds three colors she cannot un-mix.',
        draw: function (p, P) {
          swatch(P.alice.x - 34, P.alice.y + 44, A_SECRET, 'private', 9, C.line);
          swatch(P.bob.x + 34, P.bob.y + 44, B_SECRET, 'private', 9, C.line);
          var col = p < 0.5 ? B_MIX : SHARED;
          var col2 = p < 0.5 ? A_MIX : SHARED;
          swatch(P.alice.x + 34, P.alice.y + 44, col, p < 0.5 ? 'received' : 'shared secret', 12, p >= 0.5 ? C.teal : null);
          swatch(P.bob.x - 34, P.bob.y + 44, col2, p < 0.5 ? 'received' : 'shared secret', 12, p >= 0.5 ? C.teal : null);
          swatch(P.eve.x + 34, P.eve.y, BASE, null, 8);
          swatch(P.eve.x + 52, P.eve.y, A_MIX, null, 8);
          swatch(P.eve.x + 70, P.eve.y, B_MIX, null, 8);
          if (p >= 0.5) {
            ctx.font = '700 14px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = C.teal;
            ctx.fillText('=', st.w * 0.5, P.alice.y + 48);
            ctx.font = '12px Inter, sans-serif';
            ctx.fillStyle = C.rose;
            ctx.fillText('?', P.eve.x + 90, P.eve.y + 4);
          }
        } }
    ];

    var anim = { t: 0, idx: 0 };
    var loop = makeLoop(function (_, dt) {
      var P = scene();
      if (!P) { return; }
      anim.t += dt;
      var seg = story[anim.idx];
      var p = clamp(anim.t / seg.dur, 0, 1);
      seg.draw(easeInOut(p), P);
      if (p >= 1) {
        anim.idx++;
        anim.t = 0;
        if (anim.idx >= story.length) { loop.stop(); return; }
        setStatus(statusEl, story[anim.idx].caption);
      }
    });

    btnPlay.addEventListener('click', function () {
      idle = false;
      if (reduced()) {
        var P = scene();
        if (P) { story[story.length - 1].draw(1, P); }
        setStatus(statusEl, story.map(function (s) { return s.caption; }).join(' '));
        return;
      }
      loop.stop();
      anim = { t: 0, idx: 0 };
      setStatus(statusEl, story[0].caption);
      loop.start();
    });
    btnReset.addEventListener('click', function () {
      loop.stop();
      idle = true;
      drawIdle();
      setStatus(statusEl, '');
    });

    onScreen(canvas, function () { if (!loop.running() && idle) { drawIdle(); } }, function () { loop.stop(); });
  }

  /* ==========================================================================
     10 — EVERYDAY APPS DASHBOARD
     ========================================================================== */

  var CHIP_LABEL = {
    sym: 'Symmetric (AES)', asym: 'Asymmetric', hash: 'Hashing', sig: 'Signatures', tls: 'TLS / certificates'
  };

  var APPS = [
    { name: 'HTTPS websites', chips: ['tls', 'asym', 'sym', 'sig'],
      how: 'Every padlocked page runs the full stack from this exhibit: certificates prove the site’s identity, an ephemeral key exchange derives a session key, and AES encrypts the traffic.',
      why: 'Without it, every password, message, and card number you type would cross the network readable by anyone en route.' },
    { name: 'Online banking', chips: ['tls', 'sig', 'hash'],
      how: 'TLS secures the connection; behind the scenes, banks sign transactions and API calls, and integrity checks (MACs) ensure an instruction like “pay $100” can’t be altered to “pay $10,000” in flight.',
      why: 'Money movement needs all four pillars at once — secrecy, integrity, identity, and an audit trail nobody can disown.' },
    { name: 'Credit card payments', chips: ['sym', 'asym', 'tls'],
      how: 'Chip cards (EMV) hold a private key and sign each transaction inside the chip — that’s why chips killed card-cloning fraud. Networks encrypt card numbers end-to-end and replace them with tokens.',
      why: 'A skimmer can copy a magnetic stripe forever; it cannot extract a private key from the chip’s secure element.' },
    { name: 'Apple Pay / Google Pay', chips: ['asym', 'sig', 'sym'],
      how: 'Your real card number is never stored or sent. A device-specific token plus a per-payment cryptographic signature — generated in dedicated secure hardware — authorizes each tap.',
      why: 'A breached merchant learns a token that’s useless anywhere else, not your card.' },
    { name: 'Password managers', chips: ['sym', 'hash'],
      how: 'Your vault is AES-encrypted under a key derived from your master password with a deliberately slow hash (like the salted hashing in chapter 08, but tuned much harder). The provider stores only ciphertext.',
      why: 'One strong secret protects hundreds — and a breach of the provider yields only sealed vaults.' },
    { name: 'VPNs', chips: ['asym', 'sym', 'tls'],
      how: 'A VPN client authenticates the server (certificates), runs a key exchange, then wraps all your traffic in an AES-encrypted tunnel to the VPN endpoint.',
      why: 'On hostile networks — airport Wi-Fi, censored links — the tunnel hides both content and destinations from local eavesdroppers.' },
    { name: 'Signal / WhatsApp', chips: ['asym', 'sym', 'sig', 'hash'],
      how: 'End-to-end encryption: keys live only on your and your contact’s devices, with a fresh key for every message (the “double ratchet”). The servers relay ciphertext they cannot read.',
      why: 'Even the service operator — subpoenaed, hacked, or curious — has nothing legible to hand over. Forward secrecy means past messages stay sealed even if a key leaks later.' },
    { name: 'Bitcoin', chips: ['hash', 'sig'],
      how: 'Interestingly, no encryption at all: everything is public. Ownership is an ECDSA key pair — “your” coins are the ones your private key can sign away — and mining is a global SHA-256 race.',
      why: 'Signatures replace banks as the authority on who may spend; hashes make history tamper-evident. The full story is in the Bitcoin exhibit.' },
    { name: 'Blockchains', chips: ['hash', 'sig'],
      how: 'Each block commits to its predecessor by hash, so rewriting old data breaks every later block visibly. Transactions are signed; consensus rules decide whose chain wins.',
      why: 'Integrity through mathematics instead of through a trusted bookkeeper — see the Blockchain exhibit for when that trade is worth it.' },
    { name: 'Software updates', chips: ['sig', 'hash'],
      how: 'Vendors sign every release; your OS verifies the signature against the vendor’s public key before installing. Package managers pin hashes of every dependency.',
      why: 'Without this, anyone controlling a download mirror or your network could ship you malware labeled as an update — signing makes the update channel itself trustworthy.' },
    { name: 'Cloud storage', chips: ['sym', 'tls', 'hash'],
      how: 'Files are AES-encrypted at rest (each file under its own key, keys wrapped by master keys in hardware modules) and TLS-encrypted in transit; hashes deduplicate and verify integrity.',
      why: 'A stolen datacenter disk is ciphertext without the key hierarchy that never leaves the provider’s hardware security modules.' },
    { name: 'Disk & phone encryption', chips: ['sym'],
      how: 'Your device’s storage is one big AES ciphertext; the key is derived from your passcode inside tamper-resistant hardware that rate-limits guesses.',
      why: 'A lost or stolen phone is a brick of random bytes instead of your entire life. This is also why forgetting the passcode is unrecoverable — there is no back door to “ask.”' }
  ];

  function initApps() {
    var list = $('#cy-app-list');
    var detail = $('#cy-app-detail');
    if (!list || !detail) { return; }

    var buttons = [];

    function select(idx) {
      buttons.forEach(function (b, i) { b.setAttribute('aria-pressed', String(i === idx)); });
      var app = APPS[idx];
      detail.innerHTML = '';
      var h = document.createElement('h3');
      h.textContent = app.name;
      var chips = document.createElement('div');
      chips.className = 'cy-chiprow';
      app.chips.forEach(function (c) {
        var s = document.createElement('span');
        s.className = 'cy-chip cy-chip-' + c;
        s.textContent = CHIP_LABEL[c];
        chips.appendChild(s);
      });
      var pHow = document.createElement('p');
      pHow.textContent = app.how;
      var pWhy = document.createElement('p');
      var whyStrong = document.createElement('strong');
      whyStrong.textContent = 'Why it matters: ';
      pWhy.appendChild(whyStrong);
      pWhy.appendChild(document.createTextNode(app.why));
      detail.appendChild(h);
      detail.appendChild(chips);
      detail.appendChild(pHow);
      detail.appendChild(pWhy);
    }

    APPS.forEach(function (app, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'cy-app-btn';
      b.textContent = app.name;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () { select(i); });
      list.appendChild(b);
      buttons.push(b);
    });

    select(0);
  }

  /* ==========================================================================
     13 — THE CRYPTOGRAPHY LAB
     Full pipeline: keys → hash → sign → encrypt → transit (± tamper)
     → decrypt/authenticate → verify. All primitives are real.
     ========================================================================== */

  function initLab() {
    var runBtn = $('#cy-lab-run');
    if (!runBtn) { return; }
    var msgEl = $('#cy-lab-msg');
    var tamperEl = $('#cy-lab-tamper');
    var statusEl = $('#cy-lab-status');
    var stages = {};
    $$('#cy-lab-stages .cy-lab-stage').forEach(function (li) {
      stages[li.getAttribute('data-stage')] = {
        li: li,
        out: li.querySelector('.cy-lab-stage-out')
      };
    });

    if (!SUBTLE) { noSubtle(statusEl, [runBtn]); return; }

    function resetStages() {
      Object.keys(stages).forEach(function (k) {
        stages[k].li.classList.remove('is-active', 'is-ok', 'is-bad', 'is-warn');
        stages[k].out.textContent = '';
      });
      setStatus(statusEl, '');
    }

    function mark(key, cls, text) {
      var s = stages[key];
      if (!s) { return; }
      s.li.classList.remove('is-active');
      s.li.classList.add(cls);
      if (text) { s.out.textContent = text; }
    }

    function activate(key) {
      var s = stages[key];
      if (s) { s.li.classList.add('is-active'); }
    }

    function pause() {
      return new Promise(function (res) { setTimeout(res, reduced() ? 0 : 420); });
    }

    var running = false;

    runBtn.addEventListener('click', function () {
      if (running) { return; }
      running = true;
      runBtn.disabled = true;
      resetStages();

      var msg = msgEl.value || '(empty message)';
      var tamper = tamperEl.checked;
      var aesKey, sigKeys, iv, ctBytes, sigHex, msgHash;

      activate('keys');
      Promise.all([
        window.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']),
        window.crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
      ]).then(function (res) {
        aesKey = res[0];
        sigKeys = res[1];
        return SUBTLE.exportKey('raw', aesKey);
      }).then(function (raw) {
        mark('keys', 'is-ok', 'session key ' + shortHex(bytesToHex(raw), 16) + ' · ECDSA P-256 pair ready');
        return pause();
      }).then(function () {
        activate('hash');
        msgHash = sha256(msg);
        mark('hash', 'is-ok', 'SHA-256: ' + shortHex(msgHash, 24));
        return pause();
      }).then(function () {
        activate('sign');
        return SUBTLE.sign({ name: 'ECDSA', hash: 'SHA-256' }, sigKeys.privateKey, utf8Bytes(msg));
      }).then(function (sig) {
        sigHex = bytesToHex(sig);
        mark('sign', 'is-ok', 'signature ' + shortHex(sigHex, 24) + ' (' + (sigHex.length / 2) + ' bytes)');
        return pause();
      }).then(function () {
        activate('encrypt');
        iv = randBytes(12);
        var payload = JSON.stringify({ msg: msg, sig: sigHex });
        return SUBTLE.encrypt({ name: 'AES-GCM', iv: iv }, aesKey, utf8Bytes(payload));
      }).then(function (ct) {
        ctBytes = new Uint8Array(ct);
        mark('encrypt', 'is-ok', 'AES-256-GCM: ' + shortHex(bytesToHex(ctBytes), 24) + ' (' + ctBytes.length + ' bytes)');
        return pause();
      }).then(function () {
        activate('transit');
        if (tamper) {
          var idx = 8 + Math.floor(Math.random() * Math.max(1, ctBytes.length - 24));
          ctBytes[idx] ^= 0x01; /* Eve flips a single bit */
          mark('transit', 'is-warn', 'Eve flipped one bit of byte #' + idx + ' — the ciphertext looks almost identical…');
        } else {
          mark('transit', 'is-ok', 'delivered unchanged');
        }
        return pause();
      }).then(function () {
        activate('decrypt');
        return SUBTLE.decrypt({ name: 'AES-GCM', iv: iv }, aesKey, ctBytes).then(
          function (pt) { return { ok: true, pt: pt }; },
          function () { return { ok: false }; }
        );
      }).then(function (res) {
        if (!res.ok) {
          mark('decrypt', 'is-bad', 'AES-GCM authentication tag mismatch — the ciphertext was modified in transit. Bob discards the message unread.');
          mark('verify', 'is-bad', 'never reached — tampering was caught one layer earlier');
          setStatus(statusEl, 'One flipped bit out of ' + ctBytes.length * 8 + ' and the whole message is rejected. That’s integrity protection working: Bob doesn’t get a subtly corrupted message, he gets certainty that something is wrong.', 'bad');
          return null;
        }
        var payload = JSON.parse(new TextDecoder().decode(res.pt));
        mark('decrypt', 'is-ok', 'authenticated and decrypted: “' + payload.msg + '”');
        return pause().then(function () {
          activate('verify');
          return SUBTLE.verify({ name: 'ECDSA', hash: 'SHA-256' }, sigKeys.publicKey, hexToBytes(payload.sig), utf8Bytes(payload.msg));
        }).then(function (ok) {
          if (ok) {
            mark('verify', 'is-ok', 'signature valid — provably Alice’s exact words');
            setStatus(statusEl, 'Delivered: confidential in transit (AES), tamper-evident (GCM tag), provably Alice’s (ECDSA). This pipeline — in essence — is what TLS, Signal, and code-signing all run.', 'ok');
          } else {
            mark('verify', 'is-bad', 'signature invalid');
            setStatus(statusEl, 'Signature verification failed.', 'bad');
          }
        });
      }).catch(function () {
        setStatus(statusEl, 'The pipeline hit an unexpected error.', 'bad');
      }).then(function () {
        running = false;
        runBtn.disabled = false;
      });
    });
  }

  /* ==========================================================================
     Boot — every widget isolated so one failure can't break the page
     ========================================================================== */

  function boot() {
    [initReveal, initRail, initHero, initIntercept, initCaesar, initSymmetric,
     initAsymAnim, initAsymRSA, initHash, initSignatures, initTls,
     initPasswords, initDh, initApps, initLab].forEach(function (fn) {
      try { fn(); } catch (e) {
        if (window.console && console.error) { console.error('cryptography.js widget failed:', fn.name, e); }
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
