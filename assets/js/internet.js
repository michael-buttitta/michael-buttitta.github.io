/* =============================================================================
   How the Internet Works — interactivity
   Vanilla JS, no dependencies. Loaded with `defer` on /internet/ only.

   Structure:
     1. Shared utilities (canvas fitting, visibility gating, rAF loops) —
        the same toolkit as the other exhibits
     2. One init function per widget, each guarded by element existence and
        wrapped in try/catch so one failure never takes down the page
     3. Everything respects prefers-reduced-motion: ambient animation is
        disabled and story animations jump to labeled final states

   Honesty notes: the routing playground runs real per-hop shortest-path
   recomputation (Dijkstra) over a live graph; the TCP/UDP lanes genuinely
   drop and retransmit; the latency numbers everywhere are speed-of-light
   great-circle estimates with a route factor, labeled as such in the page
   copy. The hero globe, packet reassembly scene, and simulator are honest
   cartoons built to teach concepts, and the captions say so where it matters.
   ============================================================================ */

(function () {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  document.documentElement.classList.add('net-js');

  var RM = window.matchMedia('(prefers-reduced-motion: reduce)');
  function reduced() { return RM.matches; }

  function setStatus(el, msg, kind) {
    if (!el) { return; }
    el.textContent = msg;
    el.classList.remove('is-ok', 'is-bad');
    if (kind === 'ok') { el.classList.add('is-ok'); }
    if (kind === 'bad') { el.classList.add('is-bad'); }
  }

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

  function fmtMs(ms) {
    if (ms >= 1000) { return (ms / 1000).toFixed(2) + ' s'; }
    return Math.round(ms) + ' ms';
  }

  /* Great-circle distance in km between {lat, lon} points. */
  function haversine(a, b) {
    var R = 6371, D = Math.PI / 180;
    var dLat = (b.lat - a.lat) * D, dLon = (b.lon - a.lon) * D;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * D) * Math.cos(b.lat * D) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  /* Estimated RTT in ms: light in fiber ≈ 200 km/ms, ×1.3 route factor,
     plus a few ms of equipment delay. Matches the caption's caveat. */
  function rttFor(km) { return Math.max(3, (km / 100) * 1.3 + 4); }

  /* ==========================================================================
     Reveal-on-scroll + chapter rail
     ========================================================================== */

  function initReveal() {
    var targets = $$('#internet-experience [data-net-reveal]');
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
    var dots = $$('#internet-experience .net-rail-dot');
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
     HERO — an abstract rotating globe of nodes joined by great-circle arcs,
     with packets streaming along the arcs.
     ========================================================================== */

  function initHero() {
    var canvas = $('#net-hero-canvas');
    if (!canvas) { return; }
    var cv = setupCanvas(canvas);
    var ctx = cv.ctx, st = cv.state;
    var rng = makeRng(19691029); /* first ARPANET message */

    /* Nodes on a unit sphere (lat/lon in radians). */
    var nodes = [];
    var i;
    for (i = 0; i < 26; i++) {
      nodes.push({
        lat: Math.asin(rng() * 1.8 - 0.9),
        lon: rng() * Math.PI * 2
      });
    }
    var links = [];
    for (i = 0; i < 30; i++) {
      var a = Math.floor(rng() * nodes.length);
      var b = Math.floor(rng() * nodes.length);
      if (a !== b) { links.push({ a: a, b: b, phase: rng() }); }
    }

    function project(lat, lon, rot, R, cx, cy) {
      var x3 = Math.cos(lat) * Math.cos(lon + rot);
      var y3 = Math.sin(lat);
      var z3 = Math.cos(lat) * Math.sin(lon + rot);
      return { x: cx + x3 * R, y: cy - y3 * R * 0.92, z: z3 };
    }

    function draw(t) {
      var w = st.w, h = st.h;
      if (!w || !h) { return; }
      ctx.clearRect(0, 0, w, h);
      var cx = w / 2, cy = h * 0.56;
      var R = Math.min(w * 0.32, h * 0.5);
      var rot = reduced() ? 0.6 : t * 0.00006;

      /* graticule */
      ctx.strokeStyle = 'rgba(51, 65, 85, 0.35)';
      ctx.lineWidth = 1;
      var la, lo, k;
      for (la = -60; la <= 60; la += 30) {
        ctx.beginPath();
        var first = true;
        for (lo = 0; lo <= 360; lo += 6) {
          var p = project(la * Math.PI / 180, lo * Math.PI / 180, rot, R, cx, cy);
          if (p.z < -0.05) { first = true; continue; }
          if (first) { ctx.moveTo(p.x, p.y); first = false; }
          else { ctx.lineTo(p.x, p.y); }
        }
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.ellipse(cx, cy, R, R * 0.92, 0, 0, Math.PI * 2);
      ctx.stroke();

      /* links as chords lifted toward the viewer */
      for (k = 0; k < links.length; k++) {
        var L = links[k];
        var pa = project(nodes[L.a].lat, nodes[L.a].lon, rot, R, cx, cy);
        var pb = project(nodes[L.b].lat, nodes[L.b].lon, rot, R, cx, cy);
        if (pa.z < 0.05 || pb.z < 0.05) { continue; }
        var mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2 - R * 0.22;
        var vis = Math.min(pa.z, pb.z);
        ctx.strokeStyle = 'rgba(45, 212, 191, ' + (0.10 + vis * 0.16) + ')';
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.quadraticCurveTo(mx, my, pb.x, pb.y);
        ctx.stroke();
        /* packet */
        var pr = reduced() ? L.phase : ((t * 0.00025 + L.phase) % 1);
        var q = 1 - pr;
        var px = q * q * pa.x + 2 * q * pr * mx + pr * pr * pb.x;
        var py = q * q * pa.y + 2 * q * pr * my + pr * pr * pb.y;
        ctx.fillStyle = 'rgba(45, 212, 191, ' + (0.35 + vis * 0.5) + ')';
        ctx.beginPath();
        ctx.arc(px, py, 2, 0, Math.PI * 2);
        ctx.fill();
      }

      /* nodes */
      for (k = 0; k < nodes.length; k++) {
        var pn = project(nodes[k].lat, nodes[k].lon, rot, R, cx, cy);
        if (pn.z < 0) { continue; }
        ctx.fillStyle = 'rgba(148, 163, 184, ' + (0.25 + pn.z * 0.55) + ')';
        ctx.beginPath();
        ctx.arc(pn.x, pn.y, 1.6 + pn.z * 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (reduced()) {
      draw(0);
      onScreen(canvas, function () { draw(0); });
      return;
    }
    var loop = makeLoop(function (t) { draw(t); });
    onScreen(canvas, function () { loop.start(); }, function () { loop.stop(); });
  }

  /* ==========================================================================
     01 — BIG PICTURE: the laptop → server chain with ambient traffic
     and a narrated request/response round trip.
     ========================================================================== */

  function initBigPicture() {
    var canvas = $('#net-big-canvas');
    if (!canvas) { return; }
    var cv = setupCanvas(canvas);
    var ctx = cv.ctx, st = cv.state;
    var statusEl = $('#net-big-status');
    var btn = $('#net-big-send');

    var HOPS = [
      { label: 'Laptop', icon: 'device' },
      { label: 'Home router', icon: 'router' },
      { label: 'ISP', icon: 'cloudlet' },
      { label: 'Regional network', icon: 'cloudlet' },
      { label: 'Backbone', icon: 'fiber' },
      { label: 'Cloud provider', icon: 'cloudlet' },
      { label: 'Server', icon: 'server' }
    ];
    var NARRATE = [
      'Your laptop hands the packet to Wi-Fi.',
      'The home router forwards it to your ISP.',
      'Your ISP carries it to a regional exchange.',
      'A regional network hands it to a backbone carrier.',
      'Long-haul fiber crosses the country (or an ocean).',
      'The cloud provider’s network takes over.',
      'The server receives the request — response heads back.'
    ];

    /* story: null | { dir: 1|-1, hop: float } */
    var story = null;
    var ambient = [];
    var rng = makeRng(8080);
    var i;
    for (i = 0; i < 9; i++) {
      ambient.push({ p: rng() * 6, v: 0.4 + rng() * 0.7, dir: rng() > 0.5 ? 1 : -1, lane: rng() });
    }

    function pos(hop) {
      var pad = 46;
      var x = pad + (st.w - pad * 2) * (hop / (HOPS.length - 1));
      return { x: x, y: st.h * 0.5 };
    }

    function drawIcon(x, y, kind, active) {
      ctx.strokeStyle = active ? C.teal : C.lineStrong;
      ctx.fillStyle = C.deep;
      ctx.lineWidth = active ? 2 : 1.4;
      ctx.beginPath();
      if (kind === 'device') { ctx.rect(x - 13, y - 9, 26, 16); }
      else if (kind === 'server') { ctx.rect(x - 11, y - 14, 22, 28); }
      else if (kind === 'router') { ctx.arc(x, y, 12, 0, Math.PI * 2); }
      else if (kind === 'fiber') { ctx.rect(x - 14, y - 6, 28, 12); }
      else { /* cloudlet */
        ctx.arc(x - 7, y + 2, 8, Math.PI * 0.5, Math.PI * 1.5);
        ctx.arc(x - 2, y - 6, 8, Math.PI * 0.8, Math.PI * 1.95);
        ctx.arc(x + 7, y + 2, 8, Math.PI * 1.5, Math.PI * 0.5);
        ctx.closePath();
      }
      ctx.fill();
      ctx.stroke();
    }

    function draw(t, dt) {
      var w = st.w, h = st.h;
      if (!w || !h) { return; }
      ctx.clearRect(0, 0, w, h);

      var y = h * 0.5;
      ctx.strokeStyle = C.line;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pos(0).x, y);
      ctx.lineTo(pos(HOPS.length - 1).x, y);
      ctx.stroke();

      /* ambient packets */
      if (!reduced()) {
        ambient.forEach(function (p) {
          p.p += p.dir * p.v * dt * 0.001;
          if (p.p > 6.2) { p.p = -0.2; }
          if (p.p < -0.2) { p.p = 6.2; }
          var a = pos(clamp(p.p, 0, 6));
          ctx.fillStyle = 'rgba(100, 116, 139, 0.5)';
          ctx.beginPath();
          ctx.arc(a.x, a.y + (p.lane - 0.5) * 10, 1.8, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      var activeHop = story ? Math.round(clamp(story.hop, 0, 6)) : -1;

      HOPS.forEach(function (hopDef, idx) {
        var p = pos(idx);
        drawIcon(p.x, p.y, hopDef.icon, idx === activeHop);
        ctx.fillStyle = idx === activeHop ? C.strong : C.muted;
        ctx.font = '600 ' + (w < 560 ? 9 : 11) + 'px Inter, sans-serif';
        ctx.textAlign = 'center';
        var words = hopDef.label.split(' ');
        words.forEach(function (word, wi) {
          ctx.fillText(word, p.x, p.y + 32 + wi * 12);
        });
      });

      if (story) {
        story.hop += story.dir * dt * 0.0016;
        if (story.dir === 1 && story.hop >= 6) { story = { dir: -1, hop: 6 }; setStatus(statusEl, NARRATE[6]); }
        else if (story.dir === -1 && story.hop <= 0) {
          story = null;
          setStatus(statusEl, 'Response delivered. Round trip complete — typically 20–300 ms.', 'ok');
          if (btn) { btn.disabled = false; }
        }
        if (story) {
          if (story.dir === 1) {
            var n = Math.floor(clamp(story.hop, 0, 5.99));
            setStatus(statusEl, NARRATE[n]);
          }
          var pp = pos(clamp(story.hop, 0, 6));
          ctx.fillStyle = story.dir === 1 ? C.sky : C.teal;
          ctx.shadowColor = ctx.fillStyle;
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.arc(pp.x, pp.y, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }
    }

    var loop = makeLoop(draw);

    if (btn) {
      btn.addEventListener('click', function () {
        if (reduced()) {
          setStatus(statusEl, 'Request crossed all 7 stages and the response returned — typically 20–300 ms round trip.', 'ok');
          draw(0, 0);
          return;
        }
        story = { dir: 1, hop: 0 };
        btn.disabled = true;
        loop.start();
      });
    }

    if (reduced()) {
      draw(0, 0);
      onScreen(canvas, function () { draw(0, 0); });
    } else {
      onScreen(canvas, function () { loop.start(); }, function () { loop.stop(); });
    }
  }

  /* ==========================================================================
     02 — DNS walkthrough + record inspector
     ========================================================================== */

  function initDns() {
    var stage = $('#net-dns-stage');
    if (!stage) { return; }
    var log = $('#net-dns-log');
    var playBtn = $('#net-dns-play'), stepBtn = $('#net-dns-step'), resetBtn = $('#net-dns-reset');
    var cachedBox = $('#net-dns-cached');
    var nodes = {};
    $$('[data-dns-node]', stage).forEach(function (n) { nodes[n.getAttribute('data-dns-node')] = n; });

    var FULL = [
      { at: 'browser', text: 'You ask for www.google.com. The browser checks its own cache — nothing. It asks the recursive resolver.' },
      { at: 'resolver', text: 'The resolver checks its cache — nothing. Time to walk the hierarchy, starting at the root.' },
      { at: 'root', text: 'Root server: “I don’t know www.google.com, but here are the servers for .com.”' },
      { at: 'tld', text: '.com TLD server: “I don’t know it either, but here are google.com’s authoritative servers.”' },
      { at: 'auth', text: 'Authoritative server: “www.google.com is at 142.250.72.196.” The actual answer, from the source.' },
      { at: 'resolver', text: 'The resolver caches the answer (respecting its TTL) and returns it to your browser.' },
      { at: 'browser', text: 'Your browser has the IP. Total: ~20–120 ms. Now the real connection can begin.' }
    ];
    var CACHED = [
      { at: 'browser', text: 'You ask for www.google.com. The browser checks its own cache — nothing recent. It asks the resolver.' },
      { at: 'resolver', text: 'Cache hit! The resolver answered this an hour ago and the TTL hasn’t expired.' },
      { at: 'browser', text: 'Answer returned in ~1–10 ms. The root, TLD, and authoritative servers were never bothered — this is the common case.' }
    ];

    var script = FULL, step = -1, timer = null;

    function reset() {
      if (timer) { clearInterval(timer); timer = null; }
      step = -1;
      script = (cachedBox && cachedBox.checked) ? CACHED : FULL;
      if (log) { log.innerHTML = ''; }
      Object.keys(nodes).forEach(function (k) { nodes[k].classList.remove('is-active', 'is-done'); });
      if (playBtn) { playBtn.disabled = false; }
    }

    function doStep() {
      if (step >= script.length - 1) { if (timer) { clearInterval(timer); timer = null; } if (playBtn) { playBtn.disabled = false; } return; }
      step++;
      var s = script[step];
      Object.keys(nodes).forEach(function (k) {
        nodes[k].classList.remove('is-active');
        if (nodes[k].classList.contains('was')) { nodes[k].classList.add('is-done'); }
      });
      if (nodes[s.at]) {
        nodes[s.at].classList.add('is-active', 'was');
        nodes[s.at].classList.remove('is-done');
      }
      if (log) {
        var li = document.createElement('li');
        li.textContent = s.text;
        log.appendChild(li);
      }
      if (step === script.length - 1 && timer) { clearInterval(timer); timer = null; if (playBtn) { playBtn.disabled = false; } }
    }

    if (playBtn) {
      playBtn.addEventListener('click', function () {
        reset();
        if (reduced()) { while (step < script.length - 1) { doStep(); } return; }
        playBtn.disabled = true;
        doStep();
        timer = setInterval(doStep, 1400);
      });
    }
    if (stepBtn) { stepBtn.addEventListener('click', function () { if (timer) { clearInterval(timer); timer = null; if (playBtn) { playBtn.disabled = false; } } doStep(); }); }
    if (resetBtn) { resetBtn.addEventListener('click', reset); }
    if (cachedBox) { cachedBox.addEventListener('change', reset); }
    reset();
  }

  function initRecords() {
    var out = $('#net-rr-out');
    if (!out) { return; }
    var RR = {
      A: {
        rec: '<span class="net-rr-name">example.com.</span>    300   IN   A      <span class="net-rr-val">93.184.215.14</span>',
        why: 'The workhorse: maps a name to an IPv4 address. The 300 is the TTL — caches may keep this answer for 300 seconds.'
      },
      AAAA: {
        rec: '<span class="net-rr-name">example.com.</span>    300   IN   AAAA   <span class="net-rr-val">2606:2800:21f:cb07:6820:80da:af6b:8b2c</span>',
        why: 'The IPv6 twin of the A record. Modern clients ask for both and race the connections (“happy eyeballs”).'
      },
      CNAME: {
        rec: '<span class="net-rr-name">www.example.com.</span> 3600  IN   CNAME  <span class="net-rr-val">example.cdn-provider.net.</span>',
        why: 'An alias: “this name is really that name.” This is how a site hands its traffic to a CDN — the lookup continues at the target.'
      },
      MX: {
        rec: '<span class="net-rr-name">example.com.</span>    3600  IN   MX     <span class="net-rr-val">10 mail.example.com.</span>',
        why: 'Where email for @example.com should be delivered, with a priority number. Proof that DNS serves more than the Web.'
      },
      TXT: {
        rec: '<span class="net-rr-name">example.com.</span>    3600  IN   TXT    <span class="net-rr-val">"v=spf1 include:_spf.example.com ~all"</span>',
        why: 'Free-form text, used heavily for verification and email anti-spoofing policies (SPF, DKIM, DMARC).'
      },
      NS: {
        rec: '<span class="net-rr-name">example.com.</span>    86400 IN   NS     <span class="net-rr-val">ns1.example-dns.com.</span>',
        why: 'The delegation record: names the authoritative servers for this zone. This is the glue the root and TLD servers hand out.'
      }
    };
    var chips = $$('[data-net-rr]');
    function show(key) {
      var r = RR[key];
      if (!r) { return; }
      out.innerHTML = '<div>' + r.rec + '</div><p>' + r.why + '</p>';
      chips.forEach(function (c) { c.classList.toggle('is-active', c.getAttribute('data-net-rr') === key); });
    }
    chips.forEach(function (c) {
      c.addEventListener('click', function () { show(c.getAttribute('data-net-rr')); });
    });
    show('A');
  }

  /* ==========================================================================
     03 — IP inspector + NAT
     ========================================================================== */

  function initIp() {
    var out = $('#net-ip-out');
    if (!out) { return; }
    var binWrap = $('#net-ip-binwrap');
    var binEl = $('#net-ip-binary');
    var prefixEl = $('#net-ip-prefix');
    var prefixVal = $('#net-ip-prefixval');
    var statusEl = $('#net-ip-status');

    var ADDRS = {
      pub4: {
        addr: '142.250.72.196', v4: [142, 250, 72, 196], prefix: 24,
        tag: 'Public IPv4 · globally routable',
        why: 'A real-world-style public address. Routers across the Internet know how to move packets toward its network — this is the kind of answer DNS returned for www.google.com.'
      },
      priv4: {
        addr: '192.168.1.42', v4: [192, 168, 1, 42], prefix: 24,
        tag: 'Private IPv4 · not routable on the Internet',
        why: 'Reserved for private networks (RFC 1918: 10.x.x.x, 172.16–31.x.x, 192.168.x.x). Millions of homes use this exact address at once — it only has to be unique inside your network. NAT translates it at the border.'
      },
      loop: {
        addr: '127.0.0.1', v4: [127, 0, 0, 1], prefix: 8,
        tag: 'Loopback · this machine itself',
        why: 'Never leaves your device: packets to 127.0.0.1 are delivered to the same machine. Developers know it as localhost.'
      },
      v6: {
        addr: '2607:f8b0:4009:0803:0000:0000:0000:200e',
        tag: 'Public IPv6 · 128 bits',
        why: 'Eight groups of 16 bits, usually abbreviated (2607:f8b0:4009:803::200e): leading zeros drop, one run of zero groups becomes “::”. The first 64 bits typically identify the network, the last 64 the device — so NAT isn’t needed; every device can have a real address.'
      }
    };

    var chips = $$('[data-net-ip]');
    var current = 'pub4';

    function renderBinary() {
      var a = ADDRS[current];
      if (!a.v4 || !binEl) { return; }
      var prefix = parseInt(prefixEl ? prefixEl.value : a.prefix, 10);
      if (prefixVal) { prefixVal.textContent = String(prefix); }
      var html = '';
      var bitIndex = 0;
      a.v4.forEach(function (oct, oi) {
        if (oi > 0) { html += '<span class="net-bit-dot">.</span>'; }
        var bits = ('00000000' + oct.toString(2)).slice(-8);
        var gi;
        for (gi = 0; gi < 8; gi++) {
          html += '<span class="net-bit' + (bitIndex < prefix ? ' is-net' : '') + '">' + bits[gi] + '</span>';
          bitIndex++;
        }
      });
      binEl.innerHTML = html;
      if (statusEl) {
        var hosts = Math.pow(2, 32 - prefix) - 2;
        statusEl.textContent = 'Network bits: ' + prefix + ' (blue) · host bits: ' + (32 - prefix) +
          ' → room for ' + (hosts > 0 ? hosts.toLocaleString('en-US') : '0') + ' devices on this network.';
      }
    }

    function show(key) {
      current = key;
      var a = ADDRS[key];
      out.innerHTML = '<div class="net-ip-addr">' + a.addr + '</div>' +
        '<p><strong>' + a.tag + '</strong></p><p>' + a.why + '</p>';
      chips.forEach(function (c) { c.classList.toggle('is-active', c.getAttribute('data-net-ip') === key); });
      if (binWrap) { binWrap.style.display = a.v4 ? '' : 'none'; }
      if (a.v4 && prefixEl) { prefixEl.value = String(a.prefix); }
      renderBinary();
    }

    chips.forEach(function (c) {
      c.addEventListener('click', function () { show(c.getAttribute('data-net-ip')); });
    });
    if (prefixEl) { prefixEl.addEventListener('input', renderBinary); }
    show('pub4');
  }

  function initNat() {
    var table = $('#net-nat-table');
    if (!table) { return; }
    var tbody = table.querySelector('tbody');
    var lan = $('#net-nat-lan');
    var sendBtn = $('#net-nat-send'), resetBtn = $('#net-nat-reset');

    var DEVICES = [
      { name: 'Laptop', ip: '192.168.1.42' },
      { name: 'Phone', ip: '192.168.1.87' },
      { name: 'TV', ip: '192.168.1.15' },
      { name: 'Console', ip: '192.168.1.103' }
    ];
    var DESTS = ['142.250.72.196:443', '151.101.1.140:443', '104.16.132.229:443', '13.107.42.14:443'];
    var PUBLIC = '203.0.113.7';
    var nextPort = 49152;
    var rng = makeRng(1918);

    if (lan) {
      DEVICES.forEach(function (d, i) {
        var div = document.createElement('div');
        div.className = 'net-nat-dev';
        div.setAttribute('data-nat-dev', String(i));
        div.textContent = d.name + ' · ' + d.ip;
        lan.appendChild(div);
      });
    }

    if (sendBtn) {
      sendBtn.addEventListener('click', function () {
        var di = Math.floor(rng() * DEVICES.length);
        var d = DEVICES[di];
        var srcPort = 50000 + Math.floor(rng() * 15000);
        var dest = DESTS[Math.floor(rng() * DESTS.length)];
        var pubPort = nextPort++;
        if (lan) {
          $$('.net-nat-dev', lan).forEach(function (el, i) { el.classList.toggle('is-active', i === di); });
        }
        var tr = document.createElement('tr');
        tr.innerHTML = '<td>' + d.ip + ':' + srcPort + '</td><td>' + PUBLIC + ':' + pubPort + '</td><td>' + dest + '</td>';
        if (tbody) {
          tbody.insertBefore(tr, tbody.firstChild);
          while (tbody.children.length > 6) { tbody.removeChild(tbody.lastChild); }
        }
      });
    }
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        if (tbody) { tbody.innerHTML = ''; }
        nextPort = 49152;
        if (lan) { $$('.net-nat-dev', lan).forEach(function (el) { el.classList.remove('is-active'); }); }
      });
    }
  }

  /* ==========================================================================
     04 — ROUTING playground: live graph, Dijkstra per hop, click-to-fail
     ========================================================================== */

  function initRoute() {
    var canvas = $('#net-route-canvas');
    if (!canvas) { return; }
    var cv = setupCanvas(canvas);
    var ctx = cv.ctx, st = cv.state;
    var statusEl = $('#net-route-status');
    var sendBtn = $('#net-route-send');
    var congBox = $('#net-route-congestion');
    var repairBtn = $('#net-route-repair');

    /* Node layout in unit space. 0 = home, last = data center. */
    var NODES = [
      { x: 0.05, y: 0.5, label: 'Home', fixed: true },
      { x: 0.22, y: 0.24, label: 'ISP A' },
      { x: 0.22, y: 0.74, label: 'ISP B' },
      { x: 0.42, y: 0.12, label: 'R1' },
      { x: 0.42, y: 0.45, label: 'R2' },
      { x: 0.42, y: 0.85, label: 'R3' },
      { x: 0.62, y: 0.25, label: 'R4' },
      { x: 0.62, y: 0.65, label: 'R5' },
      { x: 0.79, y: 0.45, label: 'Edge' },
      { x: 0.95, y: 0.5, label: 'Data center', fixed: true }
    ];
    /* [a, b, baseCost, fastPath] — fastPath edges get congested by the toggle */
    var EDGES = [
      [0, 1, 2, true], [0, 2, 3, false],
      [1, 3, 3, true], [1, 4, 4, false], [2, 4, 4, false], [2, 5, 3, false],
      [3, 6, 3, true], [4, 6, 4, false], [4, 7, 4, false], [5, 7, 3, false],
      [3, 4, 2, false], [4, 5, 2, false], [6, 7, 2, false],
      [6, 8, 3, true], [7, 8, 3, false], [8, 9, 2, true]
    ];
    var down = {};       /* nodeIndex -> true when failed */
    var packets = [];
    var streaming = false;
    var spawnAcc = 0;

    function edgeCost(e) {
      var c = e[2];
      if (congBox && congBox.checked && e[3]) { c += 6; }
      return c;
    }

    function neighbors(n) {
      var out = [];
      EDGES.forEach(function (e) {
        if (e[0] === n && !down[e[1]]) { out.push({ to: e[1], cost: edgeCost(e) }); }
        if (e[1] === n && !down[e[0]]) { out.push({ to: e[0], cost: edgeCost(e) }); }
      });
      return out;
    }

    /* Dijkstra from node n to the data center; returns next hop or -1. */
    function route(n) {
      var N = NODES.length, dist = [], prev = [], seen = [];
      var i;
      for (i = 0; i < N; i++) { dist.push(Infinity); prev.push(-1); seen.push(false); }
      dist[n] = 0;
      for (i = 0; i < N; i++) {
        var best = -1, bd = Infinity, j;
        for (j = 0; j < N; j++) { if (!seen[j] && dist[j] < bd) { bd = dist[j]; best = j; } }
        if (best === -1) { break; }
        seen[best] = true;
        neighbors(best).forEach(function (nb) {
          if (dist[best] + nb.cost < dist[nb.to]) {
            dist[nb.to] = dist[best] + nb.cost;
            prev[nb.to] = best;
          }
        });
      }
      if (!isFinite(dist[NODES.length - 1])) { return -1; }
      var cur = NODES.length - 1;
      while (prev[cur] !== n && prev[cur] !== -1) { cur = prev[cur]; }
      return prev[cur] === n ? cur : -1;
    }

    function px(n) { return { x: NODES[n].x * st.w, y: NODES[n].y * st.h }; }

    function spawn() {
      packets.push({ from: 0, to: route(0), p: 0, dead: false });
    }

    function draw(t, dt) {
      var w = st.w, h = st.h;
      if (!w || !h) { return; }
      ctx.clearRect(0, 0, w, h);

      EDGES.forEach(function (e) {
        var a = px(e[0]), b = px(e[1]);
        var isDown = down[e[0]] || down[e[1]];
        var congested = congBox && congBox.checked && e[3];
        ctx.strokeStyle = isDown ? 'rgba(51, 65, 85, 0.35)' : (congested ? 'rgba(217, 119, 6, 0.55)' : C.line);
        ctx.lineWidth = congested ? 3 : 1.5;
        ctx.setLineDash(isDown ? [3, 5] : []);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);
      });

      /* packets */
      if (!reduced()) {
        spawnAcc += dt;
        if (streaming && spawnAcc > 260) { spawnAcc = 0; spawn(); }
      }
      var alive = [];
      packets.forEach(function (pk) {
        if (pk.to === -1) {
          /* stranded: no route from current node */
          pk.dead = true;
          return;
        }
        pk.p += dt * 0.0028;
        if (pk.p >= 1) {
          pk.from = pk.to;
          if (pk.from === NODES.length - 1) { return; } /* arrived */
          pk.to = route(pk.from);
          pk.p = 0;
        }
        if (pk.to === -1) { pk.dead = true; return; }
        var a = px(pk.from), b = px(pk.to);
        var x = a.x + (b.x - a.x) * pk.p;
        var y = a.y + (b.y - a.y) * pk.p;
        ctx.fillStyle = C.sky;
        ctx.beginPath();
        ctx.arc(x, y, 3.2, 0, Math.PI * 2);
        ctx.fill();
        alive.push(pk);
      });
      packets = alive;

      NODES.forEach(function (n, i) {
        var p = px(i);
        var isDown = down[i];
        ctx.fillStyle = C.deep;
        ctx.strokeStyle = isDown ? C.rose : (n.fixed ? C.teal : C.lineStrong);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        if (n.fixed) { ctx.rect(p.x - 14, p.y - 12, 28, 24); }
        else { ctx.arc(p.x, p.y, 11, 0, Math.PI * 2); }
        ctx.fill();
        ctx.stroke();
        if (isDown) {
          ctx.strokeStyle = C.rose;
          ctx.beginPath();
          ctx.moveTo(p.x - 6, p.y - 6); ctx.lineTo(p.x + 6, p.y + 6);
          ctx.moveTo(p.x + 6, p.y - 6); ctx.lineTo(p.x - 6, p.y + 6);
          ctx.stroke();
        }
        ctx.fillStyle = isDown ? C.rose : C.muted;
        ctx.font = '600 10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(n.label, p.x, p.y + (n.fixed ? 26 : 24));
      });
    }

    var loop = makeLoop(draw);

    function report() {
      var hops = [], cur = 0, guard = 0;
      while (cur !== NODES.length - 1 && guard++ < 20) {
        var nx = route(cur);
        if (nx === -1) { setStatus(statusEl, 'No route available — the network is partitioned. Repair a router.', 'bad'); return; }
        hops.push(NODES[nx].label);
        cur = nx;
      }
      setStatus(statusEl, 'Current best path: Home → ' + hops.join(' → ') + ' (' + hops.length + ' hops).');
    }

    canvas.addEventListener('click', function (ev) {
      var rect = canvas.getBoundingClientRect();
      var mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
      var i;
      for (i = 1; i < NODES.length - 1; i++) {
        var p = px(i);
        if ((mx - p.x) * (mx - p.x) + (my - p.y) * (my - p.y) < 18 * 18) {
          down[i] = !down[i];
          report();
          if (reduced()) { draw(0, 0); }
          return;
        }
      }
    });

    if (sendBtn) {
      sendBtn.addEventListener('click', function () {
        if (reduced()) {
          report();
          draw(0, 0);
          return;
        }
        streaming = !streaming;
        sendBtn.textContent = streaming ? 'Stop streaming' : 'Stream packets';
        if (streaming) { loop.start(); report(); }
      });
    }
    if (congBox) { congBox.addEventListener('change', function () { report(); if (reduced()) { draw(0, 0); } }); }
    if (repairBtn) {
      repairBtn.addEventListener('click', function () {
        down = {};
        report();
        if (reduced()) { draw(0, 0); }
      });
    }

    if (reduced()) {
      draw(0, 0);
      onScreen(canvas, function () { draw(0, 0); });
    } else {
      onScreen(canvas, function () { loop.start(); }, function () { loop.stop(); });
    }
    report();
  }

  /* ==========================================================================
     05 — PACKETS: slicing, scattering, reassembly, click-to-inspect
     ========================================================================== */

  function initPackets() {
    var canvas = $('#net-packet-canvas');
    if (!canvas) { return; }
    var cv = setupCanvas(canvas);
    var ctx = cv.ctx, st = cv.state;
    var replayBtn = $('#net-packet-replay');
    var inspect = $('#net-packet-inspect');
    var rng = makeRng(1500);

    var N = 12;
    var packets = [];
    var selected = -1;

    function makePackets() {
      packets = [];
      var i;
      for (i = 0; i < N; i++) {
        packets.push({
          seq: i,
          path: i % 3,                       /* which of 3 curved paths */
          delay: i * 260 + rng() * 500,      /* staggered departure */
          speed: 0.00035 + rng() * 0.00012,
          p: 0,
          arrived: false
        });
      }
      selected = -1;
      if (inspect) { inspect.hidden = true; }
    }

    function grid(side) {
      /* source page on the left, reassembly slots on the right */
      var gw = Math.min(st.w * 0.22, 120), gh = st.h * 0.6;
      var x = side === 0 ? st.w * 0.04 : st.w * 0.96 - gw;
      var y = (st.h - gh) / 2;
      return { x: x, y: y, w: gw, h: gh };
    }

    function cellRect(g, i) {
      var cols = 3, rows = 4;
      var cw = g.w / cols, ch = g.h / rows;
      return { x: g.x + (i % cols) * cw + 2, y: g.y + Math.floor(i / cols) * ch + 2, w: cw - 4, h: ch - 4 };
    }

    function pathPoint(pk, p) {
      var g0 = grid(0), g1 = grid(1);
      var x0 = g0.x + g0.w + 8, x1 = g1.x - 8;
      var midY = st.h * (0.18 + pk.path * 0.32);
      var y0 = st.h * 0.5, y1 = st.h * 0.5;
      var q = 1 - p;
      return {
        x: q * q * x0 + 2 * q * p * ((x0 + x1) / 2) + p * p * x1,
        y: q * q * y0 + 2 * q * p * midY + p * p * y1
      };
    }

    var startT = null;

    function draw(t) {
      var w = st.w, h = st.h;
      if (!w || !h) { return; }
      ctx.clearRect(0, 0, w, h);
      var g0 = grid(0), g1 = grid(1);

      /* the three paths */
      var pi;
      for (pi = 0; pi < 3; pi++) {
        ctx.strokeStyle = 'rgba(51, 65, 85, 0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        var s;
        for (s = 0; s <= 20; s++) {
          var pp = pathPoint({ path: pi }, s / 20);
          if (s === 0) { ctx.moveTo(pp.x, pp.y); } else { ctx.lineTo(pp.x, pp.y); }
        }
        ctx.stroke();
      }

      /* source + destination frames */
      [g0, g1].forEach(function (g, gi) {
        ctx.strokeStyle = C.lineStrong;
        ctx.lineWidth = 1.4;
        ctx.strokeRect(g.x - 4, g.y - 4, g.w + 8, g.h + 8);
        ctx.fillStyle = C.muted;
        ctx.font = '600 10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(gi === 0 ? 'The page (server)' : 'Reassembled (you)', g.x + g.w / 2, g.y - 12);
      });

      var elapsed = startT === null ? 0 : t - startT;
      var doneCount = 0;

      packets.forEach(function (pk, i) {
        var c0 = cellRect(g0, i), c1 = cellRect(g1, i);
        var local = elapsed - pk.delay;
        var p = reduced() ? 1 : clamp(local * pk.speed, 0, 1);
        if (reduced()) { pk.arrived = true; }
        else if (local <= 0) { p = 0; }
        pk.p = p;
        if (p >= 1) { pk.arrived = true; }
        if (pk.arrived) { doneCount++; }

        /* source cell empties once the packet departs */
        ctx.fillStyle = (p > 0 || pk.arrived) ? 'rgba(39, 52, 73, 0.4)' : C.free;
        ctx.fillRect(c0.x, c0.y, c0.w, c0.h);

        /* destination cell fills on arrival */
        if (pk.arrived) {
          ctx.fillStyle = 'rgba(13, 148, 136, 0.55)';
          ctx.fillRect(c1.x, c1.y, c1.w, c1.h);
          ctx.fillStyle = C.strong;
          ctx.font = '600 9px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(String(pk.seq), c1.x + c1.w / 2, c1.y + c1.h / 2 + 3);
        } else {
          ctx.fillStyle = C.free;
          ctx.fillRect(c1.x, c1.y, c1.w, c1.h);
        }

        /* in flight */
        if (p > 0 && p < 1) {
          var pt = pathPoint(pk, p);
          pk.fx = pt.x; pk.fy = pt.y;
          ctx.fillStyle = selected === i ? C.amber : C.sky;
          ctx.strokeStyle = C.deep;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.rect(pt.x - 8, pt.y - 6, 16, 12);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#fff';
          ctx.font = '700 8px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(String(pk.seq), pt.x, pt.y + 3);
        } else {
          pk.fx = null;
        }
      });

      ctx.fillStyle = C.faint;
      ctx.font = '600 10px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(doneCount + ' / ' + N + ' packets delivered — order restored by sequence number', w / 2, h - 10);

      if (!reduced() && doneCount >= N && loop.running()) { loop.stop(); }
    }

    var loop = makeLoop(function (t) { draw(t); });

    function replay() {
      makePackets();
      if (reduced()) { draw(0); return; }
      startT = performance.now();
      loop.stop();
      loop.start();
    }

    canvas.addEventListener('click', function (ev) {
      var rect = canvas.getBoundingClientRect();
      var mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
      var best = -1, bd = 22 * 22;
      packets.forEach(function (pk, i) {
        if (pk.fx == null) { return; }
        var d = (mx - pk.fx) * (mx - pk.fx) + (my - pk.fy) * (my - pk.fy);
        if (d < bd) { bd = d; best = i; }
      });
      if (best === -1) { return; }
      selected = best;
      var pk = packets[best];
      if (inspect) {
        inspect.hidden = false;
        inspect.innerHTML =
          '<div><span class="net-pk-k">Source IP:&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="net-pk-v">142.250.72.196 (the server)</span></div>' +
          '<div><span class="net-pk-k">Destination IP:&nbsp;</span><span class="net-pk-v">203.0.113.7 (your router’s public address)</span></div>' +
          '<div><span class="net-pk-k">Sequence #:&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="net-pk-v">' + pk.seq + ' of ' + N + '</span></div>' +
          '<div><span class="net-pk-k">Path taken:&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="net-pk-v">route ' + (pk.path + 1) + ' of 3</span></div>' +
          '<div><span class="net-pk-k">Payload:&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="net-pk-v">~1,460 bytes of the page (chunk ' + (pk.seq + 1) + ')</span></div>';
      }
    });

    if (replayBtn) { replayBtn.addEventListener('click', replay); }
    makePackets();
    if (reduced()) {
      draw(0);
      onScreen(canvas, function () { draw(0); });
    } else {
      onScreen(canvas, function () { if (startT === null) { replay(); } }, function () { loop.stop(); });
    }
  }

  /* ==========================================================================
     06 — TCP vs UDP lanes with genuine loss and retransmission
     ========================================================================== */

  function initProto() {
    var canvas = $('#net-proto-canvas');
    if (!canvas) { return; }
    var cv = setupCanvas(canvas);
    var ctx = cv.ctx, st = cv.state;
    var runBtn = $('#net-proto-run');
    var lossEl = $('#net-proto-loss'), lossVal = $('#net-proto-lossval');
    var statsEl = $('#net-proto-stats');
    var scenario = 'download';
    var rng = makeRng(768);

    var N = 12;
    var sim = null;

    function newSim() {
      var loss = (lossEl ? parseInt(lossEl.value, 10) : 20) / 100;
      function lane() {
        var pks = [], i;
        for (i = 0; i < N; i++) {
          pks.push({ seq: i, state: 'wait', p: 0, delay: i * 320, lost: rng() < loss, tries: 0 });
        }
        return { pks: pks, delivered: 0, retx: 0, lostFinal: 0, doneAt: null };
      }
      sim = { tcp: lane(), udp: lane(), t: 0 };
    }

    function laneY(which) { return which === 0 ? st.h * 0.28 : st.h * 0.72; }

    function stepLane(L, isTcp, dt) {
      L.pks.forEach(function (pk) {
        if (pk.state === 'done' || pk.state === 'gone') { return; }
        if (sim.t < pk.delay) { return; }
        if (pk.state === 'wait') { pk.state = 'fly'; pk.p = 0; }
        if (pk.state === 'fly') {
          pk.p += dt * 0.0009;
          if (pk.lost && pk.p >= 0.5) {
            /* drop mid-flight */
            if (isTcp) {
              pk.state = 'timeout';
              pk.timeoutAt = sim.t + 900; /* retransmission timer */
              L.retx++;
            } else {
              pk.state = 'gone';
              L.lostFinal++;
            }
            return;
          }
          if (pk.p >= 1) {
            pk.state = 'done';
            L.delivered++;
          }
        } else if (pk.state === 'timeout') {
          if (sim.t >= pk.timeoutAt) {
            pk.tries++;
            pk.lost = rng() < (lossEl ? parseInt(lossEl.value, 10) : 20) / 100 && pk.tries < 4;
            pk.state = 'fly';
            pk.p = 0;
          }
        }
      });
      var allSettled = L.pks.every(function (pk) { return pk.state === 'done' || pk.state === 'gone'; });
      if (allSettled && L.doneAt === null) { L.doneAt = sim.t; }
      return allSettled;
    }

    function drawLane(L, which, isTcp) {
      var y = laneY(which);
      var x0 = st.w * 0.14, x1 = st.w * 0.86;
      ctx.strokeStyle = C.line;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();

      ctx.fillStyle = isTcp ? C.cTeal : C.amber;
      ctx.font = '800 12px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(isTcp ? 'TCP' : 'UDP', st.w * 0.02, y + 4);
      ctx.fillStyle = C.faint;
      ctx.font = '600 9px Inter, sans-serif';
      ctx.fillText(isTcp ? 'reliable · ordered' : 'fast · best-effort', st.w * 0.02, y + 17);

      /* delivered strip */
      var slotW = Math.min(14, (st.w * 0.11) / N * 3);
      L.pks.forEach(function (pk, i) {
        var sx = x1 + 10 + (i % 4) * (slotW + 2);
        var sy = y - 18 + Math.floor(i / 4) * 12;
        if (pk.state === 'done') { ctx.fillStyle = isTcp ? C.cTeal : C.amber; }
        else if (pk.state === 'gone') { ctx.fillStyle = 'rgba(225, 29, 72, 0.55)'; }
        else { ctx.fillStyle = C.free; }
        ctx.fillRect(sx, sy, slotW, 9);
      });

      /* in flight */
      L.pks.forEach(function (pk) {
        if (pk.state !== 'fly') { return; }
        var x = x0 + (x1 - x0) * pk.p;
        ctx.fillStyle = pk.tries > 0 ? C.violet : (isTcp ? C.cTeal : C.amber);
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        if (pk.lost) {
          ctx.strokeStyle = 'rgba(225, 29, 72, 0.7)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(x0 + (x1 - x0) * 0.5, y, 9, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }

    function renderStats() {
      if (!statsEl || !sim) { return; }
      var t = sim.tcp, u = sim.udp;
      var tcpMsg, udpMsg;
      if (scenario === 'download') {
        tcpMsg = t.delivered === N ? 'file intact' : 'still completing…';
        udpMsg = u.lostFinal > 0 ? 'file corrupt — ' + u.lostFinal + ' chunks missing' : 'file intact (lucky)';
      } else {
        tcpMsg = t.retx > 0 ? 'call stutters — waiting on retransmits' : 'smooth (no loss)';
        udpMsg = u.lostFinal > 0 ? u.lostFinal + ' frames dropped — tiny glitch, call continues' : 'smooth';
      }
      statsEl.innerHTML =
        '<div class="net-stat is-tcp"><b>' + t.delivered + '/' + N + '</b><span>TCP delivered</span></div>' +
        '<div class="net-stat is-tcp"><b>' + t.retx + '</b><span>TCP retransmits</span></div>' +
        '<div class="net-stat is-tcp"><b>' + (t.doneAt !== null ? fmtMs(t.doneAt) : '…') + '</b><span>TCP finished · ' + tcpMsg + '</span></div>' +
        '<div class="net-stat is-udp"><b>' + u.delivered + '/' + N + '</b><span>UDP delivered</span></div>' +
        '<div class="net-stat is-udp"><b>' + u.lostFinal + '</b><span>UDP lost forever</span></div>' +
        '<div class="net-stat is-udp"><b>' + (u.doneAt !== null ? fmtMs(u.doneAt) : '…') + '</b><span>UDP finished · ' + udpMsg + '</span></div>';
    }

    function draw(t, dt) {
      var w = st.w, h = st.h;
      if (!w || !h || !sim) { return; }
      ctx.clearRect(0, 0, w, h);
      sim.t += dt;
      var d1 = stepLane(sim.tcp, true, dt);
      var d2 = stepLane(sim.udp, false, dt);
      drawLane(sim.tcp, 0, true);
      drawLane(sim.udp, 1, false);
      renderStats();
      if (d1 && d2) { loop.stop(); }
    }

    var loop = makeLoop(draw);

    function run() {
      newSim();
      if (reduced()) {
        /* settle instantly */
        var guard = 0;
        while (guard++ < 4000) {
          sim.t += 16;
          var a = stepLane(sim.tcp, true, 16);
          var b = stepLane(sim.udp, false, 16);
          if (a && b) { break; }
        }
        ctx.clearRect(0, 0, st.w, st.h);
        drawLane(sim.tcp, 0, true);
        drawLane(sim.udp, 1, false);
        renderStats();
        return;
      }
      loop.stop();
      loop.start();
    }

    if (lossEl) {
      lossEl.addEventListener('input', function () {
        if (lossVal) { lossVal.textContent = lossEl.value; }
      });
    }
    $$('[data-net-scenario]').forEach(function (c) {
      c.addEventListener('click', function () {
        scenario = c.getAttribute('data-net-scenario');
        $$('[data-net-scenario]').forEach(function (x) { x.classList.toggle('is-active', x === c); });
        renderStats();
      });
    });
    if (runBtn) { runBtn.addEventListener('click', run); }

    newSim();
    drawLane(sim.tcp, 0, true);
    drawLane(sim.udp, 1, false);
    renderStats();
    onScreen(canvas, function () {
      ctx.clearRect(0, 0, st.w, st.h);
      drawLane(sim.tcp, 0, true);
      drawLane(sim.udp, 1, false);
    });
  }

  /* ==========================================================================
     07 — TLS 1.3 handshake stepper
     ========================================================================== */

  function initTls() {
    var wire = $('#net-tls-wire');
    if (!wire) { return; }
    var log = $('#net-tls-log');
    var playBtn = $('#net-tls-play'), stepBtn = $('#net-tls-step'), resetBtn = $('#net-tls-reset');
    var client = $('#net-tls-client'), server = $('#net-tls-server');

    var STEPS = [
      { dir: 'to-server', msg: 'ClientHello · supported ciphers + key share', enc: false,
        log: 'Browser: “Hello — here are the encryption methods I speak, and here is my half of a key exchange.”' },
      { dir: 'to-client', msg: 'ServerHello · key share + certificate', enc: false,
        log: 'Server: “Here is my half of the key exchange” — and, already encrypted with the resulting key, its certificate.' },
      { dir: 'none', msg: '', enc: false,
        log: 'Browser verifies the certificate: signed by a certificate authority it trusts, valid dates, and issued for www.google.com. This is what defeats impostors.' },
      { dir: 'none', msg: '', enc: false,
        log: 'Both sides combine the two key shares and derive the same session keys — the secret never crossed the wire (see the Cryptography exhibit for the math).' },
      { dir: 'to-server', msg: 'Finished · encrypted', enc: true,
        log: 'Browser: “Finished” — proving it derived the same keys. The handshake took one round trip.' },
      { dir: 'to-server', msg: 'GET / HTTP/2 · encrypted', enc: true,
        log: 'The actual request finally goes out — unreadable to every router, ISP, and Wi-Fi snoop along the path.' },
      { dir: 'to-client', msg: '200 OK · encrypted HTML', enc: true,
        log: 'The page comes back encrypted. Connection secure: private, tamper-evident, and authenticated.' }
    ];

    var step = -1, timer = null, msgCount = 0;

    function reset() {
      if (timer) { clearInterval(timer); timer = null; }
      step = -1;
      msgCount = 0;
      wire.innerHTML = '';
      wire.classList.remove('is-secure');
      if (client) { client.classList.remove('is-secure'); }
      if (server) { server.classList.remove('is-secure'); }
      if (log) { log.innerHTML = ''; }
      if (playBtn) { playBtn.disabled = false; }
    }

    function doStep() {
      if (step >= STEPS.length - 1) { if (timer) { clearInterval(timer); timer = null; } if (playBtn) { playBtn.disabled = false; } return; }
      step++;
      var s = STEPS[step];
      if (s.dir !== 'none') {
        var div = document.createElement('div');
        div.className = 'net-tls-msg ' + s.dir + (s.enc ? ' is-enc' : '');
        div.style.top = (6 + msgCount * 19) + 'px';
        div.textContent = (s.dir === 'to-server' ? '→ ' : '← ') + s.msg;
        wire.appendChild(div);
        msgCount++;
      }
      if (step === 3) {
        wire.classList.add('is-secure');
        if (client) { client.classList.add('is-secure'); }
        if (server) { server.classList.add('is-secure'); }
      }
      if (log) {
        var li = document.createElement('li');
        li.textContent = s.log;
        if (s.dir === 'none') { li.className = 'is-note'; }
        log.appendChild(li);
      }
      if (step === STEPS.length - 1 && timer) { clearInterval(timer); timer = null; if (playBtn) { playBtn.disabled = false; } }
    }

    if (playBtn) {
      playBtn.addEventListener('click', function () {
        reset();
        if (reduced()) { while (step < STEPS.length - 1) { doStep(); } return; }
        playBtn.disabled = true;
        doStep();
        timer = setInterval(doStep, 1500);
      });
    }
    if (stepBtn) { stepBtn.addEventListener('click', function () { if (timer) { clearInterval(timer); timer = null; if (playBtn) { playBtn.disabled = false; } } doStep(); }); }
    if (resetBtn) { resetBtn.addEventListener('click', reset); }
    reset();
  }

  /* ==========================================================================
     Shared geo data (CDN map + simulator)
     ========================================================================== */

  var CITIES = {
    syd: { name: 'Sydney', lat: -33.87, lon: 151.21 },
    tok: { name: 'Tokyo', lat: 35.68, lon: 139.69 },
    lon: { name: 'London', lat: 51.5, lon: -0.13 },
    sao: { name: 'São Paulo', lat: -23.55, lon: -46.63 },
    joh: { name: 'Johannesburg', lat: -26.2, lon: 28.05 },
    nyc: { name: 'New York', lat: 40.71, lon: -74.0 },
    vir: { name: 'Virginia', lat: 39.04, lon: -77.49 },
    ore: { name: 'Oregon', lat: 45.5, lon: -122.7 },
    fra: { name: 'Frankfurt', lat: 50.11, lon: 8.68 },
    sin: { name: 'Singapore', lat: 1.35, lon: 103.82 }
  };
  var EDGE_KEYS = ['syd', 'tok', 'lon', 'sao', 'joh', 'nyc', 'fra', 'sin'];

  function mapXY(city, w, h) {
    return {
      x: (city.lon + 180) / 360 * w,
      y: (90 - city.lat) / 180 * h
    };
  }

  function drawMapBase(ctx, w, h) {
    /* graticule-style world backdrop: abstract, honest, no fake coastlines */
    ctx.strokeStyle = 'rgba(30, 41, 59, 0.9)';
    ctx.lineWidth = 1;
    var x, y;
    for (x = 0; x <= w; x += w / 12) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (y = 0; y <= h; y += h / 6) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    /* equator emphasis */
    ctx.strokeStyle = 'rgba(51, 65, 85, 0.9)';
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
  }

  function drawArc(ctx, a, b, color, progress) {
    var mx = (a.x + b.x) / 2, my = Math.min(a.y, b.y) - Math.abs(b.x - a.x) * 0.18 - 18;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(mx, my, b.x, b.y);
    ctx.stroke();
    if (progress != null) {
      var p = progress, q = 1 - p;
      var px = q * q * a.x + 2 * q * p * mx + p * p * b.x;
      var py = q * q * a.y + 2 * q * p * my + p * p * b.y;
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  /* ==========================================================================
     08 — CDN map
     ========================================================================== */

  function initCdn() {
    var canvas = $('#net-cdn-canvas');
    if (!canvas) { return; }
    var cv = setupCanvas(canvas);
    var ctx = cv.ctx, st = cv.state;
    var toggle = $('#net-cdn-toggle');
    var statsEl = $('#net-cdn-stats');
    var userKey = 'syd';

    function nearestEdge(key) {
      var user = CITIES[key];
      var best = null, bd = Infinity;
      EDGE_KEYS.forEach(function (ek) {
        var d = haversine(user, CITIES[ek]);
        if (d < bd) { bd = d; best = ek; }
      });
      return { key: best, km: bd };
    }

    function draw(t) {
      var w = st.w, h = st.h;
      if (!w || !h) { return; }
      ctx.clearRect(0, 0, w, h);
      drawMapBase(ctx, w, h);

      var useCdn = !toggle || toggle.checked;
      var user = CITIES[userKey];
      var origin = CITIES.vir;
      var up = mapXY(user, w, h);
      var op = mapXY(origin, w, h);

      /* edge nodes */
      EDGE_KEYS.forEach(function (ek) {
        var p = mapXY(CITIES[ek], w, h);
        ctx.fillStyle = useCdn ? 'rgba(101, 163, 13, 0.85)' : 'rgba(100, 116, 139, 0.4)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3.4, 0, Math.PI * 2);
        ctx.fill();
      });

      /* origin */
      ctx.fillStyle = C.amber;
      ctx.fillRect(op.x - 5, op.y - 5, 10, 10);
      ctx.fillStyle = C.muted;
      ctx.font = '600 10px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Origin (Virginia)', op.x, op.y - 10);

      var prog = reduced() ? null : (t % 1600) / 1600;

      var edge = nearestEdge(userKey);
      var target, targetPos, km;
      if (useCdn) {
        target = CITIES[edge.key];
        targetPos = mapXY(target, w, h);
        km = edge.km;
        drawArc(ctx, up, targetPos, C.lime, prog);
        /* faint path to origin for contrast */
        drawArc(ctx, up, op, 'rgba(51, 65, 85, 0.6)', null);
        if (edge.key !== userKey) {
          ctx.fillStyle = C.lime;
          ctx.font = '600 10px Inter, sans-serif';
          ctx.fillText('Edge: ' + target.name, targetPos.x, targetPos.y + 16);
        }
      } else {
        target = origin;
        km = haversine(user, origin);
        drawArc(ctx, up, op, C.amber, prog);
      }

      /* user */
      ctx.fillStyle = C.sky;
      ctx.shadowColor = C.sky;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(up.x, up.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = C.strong;
      ctx.font = '700 11px Inter, sans-serif';
      ctx.fillText('You · ' + user.name, up.x, up.y + 18);

      if (statsEl) {
        var rtt = rttFor(km);
        var pageLoad = rtt * 4; /* several round trips to load a page */
        var label = useCdn
          ? 'Via ' + (edge.key === userKey ? 'local edge' : CITIES[edge.key].name + ' edge') + ': ~' + Math.round(km).toLocaleString('en-US') + ' km · RTT ~' + fmtMs(rtt) + ' · cached assets load in ~' + fmtMs(pageLoad)
          : 'Direct to origin: ~' + Math.round(km).toLocaleString('en-US') + ' km · RTT ~' + fmtMs(rtt) + ' · assets load in ~' + fmtMs(pageLoad);
        setStatus(statsEl, label, useCdn ? 'ok' : undefined);
      }
    }

    var loop = makeLoop(function (t) { draw(t); });

    $$('[data-net-loc]').forEach(function (c) {
      c.addEventListener('click', function () {
        userKey = c.getAttribute('data-net-loc');
        $$('[data-net-loc]').forEach(function (x) { x.classList.toggle('is-active', x === c); });
        if (reduced()) { draw(0); }
      });
    });
    if (toggle) { toggle.addEventListener('change', function () { if (reduced()) { draw(0); } }); }

    if (reduced()) {
      draw(0);
      onScreen(canvas, function () { draw(0); });
    } else {
      onScreen(canvas, function () { loop.start(); }, function () { loop.stop(); });
    }
  }

  /* ==========================================================================
     09 — LOAD BALANCER simulation
     ========================================================================== */

  function initLb() {
    var canvas = $('#net-lb-canvas');
    if (!canvas) { return; }
    var cv = setupCanvas(canvas);
    var ctx = cv.ctx, st = cv.state;
    var trafficEl = $('#net-lb-traffic'), trafficVal = $('#net-lb-trafficval');
    var autoBox = $('#net-lb-autoscale');
    var killBtn = $('#net-lb-kill');
    var statsEl = $('#net-lb-stats');
    var rng = makeRng(443);

    var CAP = 60;                 /* req/s each server handles comfortably */
    var servers = [];             /* { load, health: 'up'|'down'|'booting', boot } */
    var i;
    for (i = 0; i < 3; i++) { servers.push({ load: 0, health: 'up', boot: 0 }); }
    var flying = [];              /* { x, y, tx, ty, sIdx, p, drop } */
    var dropped = 0, served = 0;
    var spawnAcc = 0, scaleAcc = 0, rrIndex = 0;

    function lbPos() { return { x: st.w * 0.38, y: st.h * 0.5 }; }
    function srvPos(idx, n) {
      var gap = Math.min(46, (st.h - 60) / Math.max(1, n));
      var y0 = st.h / 2 - ((n - 1) / 2) * gap;
      return { x: st.w * 0.78, y: y0 + idx * gap };
    }

    function pickServer() {
      var healthy = [];
      servers.forEach(function (s, idx) { if (s.health === 'up') { healthy.push(idx); } });
      if (!healthy.length) { return -1; }
      /* least-connections among healthy, round-robin tiebreak */
      var best = healthy[0], bl = Infinity;
      healthy.forEach(function (idx, k) {
        var l = servers[idx].load + ((k + rrIndex) % healthy.length) * 0.01;
        if (l < bl) { bl = l; best = idx; }
      });
      rrIndex++;
      return best;
    }

    function draw(t, dt) {
      var w = st.w, h = st.h;
      if (!w || !h) { return; }
      ctx.clearRect(0, 0, w, h);
      var rate = trafficEl ? parseInt(trafficEl.value, 10) : 40;
      var lb = lbPos();

      /* spawn requests */
      spawnAcc += dt * rate / 1000;
      while (spawnAcc >= 1) {
        spawnAcc -= 1;
        var sIdx = pickServer();
        var startY = h * (0.15 + rng() * 0.7);
        if (sIdx === -1) {
          flying.push({ x: w * 0.05, y: startY, sIdx: -1, p: 0, drop: true });
        } else {
          var s = servers[sIdx];
          var willDrop = s.load > CAP * 1.3;
          if (!willDrop) { s.load += 1; }
          flying.push({ x: w * 0.05, y: startY, sIdx: sIdx, p: 0, drop: willDrop });
        }
      }

      /* decay load (requests complete) */
      servers.forEach(function (s) {
        s.load = Math.max(0, s.load - dt * CAP / 1000);
        if (s.health === 'booting') {
          s.boot -= dt;
          if (s.boot <= 0) { s.health = 'up'; }
        }
      });

      /* autoscale check every 1.5 s */
      scaleAcc += dt;
      if (scaleAcc > 1500) {
        scaleAcc = 0;
        if (autoBox && autoBox.checked) {
          var up = servers.filter(function (s) { return s.health === 'up'; });
          var util = up.length ? up.reduce(function (a, s) { return a + s.load; }, 0) / (up.length * CAP) : 1;
          if (util > 0.8 && servers.length < 8) {
            servers.push({ load: 0, health: 'booting', boot: 2200 });
          } else if (util < 0.25 && up.length > 2) {
            for (var k = servers.length - 1; k >= 0; k--) {
              if (servers[k].health === 'up') { servers.splice(k, 1); break; }
            }
          }
        }
      }

      /* move requests */
      var alive = [];
      flying.forEach(function (f) {
        f.p += dt * 0.0022;
        var target = f.p < 0.5 ? lb : (f.sIdx >= 0 && f.sIdx < servers.length ? srvPos(f.sIdx, servers.length) : lb);
        var from = f.p < 0.5 ? { x: st.w * 0.05, y: f.y } : lb;
        var lp = f.p < 0.5 ? f.p * 2 : (f.p - 0.5) * 2;
        var x = from.x + (target.x - from.x) * lp;
        var y = from.y + (target.y - from.y) * lp;
        if (f.p >= 1) {
          if (f.drop) { dropped++; } else { served++; }
          return;
        }
        ctx.fillStyle = f.drop ? C.rose : C.sky;
        ctx.beginPath();
        ctx.arc(x, y, 2.4, 0, Math.PI * 2);
        ctx.fill();
        alive.push(f);
      });
      flying = alive;

      /* load balancer */
      ctx.fillStyle = C.deep;
      ctx.strokeStyle = C.teal;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(lb.x, lb.y - 26);
      ctx.lineTo(lb.x + 20, lb.y);
      ctx.lineTo(lb.x, lb.y + 26);
      ctx.lineTo(lb.x - 20, lb.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = C.strong;
      ctx.font = '600 10px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('LB', lb.x, lb.y + 4);

      /* servers */
      servers.forEach(function (s, idx) {
        var p = srvPos(idx, servers.length);
        var color = s.health === 'down' ? C.rose : (s.health === 'booting' ? C.amber : C.lineStrong);
        ctx.fillStyle = C.deep;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(p.x - 16, p.y - 12, 60, 24);
        /* load bar */
        var util = clamp(s.load / (CAP * 1.3), 0, 1);
        ctx.fillStyle = util > 0.85 ? C.rose : (util > 0.6 ? C.amber : C.cTeal);
        ctx.fillRect(p.x - 13, p.y - 4, 54 * (s.health === 'up' ? util : 0), 8);
        if (s.health === 'down') {
          ctx.fillStyle = C.rose;
          ctx.font = '600 9px Inter, sans-serif';
          ctx.fillText('down', p.x + 14, p.y + 3);
        } else if (s.health === 'booting') {
          ctx.fillStyle = C.amber;
          ctx.font = '600 9px Inter, sans-serif';
          ctx.fillText('booting', p.x + 14, p.y + 3);
        }
      });

      ctx.fillStyle = C.faint;
      ctx.font = '600 10px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('Users', w * 0.03, h * 0.08);

      if (statsEl) {
        var upCount = servers.filter(function (s) { return s.health === 'up'; }).length;
        setStatus(statsEl, upCount + ' healthy servers · ' + served.toLocaleString('en-US') + ' served · ' + dropped.toLocaleString('en-US') + ' dropped', dropped > served * 0.02 ? 'bad' : undefined);
      }
    }

    var loop = makeLoop(draw);

    if (trafficEl) {
      trafficEl.addEventListener('input', function () {
        if (trafficVal) { trafficVal.textContent = trafficEl.value; }
      });
    }
    if (killBtn) {
      killBtn.addEventListener('click', function () {
        var up = [];
        servers.forEach(function (s, idx) { if (s.health === 'up') { up.push(idx); } });
        if (up.length <= 1) { return; }
        var victim = servers[up[Math.floor(rng() * up.length)]];
        victim.health = 'down';
        victim.load = 0;
        setTimeout(function () {
          var k = servers.indexOf(victim);
          if (k !== -1) { servers.splice(k, 1); } /* health check removes it */
        }, 4000);
      });
    }

    if (reduced()) {
      /* static snapshot with a mid-level load */
      servers.forEach(function (s) { s.load = CAP * 0.5; });
      draw(0, 0);
      onScreen(canvas, function () { draw(0, 0); });
    } else {
      onScreen(canvas, function () { loop.start(); }, function () { loop.stop(); });
    }
  }

  /* ==========================================================================
     10 — DATA CENTER rack explorer
     ========================================================================== */

  function initDc() {
    var info = $('#net-dc-info');
    if (!info) { return; }
    var PARTS = {
      switch: {
        t: 'Top-of-rack switch',
        d: 'Every server in the rack plugs into this switch, which uplinks to the data center’s spine network. Inside a building, switches do the forwarding; routers take over between networks. Your request’s last hops run through two or three of these at multi-hundred-gigabit speeds.'
      },
      servers: {
        t: 'Servers',
        d: 'Flat “pizza box” machines — dozens per rack, tens of thousands per building. Each is an ordinary computer: CPUs, RAM, NICs. One of these actually ran the code that answered you. The CPU and Memory exhibits cover what happens inside.'
      },
      storage: {
        t: 'Storage',
        d: 'Dense shelves of SSDs and hard drives, often pooled into distributed file systems replicated across machines — so one dead drive (they die daily at this scale) loses nothing. Your cloud photos live on hardware like this.'
      },
      power: {
        t: 'Power',
        d: 'Redundant feeds, batteries for the seconds after a grid failure, and diesel generators for the hours beyond. Data centers are engineered so that no single electrical failure takes servers offline — measured against “five nines” availability targets.'
      },
      cooling: {
        t: 'Cooling',
        d: 'Every watt that enters leaves as heat. Cold air is forced through server fronts (hot-aisle/cold-aisle layouts), and cooling is a major share of a facility’s power bill — the reason operators chase cold climates, evaporative designs, and even liquid cooling.'
      },
      fiber: {
        t: 'Fiber',
        d: 'Bundles of optical fiber connect racks, buildings, and continents — including the ~1.5 million km of submarine cables that carry nearly all intercontinental traffic. Light pulses in glass, not satellites, are how your request crossed the ocean.'
      }
    };
    var chips = $$('[data-net-dc]');
    var svgParts = $$('#net-dc-svg [data-dc-part]');
    function show(key) {
      var p = PARTS[key];
      if (!p) { return; }
      info.innerHTML = '<b>' + p.t + '</b><p>' + p.d + '</p>';
      chips.forEach(function (c) { c.classList.toggle('is-active', c.getAttribute('data-net-dc') === key); });
      svgParts.forEach(function (s) { s.classList.toggle('is-active', s.getAttribute('data-dc-part') === key); });
    }
    chips.forEach(function (c) {
      c.addEventListener('click', function () { show(c.getAttribute('data-net-dc')); });
    });
    svgParts.forEach(function (s) {
      s.addEventListener('click', function () { show(s.getAttribute('data-dc-part')); });
    });
    show('switch');
  }

  /* ==========================================================================
     11 — BROWSER RENDERING pipeline
     ========================================================================== */

  function initRender() {
    var canvas = $('#net-render-canvas');
    if (!canvas) { return; }
    var cv = setupCanvas(canvas);
    var ctx = cv.ctx, st = cv.state;
    var playBtn = $('#net-render-play'), stepBtn = $('#net-render-step'), resetBtn = $('#net-render-reset');
    var statusEl = $('#net-render-status');
    var stageEls = $$('#net-render-stages li');

    var DESCS = [
      'Parse: the HTML text stream becomes the DOM — a tree of elements the browser can work with.',
      'Style: CSS rules are parsed and matched against the tree; every element learns its colors, fonts, sizes.',
      'Script: JavaScript runs on the CPU — here it injects an extra element and registers event handlers.',
      'Layout: the browser computes exact positions and sizes for every box on the page.',
      'Paint: each box is rasterized — text glyphs, borders, images become actual pixels in layers.',
      'Composite: the GPU blends the painted layers and puts the frame on screen — ideally 60+ times per second.'
    ];

    var stage = -1, timer = null;

    /* mini page geometry in unit space */
    function boxes(includeJs) {
      var b = [
        { x: 0.06, y: 0.08, w: 0.88, h: 0.14, color: 'rgba(45, 212, 191, 0.35)', label: 'header' },
        { x: 0.06, y: 0.28, w: 0.55, h: 0.5, color: 'rgba(2, 132, 199, 0.3)', label: 'article' },
        { x: 0.66, y: 0.28, w: 0.28, h: 0.5, color: 'rgba(139, 92, 246, 0.3)', label: 'aside' },
        { x: 0.06, y: 0.84, w: 0.88, h: 0.1, color: 'rgba(100, 116, 139, 0.35)', label: 'footer' }
      ];
      if (includeJs) {
        b.splice(3, 0, { x: 0.66, y: 0.62, w: 0.28, h: 0.16, color: 'rgba(217, 119, 6, 0.4)', label: 'widget (JS)' });
      }
      return b;
    }

    function draw() {
      var w = st.w, h = st.h;
      if (!w || !h) { return; }
      ctx.clearRect(0, 0, w, h);

      /* browser frame */
      var fx = w * 0.18, fy = h * 0.06, fw = w * 0.64, fh = h * 0.86;
      ctx.strokeStyle = C.lineStrong;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(fx, fy, fw, fh);
      ctx.fillStyle = C.free;
      ctx.fillRect(fx, fy, fw, h * 0.055);
      ctx.fillStyle = C.faint;
      ctx.font = '600 9px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('● ● ●   https://www.google.com', fx + 8, fy + h * 0.037);
      var py = fy + h * 0.055;
      var ph = fh - h * 0.055;

      if (stage < 0) {
        ctx.fillStyle = C.faint;
        ctx.font = '600 11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('HTML received — press Play', fx + fw / 2, py + ph / 2);
        return;
      }

      var bs = boxes(stage >= 2);
      bs.forEach(function (b, i) {
        var bx, by, bw, bh;
        if (stage < 3) {
          /* before layout: stacked in document order */
          bx = fx + fw * 0.08;
          bw = fw * 0.84;
          bh = ph * 0.13;
          by = py + ph * 0.05 + i * ph * 0.17;
        } else {
          bx = fx + fw * b.x;
          by = py + ph * b.y;
          bw = fw * b.w;
          bh = ph * b.h;
        }
        if (stage >= 4) {
          ctx.fillStyle = b.color;
          ctx.fillRect(bx, by, bw, bh);
          /* text lines */
          ctx.strokeStyle = 'rgba(241, 245, 249, 0.35)';
          ctx.lineWidth = 2;
          var ly;
          for (ly = by + 8; ly < by + bh - 6 && ly < by + 40; ly += 8) {
            ctx.beginPath();
            ctx.moveTo(bx + 6, ly);
            ctx.lineTo(bx + bw * 0.6, ly);
            ctx.stroke();
          }
        }
        ctx.strokeStyle = stage >= 1 ? b.color.replace(/[\d.]+\)$/, '0.9)') : C.lineStrong;
        ctx.lineWidth = 1.2;
        ctx.setLineDash(stage >= 3 ? [] : [4, 3]);
        ctx.strokeRect(bx, by, bw, bh);
        ctx.setLineDash([]);
        ctx.fillStyle = stage >= 1 ? C.text : C.faint;
        ctx.font = '600 9px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('<' + b.label + '>', bx + 4, by - 3 > py ? by - 3 : by + 10);
      });

      if (stage >= 5) {
        /* composite sheen */
        ctx.fillStyle = 'rgba(45, 212, 191, 0.06)';
        ctx.fillRect(fx, py, fw, ph);
        ctx.fillStyle = C.teal;
        ctx.font = '700 10px Inter, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('60 fps ✓ (GPU)', fx + fw - 8, fy + fh - 8);
      }
    }

    function apply() {
      stageEls.forEach(function (el) {
        var s = parseInt(el.getAttribute('data-stage'), 10);
        el.classList.toggle('is-active', s === stage);
        el.classList.toggle('is-done', s < stage);
      });
      setStatus(statusEl, stage >= 0 ? DESCS[stage] : 'Response received: a stream of HTML text.');
      draw();
    }

    function doStep() {
      if (stage >= 5) { if (timer) { clearInterval(timer); timer = null; } if (playBtn) { playBtn.disabled = false; } return; }
      stage++;
      apply();
      if (stage >= 5 && timer) { clearInterval(timer); timer = null; if (playBtn) { playBtn.disabled = false; } }
    }

    function reset() {
      if (timer) { clearInterval(timer); timer = null; }
      stage = -1;
      if (playBtn) { playBtn.disabled = false; }
      apply();
    }

    if (playBtn) {
      playBtn.addEventListener('click', function () {
        reset();
        if (reduced()) { while (stage < 5) { doStep(); } return; }
        playBtn.disabled = true;
        doStep();
        timer = setInterval(doStep, 1600);
      });
    }
    if (stepBtn) { stepBtn.addEventListener('click', function () { if (timer) { clearInterval(timer); timer = null; if (playBtn) { playBtn.disabled = false; } } doStep(); }); }
    if (resetBtn) { resetBtn.addEventListener('click', reset); }
    onScreen(canvas, draw);
    reset();
  }

  /* ==========================================================================
     12 — SPEED dashboard
     ========================================================================== */

  function initSpeed() {
    var waterfall = $('#net-sp-waterfall');
    if (!waterfall) { return; }
    var totalEl = $('#net-sp-total');
    var els = {
      distance: $('#net-sp-distance'), server: $('#net-sp-server'),
      img: $('#net-sp-img'), js: $('#net-sp-js'), bw: $('#net-sp-bw'),
      cdn: $('#net-sp-cdn'), compress: $('#net-sp-compress'), cache: $('#net-sp-cache')
    };
    var vals = {
      distance: $('#net-sp-distanceval'), server: $('#net-sp-serverval'),
      img: $('#net-sp-imgval'), js: $('#net-sp-jsval'), bw: $('#net-sp-bwval')
    };

    function num(el, d) { return el ? parseFloat(el.value) : d; }
    function on(el) { return !!(el && el.checked); }

    function compute() {
      var distance = num(els.distance, 8000);
      var serverMs = num(els.server, 200);
      var imgMB = num(els.img, 2);
      var jsMB = num(els.js, 1);
      var bw = num(els.bw, 25);
      var cdn = on(els.cdn), compress = on(els.compress), cache = on(els.cache);

      if (vals.distance) { vals.distance.textContent = Math.round(distance).toLocaleString('en-US'); }
      if (vals.server) { vals.server.textContent = String(Math.round(serverMs)); }
      if (vals.img) { vals.img.textContent = imgMB.toFixed(2).replace(/0$/, ''); }
      if (vals.js) { vals.js.textContent = jsMB.toFixed(2).replace(/0$/, ''); }
      if (vals.bw) { vals.bw.textContent = String(Math.round(bw)); }

      /* static assets come from nearby edge when CDN is on; HTML still hits origin */
      var rttOrigin = rttFor(distance);
      var rttAssets = cdn ? rttFor(300) : rttOrigin;

      var dns = cache ? 2 : rttFor(cdn ? 300 : Math.min(distance, 3000)) * 1.2;
      var connect = rttOrigin;                       /* TCP handshake to origin */
      var tls = cache ? rttOrigin : rttOrigin;       /* TLS 1.3: 1 RTT */
      var serverWait = rttOrigin + serverMs;         /* request + think time */

      var htmlKB = 100;
      var textFactor = compress ? 0.3 : 1;
      var imgFactor = compress ? 0.55 : 1;
      var bytesMB = htmlKB / 1024 * textFactor + imgMB * imgFactor + jsMB * textFactor;
      if (cache) { bytesMB *= 0.15; }                /* most assets revalidated, not re-fetched */
      var download = bytesMB * 8 / bw * 1000 + Math.ceil(bytesMB / 0.5) * rttAssets * 0.35;

      var render = 120 + jsMB * 350 * (cache ? 0.7 : 1);

      var rows = [
        { label: 'DNS lookup', ms: dns, color: C.amber },
        { label: 'TCP connect', ms: connect, color: C.sky },
        { label: 'TLS handshake', ms: tls, color: C.violet },
        { label: 'Server response', ms: serverWait, color: C.rose },
        { label: 'Content download', ms: download, color: C.cTeal },
        { label: 'Parse & render', ms: render, color: C.lime }
      ];
      var total = rows.reduce(function (a, r) { return a + r.ms; }, 0);
      var max = Math.max.apply(null, rows.map(function (r) { return r.ms; }));

      waterfall.innerHTML = rows.map(function (r) {
        var pct = Math.max(1.5, r.ms / max * 100);
        return '<div class="net-sp-row"><span>' + r.label + '</span>' +
          '<span class="net-sp-barwrap"><span class="net-sp-bar" style="width:' + pct.toFixed(1) + '%;background:' + r.color + '"></span></span>' +
          '<span class="net-sp-ms">' + fmtMs(r.ms) + '</span></div>';
      }).join('');

      if (totalEl) {
        var cls = total < 1000 ? 'is-fast' : (total < 3000 ? 'is-slow' : 'is-bad');
        var verdict = total < 1000 ? 'feels instant' : (total < 3000 ? 'noticeably slow' : 'visitors are leaving');
        totalEl.innerHTML = 'Estimated page load<b class="' + cls + '">' + fmtMs(total) + '</b>' + verdict;
      }
    }

    Object.keys(els).forEach(function (k) {
      if (els[k]) { els[k].addEventListener('input', compute); els[k].addEventListener('change', compute); }
    });
    compute();
  }

  /* ==========================================================================
     13 — REAL-WORLD JOURNEY itineraries
     ========================================================================== */

  function initJourney() {
    var out = $('#net-journey-out');
    if (!out) { return; }

    var U = true, V = false;
    var COMMON_HEAD = [
      { u: U, t: 'DNS lookup', d: 'Your resolver finds the site’s IP — for big services, DNS itself often answers from a nearby anycast location.' },
      { u: U, t: 'Routing', d: 'Packets hop across your ISP, exchange points, and backbone fiber toward the announced network.' },
      { u: U, t: 'TLS handshake', d: 'Certificate verified, session keys derived; everything beyond this line is encrypted.' }
    ];
    var COMMON_TAIL = [
      { u: U, t: 'Response & render', d: 'The reply crosses the same Internet back to you, and your browser runs the rendering pipeline from chapter 11.' }
    ];

    function j(mid) { return COMMON_HEAD.concat(mid, COMMON_TAIL); }

    var DESTS = {
      search: j([
        { u: V, t: 'Anycast front door', d: 'The same IP is announced from many cities; routing delivers you to the nearest front-end point of presence.' },
        { u: V, t: 'Load balancing', d: 'Front-end balancers pick a healthy backend cluster, possibly in another region.' },
        { u: V, t: 'Query serving', d: 'A fan-out across index shards ranks results — an AI-heavy workload — and the page is assembled in tens of milliseconds.' }
      ]),
      wiki: j([
        { u: V, t: 'CDN cache layer', d: 'Wikipedia serves most page views from caching data centers; a popular article rarely touches the core.' },
        { u: V, t: 'Application servers', d: 'On a cache miss, MediaWiki renders the article from the database, then the caches keep it.' }
      ]),
      github: j([
        { u: V, t: 'Edge & load balancers', d: 'Requests land on front-end proxies and balancers guarding the application fleet.' },
        { u: V, t: 'Application + Git storage', d: 'Web requests hit app servers backed by databases; repository data lives in replicated Git storage clusters.' }
      ]),
      netflix: j([
        { u: V, t: 'API via cloud', d: 'Browsing, search, and “what to watch” recommendations run on cloud-hosted microservices.' },
        { u: V, t: 'Video from the edge', d: 'The video itself streams from CDN appliances installed inside ISPs — often without crossing the backbone at all. This split (small dynamic API + huge static video) is the CDN chapter in production.' }
      ]),
      amazon: j([
        { u: V, t: 'CDN for the shell', d: 'Images, scripts, and styles come from edge locations near you.' },
        { u: V, t: 'Microservice fan-out', d: 'One page view fans out to many internal services — pricing, inventory, recommendations — each load-balanced across fleets.' }
      ]),
      ms: j([
        { u: V, t: 'Global front door', d: 'Traffic enters a worldwide edge network and rides the provider’s private backbone toward the right region.' },
        { u: V, t: 'Regional services', d: 'The request terminates in a region chosen for latency and data residency — the geography story from the data-center chapter.' }
      ]),
      cf: j([
        { u: V, t: 'Every edge runs everything', d: 'Anycast delivers you to the nearest of hundreds of cities; that edge can serve the cache, run security filtering, and execute code.' },
        { u: V, t: 'Origin only if needed', d: 'Only cache misses and dynamic calls continue to the customer’s origin server — the edge handles the rest.' }
      ])
    };

    var chips = $$('[data-net-dest]');
    function show(key) {
      var steps = DESTS[key];
      if (!steps) { return; }
      out.innerHTML = steps.map(function (s) {
        return '<li class="' + (s.u ? 'is-universal' : 'is-varies') + '"><i>' + (s.u ? 'universal' : 'varies') + '</i><b>' + s.t + '</b><span>' + s.d + '</span></li>';
      }).join('');
      chips.forEach(function (c) { c.classList.toggle('is-active', c.getAttribute('data-net-dest') === key); });
    }
    chips.forEach(function (c) {
      c.addEventListener('click', function () { show(c.getAttribute('data-net-dest')); });
    });
    show('search');
  }

  /* ==========================================================================
     15 — THE REQUEST SIMULATOR
     ========================================================================== */

  function initSim() {
    var canvas = $('#net-sim-canvas');
    if (!canvas) { return; }
    var cv = setupCanvas(canvas);
    var ctx = cv.ctx, st = cv.state;
    var log = $('#net-sim-log');
    var metrics = $('#net-sim-metrics');
    var sendBtn = $('#net-sim-send');

    var els = {
      user: $('#net-sim-user'), origin: $('#net-sim-origin'), proto: $('#net-sim-proto'),
      cdn: $('#net-sim-cdn'), dnscache: $('#net-sim-dnscache'),
      loss: $('#net-sim-loss'), congestion: $('#net-sim-congestion'),
      bw: $('#net-sim-bw'), users: $('#net-sim-users')
    };
    var vals = {
      loss: $('#net-sim-lossval'), congestion: $('#net-sim-congestionval'),
      bw: $('#net-sim-bwval'), users: $('#net-sim-usersval')
    };
    ['loss', 'congestion', 'bw'].forEach(function (k) {
      if (els[k]) {
        els[k].addEventListener('input', function () { if (vals[k]) { vals[k].textContent = els[k].value; } });
      }
    });
    if (els.users) {
      els.users.addEventListener('input', function () {
        if (vals.users) { vals.users.textContent = parseInt(els.users.value, 10).toLocaleString('en-US'); }
      });
    }

    var anim = null; /* { from, to, color, label } during staged playback */
    var timers = [];

    function clearTimers() { timers.forEach(clearTimeout); timers = []; }

    function drawScene() {
      var w = st.w, h = st.h;
      if (!w || !h) { return; }
      ctx.clearRect(0, 0, w, h);
      drawMapBase(ctx, w, h);

      var userKey = els.user ? els.user.value : 'syd';
      var originKey = els.origin ? els.origin.value : 'vir';
      var user = CITIES[userKey], origin = CITIES[originKey];
      var up = mapXY(user, w, h), op = mapXY(origin, w, h);

      var useCdn = els.cdn && els.cdn.checked;
      var edgeKey = null;
      if (useCdn) {
        var bd = Infinity;
        EDGE_KEYS.forEach(function (ek) {
          var d = haversine(user, CITIES[ek]);
          if (d < bd) { bd = d; edgeKey = ek; }
        });
      }

      if (edgeKey) {
        var ep = mapXY(CITIES[edgeKey], w, h);
        ctx.fillStyle = C.lime;
        ctx.beginPath();
        ctx.arc(ep.x, ep.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = C.muted;
        ctx.font = '600 9px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Edge · ' + CITIES[edgeKey].name, ep.x, ep.y - 8);
      }

      ctx.fillStyle = C.amber;
      ctx.fillRect(op.x - 5, op.y - 5, 10, 10);
      ctx.fillStyle = C.muted;
      ctx.font = '600 9px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Origin · ' + origin.name, op.x, op.y - 9);

      ctx.fillStyle = C.sky;
      ctx.beginPath();
      ctx.arc(up.x, up.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = C.strong;
      ctx.font = '700 10px Inter, sans-serif';
      ctx.fillText('You · ' + user.name, up.x, up.y + 16);

      if (anim) {
        var a = mapXY(anim.from, w, h), b = mapXY(anim.to, w, h);
        var p = reduced() ? 0.5 : ((performance.now() % 1100) / 1100);
        drawArc(ctx, a, b, anim.color, p);
        if (anim.label) {
          ctx.fillStyle = anim.color;
          ctx.font = '700 10px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(anim.label, w / 2, 16);
        }
      }
    }

    var loop = makeLoop(drawScene);

    function addLog(text, note) {
      if (!log) { return; }
      var li = document.createElement('li');
      li.textContent = text;
      if (note) { li.className = 'is-note'; }
      log.appendChild(li);
      log.scrollTop = log.scrollHeight;
    }

    function run() {
      clearTimers();
      if (log) { log.innerHTML = ''; }
      if (metrics) { metrics.hidden = true; }

      var userKey = els.user ? els.user.value : 'syd';
      var originKey = els.origin ? els.origin.value : 'vir';
      var user = CITIES[userKey], origin = CITIES[originKey];
      var https = !els.proto || els.proto.value === 'https';
      var useCdn = els.cdn && els.cdn.checked;
      var dnsCached = els.dnscache && els.dnscache.checked;
      var loss = (els.loss ? parseInt(els.loss.value, 10) : 1) / 100;
      var congestion = (els.congestion ? parseInt(els.congestion.value, 10) : 20) / 100;
      var bw = els.bw ? parseInt(els.bw.value, 10) : 50;
      var users = els.users ? parseInt(els.users.value, 10) : 1000;

      /* pick serving location */
      var edgeKey = null, bd = Infinity;
      if (useCdn) {
        EDGE_KEYS.forEach(function (ek) {
          var d = haversine(user, CITIES[ek]);
          if (d < bd) { bd = d; edgeKey = ek; }
        });
      }
      var serveCity = edgeKey ? CITIES[edgeKey] : origin;
      var kmServe = haversine(user, serveCity);
      var kmOrigin = haversine(user, origin);

      var congMult = 1 + congestion * 0.9;
      var rttServe = rttFor(kmServe) * congMult;
      var rttOrigin = rttFor(kmOrigin) * congMult;

      /* loss makes some round trips repeat (crude retransmission model) */
      var lossMult = 1 / Math.max(0.35, 1 - loss * 2.5);

      var tDns = dnsCached ? 2 : rttFor(Math.min(kmServe, 2500)) * congMult * 1.4;
      var tTcp = rttServe * lossMult;
      var tTls = https ? rttServe * lossMult : 0;
      /* server queueing: a fleet sized ~1 server / 2,000 users, degrading past 80% load */
      var capacity = Math.max(1, Math.ceil(users / 2000)) * 2400;
      var utilization = Math.min(0.97, users / Math.max(1, capacity));
      var tServer = (40 + 60 * utilization / (1 - utilization)) + rttServe;
      var pageMB = 2.2;
      var packets = Math.ceil(pageMB * 1024 * 1024 / 1460);
      var tDownload = pageMB * 8 / bw * 1000 * lossMult + rttServe * 2;
      var tRender = 400;
      var total = tDns + tTcp + tTls + tServer + tDownload + tRender;

      var STAGES = [
        { at: 0, color: C.amber, from: user, to: serveCity, label: 'DNS',
          text: dnsCached ? 'DNS: cached — ' + fmtMs(tDns) : 'DNS: resolver walks the hierarchy — ' + fmtMs(tDns) },
        { at: 1, color: C.sky, from: user, to: serveCity, label: 'TCP',
          text: 'TCP handshake to ' + serveCity.name + ' (' + Math.round(kmServe).toLocaleString('en-US') + ' km' + (edgeKey ? ', CDN edge' : ', origin') + ') — ' + fmtMs(tTcp) },
        https
          ? { at: 2, color: C.violet, from: user, to: serveCity, label: 'TLS',
              text: 'TLS 1.3 handshake: certificate verified, keys derived — ' + fmtMs(tTls) }
          : { at: 2, color: C.rose, from: user, to: serveCity, label: 'HTTP',
              text: 'Plain HTTP: no handshake to pay for, but every byte is readable in transit — 0 ms', note: true },
        { at: 3, color: C.rose, from: serveCity, to: serveCity, label: 'Server',
          text: 'Server processing (' + users.toLocaleString('en-US') + ' concurrent users, load-balanced fleet at ' + Math.round(utilization * 100) + '% load) — ' + fmtMs(tServer) },
        { at: 4, color: C.cTeal, from: serveCity, to: user, label: 'Download',
          text: 'Downloading ' + pageMB.toFixed(1) + ' MB as ~' + packets.toLocaleString('en-US') + ' packets' + (loss > 0 ? ' (' + Math.round(loss * 100) + '% loss → retransmissions)' : '') + ' — ' + fmtMs(tDownload) },
        { at: 5, color: C.lime, from: user, to: user, label: 'Render',
          text: 'Browser renders: parse, style, layout, paint, composite — ' + fmtMs(tRender) }
      ];

      function finish() {
        anim = null;
        addLog('Done. Total: ' + fmtMs(total) + ' — route: ' + user.name +
          ' → ISP → backbone → ' + serveCity.name +
          (edgeKey && edgeKey !== originKey ? ' (origin in ' + origin.name + ' behind the CDN)' : '') + '.', true);
        if (metrics) {
          var tbody = metrics.querySelector('tbody');
          if (tbody) {
            var rows = [
              ['DNS lookup', tDns], ['TCP connect', tTcp], ['TLS negotiation', tTls],
              ['Server processing', tServer], ['Content download', tDownload], ['Browser render', tRender]
            ];
            tbody.innerHTML = rows.map(function (r) {
              return '<tr><td>' + r[0] + '</td><td>' + fmtMs(r[1]) + '</td></tr>';
            }).join('') +
              '<tr><td>Packets (approx.)</td><td>' + packets.toLocaleString('en-US') + '</td></tr>' +
              '<tr><td>One-way distance</td><td>' + Math.round(kmServe).toLocaleString('en-US') + ' km</td></tr>' +
              '<tr class="is-total"><td>Total page load</td><td>' + fmtMs(total) + '</td></tr>';
          }
          metrics.hidden = false;
        }
        if (sendBtn) { sendBtn.disabled = false; }
        if (reduced()) { loop.stop(); drawScene(); }
      }

      if (sendBtn) { sendBtn.disabled = true; }

      if (reduced()) {
        STAGES.forEach(function (s) { addLog(s.text, !!s.note); });
        finish();
        return;
      }

      loop.start();
      var delay = 0;
      STAGES.forEach(function (s) {
        timers.push(setTimeout(function () {
          anim = s;
          addLog(s.text, !!s.note);
        }, delay));
        delay += 1300;
      });
      timers.push(setTimeout(finish, delay));
    }

    if (sendBtn) { sendBtn.addEventListener('click', run); }
    if (els.user) { els.user.addEventListener('change', drawScene); }
    if (els.origin) { els.origin.addEventListener('change', drawScene); }
    if (els.cdn) { els.cdn.addEventListener('change', drawScene); }

    drawScene();
    onScreen(canvas, function () { drawScene(); }, function () { loop.stop(); clearTimers(); if (sendBtn) { sendBtn.disabled = false; } anim = null; });
  }

  /* ==========================================================================
     Boot — every widget isolated so one failure can't break the page
     ========================================================================== */

  function boot() {
    [initReveal, initRail, initHero, initBigPicture, initDns, initRecords,
     initIp, initNat, initRoute, initPackets, initProto, initTls, initCdn,
     initLb, initDc, initRender, initSpeed, initJourney, initSim].forEach(function (fn) {
      try { fn(); } catch (e) {
        if (window.console && console.error) { console.error('internet.js widget failed:', fn.name, e); }
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
