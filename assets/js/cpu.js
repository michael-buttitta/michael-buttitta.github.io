/* =============================================================================
   Inside a Modern CPU — interactivity
   Vanilla JS, no dependencies. Loaded with `defer` on /cpu/ only.

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

  document.documentElement.classList.add('cx-js');

  var RM = window.matchMedia('(prefers-reduced-motion: reduce)');

  function reduced() { return RM.matches; }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function fmtInt(n) { return Math.round(n).toLocaleString('en-US'); }

  function fmtBig(n) {
    if (n >= 1e9) { return (n / 1e9).toFixed(n >= 1e10 ? 0 : 1) + 'B'; }
    if (n >= 1e6) { return (n / 1e6).toFixed(0) + 'M'; }
    return fmtInt(n);
  }

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
    var targets = $$('#cpu-experience [data-cx-reveal]').concat($$('#cpu-experience .cx-era'));
    if (!targets.length) { return; }
    $$('#cpu-experience .cx-era').forEach(function (el, i) {
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
    var dots = $$('.cx-rail-dot');
    if (!dots.length) { return; }
    var byId = {};
    dots.forEach(function (dot) {
      dot.setAttribute('aria-label', dot.getAttribute('data-label') || 'Section');
      byId[dot.getAttribute('href').slice(1)] = dot;
    });
    var sections = Object.keys(byId)
      .map(function (id) { return document.getElementById(id); })
      .filter(Boolean);
    if (!('IntersectionObserver' in window)) { return; }
    var current = null;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) { return; }
        if (current) { current.classList.remove('is-active'); }
        current = byId[e.target.id];
        if (current) { current.classList.add('is-active'); }
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    sections.forEach(function (sec) { io.observe(sec); });
  }

  /* ==========================================================================
     Hero — stylized die with instruction traffic and clock pulses
     ========================================================================== */

  function initHero() {
    var canvas = $('#cx-hero-canvas');
    if (!canvas) { return; }
    var fit = setupCanvas(canvas, function () { layout(); });
    var ctx = fit.ctx;
    var st = fit.state;

    var die = null;      /* { x, y, w, h, tiles: [{x,y,w,h}], l3: rect, imc: rect } */
    var packets = [];
    var pulse = 0;       /* 0..1 clock ripple progress */

    function layout() {
      var w = st.w, h = st.h;
      var dw = Math.min(w * 0.72, 760);
      var dh = Math.min(h * 0.78, dw * 0.62);
      dw = Math.min(dw, dh / 0.62);
      var x = (w - dw) / 2;
      var y = (h - dh) / 2 + h * 0.03;
      var tiles = [];
      var cols = 4, gap = dw * 0.02;
      var tw = (dw - gap * (cols + 1)) / cols;
      var th = dh * 0.30;
      var i;
      for (i = 0; i < cols; i++) {
        tiles.push({ x: x + gap + i * (tw + gap), y: y + gap, w: tw, h: th });
      }
      for (i = 0; i < cols; i++) {
        tiles.push({ x: x + gap + i * (tw + gap), y: y + dh - gap - th, w: tw, h: th });
      }
      var midY = y + gap + th + gap;
      var midH = dh - 2 * (gap * 2 + th);
      die = {
        x: x, y: y, w: dw, h: dh, tiles: tiles,
        l3: { x: x + gap, y: midY, w: dw * 0.62, h: midH },
        imc: { x: x + dw * 0.68, y: midY, w: dw - dw * 0.68 - gap, h: midH }
      };
    }

    function centerOf(r) { return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; }

    function spawnPacket() {
      if (!die) { return; }
      var tiles = die.tiles;
      var from = centerOf(tiles[Math.floor(Math.random() * tiles.length)]);
      var toRect = Math.random() < 0.72 ? die.l3 : die.imc;
      var to = centerOf(toRect);
      to.x += (Math.random() - 0.5) * toRect.w * 0.6;
      if (Math.random() < 0.5) { var tmp = from; from = to; to = tmp; }
      packets.push({
        fx: from.x, fy: from.y, tx: to.x, ty: to.y,
        t: 0, speed: 0.25 + Math.random() * 0.5,
        mem: toRect === die.imc
      });
    }

    function draw(dt) {
      var w = st.w, h = st.h;
      ctx.clearRect(0, 0, w, h);
      if (!die) { layout(); }
      if (!die) { return; }

      /* package + die */
      ctx.strokeStyle = 'rgba(51, 65, 85, 0.5)';
      ctx.lineWidth = 1;
      roundRect(ctx, die.x - 14, die.y - 14, die.w + 28, die.h + 28, 14);
      ctx.stroke();
      ctx.fillStyle = 'rgba(19, 30, 56, 0.55)';
      roundRect(ctx, die.x, die.y, die.w, die.h, 8);
      ctx.fill();
      ctx.strokeStyle = 'rgba(51, 65, 85, 0.9)';
      ctx.stroke();

      /* core tiles */
      die.tiles.forEach(function (tRect) {
        ctx.fillStyle = 'rgba(13, 148, 136, 0.10)';
        roundRect(ctx, tRect.x, tRect.y, tRect.w, tRect.h, 5);
        ctx.fill();
        ctx.strokeStyle = 'rgba(13, 148, 136, 0.4)';
        ctx.stroke();
        /* a hint of internal structure */
        ctx.strokeStyle = 'rgba(51, 65, 85, 0.55)';
        ctx.beginPath();
        ctx.moveTo(tRect.x + tRect.w * 0.14, tRect.y + tRect.h * 0.55);
        ctx.lineTo(tRect.x + tRect.w * 0.86, tRect.y + tRect.h * 0.55);
        ctx.stroke();
      });

      /* L3 + IMC */
      ctx.fillStyle = 'rgba(139, 92, 246, 0.09)';
      roundRect(ctx, die.l3.x, die.l3.y, die.l3.w, die.l3.h, 5);
      ctx.fill();
      ctx.strokeStyle = 'rgba(139, 92, 246, 0.35)';
      ctx.stroke();
      ctx.fillStyle = 'rgba(2, 132, 199, 0.10)';
      roundRect(ctx, die.imc.x, die.imc.y, die.imc.w, die.imc.h, 5);
      ctx.fill();
      ctx.strokeStyle = 'rgba(2, 132, 199, 0.4)';
      ctx.stroke();

      /* clock ripple */
      if (!reduced()) {
        pulse += dt / 1600;
        if (pulse > 1) { pulse -= 1; }
        var pr = pulse;
        ctx.strokeStyle = 'rgba(45, 212, 191, ' + (0.35 * (1 - pr)) + ')';
        ctx.lineWidth = 1.5;
        roundRect(ctx,
          die.x - pr * 60, die.y - pr * 60,
          die.w + pr * 120, die.h + pr * 120, 10 + pr * 30);
        ctx.stroke();
        ctx.lineWidth = 1;
      }

      /* packets */
      if (!reduced()) {
        if (packets.length < 26 && Math.random() < 0.3) { spawnPacket(); }
        packets = packets.filter(function (p) {
          p.t += (dt / 1000) * p.speed;
          if (p.t >= 1) { return false; }
          var mid = { x: p.tx, y: p.fy };  /* L-shaped route */
          var seg1 = Math.abs(mid.x - p.fx);
          var seg2 = Math.abs(p.ty - mid.y);
          var total = seg1 + seg2 || 1;
          var d = p.t * total;
          var px, py;
          if (d < seg1) {
            px = p.fx + (mid.x - p.fx) * (d / (seg1 || 1));
            py = p.fy;
          } else {
            px = mid.x;
            py = mid.y + (p.ty - mid.y) * ((d - seg1) / (seg2 || 1));
          }
          var col = p.mem ? '139, 92, 246' : '45, 212, 191';
          ctx.fillStyle = 'rgba(' + col + ', 0.16)';
          ctx.beginPath();
          ctx.arc(px, py, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(' + col + ', 0.85)';
          ctx.beginPath();
          ctx.arc(px, py, 2.2, 0, Math.PI * 2);
          ctx.fill();
          return true;
        });
      } else {
        /* static glow for reduced motion */
        ctx.fillStyle = 'rgba(45, 212, 191, 0.06)';
        roundRect(ctx, die.x, die.y, die.w, die.h, 8);
        ctx.fill();
      }
    }

    var loop = makeLoop(function (t, dt) { draw(dt); });

    layout();
    draw(16);
    if (!reduced()) {
      onScreen(canvas, function () { loop.start(); }, function () { loop.stop(); });
    }
    RM.addEventListener && RM.addEventListener('change', function () {
      loop.stop();
      layout();
      draw(16);
      if (!reduced()) { loop.start(); }
    });
  }

  /* ==========================================================================
     01 · Program-to-result flow
     ========================================================================== */

  function initFlow() {
    var root = $('#cpu-experience .cx-flow');
    if (!root) { return; }
    var stages = $$('.cx-flow-stage', root);
    var arrows = $$('.cx-flow-arrow', root);
    var instrs = $$('#cx-flow-instrs code');
    var core = $('#cx-flowchip-core');
    var count = $('#cx-flow-count');
    var score = $('#cx-flow-score');
    var status = $('#cx-flow-status');
    var replay = $('#cx-flow-replay');

    /* [duration ms, apply()] — a tiny declarative timeline */
    var STATUS = {
      write: 'A human writes one line…',
      compile: '…a compiler translates it into machine steps…',
      exec: '…the CPU executes them, one by one…',
      result: '…and memory holds the new result. Total time: about two nanoseconds.'
    };

    var timeline = [
      [900, function () { stages[0].classList.add('is-live'); say(STATUS.write); }],
      [600, function () { arrows[0].classList.add('is-live'); }],
      [450, function () { stages[1].classList.add('is-live'); instrs[0].classList.add('is-shown'); say(STATUS.compile); }],
      [450, function () { instrs[1].classList.add('is-shown'); }],
      [450, function () { instrs[2].classList.add('is-shown'); }],
      [600, function () { arrows[1].classList.add('is-live'); }],
      [560, function () { stages[2].classList.add('is-live'); execOne(0); say(STATUS.exec); }],
      [560, function () { execOne(1); }],
      [560, function () { execOne(2); }],
      [600, function () { arrows[2].classList.add('is-live'); }],
      [900, function () {
        stages[3].classList.add('is-live');
        score.textContent = '2510';
        score.classList.add('is-bump');
        say(STATUS.result);
      }],
      [2600, function () {}]
    ];

    var step = 0;
    var timer = null;
    var started = false;

    function say(msg) { status.textContent = msg; }

    function execOne(i) {
      instrs.forEach(function (el, j) { el.classList.toggle('is-live', i === j); });
      count.textContent = String(i + 1);
      core.classList.add('is-busy');
      setTimeout(function () { core.classList.remove('is-busy'); }, 300);
      if (i === 2) {
        setTimeout(function () {
          instrs.forEach(function (el) { el.classList.remove('is-live'); });
        }, 420);
      }
    }

    function reset() {
      stages.forEach(function (el) { el.classList.remove('is-live'); });
      arrows.forEach(function (el) { el.classList.remove('is-live'); });
      instrs.forEach(function (el) { el.classList.remove('is-shown', 'is-live'); });
      count.textContent = '0';
      score.textContent = '2500';
      score.classList.remove('is-bump');
      step = 0;
    }

    function finalState() {
      reset();
      stages.forEach(function (el) { el.classList.add('is-live'); });
      instrs.forEach(function (el) { el.classList.add('is-shown'); });
      count.textContent = '3';
      score.textContent = '2510';
      say(STATUS.result);
    }

    function tick() {
      if (step >= timeline.length) { reset(); }
      var entry = timeline[step];
      if (!entry) { return; }
      entry[1]();
      timer = setTimeout(tick, entry[0]);
      step += 1;
    }

    function start() {
      if (timer) { clearTimeout(timer); timer = null; }
      reset();
      if (reduced()) { finalState(); return; }
      tick();
    }

    replay.addEventListener('click', start);
    onScreen(root, function () {
      if (!started) { started = true; start(); }
    }, function () {
      if (timer) { clearTimeout(timer); timer = null; }
      started = false;
    });
    if (reduced()) { finalState(); }
  }

  /* ==========================================================================
     02 · Die & core anatomy
     ========================================================================== */

  var PARTS = {
    core: {
      kicker: 'The die', name: 'CPU core',
      what: 'One complete execution engine: its own front end, scheduler, execution units, registers, and private L1/L2 caches. Each core runs an independent instruction stream.',
      why: 'Around 2005, raising clock speed stopped being affordable — power grows roughly with the cube of frequency. Copying the whole engine sideways became the cheaper way to buy performance.',
      links: ['l3', 'imc', 'clock']
    },
    l3: {
      kicker: 'Memory', name: 'Shared L3 cache',
      what: 'The last and largest cache level — tens of megabytes of SRAM shared by every core, typically holding whatever recently fell out of the per-core L2s.',
      why: 'It catches misses before they become 90 ns trips to RAM, and it lets cores share data without a round trip through memory when one core produces what another consumes.',
      links: ['l2', 'core', 'imc']
    },
    imc: {
      kicker: 'The die', name: 'Memory controller',
      what: 'The die’s ambassador to RAM: it queues requests from all cores, schedules them around DRAM’s quirks (banks, rows, refresh), and drives the DDR5 signal pins.',
      why: 'It used to live in a separate motherboard chip; moving it on-die cut memory latency sharply. Every cache miss that reaches it becomes a real off-chip journey.',
      links: ['l3', 'core']
    },
    clock: {
      kicker: 'The die', name: 'Clock generation',
      what: 'A PLL multiplies a ~100 MHz reference crystal up to several GHz, and a distribution tree delivers that beat to billions of transistors with picosecond alignment.',
      why: 'Every pipeline stage advances on the clock edge — it is the drumbeat the whole machine marches to. “Boost” is this block changing the multiplier on the fly as power and heat allow.',
      links: ['core']
    },
    bpred: {
      kicker: 'Front end', name: 'Branch predictor',
      what: 'Guesses the outcome and target of every branch before it executes, using tables of recent history and pattern-matching predictors, so fetch never has to wait.',
      why: 'With ~1 in 5 instructions being a branch and a ~15-cycle penalty per wrong guess, prediction accuracy is one of the strongest levers on real-world speed. Modern predictors exceed 95%.',
      links: ['fetch', 'rob']
    },
    l1i: {
      kicker: 'Front end', name: 'L1 instruction cache',
      what: 'A small (32–64 KB), very fast cache holding the machine-code bytes the core has been executing — hot loops live here.',
      why: 'Fetch needs new instruction bytes every single cycle; no other memory can answer that fast. It is split from the data cache so code and data never fight for it.',
      links: ['fetch', 'l2']
    },
    fetch: {
      kicker: 'Front end', name: 'Fetch unit',
      what: 'Reads 16–32 bytes of machine code per cycle from the L1i at the address the program counter (plus the branch predictor) points to.',
      why: 'It is the intake of the whole pipeline — everything downstream starves if fetch stalls, which is why it follows predictions instead of waiting for certainty.',
      links: ['bpred', 'l1i', 'decode']
    },
    decode: {
      kicker: 'Front end', name: 'Instruction decoder',
      what: 'Cracks raw bytes into micro-ops (µops) — the fixed, simple internal operations the execution engine actually runs. x86’s variable-length bytes make this genuinely hard.',
      why: 'It decouples the messy external instruction set from the tidy internal machine — the trick that lets 1978’s x86 encoding run on a 2025 out-of-order core.',
      links: ['fetch', 'uopq']
    },
    control: {
      kicker: 'Control', name: 'Control unit',
      what: 'The textbook name for the logic that sequences everything: what to fetch, how to route µops, when results write back. In modern cores it is not one box but machinery distributed across the front end, scheduler, and retirement.',
      why: 'Something must turn “an instruction arrived” into precisely timed signals for every other block. The datapath computes; control decides.',
      links: ['decode', 'sched', 'rob']
    },
    uopq: {
      kicker: 'Control', name: 'µop queue',
      what: 'A buffer of decoded µops waiting to enter the out-of-order engine. It smooths the flow when decode surges or the back end briefly stalls.',
      why: 'Factories put buffers between stations for the same reason — so a hiccup in one stage does not instantly stall its neighbors.',
      links: ['decode', 'sched']
    },
    sched: {
      kicker: 'Control', name: 'Rename + scheduler',
      what: 'Renames architectural registers onto a much larger physical set (erasing false conflicts), then watches each µop’s operands and dispatches it to an execution port the moment inputs are ready.',
      why: 'This is the heart of out-of-order execution: it finds instructions whose inputs happen to be ready and runs them early, hiding stalls that would otherwise idle the core.',
      links: ['uopq', 'regs', 'alu', 'fpu', 'lsu', 'rob']
    },
    regs: {
      kicker: 'Execution', name: 'Register file',
      what: 'The physical registers — hundreds of entries backing the 16 named x86 registers, read and written by execution units every cycle at multi-terabyte-per-second rates.',
      why: 'Computation needs storage as fast as the logic itself; only registers qualify. Everything slower is reached through explicit loads and stores.',
      links: ['sched', 'alu', 'fpu']
    },
    alu: {
      kicker: 'Execution', name: 'Integer ALUs',
      what: 'Arithmetic-logic units: add, subtract, compare, AND/OR/XOR, shifts — each in a single cycle. A modern core carries four or more, working in parallel.',
      why: 'Integer ops are the bread and butter of all code — loop counters, addresses, conditions — so the core keeps several ALUs busy at once to sustain 4+ IPC.',
      links: ['sched', 'regs', 'rob']
    },
    fpu: {
      kicker: 'Execution', name: 'FPU / vector units',
      what: 'Floating-point and SIMD engines: wide units that apply one operation to 4–16 numbers at once (AVX on x86, NEON/SVE on ARM), pipelined over a few cycles.',
      why: 'Science, graphics, audio, and AI are floating-point math on long arrays — dedicated wide hardware does in one instruction what would take a loop of scalar ones.',
      links: ['sched', 'regs']
    },
    lsu: {
      kicker: 'Execution', name: 'Load / store units',
      what: 'The only path between registers and memory. Address-generation units compute where; load and store queues keep memory operations correctly ordered while everything else runs shuffled.',
      why: 'Memory operations are slow and hazardous — a dedicated unit lets the core keep dozens in flight and forward store data straight to waiting loads.',
      links: ['l1d', 'sched']
    },
    l1d: {
      kicker: 'Memory', name: 'L1 data cache',
      what: 'The data twin of the L1i: ~32–128 KB answering loads in ~4 cycles, transferring 64-byte lines to and from L2.',
      why: 'Nearly every third instruction touches memory; without a 4-cycle first stop, the core would spend its life waiting.',
      links: ['lsu', 'l2']
    },
    l2: {
      kicker: 'Memory', name: 'L2 cache',
      what: 'Each core’s private second level — 1–3 MB, ~14 cycles — catching what spills out of the two L1s.',
      why: 'Cache design is a speed-versus-size trade at every level; L2 is the middle rung that keeps L1 misses from becoming 50-cycle L3 trips.',
      links: ['l1i', 'l1d', 'l3']
    },
    rob: {
      kicker: 'Control', name: 'Reorder buffer',
      what: 'Tracks every in-flight instruction — hundreds at once on current cores — and retires their results strictly in program order, no matter how shuffled execution was.',
      why: 'It preserves the illusion of one-at-a-time execution: on a mispredicted branch or an exception, everything younger is discarded and the visible state stays exact.',
      links: ['sched', 'bpred', 'control']
    }
  };

  function initAnatomy() {
    var svg = $('#cx-die');
    if (!svg) { return; }
    var dieView = $('#cx-die-view');
    var coreView = $('#cx-core-view');
    var btnDie = $('#cx-view-die-btn');
    var btnCore = $('#cx-view-core-btn');
    var title = $('#cx-part-title');
    var kicker = $('#cx-part-kicker');
    var what = $('#cx-part-what');
    var why = $('#cx-part-why');
    var whyLabel = $('#cx-part-why-label');
    var links = $('#cx-part-links');
    var linksLabel = $('#cx-part-links-label');

    var VIEW_OF = {};
    $$('.cx-part', dieView).forEach(function (g) { VIEW_OF[g.getAttribute('data-part')] = VIEW_OF[g.getAttribute('data-part')] || 'die'; });
    $$('.cx-part', coreView).forEach(function (g) {
      var id = g.getAttribute('data-part');
      if (!VIEW_OF[id]) { VIEW_OF[id] = 'core'; }
    });

    function setView(view) {
      dieView.classList.toggle('is-hidden', view !== 'die');
      coreView.classList.toggle('is-hidden', view !== 'core');
      btnDie.setAttribute('aria-pressed', String(view === 'die'));
      btnCore.setAttribute('aria-pressed', String(view === 'core'));
    }

    function currentView() {
      return dieView.classList.contains('is-hidden') ? 'core' : 'die';
    }

    function select(partId) {
      var data = PARTS[partId];
      if (!data) { return; }
      /* If the part only exists in the other view, switch views. */
      var home = VIEW_OF[partId] || 'die';
      var hasHere = $$('.cx-part[data-part="' + partId + '"]',
        currentView() === 'die' ? dieView : coreView).length > 0;
      if (!hasHere) { setView(home); }

      $$('.cx-part', svg).forEach(function (g) {
        var id = g.getAttribute('data-part');
        g.classList.toggle('is-active', id === partId);
        g.classList.toggle('is-related', data.links.indexOf(id) !== -1);
      });

      kicker.textContent = data.kicker;
      title.textContent = data.name;
      what.textContent = data.what;
      why.textContent = data.why;
      whyLabel.style.display = '';
      linksLabel.style.display = '';
      links.innerHTML = '';
      data.links.forEach(function (id) {
        if (!PARTS[id]) { return; }
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'cx-part-link';
        b.textContent = PARTS[id].name;
        b.addEventListener('click', function () { select(id); });
        links.appendChild(b);
      });
    }

    whyLabel.style.display = 'none';
    linksLabel.style.display = 'none';

    btnDie.addEventListener('click', function () { setView('die'); });
    btnCore.addEventListener('click', function () { setView('core'); });

    $$('.cx-part', svg).forEach(function (g) {
      var id = g.getAttribute('data-part');
      g.addEventListener('click', function () { select(id); });
      g.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          select(id);
        }
      });
    });
  }

  /* ==========================================================================
     03 · Fetch–decode–execute stepper
     ========================================================================== */

  function initCycle() {
    var svg = $('#cx-fdx-svg');
    if (!svg) { return; }
    var token = $('#cx-fdx-token');
    var stageName = $('#cx-fdx-stagename');
    var stageText = $('#cx-fdx-stagetext');
    var dots = $('#cx-fdx-dots');
    var pcText = $('#cx-fdx-pc');
    var countOut = $('#cx-fdx-count');
    var btnPrev = $('#cx-fdx-prev');
    var btnNext = $('#cx-fdx-next');
    var btnPlay = $('#cx-fdx-play');
    var btnReset = $('#cx-fdx-reset');

    var STAGES = [
      { name: '1 · Asleep in RAM', box: ['ram'], x: 841, y: 230,
        text: 'A program is just bytes in memory. At address <code>0x4000</code> sit three of them — <code>48 01 D8</code> — which mean <code>add rax, rbx</code>. Nothing happens until the core asks for them.' },
      { name: '2 · Copied into the caches', box: ['l2'], x: 576, y: 280,
        text: 'The request pulls a whole 64-byte line out of RAM, and copies land in the caches on the way in (L3 → L2). The next fetch of anything nearby will skip the 90 ns trip entirely.' },
      { name: '3 · Fetched into the core', box: ['l1i', 'fetch'], x: 101, y: 130,
        text: 'The fetch unit reads a block of bytes from the L1 instruction cache at the address the program counter holds — and the branch predictor has already told it what to fetch after that.' },
      { name: '4 · Decoded into µops', box: ['decode'], x: 261, y: 130,
        text: 'The decoder cracks <code>48 01 D8</code> into micro-ops — here just one: <em>integer add, rax + rbx → rax</em>. Complex x86 instructions may become several µops.' },
      { name: '5 · Waiting in the scheduler', box: ['sched'], x: 421, y: 130,
        text: 'The µop sits with dozens of others until its inputs are ready and an ALU is free. If rbx is still being computed, it waits here — younger, independent work may overtake it.' },
      { name: '6 · Executed', box: ['alu'], x: 421, y: 280,
        text: 'An ALU adds the two 64-bit values in a single cycle — under 250 picoseconds. This moment of actual arithmetic is a sliver of the journey; everything else was logistics.' },
      { name: '7 · Written back & retired', box: ['regs'], x: 261, y: 280,
        text: 'The sum lands in the physical register backing <code>rax</code>, and the reorder buffer retires the instruction in program order. The result is now architecturally real.' },
      { name: '8 · On to the next', box: ['fetch'], x: 101, y: 130,
        text: 'The program counter moved on long ago — fetch runs far ahead of retire. And the next instruction is already sitting in L1i: a cache <em>hit</em>, no RAM trip. This cycle repeats billions of times per second.' }
    ];

    var idx = 0;
    var done = 0;
    var playing = false;
    var timer = null;

    /* build progress dots */
    STAGES.forEach(function () {
      var s = document.createElement('span');
      dots.appendChild(s);
    });
    var dotEls = $$('span', dots);

    function render() {
      var st = STAGES[idx];
      $$('.cx-fdx-box', svg).forEach(function (g) {
        var key = g.getAttribute('data-fdx');
        g.classList.toggle('is-live', st.box.indexOf(key) !== -1);
      });
      token.setAttribute('cx', String(st.x));
      token.setAttribute('cy', String(st.y));
      stageName.innerHTML = st.name;
      stageText.innerHTML = st.text;
      dotEls.forEach(function (d, i) { d.classList.toggle('is-on', i <= idx); });
      countOut.textContent = String(done);
      pcText.textContent = '0x' + (0x4000 + done * 3).toString(16).toUpperCase();
    }

    function step(dir) {
      var next = idx + dir;
      if (next >= STAGES.length) {
        next = 2;               /* subsequent instructions start at the L1i — it is a hit now */
        done += 1;
      }
      if (next < 0) { next = 0; }
      idx = next;
      render();
    }

    function stopPlay() {
      playing = false;
      btnPlay.setAttribute('aria-pressed', 'false');
      btnPlay.textContent = 'Autoplay';
      if (timer) { clearInterval(timer); timer = null; }
    }

    btnNext.addEventListener('click', function () { stopPlay(); step(1); });
    btnPrev.addEventListener('click', function () { stopPlay(); step(-1); });
    btnReset.addEventListener('click', function () {
      stopPlay();
      idx = 0;
      done = 0;
      render();
    });
    btnPlay.addEventListener('click', function () {
      if (playing) { stopPlay(); return; }
      playing = true;
      btnPlay.setAttribute('aria-pressed', 'true');
      btnPlay.textContent = 'Pause';
      step(1);
      timer = setInterval(function () { step(1); }, reduced() ? 3600 : 2400);
    });
    onScreen(svg, null, stopPlay);

    render();
  }

  /* ==========================================================================
     04 · Code-to-machine-code stepper
     ========================================================================== */

  function initXlate() {
    var root = $('#cpu-experience .cx-xlate');
    if (!root) { return; }
    var note = $('#cx-xlate-note');
    var btnStep = $('#cx-xlate-step');
    var btnPlay = $('#cx-xlate-play');
    var btnReset = $('#cx-xlate-reset');

    var STEPS = [
      { on: ['c1'],
        html: 'The compiler starts from <code>return a + b;</code> — one human-readable idea that has to become arithmetic on named hardware registers.' },
      { on: ['c1', 'a0', 'h0', 'b0'],
        html: '<code>mov eax, edi</code> copies argument <em>a</em> into the accumulator. Its encoding is <code>89 F8</code>: opcode <code>89</code> means “copy register to register,” and the ModRM byte <code>F8</code> names the pair EDI → EAX.' },
      { on: ['c1', 'a1', 'h1', 'b1'],
        html: '<code>add eax, esi</code> adds argument <em>b</em>. Same grammar, different verb: opcode <code>01</code> is add, ModRM <code>F0</code> names ESI → EAX. Two bytes each — the encoding is a real language with its own syntax.' },
      { on: ['c2', 'a2', 'h2', 'b2'],
        html: '<code>ret</code> is a single byte, <code>C3</code> — x86 instructions range from 1 to 15 bytes. The whole function is five bytes of machine code.' },
      { on: ['c0', 'c1', 'c2', 'a0', 'a1', 'a2', 'h0', 'h1', 'h2', 'b0', 'b1', 'b2'],
        html: 'Five bytes, three instructions, zero magic left. The rightmost column is literally the voltage pattern the decoder receives — and the decoder reads it the way you read words: by recognizing structure, billions of times per second.' }
    ];

    var idx = -1;
    var playing = false;
    var timer = null;

    function render() {
      var on = idx >= 0 ? STEPS[idx].on : [];
      $$('.cx-xline', root).forEach(function (el) {
        el.classList.toggle('is-live', on.indexOf(el.getAttribute('data-ln')) !== -1);
      });
      if (idx >= 0) { note.innerHTML = STEPS[idx].html; }
    }

    function step() {
      idx = (idx + 1) % STEPS.length;
      render();
    }

    function stopPlay() {
      playing = false;
      btnPlay.setAttribute('aria-pressed', 'false');
      btnPlay.textContent = 'Autoplay';
      if (timer) { clearInterval(timer); timer = null; }
    }

    btnStep.addEventListener('click', function () { stopPlay(); step(); });
    btnReset.addEventListener('click', function () {
      stopPlay();
      idx = -1;
      note.innerHTML = 'Step through the translation to see how one line of C becomes five bytes the decoder can read.';
      render();
    });
    btnPlay.addEventListener('click', function () {
      if (playing) { stopPlay(); return; }
      playing = true;
      btnPlay.setAttribute('aria-pressed', 'true');
      btnPlay.textContent = 'Pause';
      step();
      timer = setInterval(step, reduced() ? 4200 : 2800);
    });
    onScreen(root, null, stopPlay);
  }

  /* ==========================================================================
     05 · Register file simulator
     ========================================================================== */

  function initRegisters() {
    var root = $('#cpu-experience .cx-regs-layout');
    if (!root) { return; }
    var rows = $$('.cx-prog-row', root);
    var status = $('#cx-regs-status');
    var btnStep = $('#cx-regs-step');
    var btnRun = $('#cx-regs-run');
    var btnReset = $('#cx-regs-reset');

    var ADDRS = ['0x00', '0x04', '0x08', '0x0c', '0x10', '0x14'];

    function regEl(name) { return $('.cx-reg[data-reg="' + name + '"]', root); }
    function setVal(name, text) {
      var el = regEl(name);
      if (el) { $('.cx-reg-val', el).textContent = text; }
    }
    function flash(name) {
      var el = regEl(name);
      if (!el) { return; }
      el.classList.add('is-flash');
      setTimeout(function () { el.classList.remove('is-flash'); }, 500);
    }
    function setFlag(name, on) {
      var el = $('.cx-flag[data-flag="' + name + '"]', root);
      if (el) { el.classList.toggle('is-set', !!on); }
    }

    var st;
    var timer = null;

    function reset() {
      st = { ip: 0, rax: null, rcx: null, zf: false, sf: false, halted: false };
      setVal('rax', '?');
      setVal('rcx', '?');
      setVal('rip', '0x00');
      setFlag('zf', false);
      setFlag('sf', false);
      setFlag('cf', false);
      render();
      status.textContent = 'Press Step to execute the first instruction.';
    }

    function render() {
      rows.forEach(function (row, i) {
        row.classList.toggle('is-live', !st.halted && i === st.ip);
      });
      setVal('rip', ADDRS[st.ip]);
    }

    function step() {
      if (st.halted) { return; }
      var i = st.ip;
      var msg = '';
      if (i === 0) {
        st.rax = 0;
        setVal('rax', '0');
        flash('rax');
        msg = 'mov writes the constant 0 into RAX. The old contents are simply gone — registers have no history.';
        st.ip = 1;
      } else if (i === 1) {
        st.rcx = 3;
        setVal('rcx', '3');
        flash('rcx');
        msg = 'RCX becomes our loop counter: 3.';
        st.ip = 2;
      } else if (i === 2) {
        st.rax += st.rcx;
        setVal('rax', String(st.rax));
        flash('rax');
        msg = 'The ALU reads RAX and RCX in the same cycle and writes back ' + st.rax + '.';
        st.ip = 3;
      } else if (i === 3) {
        st.rcx -= 1;
        st.zf = st.rcx === 0;
        setVal('rcx', String(st.rcx));
        flash('rcx');
        setFlag('zf', st.zf);
        flash('flags');
        msg = st.zf
          ? 'dec takes RCX to 0 — and quietly sets the Zero Flag. The next instruction will read it.'
          : 'dec takes RCX to ' + st.rcx + '. The result is not zero, so ZF stays clear.';
        st.ip = 4;
      } else if (i === 4) {
        if (!st.zf) {
          st.ip = 2;
          flash('rip');
          msg = 'jnz reads ZF: clear — so the branch is taken and RIP jumps back to 0x08. Control flow is just arithmetic on RIP.';
        } else {
          st.ip = 5;
          msg = 'jnz reads ZF: set — the branch falls through. The loop is done.';
        }
      } else {
        st.halted = true;
        msg = 'Halted. RAX holds 6 = 3 + 2 + 1. Fourteen instruction executions, three registers, one flag — that is all a loop is.';
        stopRun();
      }
      render();
      status.innerHTML = msg;
      if (st.halted) { rows.forEach(function (r) { r.classList.remove('is-live'); }); }
    }

    function stopRun() {
      if (timer) { clearInterval(timer); timer = null; }
      btnRun.setAttribute('aria-pressed', 'false');
      btnRun.textContent = 'Run';
    }

    btnStep.addEventListener('click', function () { stopRun(); step(); });
    btnRun.addEventListener('click', function () {
      if (timer) { stopRun(); return; }
      if (st.halted) { reset(); }
      btnRun.setAttribute('aria-pressed', 'true');
      btnRun.textContent = 'Pause';
      step();
      timer = setInterval(function () {
        step();
        if (st.halted) { stopRun(); }
      }, reduced() ? 1100 : 700);
    });
    btnReset.addEventListener('click', function () { stopRun(); reset(); });
    onScreen(root, null, stopRun);

    reset();
  }

  /* ==========================================================================
     06 · Memory hierarchy demo
     ========================================================================== */

  function initMemory() {
    var root = $('#cpu-experience .cx-hier');
    if (!root) { return; }
    var trace = $('#cx-mem-trace');
    var verdict = $('#cx-mem-verdict');
    var btnHot = $('#cx-mem-hot');
    var btnCold = $('#cx-mem-cold');

    var HOT = [
      { lvl: 'ram', cyc: 400, what: 'a[0] — cold start: RAM fetch brings the whole 64-byte line' },
      { lvl: 'l1', cyc: 4, what: 'a[1] — same cache line: L1 hit' },
      { lvl: 'l1', cyc: 4, what: 'a[2] — L1 hit' },
      { lvl: 'l1', cyc: 4, what: 'a[3] — L1 hit' },
      { lvl: 'l1', cyc: 4, what: 'a[4] — L1 hit' },
      { lvl: 'l1', cyc: 4, what: 'a[5] — L1 hit' },
      { lvl: 'l1', cyc: 4, what: 'a[6] — L1 hit' },
      { lvl: 'l1', cyc: 4, what: 'a[7] — L1 hit' }
    ];
    var COLD = [
      { lvl: 'ram', cyc: 400, what: 'node @ 0x91f2a0 — nowhere near anything cached' },
      { lvl: 'ram', cyc: 400, what: 'next @ 0x2c8f10 — cold again' },
      { lvl: 'l3', cyc: 50, what: 'next @ 0x77aa08 — lucky: still in L3' },
      { lvl: 'ram', cyc: 400, what: 'next @ 0x5d1b48 — cold' },
      { lvl: 'ram', cyc: 400, what: 'next @ 0x08c9e0 — cold' },
      { lvl: 'ram', cyc: 400, what: 'next @ 0xa41770 — cold' },
      { lvl: 'l3', cyc: 50, what: 'next @ 0x3f0d28 — L3 hit' },
      { lvl: 'ram', cyc: 400, what: 'next @ 0x6b2a90 — cold' }
    ];
    var LEVEL_LABEL = { l1: 'L1', l2: 'L2', l3: 'L3', ram: 'RAM', ssd: 'SSD' };

    var running = false;

    function flashLevel(lvl, kind) {
      var el = $('.cx-level[data-level="' + lvl + '"]', root);
      if (!el) { return; }
      el.classList.add(kind === 'miss' ? 'is-miss' : 'is-hit');
      setTimeout(function () { el.classList.remove('is-miss', 'is-hit'); }, 450);
    }

    function addRow(item, i, instant) {
      var kind = item.lvl === 'ram' || item.lvl === 'ssd' ? 'miss' : 'hit';
      var li = document.createElement('li');
      li.setAttribute('data-kind', kind);
      li.innerHTML = '<span>#' + (i + 1) + ' · ' + item.what + '</span>' +
        '<span class="cx-mem-where">' + LEVEL_LABEL[item.lvl] + ' · ' + item.cyc + ' cyc</span>';
      trace.appendChild(li);
      if (instant) {
        li.classList.add('is-in');
      } else {
        requestAnimationFrame(function () {
          requestAnimationFrame(function () { li.classList.add('is-in'); });
        });
        flashLevel(item.lvl, kind);
      }
    }

    function finish(pattern, total) {
      running = false;
      btnHot.disabled = false;
      btnCold.disabled = false;
      if (pattern === HOT) {
        verdict.innerHTML = '<strong>8 loads, ' + fmtInt(total) + ' cycles.</strong> ' +
          'One miss paid for the whole cache line; seven neighbors rode along free. ' +
          'This is why arrays are fast — the hardware rewards marching in order.';
      } else {
        verdict.innerHTML = '<strong>8 loads, ' + fmtInt(total) + ' cycles — ~6× slower for the same work.</strong> ' +
          'Every pointer hop lands somewhere cold, and no cache can predict a random walk. ' +
          'This is why linked structures crawl on modern hardware.';
      }
    }

    function run(pattern) {
      if (running) { return; }
      running = true;
      btnHot.disabled = true;
      btnCold.disabled = true;
      trace.innerHTML = '';
      var total = 0;
      if (reduced()) {
        pattern.forEach(function (item, i) { total += item.cyc; addRow(item, i, true); });
        finish(pattern, total);
        return;
      }
      verdict.textContent = 'Running…';
      var i = 0;
      (function next() {
        if (i >= pattern.length) { finish(pattern, total); return; }
        var item = pattern[i];
        total += item.cyc;
        addRow(item, i, false);
        i += 1;
        setTimeout(next, 380);
      })();
    }

    btnHot.addEventListener('click', function () { run(HOT); });
    btnCold.addEventListener('click', function () { run(COLD); });
  }

  /* ==========================================================================
     07 · Pipeline animation
     ========================================================================== */

  function initPipeline() {
    var canvas = $('#cx-pipe-canvas');
    if (!canvas) { return; }
    var fit = setupCanvas(canvas, function () { draw(); });
    var ctx = fit.ctx;
    var st = fit.state;
    var outCycles = $('#cx-pipe-cycles');
    var outDone = $('#cx-pipe-done');
    var outIpc = $('#cx-pipe-ipc');
    var verdict = $('#cx-pipe-verdict');
    var btnSerial = $('#cx-pipe-serial');
    var btnPar = $('#cx-pipe-par');
    var btnReplay = $('#cx-pipe-replay');

    var NI = 8;
    var NS = 5;
    var STAGE_NAMES = ['Fetch', 'Decode', 'Execute', 'Memory', 'Write back'];
    var STAGE_COLORS = [C.cTeal, C.sky, C.amber, C.violet, C.lime];

    var mode = 'par';
    var cy = 0;           /* fractional current cycle */
    var finished = false;

    function totalCycles() { return mode === 'par' ? NI + NS - 1 : NI * NS; }
    function cellCycle(i, s) { return mode === 'par' ? i + s : i * NS + s; }

    function doneCount(cycles) {
      if (mode === 'par') { return clamp(Math.floor(cycles) - (NS - 1), 0, NI); }
      return clamp(Math.floor(cycles / NS), 0, NI);
    }

    function draw() {
      var w = st.w, h = st.h;
      ctx.clearRect(0, 0, w, h);
      var left = 44;
      var top = 24;
      var legendH = 30;
      var total = totalCycles();
      var cw = (w - left - 12) / total;
      var rh = (h - top - legendH - 12) / NI;

      ctx.font = '11px Inter, sans-serif';
      ctx.textBaseline = 'middle';

      /* cycle ticks */
      ctx.fillStyle = C.faint;
      ctx.textAlign = 'center';
      var tickEvery = total > 20 ? 5 : 2;
      var c;
      for (c = 0; c <= total; c += tickEvery) {
        ctx.fillText(String(c), left + c * cw, top - 12);
      }
      ctx.strokeStyle = 'rgba(30, 41, 59, 0.8)';
      for (c = 0; c <= total; c += 1) {
        ctx.beginPath();
        ctx.moveTo(left + c * cw, top);
        ctx.lineTo(left + c * cw, top + NI * rh);
        ctx.stroke();
      }

      /* instruction rows */
      ctx.textAlign = 'right';
      var i, s;
      for (i = 0; i < NI; i++) {
        ctx.fillStyle = C.muted;
        ctx.fillText('I' + (i + 1), left - 8, top + i * rh + rh / 2);
        for (s = 0; s < NS; s++) {
          var cc = cellCycle(i, s);
          if (cc >= cy) { continue; }
          var x = left + cc * cw;
          var y = top + i * rh + 2;
          var active = Math.floor(cy) === cc + 1 || (cy - cc) < 1.6;
          ctx.globalAlpha = active ? 1 : 0.65;
          ctx.fillStyle = STAGE_COLORS[s];
          roundRect(ctx, x + 1, y, Math.max(2, cw - 2), rh - 4, 3);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }

      /* sweep line */
      if (!finished && cy > 0 && cy < total + 1) {
        var sx = left + Math.min(cy, total) * cw;
        ctx.strokeStyle = 'rgba(45, 212, 191, 0.7)';
        ctx.beginPath();
        ctx.moveTo(sx, top - 4);
        ctx.lineTo(sx, top + NI * rh + 4);
        ctx.stroke();
      }

      /* legend */
      ctx.textAlign = 'left';
      var lx = left;
      var ly = h - legendH / 2 - 2;
      for (s = 0; s < NS; s++) {
        ctx.fillStyle = STAGE_COLORS[s];
        roundRect(ctx, lx, ly - 5, 10, 10, 2);
        ctx.fill();
        ctx.fillStyle = C.muted;
        ctx.fillText(STAGE_NAMES[s], lx + 15, ly);
        lx += 15 + ctx.measureText(STAGE_NAMES[s]).width + 18;
      }
    }

    function updateOuts() {
      var total = totalCycles();
      var cycles = clamp(Math.floor(cy), 0, total);
      var done = doneCount(cy);
      outCycles.textContent = String(cycles);
      outDone.textContent = done + ' / ' + NI;
      outIpc.textContent = cycles > 0 ? (done / cycles).toFixed(2) + ' IPC' : '—';
    }

    function setVerdict() {
      if (mode === 'par') {
        verdict.innerHTML = '<strong>8 instructions in 12 cycles.</strong> Once the pipe fills, ' +
          'one instruction finishes every cycle — all five stage units busy on five different ' +
          'instructions at once. Keep the stream going and throughput approaches 1.0 IPC.';
      } else {
        verdict.innerHTML = '<strong>8 instructions in 40 cycles.</strong> Each instruction crosses ' +
          'all five stages alone, so at any moment four of the five hardware units are idle. ' +
          'Same hardware, same program — 3.3× slower.';
      }
    }

    var loop = makeLoop(function (t, dt) {
      var rate = mode === 'par' ? 3.2 : 9;
      cy += (dt / 1000) * rate;
      var total = totalCycles();
      if (cy >= total + 1.5) {
        cy = total + 1.5;
        finished = true;
        loop.stop();
        setVerdict();
      }
      draw();
      updateOuts();
    });

    function run() {
      loop.stop();
      finished = false;
      verdict.textContent = '';
      if (reduced()) {
        cy = totalCycles() + 1.5;
        finished = true;
        draw();
        updateOuts();
        setVerdict();
        return;
      }
      cy = 0;
      draw();
      updateOuts();
      loop.start();
    }

    function setMode(m) {
      mode = m;
      btnPar.setAttribute('aria-pressed', String(m === 'par'));
      btnSerial.setAttribute('aria-pressed', String(m === 'serial'));
      run();
    }

    btnPar.addEventListener('click', function () { setMode('par'); });
    btnSerial.addEventListener('click', function () { setMode('serial'); });
    btnReplay.addEventListener('click', run);

    var seen = false;
    onScreen(canvas, function () {
      if (!seen) { seen = true; run(); }
    }, function () { loop.stop(); });
    draw();
  }

  /* ==========================================================================
     08 · Branch prediction
     ========================================================================== */

  function initBranch() {
    var canvas = $('#cx-branch-canvas');
    if (!canvas) { return; }
    var fit = setupCanvas(canvas, function () { draw(); });
    var ctx = fit.ctx;
    var st = fit.state;
    var slider = $('#cx-branch-acc');
    var sliderOut = $('#cx-branch-acc-out');
    var btnForce = $('#cx-branch-force');
    var outDone = $('#cx-branch-done');
    var outWasted = $('#cx-branch-wasted');
    var outIpc = $('#cx-branch-ipc');
    var verdict = $('#cx-branch-verdict');

    var D = 12;               /* pipeline depth in visual stages */
    var BR_EVERY = 6;         /* every 6th instruction is a branch */
    var RESOLVE_AT = D - 2;   /* branches resolve near the end of the pipe */

    var inflight = [];        /* { age, br, seq } */
    var dying = [];           /* { x, y, vy, alpha } */
    var seq = 0;
    var cycles = 0;
    var retired = 0;
    var wasted = 0;
    var flashT = 0;
    var forceNext = false;
    var acc = 0.95;

    function spawn() {
      seq += 1;
      inflight.push({ age: 0, br: seq % BR_EVERY === 0, seq: seq });
    }

    function tick() {
      cycles += 1;
      spawn();
      var flushed = false;
      var i;
      for (i = 0; i < inflight.length; i++) {
        var ins = inflight[i];
        ins.age += 1;
        if (ins.br && ins.age === RESOLVE_AT && !ins.resolved) {
          ins.resolved = true;
          var wrong = forceNext || Math.random() > acc;
          forceNext = false;
          btnForce.disabled = false;
          if (wrong && !flushed) {
            flushed = true;
            var young = inflight.filter(function (o) { return o.age < ins.age; });
            inflight = inflight.filter(function (o) { return o.age >= ins.age; });
            wasted += young.length;
            flashT = 1;
            young.forEach(function (o) {
              dying.push({
                x: xFor(o.age), y: yFor(o.seq),
                vy: 20 + Math.random() * 60, alpha: 1
              });
            });
          }
        }
      }
      inflight = inflight.filter(function (o) {
        if (o.age >= D) { retired += 1; return false; }
        return true;
      });
      outDone.textContent = fmtInt(retired);
      outWasted.textContent = fmtInt(wasted);
      outIpc.textContent = cycles > 30 ? (retired / cycles).toFixed(2) : '…';
    }

    function xFor(age) { return 24 + (age / D) * (st.w - 70); }
    function yFor(s) { return 60 + (s % 5) * ((st.h - 110) / 4); }

    function draw() {
      var w = st.w, h = st.h;
      ctx.clearRect(0, 0, w, h);

      /* pipe outline */
      ctx.strokeStyle = flashT > 0 ? 'rgba(225, 29, 72, ' + (0.25 + flashT * 0.4) + ')' : 'rgba(51, 65, 85, 0.8)';
      roundRect(ctx, 12, 34, w - 24, h - 70, 12);
      ctx.stroke();

      ctx.font = '11px Inter, sans-serif';
      ctx.fillStyle = C.faint;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('Fetch (speculating ahead)', 20, 20);
      ctx.textAlign = 'right';
      ctx.fillText('Execute → retire', w - 20, 20);
      ctx.textAlign = 'center';
      ctx.fillText('every block entered on a guess', w / 2, h - 16);

      /* resolve line */
      var rx = xFor(RESOLVE_AT);
      ctx.strokeStyle = 'rgba(2, 132, 199, 0.5)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(rx, 38);
      ctx.lineTo(rx, h - 40);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(2, 132, 199, 0.8)';
      ctx.fillText('branches resolve here', rx, h - 26);

      /* in-flight instructions */
      inflight.forEach(function (o) {
        var x = xFor(o.age);
        var y = yFor(o.seq);
        if (o.br) {
          ctx.fillStyle = C.sky;
          ctx.beginPath();
          ctx.moveTo(x, y - 8);
          ctx.lineTo(x + 8, y);
          ctx.lineTo(x, y + 8);
          ctx.lineTo(x - 8, y);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.fillStyle = o.age >= RESOLVE_AT ? C.cTeal : C.amber;
          roundRect(ctx, x - 6, y - 6, 12, 12, 3);
          ctx.fill();
        }
      });

      /* dying (flushed) blocks */
      dying.forEach(function (d) {
        ctx.globalAlpha = d.alpha;
        ctx.fillStyle = C.rose;
        roundRect(ctx, d.x - 6, d.y - 6, 12, 12, 3);
        ctx.fill();
        ctx.globalAlpha = 1;
      });
    }

    function modelText() {
      var stall = (1 / BR_EVERY) * (1 - acc) * (RESOLVE_AT - 1);
      var frac = stall / (1 + stall);
      return 'At ' + Math.round(acc * 100) + '% accuracy, with a branch every ' + BR_EVERY +
        ' instructions and an 11-cycle refill, the core loses about <strong>' +
        Math.round(frac * 100) + '% of its cycles</strong> to flushes. Drag the slider — ' +
        'watch how fast 99% → 85% turns a smooth pipe into a stop-start one.';
    }

    var carry = 0;
    var loop = makeLoop(function (t, dt) {
      carry += dt;
      var stepMs = 220;
      while (carry >= stepMs) {
        carry -= stepMs;
        tick();
      }
      flashT = Math.max(0, flashT - dt / 400);
      dying = dying.filter(function (d) {
        d.y += d.vy * (dt / 1000);
        d.alpha -= dt / 700;
        return d.alpha > 0;
      });
      draw();
    });

    function syncSlider() {
      acc = parseInt(slider.value, 10) / 100;
      sliderOut.textContent = slider.value + '%';
      verdict.innerHTML = modelText();
    }

    slider.addEventListener('input', syncSlider);
    btnForce.addEventListener('click', function () {
      forceNext = true;
      btnForce.disabled = true;
      if (reduced()) {
        /* one manual step burst so the flush is visible even without animation */
        var k;
        for (k = 0; k < RESOLVE_AT + 2; k++) { tick(); }
        draw();
        btnForce.disabled = false;
      }
    });

    syncSlider();
    if (reduced()) {
      /* pre-fill a static snapshot */
      var k;
      for (k = 0; k < D + 4; k++) { tick(); }
      draw();
    } else {
      onScreen(canvas, function () { loop.start(); }, function () { loop.stop(); });
    }
  }

  /* ==========================================================================
     09 · Superscalar & out-of-order
     ========================================================================== */

  function initOoo() {
    var canvas = $('#cx-ooo-canvas');
    if (!canvas) { return; }
    var fit = setupCanvas(canvas, function () { draw(); });
    var ctx = fit.ctx;
    var st = fit.state;
    var btnIn = $('#cx-ooo-inorder');
    var btnOut = $('#cx-ooo-outoforder');
    var btnReplay = $('#cx-ooo-replay');
    var outIn = $('#cx-ooo-cyc-in');
    var outOut = $('#cx-ooo-cyc-out');
    var outSpeed = $('#cx-ooo-speedup');
    var verdict = $('#cx-ooo-verdict');

    var INSTRS = [
      { id: 'I1', port: 'mem', lat: 12, deps: [], chain: 'a' },
      { id: 'I2', port: 'alu', lat: 1, deps: [0], chain: 'a' },
      { id: 'I3', port: 'alu', lat: 3, deps: [], chain: 'b' },
      { id: 'I4', port: 'alu', lat: 1, deps: [2], chain: 'b' },
      { id: 'I5', port: 'mem', lat: 4, deps: [], chain: 'c' },
      { id: 'I6', port: 'alu', lat: 1, deps: [4, 1], chain: 'c' }
    ];
    var CHAIN_COLOR = { a: C.violet, b: C.cTeal, c: C.amber };

    function schedule(ooo) {
      var issue = [], finish = [];
      var n = INSTRS.length;
      var i, c;
      for (i = 0; i < n; i++) { issue.push(-1); finish.push(-1); }
      for (c = 0; c < 200; c++) {
        var slots = { alu: 2, mem: 1 };
        var blocked = false;
        for (i = 0; i < n; i++) {
          if (issue[i] !== -1) { continue; }
          if (!ooo && blocked) { break; }
          var ins = INSTRS[i];
          var ready = ins.deps.every(function (d) {
            return finish[d] !== -1 && finish[d] <= c;
          });
          if (ready && slots[ins.port] > 0) {
            slots[ins.port] -= 1;
            issue[i] = c;
            finish[i] = c + ins.lat;
          } else if (!ooo) {
            blocked = true;
          }
        }
        var doneAll = issue.every(function (v) { return v !== -1; });
        if (doneAll) { break; }
      }
      var total = Math.max.apply(null, finish);
      return { issue: issue, finish: finish, total: total };
    }

    var SCHED_IN = schedule(false);
    var SCHED_OUT = schedule(true);
    var AXIS = Math.max(SCHED_IN.total, SCHED_OUT.total);

    var mode = 'ooo';
    var sweep = 0;
    var finished = false;

    function activeSched() { return mode === 'ooo' ? SCHED_OUT : SCHED_IN; }

    function draw() {
      var w = st.w, h = st.h;
      ctx.clearRect(0, 0, w, h);
      var s = activeSched();
      var left = 46;
      var top = 26;
      var bottom = 26;
      var rh = (h - top - bottom) / INSTRS.length;
      var cw = (w - left - 14) / AXIS;

      ctx.font = '11px Inter, sans-serif';
      ctx.textBaseline = 'middle';

      /* cycle grid */
      ctx.textAlign = 'center';
      var c;
      for (c = 0; c <= AXIS; c += 2) {
        ctx.fillStyle = C.faint;
        ctx.fillText(String(c), left + c * cw, top - 12);
        ctx.strokeStyle = 'rgba(30, 41, 59, 0.7)';
        ctx.beginPath();
        ctx.moveTo(left + c * cw, top);
        ctx.lineTo(left + c * cw, h - bottom);
        ctx.stroke();
      }

      INSTRS.forEach(function (ins, i) {
        var y = top + i * rh + rh / 2;
        ctx.textAlign = 'right';
        ctx.fillStyle = C.muted;
        ctx.fillText(ins.id + ' · ' + (ins.port === 'mem' ? 'load' : 'alu'), left - 8, y);

        /* waiting line */
        var isu = s.issue[i];
        var fin = s.finish[i];
        var showTo = Math.min(sweep, fin);
        if (isu > 0) {
          var wTo = Math.min(sweep, isu);
          if (wTo > 0) {
            ctx.strokeStyle = 'rgba(100, 116, 139, 0.45)';
            ctx.setLineDash([3, 4]);
            ctx.beginPath();
            ctx.moveTo(left, y);
            ctx.lineTo(left + wTo * cw, y);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
        /* execution bar */
        if (showTo > isu && isu !== -1) {
          ctx.fillStyle = CHAIN_COLOR[ins.chain];
          roundRect(ctx, left + isu * cw, y - rh * 0.28,
            (showTo - isu) * cw, rh * 0.56, 4);
          ctx.fill();
          if (sweep >= fin) {
            ctx.fillStyle = 'rgba(241, 245, 249, 0.85)';
            ctx.textAlign = 'left';
            ctx.font = '10px Inter, sans-serif';
            ctx.fillText('done @ ' + fin, left + fin * cw + 5, y);
            ctx.font = '11px Inter, sans-serif';
          }
        }
      });

      /* sweep line */
      if (!finished) {
        var sx = left + Math.min(sweep, AXIS) * cw;
        ctx.strokeStyle = 'rgba(45, 212, 191, 0.7)';
        ctx.beginPath();
        ctx.moveTo(sx, top - 4);
        ctx.lineTo(sx, h - bottom + 4);
        ctx.stroke();
      }
    }

    function setOuts() {
      outIn.textContent = SCHED_IN.total + ' cycles';
      outOut.textContent = SCHED_OUT.total + ' cycles';
      outSpeed.textContent = (SCHED_IN.total / SCHED_OUT.total).toFixed(1) + '×';
    }

    function setVerdict() {
      if (mode === 'ooo') {
        verdict.innerHTML = '<strong>' + SCHED_OUT.total + ' cycles.</strong> While the slow load I1 crawls, ' +
          'the scheduler runs the teal and amber chains underneath it — the reorder buffer still retires ' +
          'everything in program order, so the program cannot tell. Same hardware, ' +
          (SCHED_IN.total / SCHED_OUT.total).toFixed(1) + '× faster, purely from permission to reorder.';
      } else {
        verdict.innerHTML = '<strong>' + SCHED_IN.total + ' cycles.</strong> In strict program order, ' +
          'I2 waits on the slow load — and every younger instruction waits behind I2, ready but forbidden. ' +
          'The dashed lines are silicon sitting idle for no physical reason.';
      }
    }

    var loop = makeLoop(function (t, dt) {
      sweep += (dt / 1000) * 4.5;
      if (sweep >= AXIS + 1) {
        sweep = AXIS + 1;
        finished = true;
        loop.stop();
        setVerdict();
      }
      draw();
    });

    function run() {
      loop.stop();
      finished = false;
      verdict.textContent = '';
      if (reduced()) {
        sweep = AXIS + 1;
        finished = true;
        draw();
        setVerdict();
        return;
      }
      sweep = 0;
      draw();
      loop.start();
    }

    function setMode(m) {
      mode = m;
      btnOut.setAttribute('aria-pressed', String(m === 'ooo'));
      btnIn.setAttribute('aria-pressed', String(m === 'inorder'));
      run();
    }

    btnOut.addEventListener('click', function () { setMode('ooo'); });
    btnIn.addEventListener('click', function () { setMode('inorder'); });
    btnReplay.addEventListener('click', run);

    setOuts();
    var seen = false;
    onScreen(canvas, function () {
      if (!seen) { seen = true; run(); }
    }, function () { loop.stop(); });
    draw();
  }

  /* ==========================================================================
     10 · Multi-core & SMT
     ========================================================================== */

  function initCores() {
    var canvas = $('#cx-cores-canvas');
    if (!canvas) { return; }
    var fit = setupCanvas(canvas, function () { draw(1); });
    var ctx = fit.ctx;
    var st = fit.state;
    var group = $('#cx-cores-count');
    var slider = $('#cx-cores-serial');
    var sliderOut = $('#cx-cores-serial-out');
    var btnSmt = $('#cx-cores-smt');
    var btnRun = $('#cx-cores-run');
    var outTime = $('#cx-cores-time');
    var outSpeed = $('#cx-cores-speedup');
    var outUtil = $('#cx-cores-util');
    var verdict = $('#cx-cores-verdict');

    var n = 8;
    var serial = 10;
    var smt = false;

    function model() {
      var W = 100;                       /* ms of single-core work */
      var s = serial;
      var boost = smt ? 1.25 : 1;
      var time = s + (W - s) / (n * boost);
      var speedup = W / time;
      var util = Math.min(1, speedup / n);
      return { time: time, speedup: speedup, util: util, fs: s / time };
    }

    function draw(p) {
      var m = model();
      var w = st.w, h = st.h;
      ctx.clearRect(0, 0, w, h);
      var left = 58;
      var top = 18;
      var bottom = 30;
      var lanes = n;
      var rh = (h - top - bottom) / lanes;
      var bw = w - left - 16;

      ctx.font = '11px Inter, sans-serif';
      ctx.textBaseline = 'middle';

      var i;
      for (i = 0; i < lanes; i++) {
        var y = top + i * rh;
        ctx.textAlign = 'right';
        ctx.fillStyle = C.muted;
        if (rh > 13 || i % 2 === 0) {
          ctx.fillText('core ' + i, left - 8, y + rh / 2);
        }
        /* track */
        ctx.fillStyle = 'rgba(39, 52, 73, 0.55)';
        roundRect(ctx, left, y + rh * 0.16, bw, rh * 0.68, 3);
        ctx.fill();

        var px = clamp(p, 0, 1);
        if (i === 0) {
          /* serial segment (amber) then parallel (teal) */
          var sw = Math.min(px, m.fs) / 1 * bw;
          if (sw > 0) {
            ctx.fillStyle = C.amber;
            roundRect(ctx, left, y + rh * 0.16, sw, rh * 0.68, 3);
            ctx.fill();
          }
          if (px > m.fs) {
            ctx.fillStyle = C.cTeal;
            roundRect(ctx, left + m.fs * bw, y + rh * 0.16, (px - m.fs) * bw, rh * 0.68, 3);
            ctx.fill();
          }
        } else if (px > m.fs) {
          ctx.fillStyle = C.cTeal;
          roundRect(ctx, left + m.fs * bw, y + rh * 0.16, (px - m.fs) * bw, rh * 0.68, 3);
          ctx.fill();
        }
        /* SMT: second hardware thread drawn as a thin stripe */
        if (smt && px > m.fs && rh > 10) {
          ctx.fillStyle = 'rgba(45, 212, 191, 0.45)';
          roundRect(ctx, left + m.fs * bw, y + rh * 0.7, (px - m.fs) * bw, rh * 0.14, 2);
          ctx.fill();
        }
      }

      ctx.textAlign = 'left';
      ctx.fillStyle = C.faint;
      ctx.fillText('amber = serial phase (one core, everyone else waits) · teal = parallel phase' +
        (smt ? ' · stripe = 2nd SMT thread' : ''), left, h - 12);
    }

    function setOuts(m) {
      outTime.textContent = m.time.toFixed(0) + ' ms';
      outSpeed.textContent = m.speedup.toFixed(1) + '×';
      outUtil.textContent = Math.round(m.util * 100) + '%';
    }

    function setVerdict(m) {
      var maxSp = 100 / serial;
      var html;
      if (serial === 0) {
        html = '<strong>Near-linear scaling.</strong> With no serial part, ' + n +
          ' cores give ~' + m.speedup.toFixed(1) + '×. Real programs are rarely this lucky — almost everything has a serial spine.';
      } else if (m.speedup < n * 0.55 && n >= 8) {
        html = '<strong>Amdahl bites.</strong> You paid for ' + n + '× the silicon and got ' +
          m.speedup.toFixed(1) + '×. The ' + serial + '% serial stretch has become the whole story — ' +
          'with this program, no core count can ever beat ' + maxSp.toFixed(0) + '×.';
      } else {
        html = '<strong>' + m.speedup.toFixed(1) + '× on ' + n + ' cores.</strong> Scaling holds while the ' +
          'parallel phase dominates; the amber serial stretch is the ceiling creeping closer (limit: ' +
          maxSp.toFixed(0) + '×).';
      }
      if (smt) {
        html += ' SMT filled stall bubbles for ~25% extra during the parallel phase — cheap, but no substitute for real cores.';
      }
      verdict.innerHTML = html;
    }

    var anim = { t: 0, dur: 1 };
    var loop = makeLoop(function (t, dt) {
      anim.t += dt / 1000;
      var p = anim.t / anim.dur;
      draw(p);
      if (p >= 1) {
        loop.stop();
        var m = model();
        setOuts(m);
        setVerdict(m);
      }
    });

    function run() {
      loop.stop();
      var m = model();
      if (reduced()) {
        draw(1);
        setOuts(m);
        setVerdict(m);
        return;
      }
      anim.t = 0;
      anim.dur = 1.1 + (m.time / 100) * 2.6;
      outTime.textContent = '…';
      outSpeed.textContent = '…';
      outUtil.textContent = '…';
      verdict.textContent = '';
      loop.start();
    }

    $$('.cx-mode-tab', group).forEach(function (b) {
      b.addEventListener('click', function () {
        n = parseInt(b.getAttribute('data-n'), 10);
        $$('.cx-mode-tab', group).forEach(function (o) {
          o.setAttribute('aria-pressed', String(o === b));
        });
        run();
      });
    });
    slider.addEventListener('input', function () {
      serial = parseInt(slider.value, 10);
      sliderOut.textContent = serial + '%';
    });
    slider.addEventListener('change', run);
    btnSmt.addEventListener('click', function () {
      smt = !smt;
      btnSmt.setAttribute('aria-pressed', String(smt));
      btnSmt.textContent = 'SMT: ' + (smt ? 'on' : 'off');
      run();
    });
    btnRun.addEventListener('click', run);

    var seen = false;
    onScreen(canvas, function () {
      if (!seen) { seen = true; run(); }
    }, function () { loop.stop(); });
    draw(0);
  }

  /* ==========================================================================
     11 · CPU vs GPU race
     ========================================================================== */

  function initRace() {
    var cpuCanvas = $('#cx-race-cpu');
    var gpuCanvas = $('#cx-race-gpu');
    if (!cpuCanvas || !gpuCanvas) { return; }
    var cpuFit = setupCanvas(cpuCanvas, function () { drawCpu(prog.cpu); });
    var gpuFit = setupCanvas(gpuCanvas, function () { drawGpu(prog.gpu); });
    var btnSerial = $('#cx-race-serialw');
    var btnPar = $('#cx-race-parw');
    var btnRun = $('#cx-race-run');
    var outs = {
      cd: $('#cx-race-cpu-done'), ct: $('#cx-race-cpu-time'),
      gd: $('#cx-race-gpu-done'), gt: $('#cx-race-gpu-time')
    };
    var verdict = $('#cx-race-verdict');

    /* model times in arbitrary "work-µs"; the ratios are the honest part */
    var WORK = {
      serial: { cpu: 200, gpu: 1600, ratio: '8×' },
      par: { cpu: 2048, gpu: 64, ratio: '32×' }
    };

    var kind = 'serial';
    var prog = { cpu: 0, gpu: 0 };

    function drawCpu(p) {
      var ctx = cpuFit.ctx, w = cpuFit.state.w, h = cpuFit.state.h;
      ctx.clearRect(0, 0, w, h);
      var lanes = 8;
      var top = 10, bottom = 24;
      var rh = (h - top - bottom) / lanes;
      var i;
      for (i = 0; i < lanes; i++) {
        var y = top + i * rh;
        var active = kind === 'par' || i === 0;
        ctx.fillStyle = 'rgba(39, 52, 73, 0.55)';
        roundRect(ctx, 12, y + rh * 0.18, w - 24, rh * 0.64, 3);
        ctx.fill();
        if (active && p > 0) {
          ctx.fillStyle = C.amber;
          roundRect(ctx, 12, y + rh * 0.18, (w - 24) * clamp(p, 0, 1), rh * 0.64, 3);
          ctx.fill();
        }
      }
      ctx.font = '10.5px Inter, sans-serif';
      ctx.fillStyle = C.faint;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(kind === 'serial'
        ? 'one dependent chain — 7 of 8 cores can only watch'
        : '8 cores, each grinding through its share of pixels', 12, h - 11);
    }

    function drawGpu(p) {
      var ctx = gpuFit.ctx, w = gpuFit.state.w, h = gpuFit.state.h;
      ctx.clearRect(0, 0, w, h);
      var cols = 64, rows = 32;
      var top = 8, bottom = 24;
      var cw = (w - 20) / cols;
      var ch = (h - top - bottom) / rows;
      var total = cols * rows;
      var lit = kind === 'par' ? Math.floor(total * clamp(p, 0, 1)) : 0;
      var i;
      ctx.fillStyle = 'rgba(39, 52, 73, 0.5)';
      ctx.fillRect(10, top, w - 20, rows * ch);
      if (kind === 'par') {
        ctx.fillStyle = C.cTeal;
        for (i = 0; i < lit; i++) {
          var x = (i % cols) * cw + 10;
          var y = Math.floor(i / cols) * ch + top;
          ctx.fillRect(x + 0.5, y + 0.5, Math.max(1, cw - 1), Math.max(1, ch - 1));
        }
      } else {
        /* single crawling worker on one lane */
        var steps = Math.floor(200 * clamp(p, 0, 1));
        ctx.fillStyle = C.cTeal;
        for (i = 0; i < steps; i++) {
          var xx = (i % cols) * cw + 10;
          var yy = Math.floor(i / cols) * ch + top;
          ctx.fillRect(xx + 0.5, yy + 0.5, Math.max(1, cw - 1), Math.max(1, ch - 1));
        }
      }
      ctx.font = '10.5px Inter, sans-serif';
      ctx.fillStyle = C.faint;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(kind === 'serial'
        ? '2,048 lanes — but a chain gives work to exactly one'
        : '2,048 lanes lighting up in waves', 10, h - 11);
    }

    var raceLoop = null;

    function setVerdict() {
      var wk = WORK[kind];
      if (kind === 'serial') {
        verdict.innerHTML = '<strong>CPU wins by ' + wk.ratio + '.</strong> A dependent chain cannot be ' +
          'split — step 2 needs step 1&rsquo;s answer. It is one worker&rsquo;s job, and the CPU&rsquo;s worker is much faster. ' +
          '2,047 GPU lanes sat idle the entire time.';
      } else {
        verdict.innerHTML = '<strong>GPU wins by ' + wk.ratio + '.</strong> 16,384 independent pixels is exactly ' +
          'what 2,048 slow lanes are built for — volume beats speed when nothing has to wait for anything. ' +
          'This is the GPU&rsquo;s home turf; it gets <a href="/gpu/">its own page</a>.';
      }
    }

    function run() {
      if (raceLoop) { raceLoop.stop(); }
      var wk = WORK[kind];
      var winner = Math.min(wk.cpu, wk.gpu);
      var scale = Math.min(2400 / winner, 7000 / Math.max(wk.cpu, wk.gpu));
      var durCpu = wk.cpu * scale;
      var durGpu = wk.gpu * scale;
      var t0 = 0;

      if (reduced()) {
        prog = { cpu: 1, gpu: 1 };
        drawCpu(1); drawGpu(1);
        outs.cd.textContent = '100';
        outs.gd.textContent = '100';
        outs.ct.textContent = fmtInt(wk.cpu);
        outs.gt.textContent = fmtInt(wk.gpu);
        setVerdict();
        return;
      }

      verdict.textContent = '';
      raceLoop = makeLoop(function (t, dt) {
        t0 += dt;
        prog.cpu = clamp(t0 / durCpu, 0, 1);
        prog.gpu = clamp(t0 / durGpu, 0, 1);
        drawCpu(prog.cpu);
        drawGpu(prog.gpu);
        outs.cd.textContent = String(Math.round(prog.cpu * 100));
        outs.gd.textContent = String(Math.round(prog.gpu * 100));
        outs.ct.textContent = fmtInt(prog.cpu * wk.cpu);
        outs.gt.textContent = fmtInt(prog.gpu * wk.gpu);
        if (prog.cpu >= 1 && prog.gpu >= 1) {
          raceLoop.stop();
          setVerdict();
        }
      });
      raceLoop.start();
    }

    function setKind(k) {
      kind = k;
      btnSerial.setAttribute('aria-pressed', String(k === 'serial'));
      btnPar.setAttribute('aria-pressed', String(k === 'par'));
      run();
    }

    btnSerial.addEventListener('click', function () { setKind('serial'); });
    btnPar.addEventListener('click', function () { setKind('par'); });
    btnRun.addEventListener('click', run);

    var seen = false;
    onScreen(cpuCanvas, function () {
      if (!seen) { seen = true; run(); }
    }, function () { if (raceLoop) { raceLoop.stop(); } });
    drawCpu(0);
    drawGpu(0);
  }

  /* ==========================================================================
     12 · Spec-sheet dashboard + GHz duel
     ========================================================================== */

  function initMetrics() {
    $$('#cpu-experience .cx-metric-toggle').forEach(function (btn) {
      var body = btn.nextElementSibling;
      btn.addEventListener('click', function () {
        var open = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!open));
        if (body) { body.hidden = open; }
      });
    });

    var reveal = $('#cx-duel-reveal');
    if (!reveal) { return; }
    var barA = $('#cx-duel-bar-a');
    var barB = $('#cx-duel-bar-b');
    var resA = $('#cx-duel-res-a');
    var resB = $('#cx-duel-res-b');
    var duelVerdict = $('#cx-duel-verdict');

    reveal.addEventListener('click', function () {
      var a = 4.8 * 1.6;   /* 7.7 G instructions/s per core */
      var b = 3.6 * 3.2;   /* 11.5 */
      var max = Math.max(a, b);
      requestAnimationFrame(function () {
        barA.style.width = Math.round(100 * a / max) + '%';
        barB.style.width = Math.round(100 * b / max) + '%';
      });
      resA.textContent = '4.8 × 1.6 = ' + a.toFixed(1) + ' billion instructions/s';
      resB.textContent = '3.6 × 3.2 = ' + b.toFixed(1) + ' billion instructions/s';
      duelVerdict.innerHTML = '<strong>Chip B wins by 50%</strong> — while advertising 1.2 fewer gigahertz. ' +
        'IPC is the quiet half of performance, and it never fits on the box.';
      reveal.disabled = true;
    });
  }

  /* ==========================================================================
     13 · Timeline scroller
     ========================================================================== */

  function initTimeline() {
    var track = $('#cx-tl-track');
    if (!track) { return; }
    var prev = $('#cx-tl-prev');
    var next = $('#cx-tl-next');

    function span() {
      var card = $('.cx-era', track);
      return card ? (card.getBoundingClientRect().width + 16) * 2 : 500;
    }

    prev.addEventListener('click', function () {
      track.scrollBy({ left: -span(), behavior: reduced() ? 'auto' : 'smooth' });
    });
    next.addEventListener('click', function () {
      track.scrollBy({ left: span(), behavior: reduced() ? 'auto' : 'smooth' });
    });
  }

  /* ==========================================================================
     14 · Playground — design your own CPU
     ========================================================================== */

  function initPlayground() {
    var canvas = $('#cx-pg-canvas');
    if (!canvas) { return; }
    var fit = setupCanvas(canvas, function () { draw(1); });
    var ctx = fit.ctx;
    var st = fit.state;

    var CACHES = [1, 2, 4, 8, 16, 32, 64];

    var els = {
      clock: $('#cx-pg-clock'), clockOut: $('#cx-pg-clock-out'),
      cores: $('#cx-pg-cores'), coresOut: $('#cx-pg-cores-out'),
      cache: $('#cx-pg-cache'), cacheOut: $('#cx-pg-cache-out'),
      depth: $('#cx-pg-depth'), depthOut: $('#cx-pg-depth-out'),
      acc: $('#cx-pg-acc'), accOut: $('#cx-pg-acc-out'),
      work: $('#cx-pg-work'), workOut: $('#cx-pg-work-out'),
      run: $('#cx-pg-run'),
      done: $('#cx-pg-done'), time: $('#cx-pg-time'), ipc: $('#cx-pg-ipc'),
      hit: $('#cx-pg-hit'), util: $('#cx-pg-util'),
      barBase: $('#cx-pg-bar-base'), barBranch: $('#cx-pg-bar-branch'), barMem: $('#cx-pg-bar-mem'),
      sBase: $('#cx-pg-sbase'), sBranch: $('#cx-pg-sbranch'), sMem: $('#cx-pg-smem'),
      verdict: $('#cx-pg-verdict')
    };

    function readInputs() {
      return {
        ghz: parseInt(els.clock.value, 10) / 10,
        cores: parseInt(els.cores.value, 10),
        cacheMB: CACHES[parseInt(els.cache.value, 10)],
        depth: parseInt(els.depth.value, 10),
        acc: parseInt(els.acc.value, 10) / 100,
        cx: parseInt(els.work.value, 10)
      };
    }

    function syncOuts() {
      var p = readInputs();
      els.clockOut.textContent = p.ghz.toFixed(1) + ' GHz';
      els.coresOut.textContent = String(p.cores);
      els.cacheOut.textContent = p.cacheMB + ' MB';
      els.depthOut.textContent = p.depth + ' stages';
      els.accOut.textContent = Math.round(p.acc * 100) + '%';
      els.workOut.textContent = p.cx + ' / 10';
    }

    function model() {
      var p = readInputs();
      var N = p.cx * 0.4e9;                          /* instructions */
      var branchFrac = 0.08 + 0.012 * p.cx;          /* 9%..20% of instructions branch */
      var wsMB = 2 + p.cx * p.cx * 0.9;              /* working set grows fast with complexity */
      var serialFrac = 0.05 + 0.04 * p.cx;           /* Amdahl's serial spine */
      var memFrac = 0.30;                            /* of instructions touch memory */

      var coverage = Math.min(1, p.cacheMB / wsMB);
      var missRate = 0.02 + 0.38 * Math.pow(1 - coverage, 1.5);
      var ramCycles = 90 * p.ghz;                    /* 90 ns costs more cycles at higher clocks */
      var brStall = branchFrac * (1 - p.acc) * p.depth;
      var memStall = memFrac * missRate * ramCycles * 0.35;  /* OoO + prefetch hide ~65% */
      var baseCPI = 1 / 3.2;                         /* 4-wide core, realistic sustained issue */
      var cpi = baseCPI + brStall + memStall;
      var ipc = Math.min(4, 1 / cpi);

      var scale = serialFrac + (1 - serialFrac) / p.cores;
      var time = (N * cpi / (p.ghz * 1e9)) * scale;
      var speedup = 1 / scale;
      var util = speedup / p.cores;

      return {
        p: p, N: N, cpi: cpi, ipc: ipc, time: time, util: util,
        hit: 1 - missRate, coverage: coverage, wsMB: wsMB, serialFrac: serialFrac,
        shares: { base: baseCPI / cpi, br: brStall / cpi, mem: memStall / cpi }
      };
    }

    var lanesSeed = [];
    function laneSeq(lane, m) {
      /* deterministic-ish pattern of block kinds per lane, sampled from shares */
      if (!lanesSeed[lane]) {
        lanesSeed[lane] = [];
        var x = lane * 7919 + 17;
        var i;
        for (i = 0; i < 160; i++) {
          x = (x * 48271) % 2147483647;
          lanesSeed[lane].push(x / 2147483647);
        }
      }
      return lanesSeed[lane].map(function (r) {
        if (r < m.shares.br) { return 'br'; }
        if (r < m.shares.br + m.shares.mem) { return 'mem'; }
        return 'ok';
      });
    }

    var lastM = null;

    function draw(pgs) {
      var m = lastM;
      var w = st.w, h = st.h;
      ctx.clearRect(0, 0, w, h);
      if (!m) {
        ctx.font = '13px Inter, sans-serif';
        ctx.fillStyle = C.faint;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Press “Run simulation” to light this up.', w / 2, h / 2);
        return;
      }
      var lanes = Math.min(8, m.p.cores);
      var top = 26, bottom = 26;
      var rh = (h - top - bottom) / lanes;
      var bw = w - 70;

      ctx.font = '11px Inter, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillStyle = C.faint;
      ctx.fillText(m.p.cores > 8
        ? 'showing 8 of ' + m.p.cores + ' cores — teal = useful work, amber = branch flush, violet = memory stall'
        : 'teal = useful work, amber = branch flush, violet = memory stall', 58, 13);

      var lane;
      for (lane = 0; lane < lanes; lane++) {
        var y = top + lane * rh;
        ctx.textAlign = 'right';
        ctx.fillStyle = C.muted;
        ctx.fillText('core ' + lane, 50, y + rh / 2);
        ctx.fillStyle = 'rgba(39, 52, 73, 0.5)';
        roundRect(ctx, 58, y + rh * 0.18, bw, rh * 0.64, 3);
        ctx.fill();

        var seq = laneSeq(lane, m);
        var visible = Math.floor(seq.length * clamp(pgs, 0, 1));
        var cw2 = bw / seq.length;
        var i;
        for (i = 0; i < visible; i++) {
          var kind = seq[i];
          ctx.fillStyle = kind === 'br' ? C.amber : (kind === 'mem' ? C.violet : C.cTeal);
          ctx.fillRect(58 + i * cw2, y + rh * 0.18 + 1, Math.max(1, cw2 - 0.6), rh * 0.64 - 2);
        }
      }
    }

    function setOuts(m, pgs) {
      els.done.textContent = fmtBig(m.N * clamp(pgs, 0, 1));
      els.time.textContent = fmtSeconds(m.time);
      els.ipc.textContent = m.ipc.toFixed(2);
      els.hit.textContent = Math.round(m.hit * 100) + '%';
      els.util.textContent = Math.round(m.util * 100) + '%';
      els.barBase.style.width = Math.round(m.shares.base * 100) + '%';
      els.barBranch.style.width = Math.round(m.shares.br * 100) + '%';
      els.barMem.style.width = Math.round(m.shares.mem * 100) + '%';
      els.sBase.textContent = Math.round(m.shares.base * 100) + '%';
      els.sBranch.textContent = Math.round(m.shares.br * 100) + '%';
      els.sMem.textContent = Math.round(m.shares.mem * 100) + '%';
    }

    function setVerdict(m) {
      var html;
      if (m.shares.mem > 0.45) {
        if (m.coverage < 1) {
          html = '<strong>Memory-bound.</strong> The working set (~' + Math.round(m.wsMB) +
            ' MB) spills out of your ' + m.p.cacheMB + ' MB cache, and at ' + m.p.ghz.toFixed(1) +
            ' GHz each RAM trip burns ' + Math.round(90 * m.p.ghz) + ' cycles. More cache or a smaller ' +
            'working set helps; more GHz mostly buys faster waiting.';
        } else {
          html = '<strong>Memory-bound anyway.</strong> Even with the working set cached, the residual ' +
            'misses dominate — welcome to real-world databases. Latency, not compute, is the wall.';
        }
      } else if (m.shares.br > 0.30) {
        html = '<strong>A flush factory.</strong> ' + m.p.depth + ' stages × ' +
          Math.round((1 - m.p.acc) * 100) + '% mispredicts means the pipe spends its life refilling. ' +
          'This is the Pentium 4 lesson: depth amplifies every wrong guess. Shorten the pipe or fix the predictor.';
      } else if (m.util < 0.5 && m.p.cores > 4) {
        html = '<strong>Cores going to waste.</strong> IPC is healthy, but the ' +
          Math.round(m.serialFrac * 100) + '% serial fraction caps this workload at ' +
          (1 / m.serialFrac).toFixed(0) + '× — your ' + m.p.cores + ' cores average ' +
          Math.round(m.util * 100) + '% busy. Amdahl always collects.';
      } else {
        html = '<strong>Nicely balanced.</strong> ' + m.ipc.toFixed(2) + ' IPC × ' +
          m.p.ghz.toFixed(1) + ' GHz × ' + m.p.cores + ' cores, with no single bottleneck dominating. ' +
          'This is the shape architects aim for — every unit earning its transistors.';
      }
      els.verdict.innerHTML = html;
    }

    var anim = { t: 0, dur: 4.2 };
    var loop = makeLoop(function (t, dt) {
      anim.t += dt / 1000;
      var pgs = anim.t / anim.dur;
      draw(pgs);
      setOuts(lastM, pgs);
      if (pgs >= 1) {
        loop.stop();
        setOuts(lastM, 1);
        setVerdict(lastM);
      }
    });

    function run() {
      loop.stop();
      lastM = model();
      lanesSeed = [];
      if (reduced()) {
        draw(1);
        setOuts(lastM, 1);
        setVerdict(lastM);
        return;
      }
      els.verdict.textContent = 'Running…';
      anim.t = 0;
      loop.start();
    }

    ['clock', 'cores', 'cache', 'depth', 'acc', 'work'].forEach(function (k) {
      els[k].addEventListener('input', syncOuts);
    });
    els.run.addEventListener('click', run);

    syncOuts();
    var seen = false;
    onScreen(canvas, function () {
      if (!seen) { seen = true; run(); }
    }, function () { loop.stop(); });
    draw(0);
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
      initReveal, initRail, initHero, initFlow, initAnatomy, initCycle,
      initXlate, initRegisters, initMemory, initPipeline, initBranch,
      initOoo, initCores, initRace, initMetrics, initTimeline, initPlayground
    ];
    var failed = [];

    function tryInit(fn) {
      try { fn(); } catch (err) {
        failed.push(fn);
        if (window.console && console.error) { console.error('cpu.js: ' + (fn.name || 'init') + ' failed', err); }
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
