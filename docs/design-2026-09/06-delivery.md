# Delivery: design refresh 2026-09 (branch `design-2026-09`)

Status: ready for the owner's review. Nothing is merged or pushed. Deployment waits for the owner's approval.

<!-- controller: fill in the final branch HEAD SHA and the date of the browser and smoke runs -->

## 1. Why this refresh

The site answers two questions: "what is this property's official municipal value, and can I trust that
answer?" and "how are values spread across the Western Cape?". The July 2026 build answered both, but the
audits (`00-audit.md`, `01-data-audit.md`, `02-code-audit.md`) found five kinds of problem:

- **Trust.** A map click could show a valuation from the wrong municipality or a stale lookup. The panel
  also gave a confident answer where the link between erf and roll row was only a guess.
- **Data honesty.** Cape Town's multi-use properties are counted twice (a parent row plus per-use
  allocation rows, about R36bn). The Explore page mixed figures with and without those rows. Valuation
  dates differ between rolls, and the page did not say so.
- **Weight.** Explore downloaded 2.6 MB before it was usable, and the map pages 4.9 MB. Imagery loaded
  even when nobody chose Satellite. Switching basemap or language reloaded the page.
- **Mobile.** The panel covered the parcel you had tapped, and the controls took over a third of the
  screen.
- **Voice and look.** The type and chrome were generic: tracked capitals, strings joined with middle
  dots, arrows on buttons, and Google Fonts.

The design plan (`03-design-plan.md`) and visual direction (`04-visual-direction.md`) fixed these by making
the valuation roll itself the visual subject. That means a ruled ledger table, and the SG-diagram hatch
on the selected erf, with its status drawn in line-work rather than colour alone. The rest of the plan:

- one map page in place of two, with the basemap switched in place;
- an Explore page built from pre-computed `explore.json` statistics, each figure with the SQL that
  produced it;
- self-hosted IBM Plex Sans and Source Serif 4;
- a bilingual UI that switches language without a reload.

## 2. What changed

`git diff --stat main...design-2026-09` (before this report was committed): **174 files changed,
18,588 insertions, 3,545 deletions**, across 39 commits. Excluding generated pages (`m/`, `d/`, `af/`,
`guide/`) and design documents, the count is 100 files, +13,921 / −1,715.

<!-- controller: re-run `git diff --stat main...design-2026-09 | tail -1` on the final HEAD and replace the line above -->

| Area | Main files | What changed |
|---|---|---|
| Tokens, type | `assets/tokens.css`, `assets/fonts/` | `light-dark()` colour tokens, rem type scale, spacing, status pairs, cadastral accent; self-hosted Plex Sans and Source Serif 4 (latin + latin-ext WOFF2, OFL licences vendored); no Google Fonts anywhere |
| Explore | `index.html`, `assets/atlas.js`, `assets/explore-sections.js`, `assets/explore-charts.js`, `assets/explore.css`, `assets/viewseg.css` | Rail + reading column. Sections: ledger table (share bar, median marker, dates), histogram, category bar, date dots, findings with "how this is computed" SQL. Cards on phones. |
| Map | `map.html`, `plain.html`, `assets/map.js`, `assets/map/*.js`, `assets/map.css` | One MapLibre instance, basemap and language switched in place, the hatched selected erf, the panel as a state model (`panel.js`) with glyph + text status badges, bottom sheet on phones, parcel refetch avoidance |
| Integrity | `assets/selection.js`, `assets/map.js` | Selection token (a late lookup never overwrites a newer one), fail-closed lookup gate, municipality gate |
| i18n | `assets/i18n.js`, `data/i18n-af.json`, `tests/check-i18n.mjs` | One shared module; in-place EN/AF switch; completeness check (all literal keys + explore.json strings) |
| Data | `data/explore.json`, `data/geo/*.geojson` | Pre-computed Explore statistics with their SQL; simplified boundaries (outline 28 KB, municipalities 89 KB) plus the full-resolution municipalities for the Integrity rule |
| Static pages | `templates/shell.html`, regenerated `m/`, `d/`, `guide/`, `af/`, `sitemap.xml` | Self-hosted fonts via tokens.css, shared `viewseg.css`, sentence case, copy without middle-dot strings. The figures now match `stats.json` (they had not been regenerated since 2026-07-19). |
| Tests | `tests/*.test.mjs` (49 passing), `tests/browser/*.js` | Unit tests for tokens, fonts, format, hash, hatch, style, selection, bbox, evidence, charts, i18n, explore sections, check-i18n; WebKit scenarios for every page and state |

Data repo (`~/projects/western-cape-property-valuations`, no remote): `extract/export_explore.py`,
`extract/catrules.py`, `extract/geo/simplify_geo.py` (drift gate and `--dry-run`),
`extract/export_pages.py` (copy sweep).

## 3. Performance before and after

From `05-perf-after.md`. WebKit, measured on a local gzip server (:8768) comparable with the GitHub Pages baseline.

| Metric | Before | After | Target |
|---|---:|---:|---|
| Explore transferred at first usable | 2.6 MB | **298 KB** | ≤ 0.9 MB, met |
| Explore first usable (desktop, cold) | 0.68 s | **0.26 s** | ≤ 0.6 s, met |
| `map.html` transferred at style ready | 4.3 MB | **1.95 MB** | ≤ 2.4 MB, met |
| `plain.html` transferred at style ready | 4.9 MB | **2.23 MB** | ≤ 2.4 MB, met (small margin) |
| Imagery on the Map view | loaded at boot | **0 Esri requests** until Satellite is chosen | met |
| Click → panel | 0.32–0.65 s | **0.33–0.60 s** | unchanged or better, met |
| Basemap / language switch | page reload | **no reload** (not timed) | met for "no reload" |
| JS errors | 0 | **0** (remaining warnings are third-party) | met |

The satellite warm style-ready time (1.17 s) and the parcels-interactive times (1.3–1.4 s) are single runs
and vary with ArcGIS latency.
<!-- controller: if the single-run satellite timings are re-measured before delivery, put the new figures here -->

## 4. Browser results

### WebKit (automated, Playwright MCP)

<!-- controller: fill the table from the MCP runs on the final HEAD (http://127.0.0.1:8766/) -->

| Scenario | Result | Notes |
|---|---|---|
| `test-explore.js` | <!-- controller --> | now expands the capped list before checking the remainder row |
| `test-explore-degrade.js` | <!-- controller --> | |
| `test-explore-mobile.js` | <!-- controller --> | |
| `test-panel-states.js` | <!-- controller --> | focus still lands on `#pclose` |
| `test-panel-errors.js` | <!-- controller --> | |
| `test-mobile-map.js` | <!-- controller --> | |
| `test-basemap-switch.js` | <!-- controller --> | |
| `test-lang-switch.js` | <!-- controller --> | also check that the `#maphint` text follows the language |
| `test-af-labels.js` | <!-- controller --> | |
| `test-failopen.js` | <!-- controller --> | |
| `test-race.js` | <!-- controller --> | |
| `test-hotfix-matzikama.js` | <!-- controller --> | the suppression must still hold |
| P0 tests | <!-- controller --> | |

### Chrome and Firefox (manual, by the owner)

Serve the worktree (`cd ~/projects/western-cape-valuations-design && python3 -m http.server 8766`), then:

```sh
open -a "Google Chrome" http://127.0.0.1:8766/
open -a Firefox http://127.0.0.1:8766/
```

Click through in each browser:

1. **Explore.** The province loads. Sort the table and expand it. Drill to Stellenbosch, then Swellendam
   (the remainder row appears only once the list is expanded). Switch EN → AF → EN.
2. **Map.** Open `http://127.0.0.1:8766/plain.html#p/tSTELLENBOSCH&c=18.861,-33.9366,17&s=W024C067002200001942000000`.
   The panel opens on the hatched erf. Switch to Satellite and back without a reload. Switch the
   language: the hint at the bottom follows it.
3. **Keyboard.** Tab through the map page. The close button shows a focus ring when reached by
   keyboard. When the panel was opened by a click, Chrome and Firefox show no ring on it.
4. **Static pages.** Open `http://127.0.0.1:8766/af/m/mossel-bay.html`: the fonts are Plex and Source
   Serif, and DevTools Network shows no request to fonts.googleapis.com.

<!-- controller: record the owner's Chrome / Firefox findings here -->

## 5. Smoke matrix

Command (the screen must be unlocked; Safari with no windows):

```sh
cd ~/projects/western-cape-property-valuations
python3 extract/match/smoke_matrix.py --site http://127.0.0.1:8766 --db <prod config> --out reports/smoke-design-2026-09 --private
```

<!-- controller: paste the per-group counts (accepted_high, accepted_group, review, ambiguous, not_in_roll, abstain), build_verified, js_errors -->

## 6. Screenshots

Made by `tests/browser/shots-delivery.js` (MCP scenario) into `docs/design-2026-09/screenshots/`.

<!-- controller: fill the table with the returned bytes/scale per file; embed or link each PNG -->

| Page | EN desktop | EN phone | AF desktop | AF phone |
|---|---|---|---|---|
| Explore (`index.html`) | <!-- controller --> | | | |
| Map (`plain.html`, Stellenbosch deep link) | | | | |
| Satellite (`map.html`, same link, `&b=sat`) | | | | |

## 7. Known limitations

- **Afrikaans basemap labels come from the vector tiles' `name:af`.** Coverage is about 90% of towns,
  30% of suburbs and close to 0% of streets and POIs. Everything without a `name:af` stays in the
  English or local name.
- **The renamed-places registry has not been approved.** `applyLanguage(map, lang, [])` passes an empty
  override list, so tiles still show old names (for example Graaff-Reinet's township as "Robert Sobukwe
  Town"). The six `REGISTRY.md` owner questions are still open.
- **Cape Town's share is derived from the findings.** `explore.json` carries the share with the
  allocation rows excluded (`ct_share`, 4 decimals) but not the excluded rand amount. The ledger
  recovers it as D = (C − s·T)/(1 − s) (≈ R36.6bn, within about R0.4bn). The shares add up to 100%, and
  Cape Town's share equals the finding exactly (64.2%). Rand totals still include both kinds of row, and
  the page says so. Concentration on Cape Town's own nodes (district, municipality) still counts the
  duplicates, because no exclusion-consistent per-node figures are exported. A cleaner fix is to export
  them from `export_explore.py`.
- **Static pages do not apply the Matzikama address suppression** (`ADDRESS_HIDDEN_MUNIS` is front-end
  only). `m/matzikama.html` and its AF twin show the same two most/least-valuable addresses as before this
  branch. This is not new exposure, but the owner should decide on it together with lifting the
  suppression.
- **Density and place bounding boxes are computed from the simplified municipal boundaries** (≤ 0.2%
  area drift) when `export_site.py` runs. This branch does not ship that drift: `stats.json`,
  `towns.json` and `places.json` are byte-identical to the previous commit. Pointing
  `export_site.py` / `export_places.py` at `extract/geo/source/` is follow-up work in the data repo.
- **A full `export_site.py` run rebuilds `data/db/`** with a new build id. Never run it on a
  checkout whose `config.json` must stay pinned to the live Supabase namespace. The pages for this
  branch were regenerated with the search-DB step cut off (see the Task 13 report).
- The Natural Earth raster on `plain.html` (656 KB) is still loaded (deferred in `05-perf-after.md`).
- A desktop Satellite screenshot may exceed the 400 KB PNG budget, because imagery compresses poorly.
  The scenario flags any file that does.
- After the merge, `extract/geo/simplify_geo.py`'s `DEFAULT_SITE` must be changed to the production
  checkout (the comment in the file says so).
- Static-page footer links are still separated by middle dots. They are navigation separators, not joined
  meta strings.

## 8. Deployment (after the owner approves)

Production is `~/projects/western-cape-valuations` on `main`, served by GitHub Pages. `main` has three
commits the branch does not have (search-DB switch to `b-93c01c0b6202`, the Matzikama repair export,
DATA_CONTRACT §7c). The merge conflicts only on the `?v=` of the `atlas.js`/`map.js` script tags in
`index.html`, `map.html` and `plain.html`. Keep the branch side, which has the higher numbers. The
Supabase `configUrl` change lives in the JS and auto-merges.

```sh
cd ~/projects/western-cape-valuations
git checkout main && git status --short            # must be clean
git merge --no-ff design-2026-09
# resolve the three script-tag conflicts in favour of the branch (atlas.js?v=40, map.js?v=38):
git checkout --theirs index.html map.html plain.html
grep -n 'atlas.js?v=\|map.js?v=' index.html map.html plain.html
grep -c 'b-93c01c0b6202' assets/atlas.js assets/map.js    # 1 each: the live DB namespace survived
node --test 'tests/*.test.mjs' && node tests/check-i18n.mjs
git add index.html map.html plain.html && git commit --no-edit
git push
```

Then, in the data repo, set `DEFAULT_SITE` in `extract/geo/simplify_geo.py` to
`~/projects/western-cape-valuations` and commit. The search DB and Supabase are not touched.

## 9. Rollback

```sh
cd ~/projects/western-cape-valuations
git revert -m 1 <merge-sha> && git push
```

The database is untouched by this branch: `data/db/` and the Supabase namespace stay as they are, so a
revert restores the previous front-end against the same data.
