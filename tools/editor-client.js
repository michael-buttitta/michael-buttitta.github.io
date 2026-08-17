/* tools/editor-client.js — injected into every page served by tools/edit.js.

   Kept as its own file rather than a template string inside edit.js so it is
   readable and debuggable in devtools.

   Two modes, set by window.__EDIT__.mode:
     rich — every [data-edit] element becomes contenteditable. Only elements
            you actually type into are sent on save, so untouched prose is
            never rewritten and its entities and line wrapping survive.
     raw  — a slide-in textarea holding the file's source. Used for Markdown
            pages and _layouts/home.html, where rendered HTML cannot be
            written back safely (Liquid sits mid-sentence there).

   After a successful save the page reloads. That is not cosmetic: an edit
   changes the file's length, so every other element's byte offsets shift and
   must be re-read from the server before the next save. */
(function () {
  'use strict';

  var CFG = window.__EDIT__;
  if (!CFG) { return; }

  var dirty = new Map();   /* element -> original innerHTML */
  var editing = CFG.mode === 'rich';

  /* ---------------------------------------------------------------- *
   * Chrome
   * ---------------------------------------------------------------- */
  var css = document.createElement('style');
  css.textContent = [
    '#__ed-bar{position:fixed;z-index:99999;left:50%;transform:translateX(-50%);bottom:18px;',
    'display:flex;align-items:center;gap:10px;padding:8px 10px 8px 14px;border-radius:999px;',
    'background:#0B1220;border:1px solid #2DD4BF55;box-shadow:0 10px 34px #000a;',
    'font:600 12.5px/1 Inter,system-ui,sans-serif;color:#CBD5E1}',
    '#__ed-bar b{color:#2DD4BF;font-weight:700}',
    '#__ed-bar button{font:inherit;cursor:pointer;border-radius:999px;padding:7px 13px;border:1px solid #ffffff22;',
    'background:#ffffff10;color:#E2E8F0}',
    '#__ed-bar button:hover{background:#ffffff1c}',
    '#__ed-bar button.on{background:#2DD4BF;border-color:#2DD4BF;color:#04201C}',
    '#__ed-bar button:disabled{opacity:.45;cursor:default}',
    '[data-edit]{outline-offset:3px;border-radius:3px}',
    'body.__ed-live [data-edit]:hover{outline:1px dashed #2DD4BF88;cursor:text}',
    'body.__ed-live [data-edit]:focus{outline:2px solid #2DD4BF;background:#2DD4BF0f}',
    'body.__ed-live [data-edit].__ed-dirty{background:#F59E0B14;outline:1px solid #F59E0B77}',
    /* A markdown block shows its own source while focused, so it needs to keep
       newlines visible and read as source rather than prose. */
    '[data-edit].__ed-md{white-space:pre-wrap;font-family:"Cascadia Code",Consolas,monospace;',
    'font-size:.92em;line-height:1.6}',
    '#__ed-toast{position:fixed;z-index:100000;left:50%;transform:translateX(-50%);bottom:74px;',
    'padding:9px 16px;border-radius:9px;font:600 12.5px Inter,system-ui,sans-serif;opacity:0;',
    'transition:opacity .18s;pointer-events:none;max-width:min(560px,88vw);text-align:center}',
    '#__ed-toast.show{opacity:1}',
    '#__ed-toast.ok{background:#134E4A;color:#5EEAD4;border:1px solid #2DD4BF66}',
    '#__ed-toast.err{background:#450A0A;color:#FCA5A5;border:1px solid #EF444466}',
    '#__ed-raw{position:fixed;z-index:99998;inset:0 0 0 auto;width:min(760px,94vw);display:flex;',
    'flex-direction:column;background:#0B1220;border-left:1px solid #2DD4BF44;box-shadow:-14px 0 44px #000a}',
    '#__ed-raw header{padding:13px 16px;border-bottom:1px solid #ffffff14;color:#2DD4BF;',
    'font:700 12.5px Inter,system-ui,sans-serif}',
    '#__ed-raw textarea{flex:1;border:0;outline:0;resize:none;padding:16px;background:transparent;',
    'color:#E2E8F0;font:13px/1.65 "Cascadia Code",Consolas,monospace;tab-size:2}'
  ].join('');
  document.head.appendChild(css);

  var bar = document.createElement('div');
  bar.id = '__ed-bar';
  document.body.appendChild(bar);

  var toast = document.createElement('div');
  toast.id = '__ed-toast';
  document.body.appendChild(toast);

  function say(msg, kind) {
    toast.textContent = msg;
    toast.className = 'show ' + (kind || 'ok');
    clearTimeout(say._t);
    say._t = setTimeout(function () { toast.className = ''; }, kind === 'err' ? 7000 : 2200);
  }

  /* ---------------------------------------------------------------- *
   * Inline Markdown -> HTML, for re-rendering a block after you edit it.
   * Mirrors inlineMd() in tools/edit.js; keep the two in step. Only used
   * for preview — what gets SAVED is always the Markdown itself, so a
   * mismatch here shows a wrong preview, never a wrong file.
   * ---------------------------------------------------------------- */
  function renderMd(src) {
    return src
      .replace(/^#{1,6}\s+/, '')
      .replace(/^[-*]\s+/, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  }

  /* ---------------------------------------------------------------- *
   * Rich mode
   * ---------------------------------------------------------------- */
  var fields = [];

  if (CFG.mode === 'rich' || CFG.mode === 'md') {
    fields = [].slice.call(document.querySelectorAll('[data-edit]'));
    fields.forEach(function (el) {
      var isMd = el.dataset.md === '1';

      /* Markdown blocks are displayed rendered but edited as their source, so
         [text](/url/) and **bold** round-trip byte-for-byte instead of being
         reconstructed from HTML.
         This MUST happen before the first keystroke: typing into the rendered
         form and saving its text would silently flatten every link and bold
         span in the block. focus alone is not enough — an element that already
         holds focus when the listener attaches (browsers restore focus across
         a reload) never fires it. So swap on pointerdown and focus, and keep
         beforeinput as a backstop that cancels the keystroke rather than let
         it land on the wrong content. */
      if (isMd) {
        /* mdCurrent is the authoritative Markdown for this block at all times,
           whether or not the source is currently on screen. Reading it from the
           DOM instead would be wrong the moment the block renders back. */
        el.dataset.mdCurrent = el.dataset.mdSrc;
        el.dataset.renderedOriginal = el.innerHTML;

        var swap = function () {
          if (el.dataset.edSwapped === '1') { return false; }
          el.dataset.edSwapped = '1';
          el.textContent = el.dataset.mdCurrent;
          el.classList.add('__ed-md');
          return true;
        };
        /* Render back as soon as focus leaves, so a block you clicked into —
           and especially one you changed nothing in — does not sit there as raw
           monospace source. Unchanged blocks restore the exact HTML they were
           served with; changed ones are re-rendered from their Markdown. */
        var unswap = function () {
          if (el.dataset.edSwapped !== '1') { return; }
          el.dataset.mdCurrent = el.textContent;
          el.dataset.edSwapped = '';
          el.classList.remove('__ed-md');
          el.innerHTML = el.dataset.mdCurrent === el.dataset.mdSrc
            ? el.dataset.renderedOriginal
            : renderMd(el.dataset.mdCurrent);
        };
        el.addEventListener('pointerdown', swap);
        el.addEventListener('focus', swap);
        el.addEventListener('blur', unswap);
        el.addEventListener('beforeinput', function (e) {
          if (swap()) { e.preventDefault(); }
        });
      }

      el.dataset.edOriginal = isMd ? el.dataset.mdSrc : el.innerHTML;
      el.addEventListener('input', function () {
        var now;
        if (isMd) { now = el.textContent; el.dataset.mdCurrent = now; }
        else { now = el.innerHTML; }
        if (now === el.dataset.edOriginal) { dirty.delete(el); el.classList.remove('__ed-dirty'); }
        else { dirty.set(el, el.dataset.edOriginal); el.classList.add('__ed-dirty'); }
        render();
      });
      /* Paste as plain text — pasting from a browser otherwise drags in
         spans, colors and fonts that would land in the source file. */
      el.addEventListener('paste', function (e) {
        e.preventDefault();
        var text = (e.clipboardData || window.clipboardData).getData('text/plain');
        document.execCommand('insertText', false, text.replace(/\s*\n\s*/g, ' '));
      });
      /* Enter would create a <div> or <p> inside a paragraph. These fields are
         single blocks; Shift+Enter still gives an explicit <br>.
         Markdown blocks are the exception — they legitimately wrap across
         lines, and a <br> would vanish from textContent, so insert a real
         newline instead (the field is white-space: pre-wrap while editing). */
      el.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || e.shiftKey) { return; }
        e.preventDefault();
        if (isMd) { document.execCommand('insertText', false, '\n'); }
      });
    });
    setLive(true);
  } else {
    /* Raw-mode pages have nothing to click, so opening one reads as a broken
       editor. Open the source panel immediately instead. */
    setTimeout(openRaw, 0);
  }

  function setLive(on) {
    editing = on;
    document.body.classList.toggle('__ed-live', on);
    fields.forEach(function (el) { el.contentEditable = on ? 'true' : 'false'; });
    render();
  }

  /* ---------------------------------------------------------------- *
   * Raw mode
   * ---------------------------------------------------------------- */
  var rawBox = null;

  function openRaw() {
    if (rawBox) { rawBox.remove(); rawBox = null; render(); return; }
    rawBox = document.createElement('div');
    rawBox.id = '__ed-raw';
    var h = document.createElement('header');
    h.textContent = CFG.file + '  —  edit the source, then Ctrl+S';
    var ta = document.createElement('textarea');
    ta.spellcheck = false;
    ta.value = CFG.raw;
    ta.addEventListener('input', function () {
      if (ta.value === CFG.raw) { dirty.delete(ta); } else { dirty.set(ta, CFG.raw); }
      render();
    });
    rawBox.appendChild(h);
    rawBox.appendChild(ta);
    document.body.appendChild(rawBox);
    ta.focus();
    render();
  }

  /* ---------------------------------------------------------------- *
   * Save
   * ---------------------------------------------------------------- */
  function save() {
    if (!dirty.size) { return; }
    var payload = { file: CFG.file, hash: CFG.hash };
    if (CFG.mode === 'raw') {
      payload.raw = rawBox.querySelector('textarea').value;
    } else {
      payload.edits = [...dirty.keys()].map(function (el) {
        var range = el.getAttribute('data-edit').split(':');
        var isMdEl = el.dataset.md === '1';
        /* A block still showing its source has the newest text in the DOM;
           one that has rendered back has it in mdCurrent. */
        if (isMdEl && el.dataset.edSwapped === '1') { el.dataset.mdCurrent = el.textContent; }
        return {
          start: Number(range[0]),
          end: Number(range[1]),
          html: isMdEl ? el.dataset.mdCurrent : el.innerHTML
        };
      });
    }
    var btn = bar.querySelector('#__ed-save');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

    fetch('/__save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); }).then(function (r) {
      if (!r.ok) { throw new Error(r.error); }
      say('Saved to ' + CFG.file, 'ok');
      /* Reload so byte offsets are re-read: this edit changed the file length,
         which moved every offset after it. */
      setTimeout(function () { location.reload(); }, 500);
    }).catch(function (e) {
      say(e.message, 'err');
      if (btn) { btn.disabled = false; }
      render();
    });
  }

  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  });

  window.addEventListener('beforeunload', function (e) {
    if (dirty.size) { e.preventDefault(); e.returnValue = ''; }
  });

  /* ---------------------------------------------------------------- *
   * Toolbar render
   * ---------------------------------------------------------------- */
  function render() {
    var n = dirty.size;
    bar.innerHTML = '';
    /* Page jump list — the only other way to reach a page is to type its URL. */
    var pick = document.createElement('select');
    pick.id = '__ed-pick';
    (CFG.pages || []).forEach(function (p) {
      var o = document.createElement('option');
      o.value = p.url;
      o.textContent = (p.url === '/' ? '/ (home)' : p.url) + (p.mode === 'raw' ? '  — source only' : '');
      o.selected = p.url === location.pathname;
      pick.appendChild(o);
    });
    pick.onchange = function () {
      if (dirty.size && !confirm('You have unsaved edits. Leave this page?')) { render(); return; }
      dirty.clear();
      location.pathname = pick.value;
    };
    bar.appendChild(pick);

    var label = document.createElement('span');
    label.innerHTML = CFG.mode === 'raw'
      ? '<b>source</b>'
      : '<b>' + CFG.count + '</b> blocks' + (CFG.mode === 'md' ? ' (markdown)' : '');
    label.title = CFG.mode === 'raw'
      ? CFG.file + ' has Liquid mid-sentence, so it is edited as source'
      : CFG.mode === 'md'
        ? 'Click any paragraph to edit its Markdown source'
        : 'Click any paragraph or heading to edit it';
    bar.appendChild(label);

    if (CFG.mode !== 'raw') {
      var t = document.createElement('button');
      t.textContent = editing ? 'Editing' : 'Browsing';
      t.className = editing ? 'on' : '';
      t.title = 'Turn editing off to click through the interactive widgets';
      t.onclick = function () { setLive(!editing); };
      bar.appendChild(t);
    } else {
      var o = document.createElement('button');
      o.textContent = rawBox ? 'Close source' : 'Edit source';
      o.className = rawBox ? 'on' : '';
      o.onclick = openRaw;
      bar.appendChild(o);
    }

    var s = document.createElement('button');
    s.id = '__ed-save';
    s.className = n ? 'on' : '';
    s.disabled = !n;
    s.textContent = n ? 'Save ' + n + (n === 1 ? ' change' : ' changes') : 'Saved';
    s.onclick = save;
    bar.appendChild(s);
  }
  render();

  /* ---------------------------------------------------------------- *
   * Live reload — also picks up edits made in VS Code.
   * ---------------------------------------------------------------- */
  try {
    var es = new EventSource('/__events');
    es.onmessage = function () {
      if (dirty.size) { say('File changed on disk — you have unsaved edits, not reloading', 'err'); return; }
      location.reload();
    };
  } catch (e) { /* no SSE, live reload just off */ }
})();
