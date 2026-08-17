# Editing the site's text

Three ways in, all the same thing:

- In Claude Code, type **`/edit`**.
- Double-click **`edit-site.cmd`** in the repo root.
- From a terminal: `node tools/edit.js`

Any of them opens `http://localhost:8790/` in your browser. If the editor is already
running they just bring it to the front rather than starting a second copy, so it is safe
to do repeatedly.

Then: **click any paragraph, type, press Ctrl+S.** The bottom toolbar has a dropdown to
jump between pages, a Save button showing how many blocks you've changed, and an
**Editing / Browsing** toggle — switch to Browsing when you want to click through an
exhibit's interactive widgets instead of editing them.

Edits go straight into the source files. Nothing is published until you run `publish.js`.

## What you can click

| Pages | How it behaves |
|---|---|
| The 14 exhibits + `/map/` | Click any paragraph or heading. Edits go into `_tabs/<slug>.html`. |
| `/about/` | Click a paragraph and it shows you its **Markdown** (`[text](/url/)` and `**bold**` visible). Edit that, click away, and it renders again. |
| `/` (home) | The hero and Technology Map headings are editable. |

The editor only rewrites the exact blocks you type into, so everything else in the file
stays byte-for-byte identical — your line wrapping, entities and inline `<em>`/`<a>` tags
are never reflowed.

## What you can't click, and why

- **Two blocks on the home page** — `.tmap-sub` ("13 interactive exhibits…") and
  `.tmap-start` ("New here? Start with…"). Both contain Liquid: the exhibit count is
  *derived* from `site.tabs`, and the link is built through `relative_url`. Saving the
  rendered view would freeze the count and break the link, so they are read-only. Edit
  them in `_layouts/home.html` directly.
- **The theme's post list** below the Technology Map — that's pagination logic, not prose.
- **`<noscript>` fallback text** — browsers treat it as raw text, so it never becomes
  clickable.
- **Prose inside `assets/js/*.js`** — roughly a fifth of the site's writing (step
  captions, tooltips, status sentences, and the topic blurbs in `knowledge-graph.js`).
  Refactoring those out of thirteen working algorithm files isn't worth the risk. Use
  `find.js` instead.

## Finding any sentence

```
node tools/find.js "billions of transistors"
node tools/find.js --js "Streamed material"
```

Prints `file:line` for every match across `_tabs/`, `_layouts/`, `_includes/`, `_posts/`,
`assets/js/` and `_data/`. This is the way to reach the text the click editor can't.

Note: paragraphs are hard-wrapped in the source, so a phrase spanning a line break won't
match — search a shorter fragment.

## Publishing

```
node tools/publish.js "reworded the GPU hero"
```

Runs the link check (the local stand-in for the html-proofer step that can fail the
deploy), shows you the diff, **asks before pushing**, then waits for the change to appear
on the live site. Pushing to `main` deploys the public site, which is why it confirms.

## Limits worth knowing

The page shell — sidebar, topbar, compiled theme CSS — comes from the **deployed** site
and is cached in `tools/.shell-cache/`. So changes to `_config.yml`,
`_includes/sidebar.html`, or `assets/css/jekyll-theme-chirpy.scss` won't show up locally;
those still need a push. Run `node tools/edit.js --refresh-shell` if the theme changes.

Changes to `assets/css/<slug>.css` and `assets/js/<slug>.js` **do** show up — those are
served from disk, and the page live-reloads when you save any of them.
