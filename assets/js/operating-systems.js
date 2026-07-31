/* =============================================================================
   Understanding Operating Systems — interactivity
   Vanilla JS, no dependencies. Loaded with `defer` on /operating-systems/ only.

   Structure:
     1. Shared utilities (canvas fitting, visibility gating, rAF loops) —
        the same toolkit as the other exhibits
     2. One init function per widget, each guarded by element existence and
        wrapped in try/catch so one failure never takes down the page
     3. Everything respects prefers-reduced-motion: ambient animation is
        disabled and story animations jump to labeled final states

   Honesty notes: the scheduling playground runs a real discrete simulation
   of FCFS / Round Robin / Priority over a fixed workload — the Gantt chart,
   wait times, and switch counts are computed, not staged. The memory grid,
   virtual-memory translator, and file-system blocks track real state
   (allocations, mappings, refcounts). The hero board, context-switch scene,
   and control center are honest cartoons built to teach concepts, and the
   page copy says so where it matters.
   ============================================================================ */

(function () {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  document.documentElement.classList.add('os-js');

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

  function easeInOut(p) { return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawBox(ctx, x, y, w, h, opts) {
    opts = opts || {};
    roundRect(ctx, x, y, w, h, opts.r || 8);
    ctx.fillStyle = opts.fill || C.deep;
    ctx.fill();
    ctx.strokeStyle = opts.stroke || C.lineStrong;
    ctx.lineWidth = opts.lw || 1;
    ctx.stroke();
    if (opts.label) {
      ctx.fillStyle = opts.color || C.text;
      ctx.font = (opts.font || '600 12px') + ' Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(opts.label, x + w / 2, y + h / 2 + (opts.dy || 0));
    }
  }

  /* ==========================================================================
     Reveal-on-scroll + chapter rail
     ========================================================================== */

  function initReveal() {
    var els = $$('#os-experience [data-os-reveal]');
    if (!els.length) { return; }
    if (reduced() || !('IntersectionObserver' in window)) {
      els.forEach(function (el) { el.classList.add('is-in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.1 });
    els.forEach(function (el) { io.observe(el); });
  }

  function initRail() {
    var dots = $$('#os-experience .os-rail-dot');
    if (!dots.length || !('IntersectionObserver' in window)) { return; }
    var map = {};
    dots.forEach(function (d) {
      var id = (d.getAttribute('href') || '').slice(1);
      if (id) { map[id] = d; }
    });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var dot = map[e.target.id];
        if (!dot) { return; }
        if (e.isIntersecting) {
          dots.forEach(function (d) { d.classList.remove('is-active'); });
          dot.classList.add('is-active');
        }
      });
    }, { rootMargin: '-35% 0px -55% 0px' });
    Object.keys(map).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) { io.observe(el); }
    });
  }

  /* ==========================================================================
     Hero — a motherboard waking up as the OS boots
     ========================================================================== */

  function initHero() {
    var canvas = $('#os-hero-canvas');
    if (!canvas) { return; }
    var cv = setupCanvas(canvas, function () { draw(performance.now()); });
    var ctx = cv.ctx, st = cv.state;

    var BOOTLINES = [
      'Reached target: Graphical Interface',
      'Started scheduler on 8 CPUs',
      'Memory: 16268 MB available',
      'Mounted /dev/nvme0n1p2 as /',
      'Loaded driver: gpu, nvme, usbhid, wifi',
      'Started Network Manager',
      'Session opened for user'
    ];
    var lineEl = $('#os-hero-bootline');
    var lineIdx = 0;

    function layout() {
      var w = st.w, h = st.h;
      var cx = w / 2, cy = h / 2;
      var cpu = { x: cx - 46, y: cy - 46, w: 92, h: 92 };
      var parts = [
        { x: cx + 150, y: cy - 110, w: 26, h: 88, label: 'RAM' },
        { x: cx + 190, y: cy - 110, w: 26, h: 88, label: 'RAM' },
        { x: cx - 230, y: cy - 120, w: 74, h: 46, label: 'NIC' },
        { x: cx - 250, y: cy + 60, w: 90, h: 52, label: 'SSD' },
        { x: cx + 140, y: cy + 60, w: 110, h: 58, label: 'GPU' },
        { x: cx - 60, y: cy - 170, w: 120, h: 30, label: 'FIRMWARE' }
      ];
      var traces = parts.map(function (p) {
        var px = p.x + p.w / 2, py = p.y + p.h / 2;
        var midx = px, midy = cy;
        if (Math.abs(py - cy) > Math.abs(px - cx)) { midx = cx; midy = py; }
        return [{ x: cx, y: cy }, { x: midx, y: midy }, { x: px, y: py }];
      });
      return { cpu: cpu, parts: parts, traces: traces, cx: cx, cy: cy };
    }

    var pulses = [];
    var procs = [];
    var t0 = performance.now();

    function tracePoint(tr, p) {
      var seg = p < 0.5 ? 0 : 1;
      var lp = (p - seg * 0.5) * 2;
      var a = tr[seg], b = tr[seg + 1];
      return { x: a.x + (b.x - a.x) * lp, y: a.y + (b.y - a.y) * lp };
    }

    function draw(now) {
      var w = st.w, h = st.h;
      if (w < 60 || h < 60) { return; }
      var L = layout();
      var age = reduced() ? 60000 : now - t0;
      var boot = clamp(age / 14000, 0, 1);
      ctx.clearRect(0, 0, w, h);

      /* faint board grid */
      ctx.strokeStyle = 'rgba(30, 41, 59, 0.55)';
      ctx.lineWidth = 1;
      for (var gx = 0; gx < w; gx += 46) {
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke();
      }
      for (var gy = 0; gy < h; gy += 46) {
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
      }

      /* traces light up as boot progresses */
      L.traces.forEach(function (tr, i) {
        var lit = boot > (i + 1) / (L.traces.length + 1);
        ctx.strokeStyle = lit ? 'rgba(45, 212, 191, 0.4)' : 'rgba(51, 65, 85, 0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(tr[0].x, tr[0].y);
        ctx.lineTo(tr[1].x, tr[1].y);
        ctx.lineTo(tr[2].x, tr[2].y);
        ctx.stroke();
      });

      /* components */
      L.parts.forEach(function (p, i) {
        var lit = boot > (i + 1) / (L.parts.length + 1);
        drawBox(ctx, p.x, p.y, p.w, p.h, {
          r: 6,
          fill: lit ? 'rgba(20, 184, 166, 0.08)' : 'rgba(11, 17, 32, 0.9)',
          stroke: lit ? 'rgba(45, 212, 191, 0.5)' : C.lineStrong,
          label: p.w > 40 ? p.label : '',
          color: lit ? C.teal : C.faint,
          font: '700 9px'
        });
        if (p.w <= 40) {
          ctx.save();
          ctx.translate(p.x + p.w / 2, p.y + p.h / 2);
          ctx.rotate(-Math.PI / 2);
          ctx.fillStyle = lit ? C.teal : C.faint;
          ctx.font = '700 9px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(p.label, 0, 3);
          ctx.restore();
        }
      });

      /* CPU */
      var glow = 0.25 + 0.75 * boot;
      drawBox(ctx, L.cpu.x, L.cpu.y, L.cpu.w, L.cpu.h, {
        r: 10,
        fill: 'rgba(45, 212, 191, ' + (0.05 + 0.08 * boot) + ')',
        stroke: 'rgba(45, 212, 191, ' + glow + ')',
        lw: 2, label: 'KERNEL', color: C.teal, font: '800 13px'
      });

      if (!reduced()) {
        /* pulses along lit traces */
        if (Math.random() < 0.06 + 0.2 * boot) {
          var ti = Math.floor(Math.random() * L.traces.length);
          if (boot > (ti + 1) / (L.traces.length + 1)) {
            pulses.push({ tr: ti, p: 0, out: Math.random() < 0.5 });
          }
        }
        pulses = pulses.filter(function (pl) { return pl.p < 1; });
        pulses.forEach(function (pl) {
          pl.p += 0.014;
          var pt = tracePoint(L.traces[pl.tr], pl.out ? pl.p : 1 - pl.p);
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = pl.out ? C.teal : C.sky;
          ctx.fill();
        });

        /* processes appear around the kernel as the system comes alive */
        var want = Math.floor(boot * 10);
        while (procs.length < want) {
          procs.push({ a: Math.random() * Math.PI * 2, r: 90 + Math.random() * 40, s: 0.0002 + Math.random() * 0.0004 });
        }
        procs.forEach(function (pr) {
          pr.a += pr.s * 16;
          var px = L.cx + Math.cos(pr.a) * pr.r * 1.6;
          var py = L.cy + Math.sin(pr.a) * pr.r * 0.75;
          ctx.beginPath();
          ctx.arc(px, py, 3, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(2, 132, 199, 0.7)';
          ctx.fill();
        });
      } else {
        /* static final state: everything lit */
        for (var k = 0; k < 10; k++) {
          var a = (k / 10) * Math.PI * 2;
          ctx.beginPath();
          ctx.arc(L.cx + Math.cos(a) * 150, L.cy + Math.sin(a) * 78, 3, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(2, 132, 199, 0.7)';
          ctx.fill();
        }
      }
    }

    var loop = makeLoop(function (t) { draw(t); });
    if (reduced()) {
      draw(performance.now());
    } else {
      /* The boot-log ticker rides the same on-screen gate as the animation, so it
         stops cycling once the hero scrolls away instead of running forever. */
      var lineTimer = null;
      onScreen(canvas, function () {
        loop.start();
        if (lineEl && lineTimer === null) {
          lineTimer = setInterval(function () {
            lineIdx = (lineIdx + 1) % BOOTLINES.length;
            lineEl.textContent = BOOTLINES[lineIdx];
          }, 2600);
        }
      }, function () {
        loop.stop();
        if (lineTimer !== null) { clearInterval(lineTimer); lineTimer = null; }
      });
    }
  }

  /* ==========================================================================
     01 — With and without an OS
     ========================================================================== */

  function initWorld() {
    var canvas = $('#os-world-canvas');
    if (!canvas) { return; }
    var cv = setupCanvas(canvas, function () { draw(performance.now()); });
    var ctx = cv.ctx, st = cv.state;
    var statusEl = $('#os-world-status');
    var mode = 'chaos';
    var parts = [];      /* moving requests */
    var flashes = [];    /* collision flashes */
    var queue = [];      /* requests waiting inside the OS */
    var busy = {};       /* device -> until timestamp */
    var collisions = 0, served = 0;

    var APPS = ['Browser', 'Music', 'Game'];
    var HW = ['CPU', 'RAM', 'Disk', 'GPU'];
    var APPC = [C.sky, C.violet, C.amber];

    function layout() {
      var w = st.w, h = st.h;
      var appX = w * 0.06, hwX = w * 0.78, bw = w * 0.16, bh = 40;
      var apps = APPS.map(function (n, i) {
        return { n: n, x: appX, y: h * (0.22 + i * 0.28) - bh / 2, w: bw, h: bh, c: APPC[i] };
      });
      var hw = HW.map(function (n, i) {
        return { n: n, x: hwX, y: h * (0.14 + i * 0.24) - bh / 2, w: bw, h: bh };
      });
      var os = { x: w * 0.40, y: h * 0.14, w: w * 0.2, h: h * 0.72 };
      return { apps: apps, hw: hw, os: os };
    }

    function spawn(L) {
      var ai = Math.floor(Math.random() * 3);
      var hi = Math.floor(Math.random() * 4);
      var a = L.apps[ai], t = L.hw[hi];
      parts.push({
        c: a.c, hi: hi,
        x: a.x + a.w, y: a.y + a.h / 2,
        stage: 0, p: 0
      });
    }

    function draw(now) {
      var w = st.w, h = st.h;
      if (w < 60 || h < 60) { return; }
      var L = layout();
      ctx.clearRect(0, 0, w, h);

      L.apps.forEach(function (a) {
        drawBox(ctx, a.x, a.y, a.w, a.h, { label: a.n, stroke: a.c, color: C.strong });
      });
      L.hw.forEach(function (d, i) {
        var hot = busy[i] && busy[i] > now;
        drawBox(ctx, d.x, d.y, d.w, d.h, {
          label: d.n, stroke: hot ? C.teal : C.lineStrong, color: C.strong
        });
      });

      if (mode === 'os') {
        drawBox(ctx, L.os.x, L.os.y, L.os.w, L.os.h, {
          r: 12, fill: 'rgba(139, 92, 246, 0.07)', stroke: 'rgba(139, 92, 246, 0.55)',
          label: '', lw: 1.5
        });
        ctx.fillStyle = '#c4b5fd';
        ctx.font = '700 12px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('OPERATING SYSTEM', L.os.x + L.os.w / 2, L.os.y + 20);
        ctx.fillStyle = C.faint;
        ctx.font = '500 10px Inter, sans-serif';
        ctx.fillText('checks · queues · dispatches', L.os.x + L.os.w / 2, L.os.y + 36);
        /* the queue, drawn as stacked slots */
        queue.forEach(function (q, i) {
          var qy = L.os.y + 52 + i * 14;
          if (qy > L.os.y + L.os.h - 12) { return; }
          ctx.fillStyle = q.c;
          roundRect(ctx, L.os.x + L.os.w * 0.2, qy, L.os.w * 0.6, 9, 3);
          ctx.fill();
        });
      }

      parts.forEach(function (p) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = p.c;
        ctx.fill();
      });

      flashes = flashes.filter(function (f) { return f.until > now; });
      flashes.forEach(function (f) {
        ctx.beginPath();
        ctx.arc(f.x, f.y, 12 + (f.until - now) / 20, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(225, 29, 72, 0.8)';
        ctx.lineWidth = 2;
        ctx.stroke();
      });
    }

    function step(now, dt, L) {
      if (Math.random() < dt / 420) { spawn(L); }

      parts.forEach(function (p) {
        var t = L.hw[p.hi];
        var tx = t.x, ty = t.y + t.h / 2;
        if (mode === 'chaos') {
          /* straight to the device */
          p.x += (tx - p.x) * 0.03 * (dt / 16);
          p.y += (ty - p.y) * 0.03 * (dt / 16);
          if (Math.abs(p.x - tx) < 6) {
            p.done = true;
            if (busy[p.hi] && busy[p.hi] > now) {
              collisions++;
              flashes.push({ x: tx, y: ty, until: now + 400 });
            }
            busy[p.hi] = now + 500;
          }
        } else {
          /* via the OS */
          if (p.stage === 0) {
            var ox = L.os.x, oy = L.os.y + L.os.h / 2;
            p.x += (ox - p.x) * 0.04 * (dt / 16);
            p.y += (oy - p.y) * 0.04 * (dt / 16);
            if (Math.abs(p.x - ox) < 6) { p.stage = 1; queue.push(p); }
          } else if (p.stage === 2) {
            p.x += (tx - p.x) * 0.04 * (dt / 16);
            p.y += (ty - p.y) * 0.04 * (dt / 16);
            if (Math.abs(p.x - tx) < 6) { p.done = true; served++; busy[p.hi] = now + 350; }
          }
        }
      });

      if (mode === 'os' && queue.length) {
        /* dispatch the head of the queue if its device is idle */
        var head = queue[0];
        if (!busy[head.hi] || busy[head.hi] <= now) {
          queue.shift();
          head.stage = 2;
          head.x = L.os.x + L.os.w;
          head.y = L.os.y + L.os.h / 2;
          busy[head.hi] = now + 350;
        }
      }

      parts = parts.filter(function (p) { return !p.done; });

      if (statusEl) {
        statusEl.textContent = mode === 'chaos'
          ? 'Collisions so far: ' + collisions + ' — nobody is checking who touches what.'
          : 'Requests served in order: ' + served + ' — zero collisions since the OS took over.';
        statusEl.classList.toggle('is-bad', mode === 'chaos' && collisions > 0);
        statusEl.classList.toggle('is-ok', mode === 'os' && served > 0);
      }
    }

    var loop = makeLoop(function (t, dt) {
      if (st.w < 60 || st.h < 60) { return; }
      var L = layout();
      step(t, dt, L);
      draw(t);
    });

    $$('#os-experience [data-os-world]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$('#os-experience [data-os-world]').forEach(function (b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
        mode = btn.getAttribute('data-os-world');
        parts = []; queue = []; busy = {}; collisions = 0; served = 0;
        if (reduced()) { draw(performance.now()); }
      });
    });

    if (reduced()) {
      draw(performance.now());
      setStatus(statusEl, 'Animation disabled (reduced motion): without an OS, three apps hit the same hardware at once and collide; with one, every request is queued and dispatched safely.');
    } else {
      onScreen(canvas, function () { loop.start(); }, function () { loop.stop(); });
    }
  }

  /* ==========================================================================
     02 — Boot process stepper
     ========================================================================== */

  function initBoot() {
    var nodes = $$('#os-experience .os-boot-node');
    if (!nodes.length) { return; }
    var screen = $('#os-boot-screen');
    var titleEl = $('#os-boot-title');
    var textEl = $('#os-boot-text');
    var prev = $('#os-boot-prev'), next = $('#os-boot-next'), play = $('#os-boot-play');
    var statusEl = $('#os-boot-status');
    var idx = 0, timer = null;

    var STEPS = [
      {
        title: 'Power on',
        text: 'Electricity reaches the board. The CPU is hard-wired to start executing at one fixed address — which is where the firmware chip is mapped. No operating system exists yet; the machine knows only this one reflex.',
        scr: '<span class="os-scr-dim">&nbsp;</span>'
      },
      {
        title: 'Firmware (UEFI / BIOS)',
        text: 'A small program burned into the motherboard wakes the hardware: it initializes RAM, counts the CPUs, enumerates disks and USB devices, runs a quick self-test, and then goes looking for something bootable.',
        scr: '<span class="os-scr-title">UEFI v2.10</span><br><span class="os-scr-dim">CPU: 8 cores &middot; OK</span><br><span class="os-scr-dim">Memory test: 16384 MB</span> <span class="os-scr-ok">OK</span><br><span class="os-scr-dim">NVMe SSD: 1 TB detected</span><br><span class="os-scr-accent">Scanning boot devices&hellip;</span>'
      },
      {
        title: 'Boot loader',
        text: 'The firmware loads a tiny program from the disk’s boot partition and hands over. The boot loader’s whole job is to find the operating system kernel, copy it into memory, and jump to its first instruction. Dual-boot menus live here.',
        scr: '<span class="os-scr-title">Boot manager</span><br><br><span class="os-scr-ok">&#9656; This OS</span><br><span class="os-scr-dim">&nbsp;&nbsp;Other OS</span><br><span class="os-scr-dim">&nbsp;&nbsp;Recovery mode</span>'
      },
      {
        title: 'Kernel',
        text: 'The kernel takes control of the machine — the last handoff there will ever be. It sets up its own memory management, turns on virtual memory, configures the scheduler and interrupt handling, and becomes the permanent authority under everything else.',
        scr: '<span class="os-scr-dim">[ 0.000000 ] Kernel starting&hellip;</span><br><span class="os-scr-dim">[ 0.002114 ] Virtual memory enabled</span><br><span class="os-scr-dim">[ 0.004530 ] Scheduler online: 8 CPUs</span><br><span class="os-scr-dim">[ 0.006802 ] Interrupt controllers ready</span><br><span class="os-scr-ok">[ 0.009117 ] Mounting root file system&hellip;</span>'
      },
      {
        title: 'Drivers',
        text: 'The kernel probes the hardware and loads a driver for each device it finds — storage, graphics, network, input. From here on, the machine’s dialects are translated. (Chapter 10 is all about this layer.)',
        scr: '<span class="os-scr-ok">[ OK ]</span> <span class="os-scr-dim">nvme &mdash; storage driver</span><br><span class="os-scr-ok">[ OK ]</span> <span class="os-scr-dim">gpu &mdash; display driver</span><br><span class="os-scr-ok">[ OK ]</span> <span class="os-scr-dim">wifi &mdash; network driver</span><br><span class="os-scr-ok">[ OK ]</span> <span class="os-scr-dim">usbhid &mdash; keyboard &amp; mouse</span>'
      },
      {
        title: 'Services',
        text: 'The first user-space process starts (init, systemd, or the Windows Session Manager) and launches the background services: networking, audio, printing, search indexing, the login manager. The system is now multitasking.',
        scr: '<span class="os-scr-ok">[ OK ]</span> <span class="os-scr-dim">Started Network Manager</span><br><span class="os-scr-ok">[ OK ]</span> <span class="os-scr-dim">Started Audio Service</span><br><span class="os-scr-ok">[ OK ]</span> <span class="os-scr-dim">Started Update Service</span><br><span class="os-scr-ok">[ OK ]</span> <span class="os-scr-dim">Reached target: Login Screen</span>'
      },
      {
        title: 'Login screen',
        text: 'The display server and login manager draw the first real pixels. Everything below this point kept no opinion about who you are; from here on, permissions and per-user settings apply (chapter 12).',
        scr: '<span class="os-scr-title">Welcome</span><br><br><span class="os-scr-dim">&#9634; you@this-machine</span><br><span class="os-scr-accent">Password: &bull;&bull;&bull;&bull;&bull;&bull;</span>'
      },
      {
        title: 'Desktop',
        text: 'The shell — desktop, taskbar, icons — starts as an ordinary user-space process, and startup apps launch behind it. Total elapsed time: a few seconds, containing this entire relay race.',
        scr: '<span class="os-scr-title">Desktop</span><div class="os-scr-desktop"><span class="os-scr-icon"></span><span class="os-scr-icon"></span><span class="os-scr-icon"></span><span class="os-scr-icon"></span><span class="os-scr-icon"></span><span class="os-scr-icon"></span><span class="os-scr-icon"></span><span class="os-scr-icon"></span></div>'
      }
    ];

    function render() {
      nodes.forEach(function (n, i) {
        n.classList.toggle('is-active', i === idx);
        n.classList.toggle('is-done', i < idx);
      });
      var s = STEPS[idx];
      if (titleEl) { titleEl.textContent = (idx + 1) + '. ' + s.title; }
      if (textEl) { textEl.textContent = s.text; }
      if (screen) { screen.innerHTML = s.scr; }
      if (prev) { prev.disabled = idx === 0; }
      if (next) { next.disabled = idx === STEPS.length - 1; }
      setStatus(statusEl, 'Phase ' + (idx + 1) + ' of ' + STEPS.length);
    }

    function stopAuto() {
      if (timer) { clearInterval(timer); timer = null; }
      if (play) { play.textContent = 'Auto-play'; }
    }

    if (prev) { prev.addEventListener('click', function () { stopAuto(); idx = Math.max(0, idx - 1); render(); }); }
    if (next) { next.addEventListener('click', function () { stopAuto(); idx = Math.min(STEPS.length - 1, idx + 1); render(); }); }
    if (play) {
      play.addEventListener('click', function () {
        if (timer) { stopAuto(); return; }
        if (idx >= STEPS.length - 1) { idx = 0; }
        render();
        play.textContent = 'Stop';
        timer = setInterval(function () {
          if (idx >= STEPS.length - 1) { stopAuto(); return; }
          idx++;
          render();
        }, reduced() ? 4200 : 2600);
      });
    }

    render();
  }

  /* ==========================================================================
     03 — The kernel map
     ========================================================================== */

  function initKernel() {
    var mods = $$('#os-experience .os-kmod');
    if (!mods.length) { return; }
    var info = $('#os-kernel-info');
    var send = $('#os-kernel-send');
    var statusEl = $('#os-kernel-status');
    var dot = $('#os-kmap-dot');
    var timers = [];

    var KMODS = {
      sched: 'The scheduler decides which thread runs on which CPU core, and for how long. It balances responsiveness (interactive apps get quick turns) against throughput (heavy jobs still finish) — chapter 5 lets you drive it yourself.',
      mem: 'The memory manager owns every page of RAM: it hands pages to processes, keeps them isolated from each other, shares read-only pages where safe, and runs the virtual-memory machinery of chapters 7 and 8.',
      vfs: 'The file-system layer turns names and folders into disk blocks and back — one common interface (open, read, write) over NTFS, APFS, ext4, or a USB stick’s FAT32. Chapter 9 takes it apart.',
      net: 'The network stack builds and parses packets — TCP, UDP, IP — so applications can just say “send these bytes to that server.” Where those packets go next is the whole story of How the Internet Works.',
      drv: 'Device drivers live (mostly) inside the kernel and speak each device’s private dialect — chapter 10. Running privileged is what makes a buggy driver so much more dangerous than a buggy app.',
      sec: 'The security layer checks every request against accounts, permissions, and sandbox rules before any other subsystem acts on it — chapter 12. Its power comes from position: nothing reaches hardware without passing it.'
    };

    function show(key) {
      mods.forEach(function (m) { m.classList.toggle('is-active', m.getAttribute('data-kmod') === key); });
      if (info) { info.textContent = KMODS[key]; }
    }

    mods.forEach(function (m) {
      m.addEventListener('click', function () { show(m.getAttribute('data-kmod')); });
    });
    show('sched');

    if (send) {
      send.addEventListener('click', function () {
        timers.forEach(clearTimeout);
        timers = [];
        var SEQ = [
          ['The editor calls write(file, bytes) — user space cannot touch the disk itself…', 'vfs'],
          ['Mode switch: the CPU drops into kernel mode at the system-call entry point.', 'sec'],
          ['Security checks the file’s permissions; the file system maps bytes to blocks.', 'vfs'],
          ['The disk driver issues the hardware commands; the write completes.', 'drv'],
          ['Back to user mode with a return value. Total round trip: microseconds.', null]
        ];
        if (reduced()) {
          setStatus(statusEl, SEQ.map(function (s) { return s[0]; }).join(' '), 'ok');
          return;
        }
        send.disabled = true;
        if (dot) {
          dot.classList.add('is-moving');
          dot.style.transition = 'none';
          dot.style.left = '12%';
        }
        SEQ.forEach(function (s, i) {
          timers.push(setTimeout(function () {
            setStatus(statusEl, s[0], i === SEQ.length - 1 ? 'ok' : null);
            if (s[1]) { show(s[1]); }
            if (dot) {
              dot.style.transition = 'left 1.1s ease';
              dot.style.left = (12 + (i + 1) * 15) + '%';
            }
            if (i === SEQ.length - 1) {
              if (dot) { dot.classList.remove('is-moving'); }
              send.disabled = false;
            }
          }, i * 1200));
        });
      });
    }
  }

  /* ==========================================================================
     04 — Processes & threads
     ========================================================================== */

  function initProc() {
    var list = $('#os-proc-list');
    if (!list) { return; }
    var statusEl = $('#os-proc-status');
    var pid = 412;

    var APPS = {
      browser: {
        name: 'Browser', color: C.sky, mem: 940,
        threads: ['UI thread', 'Network thread', 'JavaScript engine', 'Compositor']
      },
      music: {
        name: 'Music Player', color: C.violet, mem: 180,
        threads: ['UI thread', 'Decoder thread', 'Audio output']
      },
      game: {
        name: 'Game', color: C.amber, mem: 2100,
        threads: ['Render thread', 'Physics thread', 'Audio thread', 'AI thread', 'Asset loader']
      },
      terminal: {
        name: 'Terminal', color: C.cTeal, mem: 40,
        threads: ['Main thread']
      }
    };

    function launch(key) {
      var app = APPS[key];
      if (!app) { return; }
      if (list.children.length >= 8) {
        setStatus(statusEl, 'Enough processes for one demo — kill one first (real OSes handle thousands).', 'bad');
        return;
      }
      pid += 1 + Math.floor(Math.random() * 7);
      var myPid = pid;
      var card = document.createElement('div');
      card.className = 'os-proc';
      var head = document.createElement('button');
      head.type = 'button';
      head.className = 'os-proc-head';
      head.setAttribute('aria-expanded', 'false');
      head.innerHTML = '<span class="os-proc-swatch" style="background:' + app.color + '"></span>' +
        app.name + '<span class="os-proc-pid">PID ' + myPid + '</span>';
      var meta = document.createElement('div');
      meta.className = 'os-proc-meta';
      meta.textContent = app.mem + ' MB private memory · ' + app.threads.length +
        (app.threads.length === 1 ? ' thread' : ' threads') + ' · running';
      var tw = document.createElement('div');
      tw.className = 'os-proc-threads';
      app.threads.forEach(function (t) {
        var row = document.createElement('div');
        row.className = 'os-thread';
        row.innerHTML = '<span>' + t + '</span><span class="os-thread-bar"><span style="background:' + app.color + ';animation-delay:-' + (Math.random() * 1.6).toFixed(2) + 's"></span></span>';
        tw.appendChild(row);
      });
      var note = document.createElement('div');
      note.className = 'os-proc-meta';
      note.textContent = app.threads.length > 1
        ? 'These threads share this process’s memory — and can run on different cores at once.'
        : 'One thread: this process does one thing at a time.';
      tw.appendChild(note);
      var kill = document.createElement('button');
      kill.type = 'button';
      kill.className = 'os-proc-kill';
      kill.textContent = 'End process';
      kill.addEventListener('click', function () {
        card.remove();
        setStatus(statusEl, 'PID ' + myPid + ' (' + app.name + ') terminated — the OS reclaimed its ' +
          app.mem + ' MB and closed its files. No other process noticed.', 'ok');
      });
      head.addEventListener('click', function () {
        var open = card.classList.toggle('is-open');
        head.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      card.appendChild(head);
      card.appendChild(meta);
      card.appendChild(tw);
      card.appendChild(kill);
      list.appendChild(card);
      setStatus(statusEl, 'Created PID ' + myPid + ': own address space, own open files, ' +
        app.threads.length + (app.threads.length === 1 ? ' thread' : ' threads') + '. Click the card to look inside.');
    }

    $$('#os-experience [data-os-launch]').forEach(function (btn) {
      btn.addEventListener('click', function () { launch(btn.getAttribute('data-os-launch')); });
    });
  }

  /* ==========================================================================
     05 — CPU scheduling simulator
     ========================================================================== */

  function initSched() {
    var canvas = $('#os-sched-canvas');
    if (!canvas) { return; }
    var cv = setupCanvas(canvas, function () { drawFrame(playT); });
    var ctx = cv.ctx, st = cv.state;
    var runBtn = $('#os-sched-run'), resetBtn = $('#os-sched-reset');
    var statusEl = $('#os-sched-status');
    var metrics = $('#os-sched-metrics');
    var qWrap = $('#os-sched-quantumwrap');
    var qRange = $('#os-sched-quantum'), qVal = $('#os-sched-quantumval');
    var policy = 'fcfs';
    var playT = 0;            /* current sim-time of the playhead, ms */
    var result = null;        /* {timeline, procs, total, switches} */
    var loop = null;

    var PROCS = [
      { id: 0, name: 'Video encode', arrival: 0, burst: 260, prio: 3, color: C.amber },
      { id: 1, name: 'File copy', arrival: 10, burst: 140, prio: 4, color: C.sky },
      { id: 2, name: 'Music decode', arrival: 20, burst: 80, prio: 2, color: C.violet },
      { id: 3, name: 'Mouse click', arrival: 30, burst: 20, prio: 1, color: C.cTeal },
      { id: 4, name: 'Spreadsheet recalc', arrival: 40, burst: 120, prio: 5, color: C.lime }
    ];

    /* Discrete 1 ms simulation. Returns the timeline of who held the CPU. */
    function simulate(pol, quantum) {
      var rem = PROCS.map(function (p) { return p.burst; });
      var done = PROCS.map(function () { return false; });
      var finish = PROCS.map(function () { return 0; });
      var first = PROCS.map(function () { return -1; });
      var timeline = [];
      var t = 0, current = -1, slice = 0, switches = 0;
      var queueOrder = [];   /* fifo for fcfs/rr */

      function arrivedNotQueued() {
        PROCS.forEach(function (p) {
          if (p.arrival <= t && !done[p.id] && queueOrder.indexOf(p.id) === -1 && p.id !== current) {
            queueOrder.push(p.id);
          }
        });
      }

      function pickNext() {
        arrivedNotQueued();
        if (!queueOrder.length) { return -1; }
        if (pol === 'prio') {
          queueOrder.sort(function (a, b) { return PROCS[a].prio - PROCS[b].prio || PROCS[a].arrival - PROCS[b].arrival; });
        }
        return queueOrder.shift();
      }

      var guard = 0;
      while (done.indexOf(false) !== -1 && guard++ < 5000) {
        if (current === -1) {
          current = pickNext();
          slice = 0;
          if (current === -1) { t++; continue; }
          switches++;
          if (first[current] === -1) { first[current] = t; }
        }
        /* run 1 ms */
        rem[current]--;
        slice++;
        t++;
        var last = timeline[timeline.length - 1];
        if (last && last.id === current && last.end === t - 1) { last.end = t; }
        else { timeline.push({ id: current, start: t - 1, end: t }); }

        if (rem[current] === 0) {
          done[current] = true;
          finish[current] = t;
          current = -1;
        } else if (pol === 'rr' && slice >= quantum) {
          arrivedNotQueued();
          queueOrder.push(current);
          current = -1;
        }
      }

      var stats = PROCS.map(function (p) {
        var turnaround = finish[p.id] - p.arrival;
        return {
          name: p.name, color: p.color,
          wait: turnaround - p.burst,
          turnaround: turnaround,
          response: first[p.id] - p.arrival
        };
      });
      return { timeline: timeline, total: t, switches: switches - 1, stats: stats };
    }

    function layout() {
      var w = st.w, h = st.h;
      return {
        rowY: function (i) { return 84 + i * ((h - 130) / PROCS.length); },
        rowH: Math.min(34, (h - 140) / PROCS.length - 8),
        gx: 150, gw: w - 150 - 16,
        queueY: 16, cpuY: 40
      };
    }

    function timeX(L, t, total) { return L.gx + (t / total) * L.gw; }

    function drawFrame(tNow) {
      var w = st.w, h = st.h;
      if (w < 60 || h < 60) { return; }
      var L = layout();
      ctx.clearRect(0, 0, w, h);
      var total = result ? result.total : 620;

      /* axis */
      ctx.strokeStyle = C.line;
      ctx.lineWidth = 1;
      for (var tick = 0; tick <= total; tick += 100) {
        var x = timeX(L, tick, total);
        ctx.beginPath(); ctx.moveTo(x, 74); ctx.lineTo(x, h - 30); ctx.stroke();
        ctx.fillStyle = C.faint;
        ctx.font = '500 10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(tick + ' ms', x, h - 16);
      }

      /* process rows */
      PROCS.forEach(function (p, i) {
        var y = L.rowY(i);
        ctx.fillStyle = C.text;
        ctx.font = '600 11px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.name, 10, y + L.rowH / 2);
        ctx.fillStyle = C.faint;
        ctx.font = '500 9px Inter, sans-serif';
        ctx.fillText(p.burst + ' ms of work' + (policy === 'prio' ? ' · priority ' + p.prio : ''), 10, y + L.rowH / 2 + 13);
        roundRect(ctx, L.gx, y, L.gw, L.rowH, 4);
        ctx.fillStyle = 'rgba(30, 41, 59, 0.5)';
        ctx.fill();
      });

      if (result) {
        /* gantt segments up to the playhead */
        result.timeline.forEach(function (seg) {
          if (seg.start >= tNow) { return; }
          var p = PROCS[seg.id];
          var i = seg.id;
          var x0 = timeX(L, seg.start, total);
          var x1 = timeX(L, Math.min(seg.end, tNow), total);
          ctx.fillStyle = p.color;
          roundRect(ctx, x0, L.rowY(i), Math.max(1.5, x1 - x0), L.rowH, 3);
          ctx.fill();
        });

        /* playhead */
        if (tNow < total) {
          var px = timeX(L, tNow, total);
          ctx.strokeStyle = C.teal;
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(px, 70); ctx.lineTo(px, h - 30); ctx.stroke();
        }

        /* CPU + ready queue header at the playhead */
        var runningSeg = null;
        for (var s = 0; s < result.timeline.length; s++) {
          if (result.timeline[s].start <= tNow && tNow < result.timeline[s].end) { runningSeg = result.timeline[s]; break; }
        }
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.font = '700 11px Inter, sans-serif';
        ctx.fillStyle = C.faint;
        ctx.fillText('CPU:', 10, L.cpuY);
        if (runningSeg !== null) {
          var rp = PROCS[runningSeg.id];
          ctx.fillStyle = rp.color;
          roundRect(ctx, 48, L.cpuY - 10, 130, 20, 5);
          ctx.fill();
          ctx.fillStyle = '#0b1120';
          ctx.font = '700 10px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(rp.name, 48 + 65, L.cpuY);
        } else if (tNow < total) {
          ctx.fillStyle = C.faint;
          ctx.fillText('idle', 48, L.cpuY);
        }

        ctx.textAlign = 'left';
        ctx.fillStyle = C.faint;
        ctx.font = '700 11px Inter, sans-serif';
        ctx.fillText('Ready:', 200, L.cpuY);
        var qx = 248;
        PROCS.forEach(function (p) {
          if (p.arrival > tNow) { return; }
          var finished = true;
          var started = false;
          result.timeline.forEach(function (seg) {
            if (seg.id !== p.id) { return; }
            if (seg.end > tNow) { finished = false; }
            if (seg.start <= tNow && tNow < seg.end) { started = true; }
          });
          /* crude but honest: in queue if arrived, not running, not finished */
          var lastEnd = 0;
          result.timeline.forEach(function (seg) { if (seg.id === p.id) { lastEnd = seg.end; } });
          if (lastEnd <= tNow) { finished = true; }
          if (started || finished) { return; }
          ctx.fillStyle = p.color;
          roundRect(ctx, qx, L.cpuY - 8, 16, 16, 4);
          ctx.fill();
          qx += 22;
        });
      } else {
        ctx.fillStyle = C.faint;
        ctx.font = '600 12px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('Press “Run workload” to start the simulation.', 10, L.cpuY);
      }
    }

    function fillMetrics() {
      if (!metrics || !result) { return; }
      var tbody = metrics.querySelector('tbody');
      if (!tbody) { return; }
      var avgW = 0, avgT = 0;
      result.stats.forEach(function (s) { avgW += s.wait; avgT += s.turnaround; });
      avgW = Math.round(avgW / result.stats.length);
      avgT = Math.round(avgT / result.stats.length);
      var click = result.stats[3];
      tbody.innerHTML =
        '<tr><td>Time until the mouse click was handled</td><td>' + click.response + ' ms</td></tr>' +
        '<tr><td>Average waiting time</td><td>' + avgW + ' ms</td></tr>' +
        '<tr><td>Average turnaround (arrive → finish)</td><td>' + avgT + ' ms</td></tr>' +
        '<tr><td>Context switches</td><td>' + result.switches + '</td></tr>' +
        '<tr class="is-total"><td>Everything finished at</td><td>' + result.total + ' ms</td></tr>';
      metrics.hidden = false;
    }

    function run() {
      var q = qRange ? parseInt(qRange.value, 10) : 30;
      result = simulate(policy, q);
      playT = 0;
      if (metrics) { metrics.hidden = true; }
      if (reduced()) {
        playT = result.total;
        drawFrame(playT);
        fillMetrics();
        setStatus(statusEl, 'Done (animation skipped): read the chart and the numbers below.', 'ok');
        return;
      }
      if (runBtn) { runBtn.disabled = true; }
      setStatus(statusEl, 'Running…');
      loop.start();
    }

    loop = makeLoop(function (t, dt) {
      if (!result) { loop.stop(); return; }
      playT += dt * 0.11; /* ~ sim runs 0.11 ms per real ms => ~5.6 s for 620 ms */
      if (playT >= result.total) {
        playT = result.total;
        drawFrame(playT);
        loop.stop();
        if (runBtn) { runBtn.disabled = false; }
        fillMetrics();
        setStatus(statusEl, 'Done — the numbers below are computed from this exact run.', 'ok');
        return;
      }
      drawFrame(playT);
    });

    $$('#os-experience [data-os-policy]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$('#os-experience [data-os-policy]').forEach(function (b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
        policy = btn.getAttribute('data-os-policy');
        if (qWrap) { qWrap.hidden = policy !== 'rr'; }
        result = null;
        loop.stop();
        if (runBtn) { runBtn.disabled = false; }
        if (metrics) { metrics.hidden = true; }
        drawFrame(0);
        setStatus(statusEl, policy === 'prio'
          ? 'Priority: lower number = more important. Note who ends up waiting.'
          : (policy === 'rr' ? 'Round Robin: every process gets a slice of ' + (qRange ? qRange.value : 30) + ' ms in turn.' : ''));
      });
    });

    if (qRange) {
      qRange.addEventListener('input', function () {
        if (qVal) { qVal.textContent = qRange.value; }
        result = null;
        loop.stop();
        if (metrics) { metrics.hidden = true; }
        drawFrame(0);
      });
    }

    if (runBtn) { runBtn.addEventListener('click', run); }
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        result = null;
        playT = 0;
        loop.stop();
        if (runBtn) { runBtn.disabled = false; }
        if (metrics) { metrics.hidden = true; }
        drawFrame(0);
        setStatus(statusEl, '');
      });
    }

    drawFrame(0);
    onScreen(canvas, null, function () {
      if (loop.running()) {
        loop.stop();
        if (result) { playT = result.total; drawFrame(playT); fillMetrics(); }
        if (runBtn) { runBtn.disabled = false; }
      }
    });
  }

  /* ==========================================================================
     06 — Context switching
     ========================================================================== */

  function initCtx() {
    var canvas = $('#os-ctx-canvas');
    if (!canvas) { return; }
    var cv = setupCanvas(canvas, function () { draw(); });
    var ctx = cv.ctx, st = cv.state;
    var rate = $('#os-ctx-rate'), rateVal = $('#os-ctx-rateval');
    var overheadEl = $('#os-ctx-overhead');

    var RATES = [1, 10, 100, 1000, 10000];
    var SWITCH_US = 50; /* per switch incl. cache warm-up — generous, labeled */
    var rateIdx = rate ? parseInt(rate.value, 10) : 1;

    /* animation state: a repeating cycle run A -> save -> load -> run B -> ... */
    var phase = 0;       /* 0 runA, 1 save, 2 load, 3 runB, 4 save, 5 load */
    var phaseT = 0;
    var regsA = [4096, 8192, 17, 3];
    var regsB = [12288, 20480, 99, 7];
    var strip = [];      /* [{who: 'a'|'b'|'x', w}] timeline strip */

    function overheadPct() {
      var r = RATES[rateIdx];
      return r * SWITCH_US / 1e6 * 100;
    }

    function updateOverhead() {
      if (rateVal) { rateVal.textContent = RATES[rateIdx].toLocaleString('en-US'); }
      var pct = overheadPct();
      setStatus(overheadEl,
        'Overhead: ~' + (pct < 0.1 ? pct.toFixed(3) : pct.toFixed(1)) + '% of CPU time spent switching' +
        ' (at ~' + SWITCH_US + ' µs per switch, cache warm-up included)',
        pct >= 10 ? 'bad' : null);
    }

    function phaseDur() {
      /* faster switching at higher rates, clamped so it stays watchable */
      var runMs = [2400, 1500, 800, 380, 200][rateIdx];
      return phase === 0 || phase === 3 ? runMs : Math.max(160, runMs * 0.4);
    }

    function draw() {
      var w = st.w, h = st.h;
      if (w < 60 || h < 60) { return; }
      ctx.clearRect(0, 0, w, h);
      var midX = w / 2;
      var boxW = Math.min(150, w * 0.24), boxH = 118;
      var y = 34;
      var aX = w * 0.08, bX = w * 0.92 - boxW, cX = midX - boxW / 2;
      var runningA = phase === 0, runningB = phase === 3;
      var saving = phase === 1 || phase === 4;
      var loading = phase === 2 || phase === 5;
      /* whose registers the current phase touches:
         0 run A · 1 save A · 2 load B · 3 run B · 4 save B · 5 load A */
      var involvedIsA = phase === 0 || phase === 1 || phase === 5;

      function drawPCB(x, label, regs, color, active) {
        drawBox(ctx, x, y, boxW, boxH, {
          r: 8, stroke: active ? color : C.lineStrong, lw: active ? 2 : 1,
          fill: 'rgba(11, 17, 32, 0.9)'
        });
        ctx.fillStyle = active ? color : C.muted;
        ctx.font = '700 11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(label, x + boxW / 2, y + 18);
        ctx.font = '500 9px Inter, sans-serif';
        ctx.fillStyle = C.faint;
        ctx.fillText('saved registers (PCB)', x + boxW / 2, y + 31);
        ctx.font = '600 10px Consolas, monospace';
        ctx.textAlign = 'left';
        var names = ['PC', 'SP', 'R1', 'R2'];
        regs.forEach(function (v, i) {
          ctx.fillStyle = C.muted;
          ctx.fillText(names[i], x + 14, y + 50 + i * 16);
          ctx.fillStyle = C.text;
          ctx.fillText('0x' + v.toString(16).toUpperCase(), x + 44, y + 50 + i * 16);
        });
      }

      drawPCB(aX, 'Process A', regsA, C.sky, involvedIsA);
      drawPCB(bX, 'Process B', regsB, C.amber, !involvedIsA);

      /* CPU */
      var cpuColor = runningA ? C.sky : (runningB ? C.amber : C.rose);
      drawBox(ctx, cX, y, boxW, boxH, {
        r: 8, stroke: cpuColor, lw: 2,
        fill: runningA ? 'rgba(2, 132, 199, 0.08)' : (runningB ? 'rgba(217, 119, 6, 0.08)' : 'rgba(225, 29, 72, 0.07)')
      });
      ctx.fillStyle = cpuColor;
      ctx.font = '700 11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('CPU CORE', cX + boxW / 2, y + 18);
      ctx.font = '500 9px Inter, sans-serif';
      ctx.fillStyle = C.faint;
      ctx.fillText(runningA ? 'running A' : runningB ? 'running B' : (saving ? 'saving state…' : 'loading state…'), cX + boxW / 2, y + 31);
      var live = involvedIsA ? regsA : regsB;
      ctx.font = '600 10px Consolas, monospace';
      ctx.textAlign = 'left';
      var names = ['PC', 'SP', 'R1', 'R2'];
      live.forEach(function (v, i) {
        ctx.fillStyle = C.muted;
        ctx.fillText(names[i], cX + 14, y + 50 + i * 16);
        ctx.fillStyle = saving || loading ? C.rose : C.strong;
        ctx.fillText('0x' + v.toString(16).toUpperCase(), cX + 44, y + 50 + i * 16);
      });

      /* transfer arrow while saving/loading: CPU ↔ the involved PCB */
      if (saving || loading) {
        var cpuEdge = involvedIsA ? cX : cX + boxW;         /* CPU edge facing the PCB */
        var pcbEdge = involvedIsA ? aX + boxW : bX;         /* PCB edge facing the CPU */
        var srcX = saving ? cpuEdge : pcbEdge;
        var dstX = saving ? pcbEdge : cpuEdge;
        var ay = y + boxH / 2;
        var p = easeInOut(clamp(phaseT / phaseDur(), 0, 1));
        var dotX = srcX + (dstX - srcX) * p;
        ctx.strokeStyle = C.rose;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(srcX, ay); ctx.lineTo(dstX, ay); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(dotX, ay, 4, 0, Math.PI * 2);
        ctx.fillStyle = C.rose; ctx.fill();
      }

      /* timeline strip */
      var sy = h - 52;
      ctx.fillStyle = C.faint;
      ctx.font = '600 10px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('The core’s time (blue = A, orange = B, red = switching):', 10, sy - 8);
      var x = 10;
      strip.forEach(function (s2) {
        ctx.fillStyle = s2.who === 'a' ? C.sky : s2.who === 'b' ? C.amber : C.rose;
        ctx.fillRect(x, sy, s2.w, 16);
        x += s2.w;
      });
    }

    function pushStrip(who, w) {
      var last = strip[strip.length - 1];
      if (last && last.who === who) { last.w += w; }
      else { strip.push({ who: who, w: w }); }
      var total = 0;
      strip.forEach(function (s) { total += s.w; });
      while (total > st.w - 20 && strip.length) {
        var first = strip[0];
        var trim = Math.min(first.w, total - (st.w - 20));
        first.w -= trim;
        total -= trim;
        if (first.w <= 0) { strip.shift(); }
      }
    }

    var loop = makeLoop(function (t, dt) {
      phaseT += dt;
      var runPhase = phase === 0 || phase === 3;
      if (runPhase) {
        /* registers tick while running */
        var regs = phase === 0 ? regsA : regsB;
        regs[0] += Math.floor(dt * 2);
        regs[2] = (regs[2] + 1) % 256;
        pushStrip(phase === 0 ? 'a' : 'b', dt * 0.02);
      } else {
        pushStrip('x', dt * 0.02);
      }
      if (phaseT >= phaseDur()) {
        phaseT = 0;
        phase = (phase + 1) % 6;
      }
      draw();
    });

    if (rate) {
      rate.addEventListener('input', function () {
        rateIdx = clamp(parseInt(rate.value, 10) || 0, 0, RATES.length - 1);
        updateOverhead();
      });
    }
    updateOverhead();

    if (reduced()) {
      phase = 1; phaseT = 0;
      pushStrip('a', 90); pushStrip('x', 8); pushStrip('b', 90); pushStrip('x', 8); pushStrip('a', 60);
      draw();
    } else {
      onScreen(canvas, function () { loop.start(); }, function () { loop.stop(); });
    }
  }

  /* ==========================================================================
     07 — Memory management grid
     ========================================================================== */

  function initMem() {
    var grid = $('#os-mem-grid');
    if (!grid) { return; }
    var statusEl = $('#os-mem-status');
    var legend = $('#os-mem-legend');
    var N = 64, KERNEL = 8, SHARED = 4;
    var cells = [];
    var owner = [];       /* null | 'kernel' | 'shared' | app key */
    var running = [];     /* launch order of app keys */
    var sharedRef = 0;

    var APPS = {
      browser: { label: 'Browser', cls: 'is-browser', pages: 14, usesLib: true, color: C.sky },
      game: { label: 'Game', cls: 'is-game', pages: 18, usesLib: false, color: C.amber },
      editor: { label: 'Editor', cls: 'is-editor', pages: 7, usesLib: true, color: C.cTeal }
    };

    for (var i = 0; i < N; i++) {
      var c = document.createElement('span');
      c.className = 'os-mem-cell' + (i < KERNEL ? ' is-kernel' : '');
      owner.push(i < KERNEL ? 'kernel' : null);
      grid.appendChild(c);
      cells.push(c);
    }

    function freeCount() {
      return owner.filter(function (o) { return o === null; }).length;
    }

    function paint() {
      owner.forEach(function (o, idx) {
        var cls = 'os-mem-cell';
        if (o === 'kernel') { cls += ' is-kernel'; }
        else if (o === 'shared') { cls += ' is-shared'; }
        else if (o) { cls += ' ' + APPS[o].cls; }
        cells[idx].className = cls;
      });
      if (legend) {
        var seen = {};
        var html = '<span><i style="background:' + C.violet + '"></i>kernel (protected)</span>';
        running.forEach(function (k) {
          if (seen[k]) { return; }
          seen[k] = true;
          html += '<span><i style="background:' + APPS[k].color + '"></i>' + APPS[k].label + '</span>';
        });
        if (sharedRef > 0) {
          html += '<span><i style="background:repeating-linear-gradient(45deg,' + C.lime + ' 0 3px,#3f6212 3px 6px)"></i>shared library (×' + sharedRef + ')</span>';
        }
        html += '<span><i style="background:' + C.free + '"></i>free</span>';
        legend.innerHTML = html;
      }
    }

    function allocate(kind, count) {
      var got = [];
      for (var idx = KERNEL; idx < N && got.length < count; idx++) {
        if (owner[idx] === null) { got.push(idx); }
      }
      if (got.length < count) { return null; }
      got.forEach(function (g) { owner[g] = kind; });
      return got;
    }

    function launch(key) {
      var app = APPS[key];
      if (running.indexOf(key) !== -1) {
        setStatus(statusEl, app.label + ' is already running — quit it first (one instance keeps the demo readable).');
        return;
      }
      var need = app.pages + (app.usesLib && sharedRef === 0 ? SHARED : 0);
      if (freeCount() < need) {
        setStatus(statusEl, 'Not enough free pages for ' + app.label + ' (needs ' + need + ', ' + freeCount() + ' free). In chapter 8 the OS would start paging to disk — here, quit an app.', 'bad');
        return;
      }
      if (app.usesLib && sharedRef === 0) { allocate('shared', SHARED); }
      if (app.usesLib) { sharedRef++; }
      allocate(key, app.pages);
      running.push(key);
      paint();
      setStatus(statusEl, app.label + ': ' + app.pages + ' private pages' +
        (app.usesLib ? ' + ' + SHARED + ' shared library pages (one copy, mapped read-only into every user)' : '') +
        '. ' + (N - freeCount()) + '/' + N + ' pages used.', 'ok');
    }

    function quitOldest() {
      if (!running.length) {
        setStatus(statusEl, 'Nothing to quit — launch an app first.');
        return;
      }
      var key = running.shift();
      var app = APPS[key];
      owner.forEach(function (o, idx) { if (o === key) { owner[idx] = null; } });
      if (app.usesLib) {
        sharedRef--;
        if (sharedRef === 0) {
          owner.forEach(function (o, idx) { if (o === 'shared') { owner[idx] = null; } });
        }
      }
      paint();
      setStatus(statusEl, app.label + ' quit: its private pages are free again — note the holes. ' +
        (app.usesLib && sharedRef > 0 ? 'The shared library stays: ' + sharedRef + ' process(es) still use it. ' : '') +
        (N - freeCount()) + '/' + N + ' pages used.');
    }

    function rogue() {
      var targets = [];
      owner.forEach(function (o, idx) { if (o === 'kernel' || (o && o !== 'shared' && o !== running[running.length - 1])) { targets.push(idx); } });
      var pick = targets.length ? targets[Math.floor(Math.random() * targets.length)] : 2;
      var who = running.length ? APPS[running[running.length - 1]].label : 'A process';
      cells[pick].classList.add('is-denied');
      setStatus(statusEl, who + ' tried to write page ' + String(pick).padStart(2, '0') + ' — owned by ' +
        (owner[pick] === 'kernel' ? 'the kernel' : APPS[owner[pick]].label) +
        '. The MMU blocked it: segmentation fault. The writer gets terminated; the victim never notices.', 'bad');
      setTimeout(function () { cells[pick].classList.remove('is-denied'); }, 1400);
    }

    $$('#os-experience [data-os-mem]').forEach(function (btn) {
      btn.addEventListener('click', function () { launch(btn.getAttribute('data-os-mem')); });
    });
    var closeBtn = $('#os-mem-close');
    if (closeBtn) { closeBtn.addEventListener('click', quitOldest); }
    var rogueBtn = $('#os-mem-rogue');
    if (rogueBtn) { rogueBtn.addEventListener('click', rogue); }

    paint();
    setStatus(statusEl, '64 pages of RAM. The first 8 belong to the kernel — launch something.');
  }

  /* ==========================================================================
     08 — Virtual memory translator
     ========================================================================== */

  function initVm() {
    var canvas = $('#os-vm-canvas');
    if (!canvas) { return; }
    var cv = setupCanvas(canvas, function () { draw(); });
    var ctx = cv.ctx, st = cv.state;
    var log = $('#os-vm-log');
    var FRAMES = 8;
    var proc = 'a';
    var busyAnim = false;

    /* frame -> {p: process, v: vpage} | null ; page tables map vpage -> frame|'disk' */
    var tables = {
      a: [2, 5, 'disk', 0],
      b: [6, 'disk', 3, 7]
    };
    var frames = [];
    (function () {
      for (var f = 0; f < FRAMES; f++) { frames.push(null); }
      ['a', 'b'].forEach(function (p) {
        tables[p].forEach(function (fr, v) {
          if (fr !== 'disk') { frames[fr] = { p: p, v: v }; }
        });
      });
    })();
    var freeFrames = [1, 4];
    var lruQueue = [2, 5, 0, 6, 3, 7];  /* least-recently-used first */
    var hi = null; /* highlight: {v, ptRow, frame, fault, stage} */

    function addLog(text, kind) {
      if (!log) { return; }
      var li = document.createElement('li');
      li.textContent = text;
      if (kind) { li.classList.add(kind); }
      log.appendChild(li);
      while (log.children.length > 6) { log.removeChild(log.firstChild); }
    }

    function layout() {
      var w = st.w, h = st.h;
      return {
        vx: w * 0.05, vw: Math.min(150, w * 0.2),
        px: w * 0.38, pw: Math.min(190, w * 0.26),
        fx: w * 0.74, fw: Math.min(170, w * 0.21),
        rowH: Math.min(42, (h - 130) / 4), top: 58,
        frH: Math.min(30, (h - 150) / FRAMES),
        diskY: h - 54
      };
    }

    function draw() {
      var w = st.w, h = st.h;
      if (w < 60 || h < 60) { return; }
      var L = layout();
      ctx.clearRect(0, 0, w, h);
      var pcol = proc === 'a' ? C.sky : C.amber;
      var t = tables[proc];

      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.font = '700 11px Inter, sans-serif';
      ctx.fillStyle = pcol;
      ctx.fillText('Process ' + proc.toUpperCase() + ' — virtual pages', L.vx, 30);
      ctx.fillStyle = C.faint;
      ctx.fillText('Page table', L.px, 30);
      ctx.fillText('Physical RAM', L.fx, 30);

      /* virtual pages */
      for (var v = 0; v < 4; v++) {
        var vy = L.top + v * (L.rowH + 8);
        var active = hi && hi.v === v && hi.stage >= 0;
        drawBox(ctx, L.vx, vy, L.vw, L.rowH, {
          r: 6, stroke: active ? pcol : C.lineStrong, lw: active ? 2 : 1,
          label: 'page ' + v, color: active ? C.strong : C.text
        });
      }

      /* page table */
      for (var r = 0; r < 4; r++) {
        var ry = L.top + r * (L.rowH + 8);
        var isHi = hi && hi.v === r && hi.stage >= 1;
        drawBox(ctx, L.px, ry, L.pw, L.rowH, {
          r: 6, stroke: isHi ? C.violet : C.lineStrong, lw: isHi ? 2 : 1,
          fill: isHi ? 'rgba(139, 92, 246, 0.1)' : C.deep
        });
        ctx.font = '600 11px Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = t[r] === 'disk' ? C.amber : C.text;
        ctx.fillText(r + ' → ' + (t[r] === 'disk' ? 'ON DISK' : 'frame ' + t[r]), L.px + L.pw / 2, ry + L.rowH / 2);
      }

      /* frames */
      for (var f = 0; f < FRAMES; f++) {
        var fy = L.top + f * (L.frH + 5);
        var o = frames[f];
        var hiF = hi && hi.frame === f && hi.stage >= 2;
        var fill = C.deep;
        if (o) { fill = o.p === 'a' ? 'rgba(2, 132, 199, 0.22)' : 'rgba(217, 119, 6, 0.22)'; }
        drawBox(ctx, L.fx, fy, L.fw, L.frH, {
          r: 5, stroke: hiF ? C.teal : C.lineStrong, lw: hiF ? 2 : 1, fill: fill
        });
        ctx.font = '600 10px Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = o ? C.strong : C.faint;
        ctx.fillText('f' + f + (o ? ' : ' + o.p.toUpperCase() + '/p' + o.v : ' : free'), L.fx + L.fw / 2, fy + L.frH / 2);
      }

      /* disk */
      var diskHi = hi && hi.fault && hi.stage >= 2;
      drawBox(ctx, L.px, L.diskY, L.pw, 34, {
        r: 6, stroke: diskHi ? C.amber : C.lineStrong, lw: diskHi ? 2 : 1,
        label: 'DISK (swap space)', color: diskHi ? C.amber : C.faint, font: '700 10px'
      });

      /* connection line for the current highlight */
      if (hi && hi.stage >= 2 && hi.frame !== null && hi.frame !== undefined) {
        var vy2 = L.top + hi.v * (L.rowH + 8) + L.rowH / 2;
        var fy2 = L.top + hi.frame * (L.frH + 5) + L.frH / 2;
        ctx.strokeStyle = 'rgba(45, 212, 191, 0.7)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(L.vx + L.vw, vy2);
        ctx.lineTo(L.px, L.top + hi.v * (L.rowH + 8) + L.rowH / 2);
        ctx.moveTo(L.px + L.pw, L.top + hi.v * (L.rowH + 8) + L.rowH / 2);
        ctx.lineTo(L.fx, fy2);
        ctx.stroke();
      }
    }

    function touchLru(frame) {
      var ix = lruQueue.indexOf(frame);
      if (ix !== -1) { lruQueue.splice(ix, 1); }
      lruQueue.push(frame);
    }

    function access(v) {
      if (busyAnim) { return; }
      var t = tables[proc];
      var addr = '0x' + (v * 4096).toString(16).toUpperCase().padStart(4, '0');
      var fault = t[v] === 'disk';
      var steps;

      function resolveFault() {
        var target;
        if (freeFrames.length) {
          target = freeFrames.shift();
        } else {
          target = lruQueue.shift();
          var victim = frames[target];
          tables[victim.p][victim.v] = 'disk';
          addLog('Frame f' + target + ' was full: evicted process ' + victim.p.toUpperCase() + '’s page ' + victim.v + ' to disk to make room.', 'is-note');
        }
        frames[target] = { p: proc, v: v };
        t[v] = target;
        touchLru(target);
        return target;
      }

      if (!fault) {
        touchLru(t[v]);
        steps = [
          { s: 0, msg: 'Process ' + proc.toUpperCase() + ' reads virtual address ' + addr + ' (page ' + v + ').' },
          { s: 1, msg: 'The MMU walks the page table: page ' + v + ' → frame ' + t[v] + '.' },
          { s: 2, msg: 'Hit! The real bytes are in RAM frame ' + t[v] + '. Nanoseconds, done in hardware.', kind: 'is-ok' }
        ];
        hi = { v: v, frame: t[v], fault: false, stage: -1 };
      } else {
        steps = [
          { s: 0, msg: 'Process ' + proc.toUpperCase() + ' reads virtual address ' + addr + ' (page ' + v + ').' },
          { s: 1, msg: 'Page table says: not in RAM — PAGE FAULT. The CPU traps into the kernel.', kind: 'is-bad' },
          { s: 2, msg: 'The OS reads the page back from swap space on disk… (milliseconds — an eternity)', kind: 'is-note' },
          { s: 3, msg: '' } /* filled after resolution */
        ];
        hi = { v: v, frame: null, fault: true, stage: -1 };
      }

      if (reduced()) {
        if (fault) {
          var fr0 = resolveFault();
          hi.frame = fr0;
          steps[3].msg = 'Loaded into frame ' + fr0 + ' and the page table updated. The program resumes, unaware.';
          steps[3].kind = 'is-ok';
        }
        hi.stage = 3;
        steps.forEach(function (sp) { addLog(sp.msg, sp.kind); });
        draw();
        return;
      }

      busyAnim = true;
      var delay = 0;
      steps.forEach(function (sp, i) {
        setTimeout(function () {
          if (fault && i === 3) {
            var fr = resolveFault();
            hi.frame = fr;
            sp.msg = 'Loaded into frame ' + fr + ' and the page table updated. The program resumes, unaware.';
            sp.kind = 'is-ok';
          }
          hi.stage = sp.s;
          addLog(sp.msg, sp.kind);
          draw();
          if (i === steps.length - 1) { busyAnim = false; }
        }, delay);
        delay += 1000;
      });
    }

    $$('#os-experience [data-os-vmproc]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$('#os-experience [data-os-vmproc]').forEach(function (b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
        proc = btn.getAttribute('data-os-vmproc');
        hi = null;
        draw();
        addLog('Switched to process ' + proc.toUpperCase() + ' — its own page table, its own private view of memory.', 'is-note');
      });
    });

    $$('#os-experience [data-os-vmpage]').forEach(function (btn) {
      btn.addEventListener('click', function () { access(parseInt(btn.getAttribute('data-os-vmpage'), 10)); });
    });

    draw();
  }

  /* ==========================================================================
     09 — File systems
     ========================================================================== */

  function initFs() {
    var tree = $('#os-fs-tree');
    if (!tree) { return; }
    var detail = $('#os-fs-detail');
    var blocksEl = $('#os-fs-blocks');
    var statusEl = $('#os-fs-status');
    var journalCk = $('#os-fs-journal');
    var crashBtn = $('#os-fs-crashbtn');
    var NBLOCKS = 96, JBLOCKS = 4;

    var FILES = [
      { path: 'system/kernel.bin', size: '14.2 MB', owner: 'system', perms: 'r-x r-- ---', modified: '2026-05-02', blocks: [4, 5, 6, 7, 8, 9] },
      { path: 'system/drivers/gpu.sys', size: '3.8 MB', owner: 'system', perms: 'r-- r-- ---', modified: '2026-06-14', blocks: [12, 13, 14] },
      { path: 'home/you/resume.pdf', size: '182 KB', owner: 'you', perms: 'rw- r-- ---', modified: '2026-07-11', blocks: [30, 31] },
      { path: 'home/you/photo.jpg', size: '4.6 MB', owner: 'you', perms: 'rw- r-- ---', modified: '2026-03-22', blocks: [34, 35, 52, 53, 71, 72, 88] },
      { path: 'home/you/budget.xlsx', size: '96 KB', owner: 'you', perms: 'rw- --- ---', modified: '2026-07-27', blocks: [40, 41] },
      { path: 'home/you/projects/website.html', size: '38 KB', owner: 'you', perms: 'rw- r-- r--', modified: '2026-07-20', blocks: [58] }
    ];

    /* background "used by other stuff" blocks */
    var usedBg = [0, 1, 2, 3, 10, 11, 16, 17, 18, 22, 23, 26, 27, 44, 45, 46, 60, 61, 65, 66, 77, 78, 82, 83];

    /* build the tree */
    (function buildTree() {
      var root = {};
      FILES.forEach(function (f, fi) {
        var parts = f.path.split('/');
        var node = root;
        parts.forEach(function (p, i) {
          if (i === parts.length - 1) { node[p] = fi; }
          else { node[p] = node[p] || {}; node = node[p]; }
        });
      });
      function render(node, ul) {
        Object.keys(node).forEach(function (k) {
          var li = document.createElement('li');
          if (typeof node[k] === 'number') {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'os-fs-file';
            b.textContent = k;
            b.setAttribute('data-fi', node[k]);
            li.appendChild(b);
          } else {
            var span = document.createElement('span');
            span.className = 'os-fs-dir';
            span.textContent = k + '/';
            li.appendChild(span);
            var sub = document.createElement('ul');
            render(node[k], sub);
            li.appendChild(sub);
          }
          ul.appendChild(li);
        });
      }
      var top = document.createElement('li');
      var lab = document.createElement('span');
      lab.className = 'os-fs-dir';
      lab.textContent = 'Disk — partition 1 /';
      top.appendChild(lab);
      var ul = document.createElement('ul');
      render(root, ul);
      top.appendChild(ul);
      tree.appendChild(top);
    })();

    /* build the block map */
    var blockCells = [];
    for (var b = 0; b < NBLOCKS; b++) {
      var cell = document.createElement('span');
      cell.className = 'os-fs-block' + (usedBg.indexOf(b) !== -1 ? ' is-used' : '');
      blocksEl.appendChild(cell);
      blockCells.push(cell);
    }
    /* journal area: last 4 blocks */
    for (var jb = NBLOCKS - JBLOCKS; jb < NBLOCKS; jb++) {
      blockCells[jb].classList.add('is-journal');
    }

    var selected = null;

    function paintBlocks() {
      blockCells.forEach(function (cell, i) {
        cell.classList.remove('is-file');
        if (selected !== null && FILES[selected].blocks.indexOf(i) !== -1) {
          cell.classList.add('is-file');
        }
      });
    }

    function select(fi) {
      selected = fi;
      var f = FILES[fi];
      $$('.os-fs-file', tree).forEach(function (el) {
        el.classList.toggle('is-active', parseInt(el.getAttribute('data-fi'), 10) === fi);
      });
      if (detail) {
        detail.innerHTML = '<dl>' +
          '<dt>Name</dt><dd>' + f.path.split('/').pop() + '</dd>' +
          '<dt>Size</dt><dd>' + f.size + '</dd>' +
          '<dt>Owner</dt><dd>' + f.owner + '</dd>' +
          '<dt>Permissions</dt><dd class="os-fs-perms">' + f.perms + '</dd>' +
          '<dt>Modified</dt><dd>' + f.modified + '</dd>' +
          '<dt>Blocks</dt><dd>' + f.blocks.length + ' block(s): ' + f.blocks.join(', ') + '</dd>' +
          '</dl>';
      }
      paintBlocks();
      setStatus(statusEl, f.blocks.length > 2
        ? 'Note the scatter: one file, blocks all over the disk. The file system’s index (inode / MFT entry) keeps the list.'
        : '');
    }

    tree.addEventListener('click', function (e) {
      var t = e.target.closest('.os-fs-file');
      if (t) { select(parseInt(t.getAttribute('data-fi'), 10)); }
    });

    /* journaling crash demo */
    var crashBusy = false;
    if (crashBtn) {
      crashBtn.addEventListener('click', function () {
        if (crashBusy) { return; }
        crashBusy = true;
        var journal = journalCk && journalCk.checked;
        var fi = 4; /* budget.xlsx */
        select(fi);
        var f = FILES[fi];
        var newBlocks = [40, 41, 42];

        function flash(idxs, cls, on) {
          idxs.forEach(function (i2) { blockCells[i2].classList.toggle(cls, on); });
        }

        if (reduced()) {
          if (journal) {
            setStatus(statusEl, 'Power cut mid-write — but the journal recorded the intent first. On reboot the OS replays it: ' + f.path.split('/').pop() + ' is intact (either fully old or fully new, never half).', 'ok');
          } else {
            setStatus(statusEl, 'Power cut mid-write with no journal: block 40 holds new data, block 41 still holds old — the file is corrupt and no record says how to fix it.', 'bad');
          }
          crashBusy = false;
          return;
        }

        setStatus(statusEl, 'Saving a new version of budget.xlsx…');
        var jIdx = [NBLOCKS - 4, NBLOCKS - 3];
        var step = 0;
        var seq = journal
          ? [
            function () { flash(jIdx, 'is-file', true); setStatus(statusEl, '1. Journal first: “about to replace blocks 40–41 with new data.”'); },
            function () { flash([40], 'is-torn', true); setStatus(statusEl, '2. Writing block 40… ⚡ POWER CUT.', 'bad'); },
            function () { setStatus(statusEl, '3. Reboot: the OS finds an incomplete journal entry…', 'bad'); },
            function () {
              flash([40], 'is-torn', false); flash(jIdx, 'is-file', false);
              setStatus(statusEl, '4. Recovery: the half-done write is rolled back cleanly. budget.xlsx is intact — old version, no corruption.', 'ok');
              crashBusy = false;
            }
          ]
          : [
            function () { flash([40], 'is-torn', true); setStatus(statusEl, '1. Writing block 40 directly… ⚡ POWER CUT.', 'bad'); },
            function () { setStatus(statusEl, '2. Reboot: block 40 is new, block 41 is old — and nothing recorded what was in progress.', 'bad'); },
            function () { setStatus(statusEl, '3. budget.xlsx is corrupt. This is the pre-journaling world: full disk scans (chkdsk / fsck) hunting for damage.', 'bad'); },
            function () {
              flash([40], 'is-torn', false);
              setStatus(statusEl, 'Demo reset. Turn journaling on and cut the power again to compare.');
              crashBusy = false;
            }
          ];
        var iv = setInterval(function () {
          seq[step]();
          step++;
          if (step >= seq.length) { clearInterval(iv); }
        }, 1400);
      });
    }
  }

  /* ==========================================================================
     10 — Device drivers
     ========================================================================== */

  function initDrv() {
    var nodes = $$('#os-experience .os-drv-node');
    if (!nodes.length) { return; }
    var ifaceEl = $('#os-drv-iface'), nameEl = $('#os-drv-name'), hwEl = $('#os-drv-hw');
    var sendBtn = $('#os-drv-send');
    var statusEl = $('#os-drv-status');
    var timers = [];
    var dev = 'keyboard';

    var DEVICES = {
      keyboard: {
        iface: 'generic input API', driver: 'USB HID keyboard driver', hw: 'key matrix scan', up: true,
        steps: ['You press K — the keyboard raises an interrupt.',
          'The driver reads the scan code and translates it to “K”.',
          'The OS routes the key event to whichever window has focus.',
          'The application receives “K” — it never knew the hardware’s dialect.']
      },
      mouse: {
        iface: 'generic pointer API', driver: 'USB HID mouse driver', hw: 'optical sensor deltas', up: true,
        steps: ['The sensor reports movement deltas — interrupt.',
          'The driver converts raw deltas into standard pointer motion.',
          'The OS moves the cursor and finds what’s under it.',
          'The application under the cursor gets a clean “mouse moved” event.']
      },
      printer: {
        iface: 'print spooler API', driver: 'manufacturer printer driver', hw: 'ink heads & paper feed', up: false,
        steps: ['The app says “print this document” — one generic call.',
          'The OS queues the job in the spooler (so the app doesn’t wait).',
          'The driver converts the pages into this printer’s command language.',
          'The hardware lays down ink. A different printer would need only a different driver.']
      },
      gpu: {
        iface: 'graphics API (Direct3D / Metal / Vulkan)', driver: 'GPU vendor driver', hw: 'thousands of shader cores', up: false,
        steps: ['The app submits draw calls through a standard graphics API.',
          'The OS schedules GPU work and manages video memory.',
          'The vendor driver compiles the work into the GPU’s native instructions.',
          'The GPU renders the frame — the whole story continues in Inside a Modern GPU.']
      },
      wifi: {
        iface: 'network socket API', driver: 'Wi-Fi chipset driver', hw: '2.4 / 5 GHz radio', up: false,
        steps: ['The app writes bytes to a network socket — no radio knowledge.',
          'The OS network stack wraps the bytes into packets.',
          'The driver commands this specific chipset’s radio.',
          'Radio waves out — the journey continues in How the Internet Works.']
      }
    };

    function pick(key) {
      dev = key;
      var d = DEVICES[key];
      if (ifaceEl) { ifaceEl.textContent = d.iface; }
      if (nameEl) { nameEl.textContent = d.driver; }
      if (hwEl) { hwEl.textContent = d.hw; }
      nodes.forEach(function (n) { n.classList.remove('is-active'); });
      setStatus(statusEl, '');
    }

    $$('#os-experience [data-os-dev]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$('#os-experience [data-os-dev]').forEach(function (b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
        pick(btn.getAttribute('data-os-dev'));
      });
    });

    if (sendBtn) {
      sendBtn.addEventListener('click', function () {
        timers.forEach(clearTimeout);
        timers = [];
        var d = DEVICES[dev];
        var order = d.up ? [3, 2, 1, 0] : [0, 1, 2, 3];
        if (reduced()) {
          nodes.forEach(function (n) { n.classList.add('is-active'); });
          setStatus(statusEl, d.steps.join(' '), 'ok');
          return;
        }
        sendBtn.disabled = true;
        nodes.forEach(function (n) { n.classList.remove('is-active'); });
        order.forEach(function (ni, i) {
          timers.push(setTimeout(function () {
            nodes.forEach(function (n) { n.classList.remove('is-active'); });
            var node = nodes.filter(function (n) { return n.getAttribute('data-drv-node') === String(ni); })[0];
            if (node) { node.classList.add('is-active'); }
            setStatus(statusEl, d.steps[i], i === order.length - 1 ? 'ok' : null);
            if (i === order.length - 1) { sendBtn.disabled = false; }
          }, i * 1200));
        });
      });
    }

    pick('keyboard');
  }

  /* ==========================================================================
     11 — System calls
     ========================================================================== */

  function initSys() {
    var nodes = $$('#os-experience .os-sys-node');
    if (!nodes.length) { return; }
    var runBtn = $('#os-sys-run');
    var statusEl = $('#os-sys-status');
    var log = $('#os-sys-log');
    var target = $('#os-sys-target');
    var timers = [];
    var kind = 'read';

    /* tag the kernel-side nodes for violet styling */
    nodes.forEach(function (n) {
      var i = n.getAttribute('data-sys-node');
      if (i === '2' || i === '3') { n.classList.add('is-kernelside'); }
    });

    var CALLS = {
      read: {
        target: 'Storage<em>hardware</em>',
        steps: [
          'The program calls read(file, buffer, 4096) — an ordinary function, still in user mode.',
          'The library executes the syscall instruction: the CPU switches to kernel mode at one fixed, kernel-controlled entry point.',
          'The kernel validates everything: is the file open? may this process read it? is the buffer really its own memory?',
          'The file system maps the request to blocks; the storage driver fetches them (the process may sleep while it waits).',
          'Bytes are copied into the process’s buffer, the CPU drops back to user mode, and read() returns 4096.'
        ]
      },
      write: {
        target: 'Storage<em>hardware</em>',
        steps: [
          'The program calls write(file, bytes) — user mode cannot touch the disk, so this is a request, not an action.',
          'syscall instruction: mode switch into the kernel’s entry point.',
          'Permission check: was this file opened for writing? Quota ok?',
          'The file system assigns blocks (journaling the intent first — chapter 9) and the driver queues the write.',
          'Return to user mode: “bytes accepted.” The physical write may complete a moment later, safely ordered by the OS.'
        ]
      },
      spawn: {
        target: 'Scheduler<em>new process</em>',
        steps: [
          'The program asks for a new process (CreateProcess / fork+exec).',
          'Mode switch into the kernel.',
          'The kernel builds the new process: fresh address space, process ID, file table — the isolation from chapter 4.',
          'The new process joins the scheduler’s ready queue (chapter 5) and will get CPU time on its own.',
          'The parent gets the child’s PID back. Two programs now run where one did.'
        ]
      },
      connect: {
        target: 'Network card<em>hardware</em>',
        steps: [
          'The program asks to open a connection to a server — a socket call.',
          'Mode switch into the kernel.',
          'The kernel’s network stack builds the packets and checks firewall rules.',
          'The network driver hands them to the card; radio or wire carries them away.',
          'The call returns a connected socket — everything past the card is the story of How the Internet Works.'
        ]
      }
    };

    $$('#os-experience [data-os-sys]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$('#os-experience [data-os-sys]').forEach(function (b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
        kind = btn.getAttribute('data-os-sys');
        if (target) { target.innerHTML = CALLS[kind].target; }
        nodes.forEach(function (n) { n.classList.remove('is-active'); });
        if (log) { log.innerHTML = ''; }
        setStatus(statusEl, '');
      });
    });

    function addLog(text, kind2) {
      if (!log) { return; }
      var li = document.createElement('li');
      li.textContent = text;
      if (kind2) { li.classList.add(kind2); }
      log.appendChild(li);
    }

    if (runBtn) {
      runBtn.addEventListener('click', function () {
        timers.forEach(clearTimeout);
        timers = [];
        if (log) { log.innerHTML = ''; }
        var call = CALLS[kind];
        var nodeOrder = [0, 1, 2, 3, 4];
        if (reduced()) {
          call.steps.forEach(function (s) { addLog(s); });
          nodes.forEach(function (n) { n.classList.remove('is-active'); });
          setStatus(statusEl, 'Complete — the log shows each step.', 'ok');
          return;
        }
        runBtn.disabled = true;
        call.steps.forEach(function (s, i) {
          timers.push(setTimeout(function () {
            nodes.forEach(function (n) { n.classList.remove('is-active'); });
            var node = nodes.filter(function (n) { return n.getAttribute('data-sys-node') === String(nodeOrder[i]); })[0];
            if (node) { node.classList.add('is-active'); }
            addLog(s, i === call.steps.length - 1 ? 'is-ok' : null);
            if (i === call.steps.length - 1) {
              runBtn.disabled = false;
              setStatus(statusEl, 'Round trip complete — microseconds in real life.', 'ok');
            }
          }, i * 1300));
        });
      });
    }
  }

  /* ==========================================================================
     12 — Security & permissions
     ========================================================================== */

  function initSec() {
    var log = $('#os-sec-log');
    if (!log) { return; }
    var user = 'standard';

    var VERDICTS = {
      own: {
        guest: [true, 'Allowed — the guest account may edit its own (temporary) documents. They’re wiped when the session ends.'],
        standard: [true, 'Allowed — you own the file, and its permissions say the owner may read and write.'],
        admin: [true, 'Allowed — ownership works the same for administrators.']
      },
      other: {
        guest: [false, 'Denied — another user’s home folder is not readable by guests. The kernel checks this on every open().'],
        standard: [false, 'Denied — their files, their permissions. Accounts exist precisely so this fails.'],
        admin: [true, 'Allowed — but only after an explicit elevation step, and it can be logged. Power with a paper trail.']
      },
      sysfile: {
        guest: [false, 'Denied — system files are owned by the OS itself; guests can’t even see some of them.'],
        standard: [false, 'Denied — this is what stops one careless click from breaking the machine for every account on it.'],
        admin: [true, 'Allowed after an elevation prompt (UAC / sudo) — the OS makes dangerous actions deliberate, not casual.']
      },
      install: {
        guest: [false, 'Denied — installing a driver means loading code into the kernel. Guests: absolutely not.'],
        standard: [false, 'Denied — drivers run with full kernel privileges (chapter 10); a standard account may not add them.'],
        admin: [true, 'Allowed — but modern OSes still require the driver to be digitally signed. Unsigned kernel code is refused even for administrators.']
      },
      camera: {
        guest: [false, 'Denied — the sandbox rules for guest sessions don’t include camera access at all.'],
        standard: [true, 'The app can’t just take it: the OS shows you a permission prompt. Allowed only if you approve — sandboxing means apps ask, users decide.'],
        admin: [true, 'Same prompt — sandbox permissions are per-app and per-user, not waived for administrators.']
      }
    };

    var ACT_LABELS = {
      own: 'Edit your document', other: 'Read another user’s files',
      sysfile: 'Modify a system file', install: 'Install a driver', camera: 'App requests the camera'
    };
    var USER_LABELS = { guest: 'Guest', standard: 'Standard user', admin: 'Administrator' };

    $$('#os-experience [data-os-user]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$('#os-experience [data-os-user]').forEach(function (b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
        user = btn.getAttribute('data-os-user');
        var li = document.createElement('li');
        li.className = 'is-note';
        li.textContent = 'Now acting as: ' + USER_LABELS[user] + '.';
        log.appendChild(li);
        trim();
      });
    });

    function trim() {
      while (log.children.length > 7) { log.removeChild(log.firstChild); }
    }

    $$('#os-experience [data-os-act]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var act = btn.getAttribute('data-os-act');
        var v = VERDICTS[act][user];
        var li = document.createElement('li');
        li.className = v[0] ? 'is-ok' : 'is-bad';
        li.textContent = USER_LABELS[user] + ' · ' + ACT_LABELS[act] + ' → ' + v[1];
        log.appendChild(li);
        trim();
      });
    });
  }

  /* ==========================================================================
     13 — Modern operating systems
     ========================================================================== */

  function initModern() {
    var card = $('#os-modern-card');
    if (!card) { return; }

    var OSES = {
      windows: {
        kernel: 'Windows NT kernel — a hybrid design, evolved continuously since 1993.',
        strengths: ['Broadest application and game catalog', 'Runs on almost any PC hardware', 'Deep enterprise management tools'],
        uses: 'Desktops and laptops everywhere: offices, gaming rigs, schools, point-of-sale systems.',
        arch: 'Graphics and drivers integrate tightly with the kernel for performance; decades of backward compatibility are a defining constraint and a defining strength.'
      },
      macos: {
        kernel: 'XNU — a hybrid of the Mach microkernel and BSD Unix, shared with iOS.',
        strengths: ['Tight hardware–software integration (Apple silicon)', 'Unix underpinnings with a polished shell', 'Strong default security posture'],
        uses: 'Creative work, software development, and general computing on Apple hardware only.',
        arch: 'One company controls chip, kernel, and desktop — enabling aggressive power-efficiency and security features that cross-vendor systems find harder.'
      },
      linux: {
        kernel: 'The Linux kernel — monolithic but modular, open source, thousands of contributors.',
        strengths: ['Free and endlessly customizable', 'Dominant on servers and the cloud', 'Same kernel scales from a Raspberry Pi to a supercomputer'],
        uses: 'Most web servers, virtually all supercomputers, cloud infrastructure, routers, TVs — and desktops for those who want control.',
        arch: '“Linux” strictly names just the kernel; distributions (Ubuntu, Fedora, Debian…) assemble it with different user-space software into complete systems.'
      },
      android: {
        kernel: 'The Linux kernel, with Android’s own user space on top — no traditional Linux desktop.',
        strengths: ['Runs on wildly diverse hardware and price points', 'The world’s most-used operating system', 'Deep app sandboxing by design'],
        uses: 'Phones and tablets first; also TVs, watches, cars, and embedded devices.',
        arch: 'Every app runs as its own user account inside its own sandbox — the multi-user machinery of chapter 12, repurposed so apps can’t read each other’s data.'
      },
      ios: {
        kernel: 'XNU — the same kernel family as macOS, tuned for phones.',
        strengths: ['Aggressive power and memory management', 'Strict sandboxing and code signing throughout', 'Consistent performance on known hardware'],
        uses: 'iPhone and iPad; the same core also runs watches and TVs.',
        arch: 'Every app is sandboxed and must be signed; background work is tightly rationed by the scheduler to preserve battery — chapter 5’s trade-offs, decided in favor of battery life.'
      }
    };

    function show(key) {
      var o = OSES[key];
      card.innerHTML =
        '<div class="os-modern-cell"><h3>Kernel family</h3><p>' + o.kernel + '</p></div>' +
        '<div class="os-modern-cell"><h3>Typical strengths</h3><ul>' +
        o.strengths.map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ul></div>' +
        '<div class="os-modern-cell"><h3>Common uses</h3><p>' + o.uses + '</p></div>' +
        '<div class="os-modern-cell"><h3>Architecture notes</h3><p>' + o.arch + '</p></div>';
    }

    $$('#os-experience [data-os-osname]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$('#os-experience [data-os-osname]').forEach(function (b) { b.classList.remove('is-active'); });
        btn.classList.add('is-active');
        show(btn.getAttribute('data-os-osname'));
      });
    });

    show('windows');
  }

  /* ==========================================================================
     15 — The OS control center
     ========================================================================== */

  function initCC() {
    var procsBody = $('#os-cc-procs');
    if (!procsBody) { return; }
    var log = $('#os-cc-log');
    var canvas = $('#os-cc-canvas');
    var els = {
      cpuBar: $('#os-cc-cpubar'), cpuVal: $('#os-cc-cpuval'),
      memBar: $('#os-cc-membar'), memVal: $('#os-cc-memval'),
      diskBar: $('#os-cc-diskbar'), diskVal: $('#os-cc-diskval'),
      netBar: $('#os-cc-netbar'), netVal: $('#os-cc-netval'),
      ctxVal: $('#os-cc-ctxval'), intVal: $('#os-cc-intval')
    };

    var CORES = 4;                /* total CPU capacity = 400 "%" */
    var MEM_TOTAL = 8192;         /* MB */
    var DISK_TOTAL = 256;         /* GB */
    var NET_CAP = 500;            /* Mbps */

    var pid = 1;
    var procs = [];
    var diskUsed = 74;            /* GB */
    var diskActive = 0;           /* transfer seconds remaining */
    var netActive = 0;
    var usbMounted = false;
    var history = [];             /* {cpu, mem} 0..1 */
    var oomArmed = true;

    function addProc(name, cpu, mem, opts) {
      opts = opts || {};
      pid += 1 + Math.floor(Math.random() * 6);
      var p = {
        pid: pid, name: name, cpu: cpu, mem: mem,
        system: !!opts.system, ttl: opts.ttl || 0, jitter: opts.jitter !== false
      };
      procs.push(p);
      return p;
    }

    function bootProcs() {
      pid = 1;
      procs = [];
      addProc('System (kernel)', 6, 320, { system: true, jitter: true });
      addProc('Desktop shell', 4, 410, { system: true });
      addProc('Network service', 2, 90, { system: true });
      addProc('Audio service', 1, 60, { system: true });
    }

    function addLog(msg, kind) {
      if (!log) { return; }
      var li = document.createElement('li');
      li.textContent = msg;
      if (kind) { li.classList.add(kind); }
      log.insertBefore(li, log.firstChild);
      while (log.children.length > 24) { log.removeChild(log.lastChild); }
    }

    function memUsed() {
      var m = 0;
      procs.forEach(function (p) { m += p.mem; });
      return m;
    }

    function cpuDemand() {
      var d = 0;
      procs.forEach(function (p) { d += p.cpu; });
      return d;
    }

    function tick() {
      /* natural decay/jitter */
      procs.forEach(function (p) {
        if (p.jitter) { p.cpu = Math.max(0.5, p.cpu + (Math.random() - 0.5) * 2); }
        if (p.ttl > 0) {
          p.ttl -= 0.25;
          if (p.ttl <= 0) {
            p.dead = true;
            addLog('[ok] ' + p.name + ' (PID ' + p.pid + ') finished and exited — memory reclaimed.', 'is-ok');
          }
        }
      });
      procs = procs.filter(function (p) { return !p.dead; });

      /* OOM killer */
      var mu = memUsed();
      if (mu > MEM_TOTAL * 0.95 && oomArmed) {
        var victim = null;
        procs.forEach(function (p) { if (!p.system && (!victim || p.mem > victim.mem)) { victim = p; } });
        if (victim) {
          addLog('[kernel] Out of memory! Killing the largest process: ' + victim.name +
            ' (PID ' + victim.pid + ', ' + (victim.mem / 1024).toFixed(1) + ' GB) to save the system.', 'is-bad');
          procs = procs.filter(function (p) { return p !== victim; });
          addLog('[kernel] ' + ((victim.mem) / 1024).toFixed(1) + ' GB reclaimed. The system survives; that app does not.', 'is-note');
        }
      }

      /* scheduler: proportional share when over-committed */
      var demand = cpuDemand();
      var scale = demand > CORES * 100 ? (CORES * 100) / demand : 1;
      procs.forEach(function (p) {
        p.granted = p.cpu * scale;
        p.state = demand > CORES * 100 && p.cpu > 1 ? (scale < 0.9 ? 'ready/running' : 'running') : (p.cpu < 1.5 ? 'sleeping' : 'running');
      });

      var cpuPct = Math.min(100, demand / CORES);
      mu = memUsed();
      var memPct = mu / MEM_TOTAL * 100;
      if (diskActive > 0) { diskActive -= 0.25; }
      if (netActive > 0) { netActive -= 0.25; }
      var diskPct = diskUsed / DISK_TOTAL * 100;
      var netNow = netActive > 0 ? NET_CAP * (0.5 + Math.random() * 0.3) : Math.random() * 4;
      var ctxRate = Math.round(600 + procs.length * 220 + cpuPct * 28 + Math.random() * 300);
      var intRate = Math.round(250 + netNow * 6 + (diskActive > 0 ? 900 : 0) + Math.random() * 120);

      /* meters */
      function bar(el, pct) {
        if (!el) { return; }
        el.style.width = clamp(pct, 0, 100) + '%';
        el.classList.toggle('is-warn', pct >= 70 && pct < 90);
        el.classList.toggle('is-crit', pct >= 90);
      }
      bar(els.cpuBar, cpuPct);
      bar(els.memBar, memPct);
      bar(els.diskBar, diskPct);
      bar(els.netBar, netNow / NET_CAP * 100);
      if (els.cpuVal) { els.cpuVal.textContent = Math.round(cpuPct) + '%'; }
      if (els.memVal) { els.memVal.textContent = (mu / 1024).toFixed(1) + ' / 8 GB'; }
      if (els.diskVal) { els.diskVal.textContent = Math.round(diskUsed) + ' / ' + DISK_TOTAL + ' GB'; }
      if (els.netVal) { els.netVal.textContent = Math.round(netNow) + ' Mbps'; }
      if (els.ctxVal) { els.ctxVal.textContent = ctxRate.toLocaleString('en-US'); }
      if (els.intVal) { els.intVal.textContent = intRate.toLocaleString('en-US'); }

      /* table */
      var rows = procs.slice().sort(function (a, b) { return b.granted - a.granted; });
      procsBody.innerHTML = rows.map(function (p) {
        var stateCls = p.state === 'ready/running' ? 'is-state-waiting' : (p.state === 'running' ? 'is-state-running' : '');
        return '<tr><td>' + p.pid + '</td><td>' + p.name + '</td><td>' +
          p.granted.toFixed(0) + '%</td><td>' +
          (p.mem >= 1024 ? (p.mem / 1024).toFixed(1) + ' GB' : p.mem + ' MB') +
          '</td><td class="' + stateCls + '">' + p.state + '</td></tr>';
      }).join('');

      /* history + graph */
      history.push({ cpu: cpuPct / 100, mem: memPct / 100 });
      if (history.length > 240) { history.shift(); }
      drawGraph();
    }

    var graph = null;
    if (canvas) { graph = setupCanvas(canvas, function () { drawGraph(); }); }
    function drawGraph() {
      if (!graph) { return; }
      var ctx = graph.ctx, w = graph.state.w, h = graph.state.h;
      if (w < 60 || h < 60) { return; }
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = C.line;
      ctx.lineWidth = 1;
      [0.25, 0.5, 0.75].forEach(function (fr) {
        ctx.beginPath(); ctx.moveTo(0, h * fr); ctx.lineTo(w, h * fr); ctx.stroke();
      });
      function line(key, color) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        history.forEach(function (pt, i) {
          var x = w - (history.length - 1 - i) * (w / 240);
          var y = h - 6 - pt[key] * (h - 14);
          if (i === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
        });
        ctx.stroke();
      }
      line('cpu', C.teal);
      line('mem', C.sky);
      ctx.font = '600 10px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = C.teal;
      ctx.fillText('CPU', 8, 14);
      ctx.fillStyle = C.sky;
      ctx.fillText('Memory', 40, 14);
    }

    var ACTIONS = {
      browser: function () {
        var p = addProc('Browser', 14 + Math.random() * 10, 950);
        addLog('[user] Launched Browser (PID ' + p.pid + ') — process created, 14 threads, address space mapped.');
      },
      game: function () {
        var p = addProc('Game', 95 + Math.random() * 30, 1900);
        addLog('[user] Launched Game (PID ' + p.pid + ') — heavy CPU + GPU work; the scheduler gives it long slices.');
      },
      compile: function () {
        var p = addProc('Compiler', 170, 650, { ttl: 18, jitter: false });
        addLog('[user] Compiling a project (PID ' + p.pid + ') — spreads across all ' + CORES + ' cores, finishes in ~18 s.');
      },
      alloc: function () {
        var hog = null;
        procs.forEach(function (p) { if (p.name === 'Data analysis') { hog = p; } });
        if (!hog) { hog = addProc('Data analysis', 8, 0); }
        hog.mem += 1024;
        addLog('[user] Data analysis allocated 1 GB (now ' + (hog.mem / 1024).toFixed(1) + ' GB). The OS maps the pages on demand.');
        if (memUsed() > MEM_TOTAL * 0.8) {
          addLog('[kernel] Memory pressure rising: caches being dropped, inactive pages compressed / swapped.', 'is-note');
        }
      },
      threads: function () {
        var t = procs.filter(function (p) { return !p.system; });
        var p2 = t.length ? t[t.length - 1] : addProc('Worker pool', 4, 200);
        p2.cpu += 35;
        addLog('[user] ' + p2.name + ' spawned 8 worker threads — more runnable threads, more context switches.');
      },
      files: function () {
        if (diskUsed >= DISK_TOTAL - 1) {
          addLog('[error] write() failed: No space left on device. The OS refuses cleanly rather than corrupting.', 'is-bad');
          return;
        }
        diskUsed = Math.min(DISK_TOTAL, diskUsed + 6);
        diskActive = 6;
        addLog('[user] Writing 6 GB of files — the file system allocates blocks, journals metadata, schedules the I/O.');
        if (diskUsed / DISK_TOTAL > 0.9) {
          addLog('[kernel] Disk over 90% full — low-space warnings issued to user space.', 'is-note');
        }
      },
      net: function () {
        netActive = 10;
        addLog('[user] Download started — the network stack streams packets; interrupts spike as the card signals arrivals.');
      },
      usb: function () {
        if (usbMounted) { addLog('[note] The USB drive is already connected.', 'is-note'); return; }
        usbMounted = true;
        addLog('[kernel] Interrupt: new USB device. Identified as mass storage — loading driver usb-storage.');
        addLog('[kernel] File system on the drive mounted. It appears in the file manager — chapters 9 + 10 in one second.', 'is-ok');
      },
      runaway: function () {
        var p = addProc('runaway.exe', 400, 250, { ttl: 14, jitter: false });
        addLog('[warn] runaway.exe (PID ' + p.pid + ') is in an infinite loop demanding every core!', 'is-bad');
        addLog('[kernel] The scheduler still preempts it on every tick — other apps get their slices; the UI stays alive.', 'is-note');
        addLog('[user] Task manager still responds… End task sent; it dies in a few seconds.', 'is-note');
      },
      oom: function () {
        var hog = addProc('Memory leak demo', 10, 5800);
        addLog('[warn] ' + hog.name + ' (PID ' + hog.pid + ') grabbed 5.7 GB at once!', 'is-bad');
        addLog('[kernel] Swapping hard… if pressure keeps rising, the OOM killer chooses a victim by size.', 'is-note');
      },
      diskfull: function () {
        diskUsed = DISK_TOTAL - 0.5;
        addLog('[warn] The disk is now 99.8% full.', 'is-bad');
        addLog('[kernel] New writes will fail with a clean error — try “Write files to disk.” Existing data stays safe.', 'is-note');
      },
      unplug: function () {
        if (!usbMounted) { addLog('[note] No USB drive connected — plug one in first.', 'is-note'); return; }
        usbMounted = false;
        addLog('[kernel] Interrupt: USB device removed without unmounting!', 'is-bad');
        addLog('[kernel] I/O errors returned to any process using it; cached writes that never reached the drive are lost. The OS contains the damage — this is why “eject safely” exists.', 'is-note');
      }
    };

    $$('#os-experience [data-os-cc]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var fn = ACTIONS[btn.getAttribute('data-os-cc')];
        if (fn) { fn(); tick(); }
      });
    });

    var reboot = $('#os-cc-reboot');
    if (reboot) {
      reboot.addEventListener('click', function () {
        bootProcs();
        diskUsed = 74; diskActive = 0; netActive = 0; usbMounted = false; history = [];
        if (log) { log.innerHTML = ''; }
        addLog('[boot] Firmware → boot loader → kernel → drivers → services — chapter 2, in a blink.');
        addLog('[ok] System ready. All state from the previous run is gone — the honest reason rebooting “fixes” things.', 'is-ok');
        tick();
      });
    }

    bootProcs();
    addLog('[ok] System booted: kernel + ' + (procs.length - 1) + ' services running. Try the buttons.', 'is-ok');
    tick();

    var iv = null;
    var period = reduced() ? 1000 : 250;
    onScreen($('#simulator') || canvas || procsBody, function () {
      if (!iv) { iv = setInterval(tick, period); }
    }, function () {
      if (iv) { clearInterval(iv); iv = null; }
    });
  }

  /* ==========================================================================
     Boot — every widget isolated so one failure can't break the page
     ========================================================================== */

  function boot() {
    [initReveal, initRail, initHero, initWorld, initBoot, initKernel, initProc,
     initSched, initCtx, initMem, initVm, initFs, initDrv, initSys, initSec,
     initModern, initCC].forEach(function (fn) {
      try { fn(); } catch (e) {
        if (window.console && console.error) { console.error('operating-systems.js widget failed:', fn.name, e); }
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
