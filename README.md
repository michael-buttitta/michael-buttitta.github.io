# michael-buttitta.github.io

Strategic-finance analysis of crypto protocols and DeFi mechanisms. Built on the
[Chirpy](https://github.com/cotes2020/jekyll-theme-chirpy) Jekyll theme (gem-based),
deployed to GitHub Pages via GitHub Actions.

## Deploy (one-time)

1. Create an **empty** GitHub repo named `michael-buttitta.github.io` (no README/license).
2. From this folder:
   ```bash
   git init
   git add .
   git commit -m "Initial site"
   git branch -M main
   git remote add origin https://github.com/michael-buttitta/michael-buttitta.github.io.git
   git push -u origin main
   ```
3. In the repo: **Settings → Pages → Build and deployment → Source = GitHub Actions**.
4. Watch the **Actions** tab; once green, the site is live at
   <https://michael-buttitta.github.io>.

> GitHub Pages does **not** build Chirpy natively — the included
> `.github/workflows/pages-deploy.yml` does. "Source = GitHub Actions" is required.

## Writing a post

1. Copy `_posts/TEMPLATE.md` → `_posts/YYYY-MM-DD-your-slug.md`.
2. Set `published: true` (or delete the line) and fill the front matter.
3. Commit and push — Actions rebuilds and redeploys automatically.

## Local preview (optional)

Requires Ruby + DevKit (not installed by default on this machine):

```bash
bundle install
bundle exec jekyll s   # http://127.0.0.1:4000
```

## TODO before launch (placeholders to replace)

- `_config.yml` + `_data/contact.yml`: real LinkedIn URL (`YOUR_LINKEDIN_SLUG`).
- `assets/img/headshot.jpg`: add your avatar image.
- `_includes/post-footer-cta.html`: Kit (`YOUR_KIT_SUBDOMAIN` / `YOUR_FORM_ID`).
- `_tabs/consulting.md`: Calendly link.
- `_tabs/about.md`: real bio/credibility statement.
- First post (`2026-06-15-...`): replace every `[VERIFY]` figure with real data.

See `CONTENT-PLAYBOOK.md` for the editorial system and X distribution workflow.
