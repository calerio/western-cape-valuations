# Western Cape Property Valuation Atlas — repo guide

Public GitHub Pages site (deploys to https://calerio.github.io/western-cape-valuations/) for the
Western Cape municipal property-valuation project. Static front-end (vanilla HTML/CSS/JS + D3 v7)
reading exported JSON + a chunked static SQLite file. No build step, no server.

## ⚠️ Conventions / rules

- **Git authorship:** Do **NOT** add any Claude/AI authorship to commits or PRs in this repo —
  no `Co-Authored-By: Claude...`, no "authored by Claude Opus 4.8", no `Claude-Session` trailer.
  Commit as the user only. *(Standing user instruction.)*
- **Data is never hardcoded.** `data/stats.json`, `data/towns.json` and the `data/db/` chunks are
  regenerated from the source valuation database by `extract/export_site.py` in the sibling
  extraction project (`~/projects/western-cape-property-valuations`). To change figures, re-run the
  export there — don't edit the JSON by hand.
- **No fabricated geography.** Municipality is the finest map level — it's the smallest area with
  reliable openly-published boundaries. Suburb/town borders aren't open data, so we don't invent a
  finer subdivision (the old Voronoi "town" level was removed). Suburb names still power search
  (they jump to the parent municipality).
- **City of Cape Town** publishes valuations only via per-property online search — shown as
  "no public valuation roll", never faked or estimated.

## Layout
- `index.html` — page shell (map stage + scroll-reveal dashboard).
- `assets/atlas.js` — all logic (map, zoom, dashboard, histogram, search). Bump the `?v=` on its
  `<script>` tag when changing it so GitHub Pages' CDN serves the new file.
- `data/` — `stats.json`, `towns.json`, `geo/*.geojson`, `db/` (chunked SQLite + `config.json`).
- `assets/vendor/` — vendored `sqlite.worker.js` + `sql-wasm.wasm` (sql.js-httpvfs).
