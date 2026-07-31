/* ============================================================================
   knowledge-nav.js — cross-page knowledge navigation for the exhibit pages.

   Loaded (after knowledge-graph.js) by every interactive exhibit. It:
     1. Works out which topic the current page is (by URL).
     2. Records progress: "started" on load, "explored" once the visitor has
        scrolled through most of the page (localStorage only).
     3. Injects a "Where this fits" section at the end of the exhibit:
        a Learn-first / You-are-here / Go-next dependency diagram, connection
        cards explaining *why* related topics relate, learning-path steppers
        with live progress, and a link to the full Technology Map at /map/.

   Vanilla JS; everything is wrapped so a failure leaves the page untouched.
   ========================================================================== */
(function () {
  'use strict';

  if (typeof document === 'undefined') return;

  var G = window.TECH_GRAPH;
  if (!G) return;

  /* ----- which topic is this page? -------------------------------------- */
  var path = location.pathname.replace(/\/+$/, '') + '/';
  var topic = null;
  G.topics.forEach(function (t) {
    if (t.url && path.endsWith(t.url)) topic = t;
  });
  if (!topic) return;

  /* ----- progress tracking ---------------------------------------------- */
  try {
    G.progress.markStarted(topic.id);

    var explored = G.progress.stateOf(topic.id) === 2;
    if (!explored) {
      var onScroll = function () {
        var doc = document.documentElement;
        var max = doc.scrollHeight - window.innerHeight;
        if (max <= 0) return;
        if ((window.scrollY || doc.scrollTop) / max > 0.6) {
          G.progress.markExplored(topic.id);
          window.removeEventListener('scroll', onScroll);
        }
      };
      window.addEventListener('scroll', onScroll, { passive: true });
    }
  } catch (e) { /* storage unavailable — the section below still renders */ }

  /* ----- build the section ---------------------------------------------- */
  function pillHtml(t) {
    var check = G.progress.stateOf(t.id) === 2
      ? '<span class="kn-pill-check" aria-hidden="true">✓</span>' : '';
    return '<a class="kn-pill" href="' + t.url + '">' + check + t.short + '</a>';
  }

  function build() {
    /* Append to <main>, NOT to #<slug>-experience.

       This section is injected markup styled by knowledge-nav.css with class
       selectors, e.g. `.kn-root .kn-title` (specificity 0,2,0). Every exhibit
       stylesheet scopes its own rules under `#<slug>-experience`, and a rule
       like `#gpu-experience h2` (1,0,1) beats any number of classes — so while
       this section lived *inside* that id, the host page silently restyled it.
       Measured on /gpu/: .kn-title rendered at 30.4px with a 16px bottom margin
       (gpu.css's h2) instead of the intended clamp(1.3rem,3vw,1.7rem)/8px.
       12 of the 13 exhibits carry at least one such bare-tag rule.

       Appending to <main> puts the section immediately after the experience div
       — same visual position, outside the id's reach. `.kn-root` already sets
       `margin: 4rem auto`, so it centres itself in the wider column. Do not
       move this back inside the experience div. */
    var host = document.querySelector('main');
    if (!host) return;

    var prereqs = G.prereqsOf(topic.id).map(function (id) { return G.byId[id]; })
      .filter(function (t) { return t && t.url; });
    var unlocks = G.unlocksOf(topic.id).map(function (id) { return G.byId[id]; })
      .filter(function (t) { return t && t.url; });
    var conns = G.neighborsOf(topic.id);

    var sec = document.createElement('section');
    sec.className = 'kn-root';
    sec.setAttribute('aria-label', 'Where this topic fits on the Technology Map');

    var html = '';
    html += '<p class="kn-kicker">The Technology Map</p>';
    html += '<h2 class="kn-title">Where this fits</h2>';
    html += '<p class="kn-sub">Every exhibit on this site is part of one ' +
      'connected map of computing. Here is how ' + topic.short + ' relates ' +
      'to the rest.</p>';

    /* dependency diagram */
    html += '<div class="kn-dep">';
    html += '<svg class="kn-dep-svg" aria-hidden="true"></svg>';
    html += '<div class="kn-col kn-col-before"><span class="kn-col-label">Learn first</span>';
    html += prereqs.length
      ? prereqs.map(pillHtml).join('')
      : '<span class="kn-pill-note">No prerequisites — this is a starting point</span>';
    html += '</div>';
    html += '<div class="kn-current"><span class="kn-current-label">You are here</span>' +
      '<span class="kn-current-name">' + topic.short + '</span></div>';
    html += '<div class="kn-col kn-col-after"><span class="kn-col-label">Go next</span>';
    html += unlocks.length
      ? unlocks.map(pillHtml).join('')
      : '<span class="kn-pill-note">A frontier — pick anything on the map</span>';
    html += '</div>';
    html += '</div>';

    /* connection cards */
    if (conns.length) {
      html += '<h3 class="kn-h3">How ' + topic.short + ' connects</h3>';
      html += '<div class="kn-conns">';
      conns.forEach(function (c) {
        var t = G.byId[c.id];
        if (!t) return;
        if (t.url) {
          html += '<a class="kn-conn" href="' + t.url + '">' +
            '<span class="kn-conn-name">' + t.short + '</span>' + c.label + '</a>';
        } else {
          html += '<span class="kn-conn kn-conn-planned">' +
            '<span class="kn-conn-name">' + t.short + ' · coming soon</span>' +
            c.label + '</span>';
        }
      });
      html += '</div>';
    }

    /* learning-path steppers (only paths that contain this topic) */
    var inPaths = G.paths.filter(function (p) {
      return p.steps.indexOf(topic.id) !== -1;
    });
    if (inPaths.length) {
      html += '<div class="kn-paths">';
      inPaths.forEach(function (p) {
        var prog = G.progress.pathProgress(p.id);
        html += '<div class="kn-path"><span class="kn-path-name">' + p.name +
          '<span class="kn-path-count">' + prog.done + ' / ' + prog.total +
          ' explored</span></span>';
        html += '<ol class="kn-path-steps">';
        p.steps.forEach(function (id) {
          var t = G.byId[id];
          if (!t) return;
          var cls = [];
          if (G.progress.stateOf(id) === 2) cls.push('is-explored');
          if (id === topic.id) cls.push('is-current');
          html += '<li class="' + cls.join(' ') + '">' +
            '<a href="' + t.url + '"' +
            (id === topic.id ? ' aria-current="page"' : '') + '>' +
            '<span class="kn-path-dot" aria-hidden="true"></span>' +
            t.short + '</a></li>';
        });
        html += '</ol></div>';
      });
      html += '</div>';
    }

    html += '<div class="kn-cta-row"><a class="kn-map-cta" href="/map/">' +
      'Open the full Technology Map →</a></div>';

    sec.innerHTML = html;
    host.appendChild(sec);

    drawConnectors(sec);
    var redraw = debounce(function () { drawConnectors(sec); }, 150);
    window.addEventListener('resize', redraw);
  }

  /* curved connector lines behind the dependency columns */
  function drawConnectors(sec) {
    var svg = sec.querySelector('.kn-dep-svg');
    var dep = sec.querySelector('.kn-dep');
    var current = sec.querySelector('.kn-current');
    if (!svg || !dep || !current) return;
    if (getComputedStyle(svg).display === 'none') return;

    var depRect = dep.getBoundingClientRect();
    svg.setAttribute('viewBox', '0 0 ' + depRect.width + ' ' + depRect.height);

    var curRect = current.getBoundingClientRect();
    var curL = { x: curRect.left - depRect.left, y: curRect.top - depRect.top + curRect.height / 2 };
    var curR = { x: curRect.right - depRect.left, y: curL.y };

    var parts = [];
    function curve(x1, y1, x2, y2) {
      var mx = (x1 + x2) / 2;
      parts.push('M' + x1 + ' ' + y1 + ' C' + mx + ' ' + y1 + ' ' + mx + ' ' + y2 +
        ' ' + x2 + ' ' + y2);
    }

    sec.querySelectorAll('.kn-col-before .kn-pill').forEach(function (pill) {
      var r = pill.getBoundingClientRect();
      curve(r.right - depRect.left, r.top - depRect.top + r.height / 2, curL.x, curL.y);
    });
    sec.querySelectorAll('.kn-col-after .kn-pill').forEach(function (pill) {
      var r = pill.getBoundingClientRect();
      curve(curR.x, curR.y, r.left - depRect.left, r.top - depRect.top + r.height / 2);
    });

    svg.innerHTML = parts.length
      ? '<path d="' + parts.join(' ') + '"></path>'
      : '';
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  try { build(); } catch (e) { /* leave the page untouched */ }
})();
