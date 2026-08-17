---
description: Open the local content editor in the browser to edit the site's text
allowed-tools: Bash
---

Start the site's local content editor and open it in the owner's browser.

Run exactly this, with `run_in_background: true` (the server is long-running and must
survive the turn — never run it in the foreground, that would block):

```
node tools/edit.js
```

It opens `http://localhost:8790/` automatically. If an editor is already running it
reuses it and just brings the browser to the front, so running this repeatedly is safe.

Then confirm it is serving before telling the owner it is ready:

```
curl -sS -o /dev/null -w "%{http_code}" http://localhost:8790/
```

Reply with one short line — that the editor is open, and that they click any paragraph,
type, and press Ctrl+S. Do not restate the page list or repeat the documentation; it is
in `tools/README.md` and printed by the server itself.

If `$ARGUMENTS` names a page (for example `gpu`, `about`, `home`), point them at that
page's URL specifically — `http://localhost:8790/<slug>/`, or `/` for home.
