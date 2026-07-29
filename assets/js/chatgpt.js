/* =============================================================================
   How ChatGPT Works — interactivity
   Vanilla JS, no dependencies. Loaded with `defer` on /chatgpt/ only.

   Structure:
     1. Shared utilities (canvas fitting, visibility gating, rAF loops) —
        the same toolkit as the other exhibits
     2. One init function per widget, each guarded by element existence and
        wrapped in try/catch so one failure never takes down the page
     3. Everything respects prefers-reduced-motion: ambient animation is
        disabled and story animations jump to labeled final states

   Honesty notes: the tokenizer is an illustrative subword tokenizer built
   for this page (real model families train their own vocabularies); the
   embedding map, attention weights, sampling candidates, and every timing
   are hand-crafted teaching illustrations, and the page copy says so where
   it matters. The temperature / top-k / top-p machinery, however, is the
   real math (softmax over logits, truncation, renormalization) running on
   the toy distributions.
   ============================================================================ */

(function () {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  document.documentElement.classList.add('cg-js');

  var RM = window.matchMedia('(prefers-reduced-motion: reduce)');
  function reduced() { return RM.matches; }

  var C = {
    deep: '#0b1120', line: '#1e293b', lineStrong: '#334155',
    text: '#cbd5e1', strong: '#f1f5f9', muted: '#94a3b8', faint: '#64748b',
    teal: '#2dd4bf', tealDeep: '#14b8a6',
    cTeal: '#0d9488', amber: '#d97706', sky: '#0284c7', skyBright: '#38bdf8',
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

  function makeRng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  /* FNV-1a — stable pseudo-IDs for the illustrative tokenizer. */
  function fnv1a(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  /* ==========================================================================
     Reveal-on-scroll + chapter rail + constellation illumination
     ========================================================================== */

  function initReveal() {
    var targets = $$('#chatgpt-experience [data-cg-reveal]');
    if (!targets.length) { return; }
    if (!('IntersectionObserver' in window) || reduced()) {
      targets.forEach(function (t) { t.classList.add('is-in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12 });
    targets.forEach(function (t) { io.observe(t); });
  }

  function initRail() {
    var dots = $$('#chatgpt-experience .cg-rail-dot');
    if (!dots.length || !('IntersectionObserver' in window)) { return; }
    var byHash = {};
    dots.forEach(function (d) { byHash[d.getAttribute('href')] = d; });
    var sections = $$('#chatgpt-experience section[id], #chatgpt-experience header[id]');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var dot = byHash['#' + e.target.id];
        if (!dot) { return; }
        if (e.isIntersecting) {
          dots.forEach(function (d) { d.classList.remove('is-active'); });
          dot.classList.add('is-active');
        }
      });
    }, { rootMargin: '-35% 0px -55% 0px' });
    sections.forEach(function (s) { io.observe(s); });
  }

  /* The shared illumination state feeding the constellation section. */
  var LIT = {
    set: {},
    listeners: [],
    light: function (ids) {
      var changed = false;
      (ids || []).forEach(function (id) {
        if (id && !LIT.set[id]) { LIT.set[id] = true; changed = true; }
      });
      if (changed) {
        LIT.listeners.forEach(function (fn) { try { fn(); } catch (e) { /* no-op */ } });
      }
    },
    has: function (id) { return !!LIT.set[id]; }
  };

  function initIllumination() {
    var sections = $$('#chatgpt-experience [data-cg-topics]');
    if (!sections.length) { return; }
    if (!('IntersectionObserver' in window)) {
      sections.forEach(function (s) { LIT.light(s.dataset.cgTopics.split(/\s+/)); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          LIT.light(e.target.dataset.cgTopics.split(/\s+/));
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.25 });
    sections.forEach(function (s) { io.observe(s); });
  }

  /* ==========================================================================
     Hero — drifting token chips + Send scrolls the story open
     ========================================================================== */

  function initHero() {
    var send = $('#cg-hero-send');
    if (send) {
      send.addEventListener('click', function () {
        var target = $('#computer');
        if (target) { target.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth' }); }
      });
    }

    var canvas = $('#cg-hero-canvas');
    if (!canvas) { return; }
    var fit = setupCanvas(canvas);
    var ctx = fit.ctx;
    var words = ('Sun sets are red because blue light scatters away token vector GPU cloud ' +
      'DNS TLS attention layer stream probability packet kernel').split(' ');
    var rng = makeRng(20260729);
    var chips = [];
    for (var i = 0; i < 26; i++) {
      chips.push({
        w: words[i % words.length],
        x: rng(), y: rng(),
        v: 0.008 + rng() * 0.02,
        s: 10 + rng() * 6,
        a: 0.05 + rng() * 0.12
      });
    }

    function draw(dt) {
      var w = fit.state.w, h = fit.state.h;
      ctx.clearRect(0, 0, w, h);
      chips.forEach(function (c) {
        ctx.font = '600 ' + c.s + 'px Inter, sans-serif';
        ctx.fillStyle = 'rgba(45, 212, 191, ' + c.a + ')';
        ctx.fillText(c.w, c.x * w, c.y * h);
      });
    }

    function step(t, dt) {
      if (!reduced()) {
        chips.forEach(function (c) {
          c.y -= c.v * (dt / 1000);
          if (c.y < -0.05) { c.y = 1.05; c.x = rng(); }
        });
      }
      draw(dt);
    }

    var loop = makeLoop(step);
    if (reduced()) {
      draw(0); /* static scatter */
    } else {
      onScreen(canvas, function () { loop.start(); }, function () { loop.stop(); });
    }
  }

  /* ==========================================================================
     Stage player — shared by chapter 1 (local machine) and 3 (TLS)
     ========================================================================== */

  function makeStagePlayer(opts) {
    var list = $(opts.list);
    var btn = $(opts.button);
    var status = $(opts.status);
    if (!list || !btn || !status) { return null; }
    var stages = $$('.cg-stage', list);
    var timer = null;
    var idx = -1;

    function clear() {
      if (timer) { clearTimeout(timer); timer = null; }
      stages.forEach(function (s) { s.classList.remove('is-active', 'is-done'); });
      idx = -1;
    }

    function showStep(i, done) {
      stages.forEach(function (s, j) {
        s.classList.toggle('is-active', j === i && !done);
        s.classList.toggle('is-done', j < i || done);
      });
      var note = done ? opts.doneNote : stages[i].dataset.note;
      status.textContent = note || '';
      status.classList.toggle('is-ok', !!done);
      if (opts.onStep) { opts.onStep(i, !!done); }
    }

    function advance() {
      idx++;
      if (idx >= stages.length) {
        showStep(stages.length - 1, true);
        btn.disabled = false;
        btn.textContent = opts.replayLabel || 'Replay';
        return;
      }
      showStep(idx, false);
      timer = setTimeout(advance, opts.interval || 1500);
    }

    btn.addEventListener('click', function () {
      clear();
      btn.disabled = true;
      if (opts.onReset) { opts.onReset(); }
      if (reduced()) {
        /* jump straight to the labeled final state */
        showStep(stages.length - 1, true);
        btn.disabled = false;
        btn.textContent = opts.replayLabel || 'Replay';
        return;
      }
      advance();
    });

    return { clear: clear };
  }

  function initLocalPipeline() {
    makeStagePlayer({
      list: '#cg-local-stages',
      button: '#cg-local-play',
      status: '#cg-local-status',
      interval: 1900,
      doneNote: 'Total so far: a few milliseconds — and your prompt has not left the building yet.',
      replayLabel: 'Press it again'
    });
  }

  function initTls() {
    var wiretext = $('#cg-tls-wiretext');
    var plain = 'Explain why sunsets are red.';
    var glyphs = '0123456789abcdef';
    var rng = makeRng(0xc0ffee);
    function cipher() {
      var out = '';
      for (var i = 0; i < plain.length + 6; i++) {
        out += glyphs[Math.floor(rng() * glyphs.length)];
      }
      return '⚿ ' + out;
    }
    makeStagePlayer({
      list: '#cg-tls-stages',
      button: '#cg-tls-play',
      status: '#cg-tls-status',
      interval: 1700,
      doneNote: 'Handshake complete — every byte from here on is ciphertext to the network.',
      replayLabel: 'Run it again',
      onReset: function () {
        if (wiretext) {
          wiretext.textContent = plain;
          wiretext.classList.remove('is-cipher');
        }
      },
      onStep: function (i, done) {
        if (wiretext && (done || i === 4)) {
          wiretext.textContent = cipher();
          wiretext.classList.add('is-cipher');
        }
      }
    });
  }

  /* ==========================================================================
     Chapter 2 — network hops
     ========================================================================== */

  var HOPS = {
    browser: {
      name: 'Browser',
      note: 'The browser wraps your prompt in an HTTPS request. First problem: it only knows a domain name, not an address — time to ask DNS.'
    },
    dns: {
      name: 'DNS',
      note: 'A hierarchy of name servers translates the chat service’s domain into an IP address. Usually answered in milliseconds from a nearby cache.'
    },
    router: {
      name: 'Your router',
      note: 'Your home router forwards packets toward your ISP and keeps track of which device on your network the replies belong to (NAT).'
    },
    isp: {
      name: 'ISP',
      note: 'Your Internet Service Provider carries the packets out of your neighborhood and hands them to long-haul networks at an exchange point.'
    },
    backbone: {
      name: 'Internet backbone',
      note: 'Continent-spanning fiber — sometimes under an ocean. Dozens of independent routers each make their own best-path decision, packet by packet.'
    },
    region: {
      name: 'Cloud region',
      note: 'The packets arrive at a data center campus in the provider’s nearest region — and hit the front door of chapter 4: the load balancer.'
    }
  };

  function initNetwork() {
    var hopsWrap = $('#cg-net-hops');
    var detail = $('#cg-net-detail');
    var play = $('#cg-net-play');
    var status = $('#cg-net-status');
    if (!hopsWrap || !detail || !play || !status) { return; }
    var hops = $$('.cg-hop', hopsWrap);
    var timer = null;

    function select(hopEl, visited) {
      hops.forEach(function (h) { h.classList.toggle('is-active', h === hopEl); });
      if (visited) { hopEl.classList.add('is-visited'); }
      var info = HOPS[hopEl.dataset.hop];
      if (info) {
        detail.innerHTML = '';
        var p = document.createElement('p');
        var b = document.createElement('span');
        b.className = 'cg-hop-detail-name';
        b.textContent = info.name;
        p.appendChild(b);
        p.appendChild(document.createTextNode(info.note));
        detail.appendChild(p);
      }
    }

    hops.forEach(function (h) {
      h.addEventListener('click', function () {
        if (timer) { clearTimeout(timer); timer = null; play.disabled = false; }
        select(h, false);
        status.textContent = '';
      });
    });

    play.addEventListener('click', function () {
      hops.forEach(function (h) { h.classList.remove('is-visited', 'is-active'); });
      if (reduced()) {
        hops.forEach(function (h) { h.classList.add('is-visited'); });
        select(hops[hops.length - 1], true);
        status.textContent = 'Six hops, one encrypted prompt — arrived at the cloud region.';
        status.classList.add('is-ok');
        return;
      }
      play.disabled = true;
      status.classList.remove('is-ok');
      var i = 0;
      function next() {
        if (i >= hops.length) {
          status.textContent = 'Arrived — total network time is usually a few dozen milliseconds.';
          status.classList.add('is-ok');
          play.disabled = false;
          play.textContent = 'Send it again';
          timer = null;
          return;
        }
        select(hops[i], true);
        status.textContent = 'Hop ' + (i + 1) + ' of ' + hops.length + '…';
        i++;
        timer = setTimeout(next, 1300);
      }
      next();
    });
  }

  /* ==========================================================================
     Chapter 4 — cloud routing canvas
     ========================================================================== */

  function initCloud() {
    var canvas = $('#cg-cloud-canvas');
    var play = $('#cg-cloud-play');
    var status = $('#cg-cloud-status');
    if (!canvas || !play || !status) { return; }
    var fit = setupCanvas(canvas);
    var ctx = fit.ctx;
    var rng = makeRng(424242);

    var SERVERS = 5;
    var loads = [];
    for (var i = 0; i < SERVERS; i++) { loads.push(0.2 + rng() * 0.5); }
    var dots = [];       /* {p: 0..1 along path, server, mine, phase} */
    var spawnAcc = 0;
    var mine = null;

    function layout() {
      var w = fit.state.w, h = fit.state.h;
      return {
        w: w, h: h,
        lb: { x: w * 0.18, y: h * 0.5 },
        srv: function (i) {
          return { x: w * 0.52, y: h * (0.14 + (i + 0.5) * 0.72 / SERVERS) };
        },
        gpu: { x: w * 0.84, y: h * 0.5 }
      };
    }

    function leastLoaded() {
      var best = 0;
      for (var i = 1; i < SERVERS; i++) { if (loads[i] < loads[best]) { best = i; } }
      return best;
    }

    function drawScene(L) {
      ctx.clearRect(0, 0, L.w, L.h);

      /* load balancer */
      ctx.fillStyle = '#16213a';
      ctx.strokeStyle = C.lineStrong;
      roundRect(ctx, L.lb.x - 34, L.lb.y - 30, 68, 60, 10, true, true);
      label('Load', L.lb.x, L.lb.y - 6);
      label('balancer', L.lb.x, L.lb.y + 8);

      /* servers with load bars */
      for (var i = 0; i < SERVERS; i++) {
        var s = L.srv(i);
        ctx.fillStyle = '#16213a';
        ctx.strokeStyle = C.lineStrong;
        roundRect(ctx, s.x - 40, s.y - 14, 80, 28, 7, true, true);
        label('app ' + (i + 1), s.x - 16, s.y + 1);
        ctx.fillStyle = C.free;
        ctx.fillRect(s.x + 4, s.y - 5, 30, 10);
        ctx.fillStyle = loads[i] > 0.75 ? C.rose : C.cTeal;
        ctx.fillRect(s.x + 4, s.y - 5, 30 * clamp(loads[i], 0, 1), 10);
      }

      /* GPU cluster */
      ctx.fillStyle = '#16213a';
      ctx.strokeStyle = 'rgba(45, 212, 191, 0.55)';
      roundRect(ctx, L.gpu.x - 44, L.gpu.y - 44, 88, 88, 10, true, true);
      label('GPU', L.gpu.x, L.gpu.y - 26);
      for (var g = 0; g < 4; g++) {
        ctx.fillStyle = 'rgba(45, 212, 191, ' + (0.35 + 0.3 * Math.sin(performance.now() / 400 + g)) + ')';
        ctx.fillRect(L.gpu.x - 32, L.gpu.y - 14 + g * 13, 64, 8);
      }

      /* dots */
      dots.forEach(function (d) {
        var from, to;
        if (d.phase === 0) { from = { x: -8, y: L.lb.y }; to = L.lb; }
        else if (d.phase === 1) { from = L.lb; to = L.srv(d.server); }
        else { from = L.srv(d.server); to = L.gpu; }
        var x = from.x + (to.x - from.x) * d.p;
        var y = from.y + (to.y - from.y) * d.p;
        ctx.beginPath();
        ctx.arc(x, y, d.mine ? 6 : 3, 0, Math.PI * 2);
        ctx.fillStyle = d.mine ? C.teal : 'rgba(56, 189, 248, 0.7)';
        ctx.fill();
        if (d.mine) {
          ctx.strokeStyle = 'rgba(45, 212, 191, 0.5)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, 10, 0, Math.PI * 2);
          ctx.stroke();
          ctx.lineWidth = 1;
        }
      });
    }

    function label(text, x, y) {
      ctx.fillStyle = C.muted;
      ctx.font = '600 11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(text, x, y);
      ctx.textAlign = 'start';
    }

    function roundRect(c, x, y, w, h, r, fill, stroke) {
      c.beginPath();
      c.moveTo(x + r, y);
      c.arcTo(x + w, y, x + w, y + h, r);
      c.arcTo(x + w, y + h, x, y + h, r);
      c.arcTo(x, y + h, x, y, r);
      c.arcTo(x, y, x + w, y, r);
      c.closePath();
      if (fill) { c.fill(); }
      if (stroke) { c.stroke(); }
    }

    function step(t, dt) {
      var L = layout();

      /* ambient traffic */
      spawnAcc += dt;
      if (spawnAcc > 380) {
        spawnAcc = 0;
        dots.push({ p: 0, phase: 0, server: 0, mine: false });
      }
      dots.forEach(function (d) {
        d.p += dt / (d.mine ? 900 : 650);
        if (d.p >= 1) {
          d.p = 0;
          if (d.phase === 0) {
            d.phase = 1;
            d.server = leastLoaded();
            loads[d.server] = clamp(loads[d.server] + 0.14, 0, 1);
            if (d.mine) {
              setStatusText('Load balancer picked app server ' + (d.server + 1) +
                ' — currently the least busy.');
            }
          } else if (d.phase === 1 && d.mine) {
            d.phase = 2;
            setStatusText('App server ' + (d.server + 1) +
              ' checked the session and handed the prompt to the inference service…');
          } else {
            if (d.mine) {
              setStatusText('Queued on the GPU cluster — chapter 5 begins.');
              status.classList.add('is-ok');
              play.disabled = false;
              play.textContent = 'Route it again';
              mine = null;
            }
            d.dead = true;
          }
        }
      });
      dots = dots.filter(function (d) { return !d.dead; });
      for (var i = 0; i < SERVERS; i++) { loads[i] = Math.max(0.08, loads[i] - dt * 0.00006); }

      drawScene(L);
    }

    function setStatusText(msg) { status.textContent = msg; }

    var loop = makeLoop(step);
    if (!reduced()) {
      onScreen(canvas, function () { loop.start(); }, function () { loop.stop(); });
    } else {
      drawScene(layout());
    }

    play.addEventListener('click', function () {
      if (reduced()) {
        drawScene(layout());
        setStatusText('Load balancer → least-busy app server → inference service → GPU cluster.');
        status.classList.add('is-ok');
        return;
      }
      if (mine) { return; }
      status.classList.remove('is-ok');
      play.disabled = true;
      mine = { p: 0, phase: 0, server: 0, mine: true };
      dots.push(mine);
      setStatusText('Your prompt arrives with everyone else’s…');
      loop.start();
    });
  }

  /* ==========================================================================
     Chapter 5 — illustrative subword tokenizer
     ========================================================================== */

  var TOK_VOCAB = (
    'explain sunset sunsets because through atmosphere scatter wavelength ' +
    'light blue red orange sky sun sets set ing tion ness ment able ally ed ly er est ers ' +
    'the and why are is of to in it you that was for on with as at be this have from or by ' +
    'not what all were when your can how their if will up other about out many then them ' +
    'so some would make like time has look two more write go see way could people than ' +
    'first been who now find long down day did get come made may part over new take only ' +
    'little work know place year live me back give most very after thing our just name ' +
    'good tell boy follow came want show also around form three small put end does ' +
    'another well large must big even such turn here ask went men read need land hand ' +
    'high keep last never am us left along while might next below something seem hard ' +
    'open example begin those which she her him his they them there where were do does ' +
    'pre re un dis con com per sub inter trans under'
  ).trim().split(/\s+/).sort(function (a, b) { return b.length - a.length; });

  function tokenize(text) {
    /* Greedy longest-match subword segmentation over a small vocabulary —
       the *shape* of BPE inference without a trained merge table. */
    var out = [];
    var pieces = text.match(/\s*\S+|\s+$/g) || [];
    pieces.forEach(function (piece) {
      var lead = piece.match(/^\s*/)[0];
      var word = piece.slice(lead.length);
      var first = true;
      while (word.length) {
        var m = word.match(/^[^A-Za-z0-9]+/);
        if (m) {
          /* punctuation: one token per run */
          out.push((first ? lead : '') + m[0]);
          word = word.slice(m[0].length);
          first = false;
          continue;
        }
        var lower = word.toLowerCase();
        var hit = '';
        for (var i = 0; i < TOK_VOCAB.length; i++) {
          if (lower.indexOf(TOK_VOCAB[i]) === 0) { hit = TOK_VOCAB[i]; break; }
        }
        /* fallback: an alphanumeric-only chunk, never mixed with punctuation */
        var alnum = word.match(/^[A-Za-z0-9]{1,3}/);
        var len = hit ? hit.length : (alnum ? alnum[0].length : 1);
        out.push((first ? lead : '') + word.slice(0, len));
        word = word.slice(len);
        first = false;
      }
      if (!word.length && !piece.trim().length && lead) {
        /* trailing whitespace only — ignore */
      }
    });
    return out;
  }

  var TOK_COLORS = ['#2dd4bf', '#7dd3fc', '#fbbf24', '#c4b5fd', '#fda4af'];

  function initTokenizer() {
    var input = $('#cg-tok-input');
    var toksEl = $('#cg-tok-tokens');
    var idsEl = $('#cg-tok-ids');
    var embEl = $('#cg-tok-embeds');
    var countEl = $('#cg-tok-count');
    if (!input || !toksEl || !idsEl || !embEl || !countEl) { return; }

    function render() {
      var text = input.value.slice(0, 240);
      var toks = tokenize(text).slice(0, 48);
      toksEl.innerHTML = '';
      idsEl.innerHTML = '';
      embEl.innerHTML = '';
      toks.forEach(function (t, i) {
        var id = fnv1a(t.toLowerCase()) % 50257;

        var chip = document.createElement('span');
        chip.className = 'cg-token';
        chip.style.setProperty('--tok', TOK_COLORS[i % TOK_COLORS.length]);
        chip.textContent = t.replace(/ /g, '␣');
        toksEl.appendChild(chip);

        var idc = document.createElement('span');
        idc.className = 'cg-tokid';
        idc.textContent = id;
        idsEl.appendChild(idc);

        var emb = document.createElement('span');
        emb.className = 'cg-embed';
        emb.title = 'token ' + id + ' → vector (illustrative)';
        var rng = makeRng(id + 7);
        for (var b = 0; b < 8; b++) {
          var bar = document.createElement('i');
          bar.style.height = Math.round(4 + rng() * 18) + 'px';
          emb.appendChild(bar);
        }
        embEl.appendChild(emb);
      });
      countEl.textContent = text.length + ' characters → ' + toks.length +
        ' tokens' + (toks.length ? ' (␣ marks a leading space — part of the token)' : '');
    }

    var deb = null;
    input.addEventListener('input', function () {
      clearTimeout(deb);
      deb = setTimeout(render, 120);
    });
    render();
  }

  /* ==========================================================================
     Chapter 6 — embedding space
     ========================================================================== */

  var EMB_GROUPS = {
    animals: { color: '#38bdf8', words: [
      ['cat', 0.16, 0.30], ['dog', 0.24, 0.34], ['kitten', 0.12, 0.40],
      ['tiger', 0.24, 0.20], ['wolf', 0.31, 0.27]] },
    food: { color: '#fbbf24', words: [
      ['pizza', 0.70, 0.72], ['pasta', 0.78, 0.65], ['bread', 0.66, 0.62],
      ['cheese', 0.75, 0.79], ['sushi', 0.85, 0.71]] },
    vehicles: { color: '#a78bfa', words: [
      ['car', 0.20, 0.72], ['truck', 0.27, 0.79], ['train', 0.14, 0.81],
      ['bicycle', 0.30, 0.66]] },
    sunset: { color: '#fb7185', words: [
      ['sunset', 0.66, 0.22], ['sky', 0.60, 0.15], ['red', 0.76, 0.17],
      ['orange', 0.74, 0.28], ['glow', 0.63, 0.29], ['horizon', 0.57, 0.24]] }
  };

  function initEmbeddings() {
    var canvas = $('#cg-emb-canvas');
    var info = $('#cg-emb-info');
    if (!canvas || !info) { return; }
    var fit = setupCanvas(canvas, draw);
    var ctx = fit.ctx;

    var points = [];
    Object.keys(EMB_GROUPS).forEach(function (g) {
      EMB_GROUPS[g].words.forEach(function (w) {
        points.push({ w: w[0], x: w[1], y: w[2], g: g, color: EMB_GROUPS[g].color });
      });
    });
    var hover = null;

    function px(p) {
      var pad = 40;
      return {
        x: pad + p.x * (fit.state.w - pad * 2),
        y: pad + p.y * (fit.state.h - pad * 2)
      };
    }

    function nearest(p, n) {
      return points
        .filter(function (q) { return q !== p; })
        .map(function (q) {
          var dx = q.x - p.x, dy = q.y - p.y;
          return { q: q, d: Math.sqrt(dx * dx + dy * dy) };
        })
        .sort(function (a, b) { return a.d - b.d; })
        .slice(0, n);
    }

    function draw() {
      var w = fit.state.w, h = fit.state.h;
      ctx.clearRect(0, 0, w, h);

      /* faint axes hint */
      ctx.strokeStyle = 'rgba(51, 65, 85, 0.5)';
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(20, h - 20); ctx.lineTo(w - 20, h - 20);
      ctx.moveTo(20, h - 20); ctx.lineTo(20, 20);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C.faint;
      ctx.font = '600 10px Inter, sans-serif';
      ctx.fillText('a 2-D shadow of ~thousands of dimensions', 26, h - 26);

      if (hover) {
        nearest(hover, 3).forEach(function (rec) {
          var a = px(hover), b = px(rec.q);
          ctx.strokeStyle = 'rgba(45, 212, 191, 0.5)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          ctx.lineWidth = 1;
        });
      }

      points.forEach(function (p) {
        var pos = px(p);
        var isH = p === hover;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, isH ? 7 : 5, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = hover && !isH ? 0.55 : 1;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = isH ? C.strong : C.text;
        ctx.font = (isH ? '700 ' : '600 ') + '12px Inter, sans-serif';
        ctx.fillText(p.w, pos.x + 9, pos.y + 4);
      });
    }

    function pick(clientX, clientY) {
      var rect = canvas.getBoundingClientRect();
      var mx = clientX - rect.left, my = clientY - rect.top;
      var best = null, bd = 28;
      points.forEach(function (p) {
        var pos = px(p);
        var d = Math.hypot(pos.x - mx, pos.y - my);
        if (d < bd) { bd = d; best = p; }
      });
      return best;
    }

    canvas.addEventListener('mousemove', function (ev) {
      var p = pick(ev.clientX, ev.clientY);
      if (p !== hover) {
        hover = p;
        draw();
        if (p) {
          var names = nearest(p, 3).map(function (r) { return r.q.w; }).join(', ');
          info.textContent = '“' + p.w + '” — nearest neighbors: ' + names + '.';
        } else {
          info.textContent = 'Hover or tap a word to see its nearest neighbors.';
        }
      }
      canvas.style.cursor = p ? 'pointer' : 'default';
    });
    canvas.addEventListener('click', function (ev) {
      hover = pick(ev.clientX, ev.clientY);
      draw();
      if (hover) {
        var names = nearest(hover, 3).map(function (r) { return r.q.w; }).join(', ');
        info.textContent = '“' + hover.w + '” — nearest neighbors: ' + names + '.';
      }
    });
    canvas.addEventListener('mouseleave', function () {
      hover = null;
      draw();
    });

    draw();
  }

  /* ==========================================================================
     Chapter 7 — transformer forward pass
     ========================================================================== */

  function initTransformer() {
    var layersEl = $('#cg-tf-layers');
    var inEl = $('#cg-tf-intokens');
    var outEl = $('#cg-tf-out');
    var play = $('#cg-tf-play');
    var status = $('#cg-tf-status');
    var diagram = $('#cg-tf-diagram');
    if (!layersEl || !inEl || !outEl || !play || !status || !diagram) { return; }

    var TOKS = ['Explain', '␣why', '␣sun', 'sets', '␣are', '␣red', '.'];
    TOKS.forEach(function (t) {
      var c = document.createElement('span');
      c.className = 'cg-tf-chip';
      c.textContent = t;
      inEl.appendChild(c);
    });

    var N = 6;
    var layers = [];
    for (var i = 0; i < N; i++) {
      var row = document.createElement('div');
      row.className = 'cg-tf-layer';
      row.innerHTML = '<span class="cg-tf-layer-name">Layer ' + (i + 1) + '</span>' +
        '<span class="cg-tf-sub" data-sub="attn">Attention</span>' +
        '<span class="cg-tf-sub" data-sub="mlp">Feed-forward</span>';
      layersEl.appendChild(row);
      layers.push(row);
    }

    var NARRATION = [
      'Token IDs become vectors (chapter 6).',
      'Attention: every token gathers context from the tokens before it (chapter 8).',
      'Feed-forward: each vector is transformed on its own.',
      'The same two moves repeat, layer after layer — meaning accumulates.',
      'The final vectors are scored against every token in the vocabulary.',
      'Highest-probability candidate: “␣Sunsets” — the answer’s first token.'
    ];

    var timer = null;

    function clearAll() {
      if (timer) { clearTimeout(timer); timer = null; }
      $$('.is-active', diagram).forEach(function (n) { n.classList.remove('is-active'); });
      outEl.innerHTML = '';
      status.classList.remove('is-ok');
    }

    function finish() {
      var chip = document.createElement('span');
      chip.className = 'cg-tf-chip is-out';
      chip.textContent = '␣Sunsets';
      outEl.appendChild(chip);
      status.textContent = NARRATION[5];
      status.classList.add('is-ok');
      play.disabled = false;
      play.textContent = 'Run it again';
    }

    play.addEventListener('click', function () {
      clearAll();
      play.disabled = true;

      if (reduced()) {
        $('[data-tf="head"]', diagram).classList.add('is-active');
        finish();
        return;
      }

      var script = [];
      script.push(function () {
        $('[data-tf="embed"]', diagram).classList.add('is-active');
        status.textContent = NARRATION[0];
      });
      layers.forEach(function (row, i) {
        script.push(function () {
          $('[data-tf="embed"]', diagram).classList.remove('is-active');
          layers.forEach(function (r) { r.classList.remove('is-active'); });
          $$('.cg-tf-sub', layersEl).forEach(function (s) { s.classList.remove('is-active'); });
          row.classList.add('is-active');
          $('[data-sub="attn"]', row).classList.add('is-active');
          status.textContent = i === 0 ? NARRATION[1] : NARRATION[3];
        });
        script.push(function () {
          $('[data-sub="attn"]', row).classList.remove('is-active');
          $('[data-sub="mlp"]', row).classList.add('is-active');
          if (i === 0) { status.textContent = NARRATION[2]; }
        });
      });
      script.push(function () {
        layers.forEach(function (r) { r.classList.remove('is-active'); });
        $$('.cg-tf-sub', layersEl).forEach(function (s) { s.classList.remove('is-active'); });
        $('[data-tf="head"]', diagram).classList.add('is-active');
        status.textContent = NARRATION[4];
      });
      script.push(finish);

      var i = 0;
      function next() {
        script[i]();
        i++;
        if (i < script.length) { timer = setTimeout(next, i <= 2 ? 1600 : 650); }
      }
      next();
    });
  }

  /* ==========================================================================
     Chapter 8 — attention visualizer
     ========================================================================== */

  var ATTN_SENTENCES = [
    {
      toks: ['The', 'animal', 'didn’t', 'cross', 'the', 'street', 'because', 'it', 'was', 'too', 'tired'],
      overrides: {
        7: { 1: 0.62, 5: 0.14, 6: 0.10 },          /* "it" -> animal */
        10: { 7: 0.30, 1: 0.34, 9: 0.22 }          /* "tired" -> animal/it */
      },
      note: 'Here “it” attends most strongly to “animal” — animals get tired.'
    },
    {
      toks: ['The', 'animal', 'didn’t', 'cross', 'the', 'street', 'because', 'it', 'was', 'too', 'wide'],
      overrides: {
        7: { 5: 0.62, 1: 0.14, 6: 0.10 },          /* "it" -> street */
        10: { 5: 0.40, 7: 0.24, 9: 0.20 }          /* "wide" -> street */
      },
      note: 'One word changed at the end — and “it” now attends to “street”, because streets are wide.'
    },
    {
      toks: ['Explain', 'why', 'sunsets', 'are', 'red'],
      overrides: {
        3: { 2: 0.62, 1: 0.16 },
        4: { 2: 0.52, 3: 0.22, 1: 0.14 }
      },
      note: 'Even in five tokens: “red” looks back hardest at “sunsets” — the thing being described.'
    }
  ];

  function attnWeights(sentence, i) {
    /* previous-token weights for token i: hand overrides + recency falloff */
    var w = [];
    var sum = 0;
    for (var j = 0; j < i; j++) {
      var v = Math.exp(-(i - j) / 2.6);
      var ov = sentence.overrides[i];
      if (ov && ov[j] != null) { v = ov[j] * 4; }
      w.push(v);
      sum += v;
    }
    return w.map(function (v) { return sum > 0 ? v / sum : 0; });
  }

  function initAttention() {
    var toksEl = $('#cg-attn-tokens');
    var svg = $('#cg-attn-svg');
    var picks = $$('.cg-attn-pick');
    var play = $('#cg-attn-play');
    var status = $('#cg-attn-status');
    if (!toksEl || !svg || !play || !status) { return; }

    var current = 0;
    var tokEls = [];
    var timer = null;

    function build() {
      if (timer) { clearTimeout(timer); timer = null; play.disabled = false; }
      toksEl.innerHTML = '';
      svg.innerHTML = '';
      tokEls = [];
      status.textContent = ATTN_SENTENCES[current].note;
      ATTN_SENTENCES[current].toks.forEach(function (t, i) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'cg-attn-tok';
        b.textContent = t;
        b.setAttribute('aria-label', 'Token “' + t + '” — show its attention to earlier tokens');
        b.addEventListener('mouseenter', function () { focusTok(i); });
        b.addEventListener('focus', function () { focusTok(i); });
        b.addEventListener('click', function () { focusTok(i); });
        toksEl.appendChild(b);
        tokEls.push(b);
      });
      toksEl.addEventListener('mouseleave', clearFocus);
    }

    function clearFocus() {
      svg.innerHTML = '';
      tokEls.forEach(function (t) {
        t.classList.remove('is-focus', 'is-src');
        t.style.removeProperty('--w');
      });
    }

    function focusTok(i) {
      clearFocus();
      var s = ATTN_SENTENCES[current];
      var w = attnWeights(s, i);
      tokEls[i].classList.add('is-focus');

      var stageRect = toksEl.parentElement.getBoundingClientRect();
      var W = stageRect.width;
      svg.setAttribute('viewBox', '0 0 ' + W + ' 120');
      svg.setAttribute('preserveAspectRatio', 'none');

      function cx(el) {
        var r = el.getBoundingClientRect();
        return r.left - stageRect.left + r.width / 2;
      }

      var parts = '';
      var top = -1, topW = 0;
      for (var j = 0; j < i; j++) {
        if (w[j] < 0.02) { continue; }
        tokEls[j].classList.add('is-src');
        tokEls[j].style.setProperty('--w', w[j].toFixed(2));
        var x1 = cx(tokEls[i]), x2 = cx(tokEls[j]);
        var lift = 30 + Math.min(80, Math.abs(x1 - x2) * 0.28);
        parts += '<path d="M' + x1 + ' 118 Q ' + ((x1 + x2) / 2) + ' ' + (118 - lift) +
          ' ' + x2 + ' 118" stroke-width="' + (1 + w[j] * 9).toFixed(1) +
          '" opacity="' + (0.25 + w[j] * 0.75).toFixed(2) + '"></path>';
        if (w[j] > topW) { topW = w[j]; top = j; }
      }
      svg.innerHTML = parts;
      if (i === 0) {
        status.textContent = 'The first token has nothing earlier to attend to.';
      } else if (top >= 0) {
        status.textContent = '“' + s.toks[i] + '” attends most to “' +
          s.toks[top] + '” (' + Math.round(topW * 100) + '% of its attention).';
      }
    }

    picks.forEach(function (p) {
      p.addEventListener('click', function () {
        picks.forEach(function (q) { q.classList.toggle('is-on', q === p); });
        current = parseInt(p.dataset.attn, 10) || 0;
        build();
      });
    });

    play.addEventListener('click', function () {
      if (timer) { return; }
      var n = ATTN_SENTENCES[current].toks.length;
      if (reduced()) {
        focusTok(n - 1);
        return;
      }
      play.disabled = true;
      var i = 1;
      function next() {
        focusTok(i);
        i++;
        if (i < n) { timer = setTimeout(next, 950); }
        else {
          timer = null;
          play.disabled = false;
        }
      }
      next();
    });

    window.addEventListener('resize', clearFocus);
    build();
  }

  /* ==========================================================================
     Chapter 9 — CPU vs GPU race
     ========================================================================== */

  function initGpuRace() {
    var cpuC = $('#cg-gpu-cpu');
    var gpuC = $('#cg-gpu-gpu');
    var btn = $('#cg-gpu-race');
    var status = $('#cg-gpu-status');
    if (!cpuC || !gpuC || !btn || !status) { return; }
    var cpu = setupCanvas(cpuC, function () { drawGrid(cpu, cpuDone, C.skyBright); });
    var gpu = setupCanvas(gpuC, function () { drawGrid(gpu, gpuDone, C.teal); });

    var COLS = 48, ROWS = 20, TOTAL = COLS * ROWS;
    var cpuDone = 0, gpuDone = 0;
    var running = false;

    function drawGrid(fitRec, done, color) {
      var ctx = fitRec.ctx, w = fitRec.state.w, h = fitRec.state.h;
      var cw = (w - 12) / COLS, ch = (h - 12) / ROWS;
      ctx.clearRect(0, 0, w, h);
      for (var i = 0; i < TOTAL; i++) {
        var x = 6 + (i % COLS) * cw;
        var y = 6 + Math.floor(i / COLS) * ch;
        ctx.fillStyle = i < done ? color : C.free;
        ctx.fillRect(x, y, Math.max(1, cw - 1.5), Math.max(1, ch - 1.5));
      }
    }

    function render() {
      drawGrid(cpu, cpuDone, C.skyBright);
      drawGrid(gpu, gpuDone, C.teal);
    }

    var cpuT = null, gpuT = null;
    var loop = makeLoop(function () {
      if (cpuDone < TOTAL) {
        cpuDone = Math.min(TOTAL, cpuDone + 5);
        if (cpuDone >= TOTAL) { cpuT = performance.now(); }
      }
      if (gpuDone < TOTAL) {
        gpuDone = Math.min(TOTAL, gpuDone + 96);
        if (gpuDone >= TOTAL) { gpuT = performance.now(); }
      }
      render();
      if (cpuDone >= TOTAL && gpuDone >= TOTAL) {
        loop.stop();
        running = false;
        btn.disabled = false;
        btn.textContent = 'Race again';
        var ratio = cpuT && gpuT && (gpuT - t0) > 0
          ? ((cpuT - t0) / (gpuT - t0)).toFixed(0) : '≈20';
        status.textContent = 'Same matrix, same work — the GPU finished ~' + ratio +
          '× sooner by doing it in wide parallel waves. (Illustrative speeds.)';
        status.classList.add('is-ok');
      }
    });
    var t0 = 0;

    btn.addEventListener('click', function () {
      if (running) { return; }
      cpuDone = 0; gpuDone = 0; cpuT = null; gpuT = null;
      status.classList.remove('is-ok');
      if (reduced()) {
        cpuDone = TOTAL; gpuDone = TOTAL;
        render();
        status.textContent = 'Both compute the same matrix — the GPU in a few wide ' +
          'parallel waves, the CPU cell by cell. (Illustrative.)';
        status.classList.add('is-ok');
        return;
      }
      running = true;
      btn.disabled = true;
      status.textContent = 'Computing one attention score matrix…';
      t0 = performance.now();
      loop.start();
    });

    render();
  }

  /* ==========================================================================
     Chapter 10 — sampling playground
     ========================================================================== */

  var SAMP_CANDS = [
    ['red', 0.30], ['orange', 0.22], ['beautiful', 0.12], ['golden', 0.09],
    ['pink', 0.07], ['like', 0.06], ['amazing', 0.05], ['purple', 0.04],
    ['crimson', 0.02], ['blue', 0.015], ['peaceful', 0.01], ['banana', 0.005]
  ];

  /* The real sampling math on toy numbers: softmax(log p / T), then
     top-k, then top-p (nucleus), then renormalize. */
  function applySampling(cands, temp, topk, topp) {
    var logits = cands.map(function (c) { return Math.log(c[1]); });
    var m = Math.max.apply(null, logits.map(function (l) { return l / temp; }));
    var exps = logits.map(function (l) { return Math.exp(l / temp - m); });
    var sum = exps.reduce(function (a, b) { return a + b; }, 0);
    var probs = exps.map(function (e) { return e / sum; });

    var order = probs.map(function (p, i) { return i; })
      .sort(function (a, b) { return probs[b] - probs[a]; });

    var kept = {};
    var cum = 0;
    order.forEach(function (idx, rank) {
      if (rank >= topk) { return; }
      if (cum >= topp) { return; }
      kept[idx] = true;
      cum += probs[idx];
    });

    var keptSum = 0;
    order.forEach(function (idx) { if (kept[idx]) { keptSum += probs[idx]; } });

    return cands.map(function (c, i) {
      return {
        word: c[0],
        raw: probs[i],
        kept: !!kept[i],
        p: kept[i] && keptSum > 0 ? probs[i] / keptSum : 0
      };
    });
  }

  function sampleFrom(dist, rand, greedy) {
    if (greedy) {
      /* near-zero temperature: pick the argmax so "deterministic" is true */
      var best = -1;
      for (var g = 0; g < dist.length; g++) {
        if (dist[g].kept && (best < 0 || dist[g].p > dist[best].p)) { best = g; }
      }
      return best < 0 ? 0 : best;
    }
    var r = rand();
    var acc = 0;
    for (var i = 0; i < dist.length; i++) {
      if (!dist[i].kept) { continue; }
      acc += dist[i].p;
      if (r <= acc) { return i; }
    }
    for (var j = dist.length - 1; j >= 0; j--) { if (dist[j].kept) { return j; } }
    return 0;
  }

  /* Tiny bigram model for the sentence generator (sunset-themed). */
  var GEN = {
    '<s>': [['The', 3], ['At', 1], ['Sunlight', 1.2]],
    'the': [['sky', 3], ['sun', 1.5], ['horizon', 1], ['air', 0.6]],
    'at': [['sunset', 1]],
    'sunset': [['the', 2], ['light', 1]],
    'sunlight': [['scatters', 2], ['travels', 1], ['reddens', 0.4]],
    'sky': [['turns', 2.2], ['glows', 1.6], ['looks', 1.2], ['burns', 0.5]],
    'sun': [['sinks', 1.5], ['sets', 1.5], ['dips', 1]],
    'horizon': [['glows', 2], ['burns', 1]],
    'air': [['scatters', 2], ['glows', 0.5]],
    'turns': [['red', 3], ['orange', 2], ['crimson', 1], ['golden', 1], ['purple', 0.5], ['green', 0.1]],
    'glows': [['red', 2], ['orange', 2], ['golden', 1.5], ['pink', 1], ['softly', 0.8]],
    'looks': [['red', 2], ['beautiful', 1.5], ['golden', 1], ['unreal', 0.4]],
    'burns': [['red', 2], ['crimson', 1.5], ['orange', 1]],
    'sinks': [['slowly', 1.5], ['low', 1]],
    'sets': [['slowly', 1], ['low', 0.8], ['behind', 1.5]],
    'dips': [['behind', 2]],
    'behind': [['the', 1]],
    'red': [['because', 2.2], ['.', 1.5], ['and', 0.8]],
    'orange': [['because', 1.5], ['.', 1.5], ['and', 0.8]],
    'crimson': [['.', 2], ['because', 1]],
    'golden': [['.', 2], ['because', 0.6]],
    'pink': [['.', 2]],
    'purple': [['.', 2]],
    'green': [['.', 2]],
    'softly': [['.', 2]],
    'slowly': [['.', 2]],
    'low': [['.', 2]],
    'beautiful': [['.', 2]],
    'unreal': [['.', 2]],
    'because': [['blue', 2.5], ['shorter', 1.2]],
    'blue': [['light', 3]],
    'light': [['scatters', 2.5], ['is', 1]],
    'shorter': [['wavelengths', 1]],
    'wavelengths': [['scatter', 2]],
    'scatter': [['away', 2], ['out', 1]],
    'scatters': [['away', 2.5], ['across', 1]],
    'across': [['the', 1]],
    'away': [['.', 2], ['leaving', 1]],
    'leaving': [['red', 1.5], ['orange', 1]],
    'out': [['.', 2]],
    'is': [['scattered', 2]],
    'scattered': [['away', 2]],
    'travels': [['through', 2]],
    'through': [['more', 1.5], ['the', 1]],
    'more': [['air', 1.5], ['atmosphere', 1.5]],
    'atmosphere': [['.', 1.5], ['and', 0.5]],
    'reddens': [['.', 2]],
    'and': [['the', 2]]
  };

  function initSampling() {
    var barsEl = $('#cg-samp-bars');
    var tempIn = $('#cg-samp-temp'), tempOut = $('#cg-samp-temp-out');
    var topkIn = $('#cg-samp-topk'), topkOut = $('#cg-samp-topk-out');
    var toppIn = $('#cg-samp-topp'), toppOut = $('#cg-samp-topp-out');
    var genBtn = $('#cg-samp-gen'), againBtn = $('#cg-samp-again');
    var outEl = $('#cg-samp-out');
    if (!barsEl || !tempIn || !topkIn || !toppIn || !genBtn || !outEl) { return; }

    var rows = SAMP_CANDS.map(function (c) {
      var row = document.createElement('div');
      row.className = 'cg-samp-bar';
      row.innerHTML = '<span class="cg-samp-word">' + c[0] + '</span>' +
        '<span class="cg-samp-track"><span class="cg-samp-fill"></span></span>' +
        '<span class="cg-samp-val"></span>';
      barsEl.appendChild(row);
      return row;
    });

    function settings() {
      return {
        temp: parseFloat(tempIn.value),
        topk: parseInt(topkIn.value, 10),
        topp: parseFloat(toppIn.value)
      };
    }

    function renderBars() {
      var s = settings();
      tempOut.textContent = s.temp.toFixed(2);
      topkOut.textContent = s.topk >= SAMP_CANDS.length ? 'all' : String(s.topk);
      toppOut.textContent = s.topp.toFixed(2);
      var dist = applySampling(SAMP_CANDS, s.temp, s.topk, s.topp);
      dist.forEach(function (d, i) {
        var row = rows[i];
        row.classList.toggle('is-cut', !d.kept);
        row.classList.remove('is-picked');
        var pct = d.kept ? d.p * 100 : d.raw * 100;
        $('.cg-samp-fill', row).style.width = clamp(pct, 0, 100).toFixed(1) + '%';
        $('.cg-samp-val', row).textContent = d.kept
          ? (d.p * 100).toFixed(1) + '%'
          : 'cut';
      });
      return dist;
    }

    [tempIn, topkIn, toppIn].forEach(function (el) {
      el.addEventListener('input', renderBars);
    });

    var rand = Math.random.bind(Math);

    function generate() {
      var s = settings();
      var greedy = s.temp <= 0.15;
      /* flash a pick on the visible distribution */
      var dist = renderBars();
      var picked = sampleFrom(dist, rand, greedy);
      rows[picked].classList.add('is-picked');

      /* then run the toy model with the same sampler */
      var words = [];
      var state = '<s>';
      for (var n = 0; n < 20; n++) {
        var cands = GEN[state.toLowerCase()] || [['.', 1]];
        var d = applySampling(cands, s.temp, s.topk, s.topp);
        var idx = sampleFrom(d, rand, greedy);
        var w = cands[idx][0];
        if (w === '.') { break; }
        words.push(w);
        state = w;
      }
      var sentence = words.join(' ') + '.';
      sentence = sentence.charAt(0).toUpperCase() + sentence.slice(1);
      outEl.textContent = '“' + sentence + '”  (temperature ' +
        s.temp.toFixed(2) + ', top-k ' +
        (s.topk >= SAMP_CANDS.length ? 'off' : s.topk) + ', top-p ' +
        s.topp.toFixed(2) + ')';
    }

    genBtn.addEventListener('click', generate);
    if (againBtn) { againBtn.addEventListener('click', generate); }
    renderBars();
  }

  /* ==========================================================================
     Chapter 11 — streaming vs waiting
     ========================================================================== */

  function initStreaming() {
    var play = $('#cg-stream-play');
    var waitB = $('#cg-stream-wait'), liveB = $('#cg-stream-live');
    var waitT = $('#cg-stream-wait-time'), liveT = $('#cg-stream-live-time');
    var status = $('#cg-stream-status');
    if (!play || !waitB || !liveB) { return; }

    var ANSWER = ('Sunsets look red because sunlight passes through much more ' +
      'atmosphere on its way to your eyes. Air molecules scatter the short blue ' +
      'wavelengths in every direction, so mostly the longer red and orange light ' +
      'survives the trip.').split(' ');
    var PER_WORD = 65;
    var timers = [];

    function resetSides() {
      timers.forEach(clearTimeout);
      timers = [];
      waitB.innerHTML = '<span class="cg-stream-placeholder">—</span>';
      liveB.innerHTML = '<span class="cg-stream-placeholder">—</span>';
      waitT.textContent = '';
      liveT.textContent = '';
    }

    play.addEventListener('click', function () {
      resetSides();
      var total = ANSWER.length * PER_WORD + 350;

      if (reduced()) {
        waitB.textContent = ANSWER.join(' ');
        liveB.textContent = ANSWER.join(' ');
        waitT.textContent = 'first word after ~' + (total / 1000).toFixed(1) + ' s';
        liveT.textContent = 'first word after ~0.3 s';
        if (status) {
          status.textContent = 'Same total time — streaming just shows each token as it exists.';
        }
        return;
      }

      play.disabled = true;
      if (status) { status.textContent = 'Both replies are being generated…'; }

      /* streaming side: words appear as generated */
      liveB.innerHTML = '';
      ANSWER.forEach(function (w, i) {
        timers.push(setTimeout(function () {
          liveB.appendChild(document.createTextNode((i ? ' ' : '') + w));
          if (i === 0) { liveT.textContent = 'first word after ~0.3 s'; }
          if (i === ANSWER.length - 1) {
            liveT.textContent = 'first word after ~0.3 s · done at ~' +
              (total / 1000).toFixed(1) + ' s';
          }
        }, 300 + i * PER_WORD));
      });

      /* waiting side: spinner until everything is done */
      waitB.innerHTML = '<span class="cg-spin" aria-hidden="true"></span>';
      timers.push(setTimeout(function () {
        waitB.textContent = ANSWER.join(' ');
        waitT.textContent = 'first word after ~' + (total / 1000).toFixed(1) + ' s';
        play.disabled = false;
        play.textContent = 'Run it again';
        if (status) {
          status.textContent = 'Identical generation time — only the delivery differed.';
          status.classList.add('is-ok');
        }
      }, 300 + total));
    });
  }

  /* ==========================================================================
     Chapter 12 — safety layers
     ========================================================================== */

  function initSafety() {
    var layers = $$('#chatgpt-experience .cg-safety-layer');
    var info = $('#cg-safety-info');
    if (!layers.length || !info) { return; }
    layers.forEach(function (l) {
      l.addEventListener('click', function () {
        layers.forEach(function (q) { q.classList.toggle('is-on', q === l); });
        info.textContent = l.dataset.note || '';
      });
    });
  }

  /* ==========================================================================
     Chapter 13 — scale: ambient canvas + batching trade-off
     ========================================================================== */

  function initScale() {
    var canvas = $('#cg-scale-canvas');
    var slider = $('#cg-scale-batch');
    var out = $('#cg-scale-batch-out');
    var latFill = $('#cg-scale-lat'), latVal = $('#cg-scale-lat-val');
    var thrFill = $('#cg-scale-thr'), thrVal = $('#cg-scale-thr-val');
    if (!slider || !latFill || !thrFill) { return; }

    function update() {
      var batch = parseInt(slider.value, 10);
      out.textContent = String(batch);
      /* illustrative model: per-token latency grows with batch, total
         throughput grows sublinearly — the labeled real dilemma */
      var lat = 40 + batch * 11;
      var thr = batch * 1000 / lat;
      var latMax = 40 + 64 * 11;
      var thrMax = 64 * 1000 / latMax;
      latFill.style.width = clamp(lat / latMax * 100, 2, 100).toFixed(1) + '%';
      thrFill.style.width = clamp(thr / thrMax * 100, 2, 100).toFixed(1) + '%';
      latVal.textContent = '~' + Math.round(lat) + ' ms';
      thrVal.textContent = '~' + Math.round(thr) + ' tok/s';
    }
    slider.addEventListener('input', update);
    update();

    if (!canvas) { return; }
    var fit = setupCanvas(canvas);
    var ctx = fit.ctx;
    var rng = makeRng(90210);
    var users = [];
    for (var i = 0; i < 70; i++) {
      users.push({ x: rng() * 0.4, y: 0.1 + rng() * 0.8, v: 0.05 + rng() * 0.09 });
    }

    function draw() {
      var w = fit.state.w, h = fit.state.h;
      ctx.clearRect(0, 0, w, h);

      /* the data center */
      var dcx = w * 0.78, dcy = h * 0.5;
      ctx.fillStyle = '#16213a';
      ctx.strokeStyle = 'rgba(45, 212, 191, 0.4)';
      ctx.beginPath();
      ctx.rect(dcx - 60, dcy - 70, 120, 140);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = C.muted;
      ctx.font = '600 11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('GPU fleet', dcx, dcy - 78);
      ctx.textAlign = 'start';
      for (var g = 0; g < 6; g++) {
        var pulse = reduced() ? 0.5 : 0.3 + 0.35 * Math.sin(performance.now() / 350 + g * 1.1);
        ctx.fillStyle = 'rgba(45, 212, 191, ' + pulse + ')';
        ctx.fillRect(dcx - 46, dcy - 56 + g * 20, 92, 12);
      }

      /* user dots streaming in */
      users.forEach(function (u) {
        var x = u.x * w, y = u.y * h;
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(56, 189, 248, 0.65)';
        ctx.fill();
      });
      ctx.fillStyle = C.faint;
      ctx.font = '600 10px Inter, sans-serif';
      ctx.fillText('millions of concurrent requests (illustrative)', 12, h - 12);
    }

    if (reduced()) {
      draw();
      return;
    }
    var loop = makeLoop(function (t, dt) {
      users.forEach(function (u) {
        u.x += u.v * dt / 1000;
        u.y += (0.5 - u.y) * 0.12 * dt / 1000 * (u.x * 2);
        if (u.x > 0.72) { u.x = -0.02; u.y = 0.1 + Math.random() * 0.8; }
      });
      draw();
    });
    onScreen(canvas, function () { loop.start(); }, function () { loop.stop(); });
  }

  /* ==========================================================================
     Playground — Trace My Prompt
     ========================================================================== */

  var TRACE_STEPS = [
    { name: 'Keyboard', t: '~1 ms', topic: 'cpu', link: '/cpu/', linkName: 'Inside a CPU',
      desc: 'Key presses become scancodes and hardware interrupts; the CPU briefly drops everything to record each one.' },
    { name: 'Operating system', t: '~0.1 ms', topic: 'os', link: '/operating-systems/', linkName: 'Understanding Operating Systems',
      desc: 'The kernel routes the input to the focused app and, on Send, exposes the network through the sockets API.' },
    { name: 'Browser', t: '~5 ms', topic: 'memory', link: '/memory/', linkName: 'Inside Memory',
      desc: 'Your prompt lives as UTF-8 bytes in the browser’s RAM until it is serialized into an HTTPS request.' },
    { name: 'DNS lookup', t: '~10–50 ms, often cached', topic: 'internet', link: '/internet/', linkName: 'How the Internet Works',
      desc: 'The chat service’s domain name is resolved to an IP address by the internet’s distributed directory.' },
    { name: 'TLS handshake', t: '~1 round trip', topic: 'cryptography', link: '/cryptography/', linkName: 'Understanding Cryptography',
      desc: 'Certificate verified, keys agreed — from here the prompt travels as ciphertext.' },
    { name: 'Internet backbone', t: '~20–150 ms', topic: 'internet', link: '/internet/', linkName: 'How the Internet Works',
      desc: 'Packets hop router to router — possibly under an ocean — to the provider’s nearest cloud region.' },
    { name: 'Load balancer', t: '~1 ms', topic: 'cloud', link: '/cloud/', linkName: 'Understanding Cloud Computing',
      desc: 'The front door of the region picks a healthy, not-too-busy application server for your request.' },
    { name: 'Inference service', t: 'ms–seconds of queueing', topic: 'cloud', link: '/cloud/', linkName: 'Understanding Cloud Computing',
      desc: 'Your prompt is validated, batched with other users’ requests, and scheduled onto GPU hardware.' },
    { name: 'Tokenization', t: '<1 ms', topic: 'ai', link: '/ai/', linkName: 'Understanding AI',
      desc: 'The text becomes token IDs — the only alphabet the model reads.' },
    { name: 'Transformer on GPUs', t: '~tens of ms to first token', topic: 'gpu', link: '/gpu/', linkName: 'Inside a Modern GPU',
      desc: 'Thousands of cores push your tokens through every layer: attention, feed-forward, repeat.' },
    { name: 'Token sampling', t: 'every single token', topic: 'ai', link: '/ai/', linkName: 'Understanding AI',
      desc: 'Temperature, top-k, and top-p turn the probability distribution into one chosen token — again and again.' },
    { name: 'Streaming back', t: 'tokens as they exist', topic: 'internet', link: '/internet/', linkName: 'How the Internet Works',
      desc: 'Each new token is encrypted and sent immediately over the same connection your prompt used.' },
    { name: 'Browser render', t: '~16 ms per frame', topic: 'cpu', link: '/cpu/', linkName: 'Inside a CPU',
      desc: 'The browser appends each token to the page and your CPU and GPU repaint the text.' },
    { name: 'Pixels on screen', t: 'total: roughly 1–3 s', topic: 'chatgpt', link: '/map/', linkName: 'The Technology Map',
      desc: 'The answer arrives word by word — the full stack of modern computing, once per message.' }
  ];

  function initTrace() {
    var stepsEl = $('#cg-trace-steps');
    var detail = $('#cg-trace-detail');
    var run = $('#cg-trace-run');
    var input = $('#cg-trace-input');
    if (!stepsEl || !detail || !run || !input) { return; }

    var lis = TRACE_STEPS.map(function (s, i) {
      var li = document.createElement('li');
      li.className = 'cg-trace-step is-pending';
      var b = document.createElement('button');
      b.type = 'button';
      var name = document.createElement('span');
      name.className = 'cg-trace-name';
      name.textContent = s.name;
      var time = document.createElement('span');
      time.className = 'cg-trace-time';
      time.textContent = s.t;
      b.appendChild(name);
      b.appendChild(time);
      b.addEventListener('click', function () { showDetail(i); });
      li.appendChild(b);
      stepsEl.appendChild(li);
      return li;
    });

    function showDetail(i, extra) {
      var s = TRACE_STEPS[i];
      lis.forEach(function (li, j) { li.classList.toggle('is-active', j === i); });
      detail.innerHTML = '';
      var p = document.createElement('p');
      var b = document.createElement('span');
      b.className = 'cg-trace-detail-name';
      b.textContent = (i + 1) + '. ' + s.name + ' · ' + s.t;
      p.appendChild(b);
      p.appendChild(document.createTextNode(s.desc + (extra || '')));
      detail.appendChild(p);
      var a = document.createElement('a');
      a.className = 'cg-trace-detail-link';
      a.href = s.link;
      a.textContent = 'Full exhibit: ' + s.linkName + ' →';
      detail.appendChild(a);
    }

    var timer = null;

    function finish(promptText) {
      LIT.light(['cpu', 'memory', 'os', 'internet', 'cryptography', 'cloud', 'gpu', 'ai', 'chatgpt']);
      lis.forEach(function (li) {
        li.classList.remove('is-pending', 'is-active');
        li.classList.add('is-done');
      });
      detail.innerHTML = '';
      var p = document.createElement('p');
      var b = document.createElement('span');
      b.className = 'cg-trace-detail-name';
      b.textContent = 'Delivered.';
      p.appendChild(b);
      p.appendChild(document.createTextNode('“' + promptText + '” made the full journey — ' +
        TRACE_STEPS.length + ' stages across ten technologies, in roughly the time it takes to blink twice. ' +
        'Select any stage above to revisit it.'));
      detail.appendChild(p);
      run.disabled = false;
      run.textContent = 'Trace it again';
      timer = null;
    }

    run.addEventListener('click', function () {
      if (timer) { clearTimeout(timer); }
      var promptText = (input.value || 'Explain why sunsets are red.').trim().slice(0, 120);
      lis.forEach(function (li) {
        li.classList.remove('is-done', 'is-active');
        li.classList.add('is-pending');
      });

      if (reduced()) {
        finish(promptText);
        return;
      }

      run.disabled = true;
      var i = 0;
      function next() {
        if (i >= TRACE_STEPS.length) { finish(promptText); return; }
        lis[i].classList.remove('is-pending');
        showDetail(i);
        i++;
        timer = setTimeout(next, 620);
      }
      next();
    });
  }

  /* ==========================================================================
     Constellation — the live knowledge graph
     ========================================================================== */

  function initConstellation() {
    var host = $('#cg-const');
    var countEl = $('#cg-const-count');
    var G = window.TECH_GRAPH;
    if (!host || !G) {
      if (host) { host.style.display = 'none'; }
      return;
    }

    var SVG_NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 1240 820');
    svg.setAttribute('role', 'group');
    svg.setAttribute('aria-label', 'Mini technology map — topics light up as you read this page.');

    var live = G.topics.filter(function (t) { return !!t.url; });
    var liveIds = {};
    live.forEach(function (t) { liveIds[t.id] = true; });

    var edgeEls = [];
    G.edges.forEach(function (e) {
      if (!liveIds[e.a] || !liveIds[e.b]) { return; }
      var a = G.byId[e.a], b = G.byId[e.b];
      var line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('class', 'cgc-edge');
      line.setAttribute('x1', a.x); line.setAttribute('y1', a.y);
      line.setAttribute('x2', b.x); line.setAttribute('y2', b.y);
      svg.appendChild(line);
      edgeEls.push({ e: e, el: line });
    });

    function hexPoints(r) {
      var pts = [];
      for (var i = 0; i < 6; i++) {
        var a = Math.PI / 180 * (60 * i - 90);
        pts.push((Math.cos(a) * r).toFixed(1) + ',' + (Math.sin(a) * r).toFixed(1));
      }
      return pts.join(' ');
    }

    var nodeEls = {};
    live.forEach(function (t) {
      var g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', 'cgc-node' + (t.capstone ? ' cgc-capstone' : ''));
      g.setAttribute('transform', 'translate(' + t.x + ',' + t.y + ')');
      g.setAttribute('tabindex', '0');
      g.setAttribute('role', 'link');
      g.setAttribute('aria-label', t.name + ' — open the exhibit');
      var cat = G.categories[t.cat];
      if (cat) { g.style.setProperty('--cat', cat.color); }

      var shape;
      if (t.capstone) {
        shape = document.createElementNS(SVG_NS, 'polygon');
        shape.setAttribute('points', hexPoints(34));
      } else {
        shape = document.createElementNS(SVG_NS, 'circle');
        shape.setAttribute('r', '26');
      }
      g.appendChild(shape);

      var label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('y', t.capstone ? 54 : 46);
      label.textContent = t.short;
      g.appendChild(label);

      g.addEventListener('click', function () { window.location.href = t.url; });
      g.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          window.location.href = t.url;
        }
      });
      g.style.cursor = 'pointer';

      svg.appendChild(g);
      nodeEls[t.id] = g;
    });

    host.appendChild(svg);

    function refresh() {
      var lit = 0;
      live.forEach(function (t) {
        var on = LIT.has(t.id);
        nodeEls[t.id].classList.toggle('is-lit', on);
        if (on) { lit++; }
      });
      edgeEls.forEach(function (rec) {
        rec.el.classList.toggle('is-lit', LIT.has(rec.e.a) && LIT.has(rec.e.b));
      });
      if (countEl) {
        countEl.textContent = lit
          ? 'Illuminated on this visit: ' + lit + ' of ' + live.length +
            ' exhibits. Run the prompt tracer above to complete the picture.'
          : 'Scroll the chapters (or run the tracer) to light up the map.';
        if (lit >= live.length - 2) {
          countEl.textContent = 'Illuminated: ' + lit + ' of ' + live.length +
            ' exhibits — one chat message really does take a whole map of computing.';
          countEl.classList.add('is-ok');
        }
      }
    }

    LIT.listeners.push(refresh);
    refresh();
  }

  /* ==========================================================================
     Boot — every widget isolated so one failure never breaks the page
     ========================================================================== */

  [
    initReveal, initRail, initIllumination, initHero,
    initLocalPipeline, initNetwork, initTls, initCloud,
    initTokenizer, initEmbeddings, initTransformer, initAttention,
    initGpuRace, initSampling, initStreaming, initSafety, initScale,
    initTrace, initConstellation
  ].forEach(function (init) {
    try { init(); } catch (e) {
      if (window.console && console.warn) { console.warn('[chatgpt]', init.name, e); }
    }
  });
})();
