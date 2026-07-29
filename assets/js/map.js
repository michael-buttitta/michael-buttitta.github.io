/* ============================================================================
   map.js — the interactive Technology Map (/map/).

   Renders the knowledge graph defined in knowledge-graph.js as a pannable,
   zoomable SVG: hover/focus a topic to light up its relationships, hover a
   connection to read how two ideas relate, click a topic for details and a
   link into its exhibit. Also enhances the learning-path cards with the
   visitor's progress (localStorage) and offers a "continue" card.

   Vanilla JS, no dependencies. Every init is wrapped in try/catch so a
   failure degrades to the static "All topics" index below the map.
   ========================================================================== */
(function () {
  'use strict';

  if (typeof document === 'undefined') return;

  var G = window.TECH_GRAPH;
  var root = document.getElementById('map-experience');
  if (!G || !root) return;

  var VB_W = 1240;
  var VB_H = 820;
  var R = 46;          // live-topic node radius
  var R_PLANNED = 34;  // planned-topic node radius
  var SVG_NS = 'http://www.w3.org/2000/svg';

  var stage = document.getElementById('tm-stage');
  var tooltip = document.getElementById('tm-tooltip');
  var panel = document.getElementById('tm-panel');
  var panelBody = document.getElementById('tm-panel-body');

  function el(name, attrs, parent) {
    var node = document.createElementNS(SVG_NS, name);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        node.setAttribute(k, attrs[k]);
      });
    }
    if (parent) parent.appendChild(node);
    return node;
  }

  function catColor(t) {
    var cat = G.categories[t.cat];
    return cat ? cat.color : '#2DD4BF';
  }

  function radiusOf(t) {
    if (t.capstone) { return R + 12; }
    return t.url ? R : R_PLANNED;
  }

  /* flat-topped hexagon path for capstone nodes (distinct from topic circles) */
  function hexPoints(r) {
    var pts = [];
    for (var i = 0; i < 6; i++) {
      var a = Math.PI / 180 * (60 * i - 90);
      pts.push((Math.cos(a) * r).toFixed(1) + ',' + (Math.sin(a) * r).toFixed(1));
    }
    return pts.join(' ');
  }

  function stateText(id) {
    var s = G.progress.stateOf(id);
    if (s === 2) return '✓ explored';
    if (s === 1) return 'in progress';
    return '';
  }

  /* ======================================================================
     Build the SVG
  ====================================================================== */
  var svg, gRoot, nodeEls = {}, edgeEls = [];

  function buildSvg() {
    svg = el('svg', {
      viewBox: '0 0 ' + VB_W + ' ' + VB_H,
      preserveAspectRatio: 'xMidYMid meet',
      role: 'group',
      'aria-label': 'Interactive map of ' + G.topics.length + ' computing topics. ' +
        'Use Tab to move between topics, Enter to open details.'
    });
    gRoot = el('g', null, svg);

    var gEdges = el('g', null, gRoot);
    var gNodes = el('g', null, gRoot);

    /* ----- edges ----- */
    G.edges.forEach(function (e) {
      var a = G.byId[e.a], b = G.byId[e.b];
      if (!a || !b) return;
      var g = el('g', { 'class': 'tm-edge-g' }, gEdges);
      g.dataset.a = e.a;
      g.dataset.b = e.b;
      el('line', {
        'class': 'tm-edge' + (e.planned ? ' is-planned' : ''),
        x1: a.x, y1: a.y, x2: b.x, y2: b.y
      }, g);
      var hit = el('line', {
        'class': 'tm-edge-hit',
        x1: a.x, y1: a.y, x2: b.x, y2: b.y
      }, g);

      hit.addEventListener('mouseenter', function (ev) {
        g.classList.add('is-hover');
        markLinked([e.a, e.b], []);
        showTooltip(ev,
          '<div class="tm-tooltip-title">' + a.short + ' ↔ ' + b.short + '</div>' +
          '<div class="tm-tooltip-sub">' + e.label + '</div>');
      });
      hit.addEventListener('mousemove', moveTooltip);
      hit.addEventListener('mouseleave', function () {
        g.classList.remove('is-hover');
        clearFocus();
        hideTooltip();
      });

      edgeEls.push({ e: e, g: g });
    });

    /* ----- nodes ----- */
    G.topics.forEach(function (t) {
      var r = radiusOf(t);
      var g = el('g', {
        'class': 'tm-node' + (t.url ? '' : ' tm-node-planned') +
                 (t.brand ? ' tm-node-brand' : '') +
                 (t.capstone ? ' tm-node-capstone' : ''),
        transform: 'translate(' + t.x + ',' + t.y + ')',
        tabindex: '0',
        role: 'button',
        'aria-label': t.name + (t.capstone ? ' — capstone experience' : '') +
          (t.url ? '' : ' — coming soon') +
          (stateText(t.id) ? ', ' + stateText(t.id) : '') + '. Opens details.'
      }, gNodes);
      g.style.setProperty('--cat', catColor(t));
      g.dataset.id = t.id;

      var float = el('g', { 'class': 'tm-node-float' }, g);
      if (t.capstone) {
        el('polygon', { 'class': 'tm-node-bg', points: hexPoints(r) }, float);
      } else {
        el('circle', { 'class': 'tm-node-bg', r: r }, float);
      }

      var state = G.progress.stateOf(t.id);
      if (t.url && state > 0) {
        el('circle', {
          'class': 'tm-node-ring',
          r: r + 7,
          pathLength: '100',
          'stroke-dasharray': (state === 2 ? '100' : '35') + ' 100'
        }, float);
      }

      el('text', {
        'class': 'tm-node-glyph',
        y: t.url ? -4 : -2,
        'font-size': t.url ? 26 : 19
      }, float).textContent = t.fa;

      el('text', {
        'class': 'tm-node-label',
        y: r + 22,
        'font-size': t.url ? 15 : 13
      }, float).textContent = t.short;

      if (!t.url) {
        el('text', { 'class': 'tm-node-soon', y: r + 38 }, float)
          .textContent = 'COMING SOON';
      }

      g.addEventListener('mouseenter', function (ev) {
        focusNode(t.id);
        var extra = t.url
          ? (stateText(t.id) ? '<span class="tm-tooltip-state">' + stateText(t.id) + '</span>' : '')
          : '<span class="tm-tooltip-state">on the roadmap</span>';
        showTooltip(ev,
          '<div class="tm-tooltip-title">' + t.name + '</div>' +
          '<div class="tm-tooltip-sub">' + t.tagline + '</div>' + extra);
      });
      g.addEventListener('mousemove', moveTooltip);
      g.addEventListener('mouseleave', function () {
        clearFocus();
        hideTooltip();
      });
      g.addEventListener('focus', function () { focusNode(t.id); });
      g.addEventListener('blur', function () { clearFocus(); });
      g.addEventListener('click', function (ev) {
        if (suppressClick) return;
        ev.stopPropagation();
        openPanel(t.id);
      });
      g.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          openPanel(t.id);
        }
      });

      nodeEls[t.id] = g;
    });

    stage.insertBefore(svg, tooltip);
  }

  /* ======================================================================
     Focus highlighting
  ====================================================================== */
  function markLinked(activeIds, linkedIds) {
    svg.classList.add('is-focused');
    Object.keys(nodeEls).forEach(function (id) {
      nodeEls[id].classList.toggle('is-active', activeIds.indexOf(id) !== -1);
      nodeEls[id].classList.toggle('is-linked', linkedIds.indexOf(id) !== -1);
    });
    edgeEls.forEach(function (rec) {
      var touches =
        (activeIds.indexOf(rec.e.a) !== -1 && activeIds.indexOf(rec.e.b) !== -1) ||
        (activeIds.length === 1 &&
          (rec.e.a === activeIds[0] || rec.e.b === activeIds[0]));
      rec.g.classList.toggle('is-linked', touches);
    });
  }

  function focusNode(id) {
    var linked = G.neighborsOf(id).map(function (n) { return n.id; });
    markLinked([id], linked);
  }

  function clearFocus() {
    svg.classList.remove('is-focused');
    Object.keys(nodeEls).forEach(function (id) {
      nodeEls[id].classList.remove('is-active', 'is-linked');
    });
    edgeEls.forEach(function (rec) { rec.g.classList.remove('is-linked'); });
  }

  /* ======================================================================
     Tooltip
  ====================================================================== */
  function showTooltip(ev, html) {
    tooltip.innerHTML = html;
    tooltip.hidden = false;
    moveTooltip(ev);
  }

  function moveTooltip(ev) {
    if (tooltip.hidden) return;
    var rect = stage.getBoundingClientRect();
    var x = ev.clientX - rect.left + 16;
    var y = ev.clientY - rect.top + 14;
    var maxX = rect.width - tooltip.offsetWidth - 10;
    var maxY = rect.height - tooltip.offsetHeight - 10;
    tooltip.style.left = Math.min(x, maxX) + 'px';
    tooltip.style.top = Math.min(y, maxY) + 'px';
  }

  function hideTooltip() { tooltip.hidden = true; }

  /* ======================================================================
     Detail panel
  ====================================================================== */
  function pill(t) {
    if (t.url) {
      return '<li><a href="' + t.url + '">' + t.short + '</a></li>';
    }
    return '<li><span class="tm-pill-planned">' + t.short + ' · soon</span></li>';
  }

  function openPanel(id) {
    var t = G.byId[id];
    if (!t) return;
    focusNode(id);
    hideTooltip();

    var html = '';
    html += '<span class="tm-panel-cat" style="--cat:' + catColor(t) + '">' +
      (G.categories[t.cat] ? G.categories[t.cat].name : '') + '</span>';
    html += '<h3>' + t.name + '</h3>';
    html += '<p>' + (t.blurb || t.tagline) + '</p>';

    var prereqs = G.prereqsOf(id).map(function (pid) { return G.byId[pid]; }).filter(Boolean);
    if (prereqs.length) {
      html += '<h4 class="tm-panel-h4">Learn first</h4><ul class="tm-panel-links">' +
        prereqs.map(pill).join('') + '</ul>';
    }

    var unlocks = G.unlocksOf(id).map(function (uid) { return G.byId[uid]; }).filter(Boolean);
    if (unlocks.length) {
      html += '<h4 class="tm-panel-h4">Ready afterwards</h4><ul class="tm-panel-links">' +
        unlocks.map(pill).join('') + '</ul>';
    }

    var conns = G.neighborsOf(id);
    if (conns.length) {
      html += '<h4 class="tm-panel-h4">How it connects</h4><ul class="tm-panel-connections">';
      conns.forEach(function (c) {
        var ct = G.byId[c.id];
        if (!ct) return;
        var name = ct.url
          ? '<a href="' + ct.url + '">' + ct.short + '</a>'
          : '<span class="tm-conn-planned">' + ct.short + '</span>';
        html += '<li>' + name + ' — ' + c.label + '</li>';
      });
      html += '</ul>';
    }

    if (t.url) {
      var st = stateText(id);
      html += '<a class="tm-panel-cta" href="' + t.url + '">' +
        (G.progress.stateOf(id) === 2 ? 'Revisit' : 'Explore') + ' ' + t.short +
        ' →</a>';
      if (st) html += ' <span class="tm-panel-cat" style="--cat:#2DD4BF">' + st + '</span>';
    } else {
      html += '<span class="tm-panel-soon">Coming soon to the map</span>';
    }

    panelBody.innerHTML = html;
    panel.hidden = false;
  }

  function closePanel() {
    panel.hidden = true;
    clearFocus();
  }

  /* ======================================================================
     Pan & zoom (pointer events: drag, wheel, pinch)
  ====================================================================== */
  var view = { x: 0, y: 0, k: 1 };
  var pointers = new Map();
  var suppressClick = false;
  var dragDist = 0;

  function applyView() {
    gRoot.setAttribute('transform',
      'translate(' + view.x + ' ' + view.y + ') scale(' + view.k + ')');
  }

  /* px-per-viewBox-unit for the current layout (preserveAspectRatio=meet) */
  function pxScale() {
    var rect = svg.getBoundingClientRect();
    return {
      rect: rect,
      s: Math.min(rect.width / VB_W, rect.height / VB_H)
    };
  }

  function clientToVb(clientX, clientY) {
    var m = pxScale();
    var ox = (m.rect.width - VB_W * m.s) / 2;
    var oy = (m.rect.height - VB_H * m.s) / 2;
    return {
      x: (clientX - m.rect.left - ox) / m.s,
      y: (clientY - m.rect.top - oy) / m.s
    };
  }

  function zoomAt(vbX, vbY, newK) {
    newK = Math.max(0.4, Math.min(3.2, newK));
    var w = { x: (vbX - view.x) / view.k, y: (vbY - view.y) / view.k };
    view.x = vbX - newK * w.x;
    view.y = vbY - newK * w.y;
    view.k = newK;
    applyView();
  }

  function initPanZoom() {
    stage.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      var p = clientToVb(ev.clientX, ev.clientY);
      zoomAt(p.x, p.y, view.k * Math.exp(-ev.deltaY * 0.0016));
    }, { passive: false });

    stage.addEventListener('pointerdown', function (ev) {
      /* don't capture gestures that start on a node or the panel — pointer
         capture would retarget the resulting click and break them */
      if (ev.target.closest('.tm-node') || ev.target.closest('.tm-panel')) return;
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      dragDist = 0;
      stage.setPointerCapture(ev.pointerId);
      stage.classList.add('is-panning');
    });

    stage.addEventListener('pointermove', function (ev) {
      var prev = pointers.get(ev.pointerId);
      if (!prev) return;
      var cur = { x: ev.clientX, y: ev.clientY };

      if (pointers.size === 1) {
        var m = pxScale();
        view.x += (cur.x - prev.x) / m.s;
        view.y += (cur.y - prev.y) / m.s;
        dragDist += Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y);
        applyView();
      } else if (pointers.size === 2) {
        var ids = Array.from(pointers.keys());
        var otherId = ids[0] === ev.pointerId ? ids[1] : ids[0];
        var other = pointers.get(otherId);
        var dPrev = Math.hypot(prev.x - other.x, prev.y - other.y);
        var dCur = Math.hypot(cur.x - other.x, cur.y - other.y);
        if (dPrev > 0) {
          var mid = clientToVb((cur.x + other.x) / 2, (cur.y + other.y) / 2);
          zoomAt(mid.x, mid.y, view.k * (dCur / dPrev));
        }
        dragDist += 10;
      }
      pointers.set(ev.pointerId, cur);
    });

    function endPointer(ev) {
      pointers.delete(ev.pointerId);
      if (pointers.size === 0) stage.classList.remove('is-panning');
      /* a real drag should not count as a click on a node */
      suppressClick = dragDist > 6;
      if (suppressClick) {
        setTimeout(function () { suppressClick = false; }, 0);
      }
    }
    stage.addEventListener('pointerup', endPointer);
    stage.addEventListener('pointercancel', endPointer);

    /* clicking empty space closes the panel (listener on the stage because
       pointer capture can retarget clicks there) */
    stage.addEventListener('click', function (ev) {
      if (suppressClick) return;
      if (!ev.target.closest('.tm-node') && !ev.target.closest('.tm-panel')) {
        closePanel();
      }
    });

    document.getElementById('tm-zoom-in').addEventListener('click', function () {
      zoomAt(VB_W / 2, VB_H / 2, view.k * 1.3);
    });
    document.getElementById('tm-zoom-out').addEventListener('click', function () {
      zoomAt(VB_W / 2, VB_H / 2, view.k / 1.3);
    });
    document.getElementById('tm-zoom-reset').addEventListener('click', function () {
      view = { x: 0, y: 0, k: 1 };
      applyView();
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && !panel.hidden) closePanel();
    });
    document.getElementById('tm-panel-close').addEventListener('click', closePanel);
  }

  /* ======================================================================
     Search & category filters
  ====================================================================== */
  var activeCat = null;

  function setNarrowed(matchIds) {
    if (!matchIds) {
      svg.classList.remove('is-narrowed');
      Object.keys(nodeEls).forEach(function (id) {
        nodeEls[id].classList.remove('is-match');
      });
      return;
    }
    svg.classList.add('is-narrowed');
    Object.keys(nodeEls).forEach(function (id) {
      nodeEls[id].classList.toggle('is-match', matchIds.indexOf(id) !== -1);
    });
  }

  function initSearch() {
    var input = document.getElementById('tm-search');
    var count = document.getElementById('tm-search-count');

    input.addEventListener('input', function () {
      var q = input.value.trim().toLowerCase();
      if (!q) {
        setNarrowed(null);
        count.textContent = '';
        return;
      }
      clearCatChips();
      var matches = G.topics.filter(function (t) {
        return (t.name + ' ' + t.short + ' ' + t.tagline).toLowerCase().indexOf(q) !== -1;
      }).map(function (t) { return t.id; });
      setNarrowed(matches);
      count.textContent = matches.length + ' / ' + G.topics.length;
    });

    input.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter') return;
      var q = input.value.trim().toLowerCase();
      if (!q) return;
      var first = G.topics.filter(function (t) {
        return (t.name + ' ' + t.short + ' ' + t.tagline).toLowerCase().indexOf(q) !== -1;
      })[0];
      if (first) openPanel(first.id);
    });
  }

  var chipEls = [];

  function clearCatChips() {
    activeCat = null;
    chipEls.forEach(function (c) {
      c.el.classList.toggle('is-on', c.cat === null);
    });
  }

  function initFilters() {
    var wrap = document.getElementById('tm-filters');
    var cats = [{ key: null, name: 'All', color: '#2DD4BF' }];
    Object.keys(G.categories).forEach(function (key) {
      cats.push({ key: key, name: G.categories[key].name, color: G.categories[key].color });
    });

    cats.forEach(function (c) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tm-chip' + (c.key === null ? ' is-on' : '');
      btn.style.setProperty('--cat', c.color);
      btn.setAttribute('aria-pressed', c.key === null ? 'true' : 'false');
      btn.innerHTML = '<span class="tm-chip-dot" aria-hidden="true"></span>' + c.name;
      btn.addEventListener('click', function () {
        var input = document.getElementById('tm-search');
        input.value = '';
        document.getElementById('tm-search-count').textContent = '';
        activeCat = c.key;
        chipEls.forEach(function (rec) {
          var on = rec.cat === c.key;
          rec.el.classList.toggle('is-on', on);
          rec.el.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        if (c.key === null) {
          setNarrowed(null);
        } else {
          setNarrowed(G.topics.filter(function (t) { return t.cat === c.key; })
            .map(function (t) { return t.id; }));
        }
      });
      wrap.appendChild(btn);
      chipEls.push({ cat: c.key, el: btn });
    });
  }

  /* ======================================================================
     Learning paths & continue card
  ====================================================================== */
  function initPaths() {
    var cards = root.querySelectorAll('.tm-path');
    Array.prototype.forEach.call(cards, function (card) {
      var explored = 0, total = 0, nextFound = false;
      var items = card.querySelectorAll('li');
      Array.prototype.forEach.call(items, function (li) {
        var a = li.querySelector('a[data-topic]');
        if (!a) return;
        total++;
        var s = G.progress.stateOf(a.dataset.topic);
        if (s === 2) { li.classList.add('is-explored'); explored++; }
        else if (s === 1) { li.classList.add('is-started'); }
        if (s !== 2 && !nextFound) {
          li.classList.add('is-next-up');
          nextFound = true;
        }
      });
      var slot = card.querySelector('[data-progress]');
      if (slot && total) {
        slot.textContent = explored + ' / ' + total + ' explored';
      }
    });
  }

  function initContinue() {
    var wrap = document.getElementById('tm-continue');
    if (!wrap) return;
    var lastId = G.progress.last();
    var t = lastId && G.byId[lastId] && G.byId[lastId].url ? G.byId[lastId] : null;
    var kicker, target;
    if (t && G.progress.stateOf(t.id) !== 2) {
      kicker = 'Continue where you left off';
      target = t;
    } else if (t) {
      /* last page fully explored — suggest what it unlocks */
      var next = G.unlocksOf(t.id).map(function (id) { return G.byId[id]; })
        .filter(function (u) { return u && G.progress.stateOf(u.id) !== 2; })[0];
      if (next) { kicker = 'You finished ' + t.short + ' — up next'; target = next; }
    }
    if (!target) {
      var started = G.topics.some(function (tt) { return G.progress.stateOf(tt.id) > 0; });
      if (started) return; /* nothing sensible to suggest */
      kicker = 'New here? Start at the beginning';
      target = G.byId.cpu;
    }
    wrap.innerHTML =
      '<a class="tm-continue-card" href="' + target.url + '">' +
      '<span class="tm-continue-icon"><i class="fas fa-location-arrow" aria-hidden="true"></i></span>' +
      '<span><span class="tm-continue-kicker">' + kicker + '</span>' +
      '<span class="tm-continue-name">' + target.name + '</span></span>' +
      '<span class="tm-continue-arrow" aria-hidden="true">→</span></a>';
    wrap.hidden = false;
  }

  /* ======================================================================
     Boot
  ====================================================================== */
  try { buildSvg(); } catch (e) { return; }
  try { initPanZoom(); } catch (e) { /* map still visible statically */ }
  try { initSearch(); } catch (e) { /* non-fatal */ }
  try { initFilters(); } catch (e) { /* non-fatal */ }
  try { initPaths(); } catch (e) { /* non-fatal */ }
  try { initContinue(); } catch (e) { /* non-fatal */ }
})();
