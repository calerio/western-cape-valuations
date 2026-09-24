# Delivery: design refresh 2026-09 (branch `design-2026-09`)

Status: ready for review. Nothing is merged or pushed.

Branch head at delivery: see the last commit on `design-2026-09`

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


| Area | Main files | What changed |
|---|---|---|
| Tokens, type | `assets/tokens.css`, `assets/fonts/` | `light-dark()` colour tokens, rem type scale, spacing, status pairs, cadastral accent; self-hosted Plex Sans and Source Serif 4 (latin + latin-ext WOFF2, OFL licences vendored); no Google Fonts anywhere |
| Explore | `index.html`, `assets/atlas.js`, `assets/explore-sections.js`, `assets/explore-charts.js`, `assets/explore.css`, `assets/viewseg.css` | Rail + reading column. Sections: ledger table (share bar, median marker, dates), histogram, category bar, date dots, findings with "how this is computed" SQL. Cards on phones. |
| Map | `map.html`, `plain.html`, `assets/map.js`, `assets/map/*.js`, `assets/map.css` | One MapLibre instance, basemap and language switched in place, the hatched selected erf, the panel as a state model (`panel.js`) with glyph + text status badges, bottom sheet on phones, parcel refetch avoidance |
| Integrity | `assets/selection.js`, `assets/map.js` | Selection token (a late lookup never overwrites a newer one), fail-closed lookup gate, municipality gate |
| i18n | `assets/i18n.js`, `data/i18n-af.json`, `tests/check-i18n.mjs` | One shared module; in-place EN/AF switch; completeness check (all literal keys + explore.json strings) |
| Data | `data/explore.json`, `data/geo/*.geojson` | Pre-computed Explore statistics with their SQL; simplified boundaries (outline 28 KB, municipalities 89 KB) plus the full-resolution municipalities for the Integrity rule |
| Static pages | `templates/shell.html`, regenerated `m/`, `d/`, `guide/`, `af/`, `sitemap.xml` | Self-hosted fonts via tokens.css, shared `viewseg.css`, sentence case, copy without middle-dot strings. The figures now match `stats.json` (they had not been regenerated since 2026-07-19). |
| Renamed places | `data/geo/renamed-places/` (registry 1.1.0, `overrides.json`), `scripts/build-overrides.mjs`, `assets/map/style.js`, `assets/places.js` | Former names (Graaff-Reinet, East London, Grahamstown, Umhlanga Rocks …) are the map labels on both basemaps and in both languages, on place labels only, matched by tile feature id + class + exact current name. Official names stay searchable: the place search lists a renamed place under its former name with its official name on a second line. One line in the map credits links to the registry. |
| Privacy | `assets/atlas.js`, `assets/map/panel.js`, `tests/browser/test-hotfix-matzikama.js` | Matzikama address suppression lifted on 2026-09-24 for build `b-93c01c0b6202` (`ADDRESS_HIDDEN_MUNIS` is empty; re-arming is one line in each of the two files). Gate: `extract/tests/test_no_owner_names_in_exports.py` in the data repo, which passed against the DB, the site exports and the build's search-DB chunks. |
| Search DB hosting | `assets/map.js` (`DB_CONFIG_URL`), `assets/atlas.js` (`DB_CONFIG`), `scripts/preflight_db.sh`, `scripts/verify_remote_db.sh`, `DATA_CONTRACT.md` §8 | The search DB moved from Supabase Storage to Cloudflare R2 (bucket `wc-valuations-db`) on 2026-09-24, after Supabase restricted the project for exceeding the free plan's 1 GB storage quota and every storage read returned HTTP 402 (`docs/incidents/2026-09-24-supabase-storage-quota.md`). The same build, `b-93c01c0b6202`, with the bytes unchanged. New pre-switch check `scripts/preflight_db.sh`; the verifier takes `--base` and compares the three build ids. Storage budget: at most two builds in the bucket, pruned after every verified switch. |
| Tests | `tests/*.test.mjs` (71 passing), `tests/browser/*.js` | Unit tests for tokens (incl. WCAG contrast of the five status pairs), fonts, format, hash, hatch, style, selection, bbox, slug, evidence, panel disclosure, charts, i18n, explore sections, check-i18n; WebKit scenarios for every page and state |

Data repo (`~/projects/western-cape-property-valuations`, no remote): `extract/export_explore.py`,
`extract/catrules.py`, `extract/geo/simplify_geo.py` (drift gate and `--dry-run`),
`extract/export_pages.py` (copy sweep), `extract/export_site.py` (the manifest records the R2 base,
`WC_DB_BASE` overrides it), `extract/match/upload_r2.sh` (R2 uploader with a retention report and
`--prune`), `extract/match/upload_supabase.sh` (marked legacy).

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

## 4. Browser results

### WebKit (automated, Playwright)

Run 2026-09-23 18:2x on ea46beb, then re-run after the last fixes on 82a0b07, against http://127.0.0.1:8766/ (Playwright, WebKit 26.6, cold contexts). 14 scenarios (the 13 below plus `test-crossview.js`), 14 passed, 0 page errors, 0 console errors. The map scenarios were re-run against the live build `b-93c01c0b6202` (`?db=`) with the same results. One timing flake was seen in four runs of `test-mobile-map.js` (a synthetic 80 px swipe from peek did not register once; it passed on re-run with both builds). Scenario sources: `tests/browser/*.js`; the `probe-hint-focus` check (hint text after EN→AF + pan inside the fetched bbox; no `:focus-visible` on `#pclose` after a touch tap; zoom control present at 600 px desktop) also passed.

| Scenario | Result | Notes |
|---|---|---|
| `test-explore.js` | PASS | now expands the capped list before checking the remainder row |
| `test-explore-degrade.js` | PASS | |
| `test-explore-mobile.js` | PASS | |
| `test-panel-states.js` | PASS (6/6 dispositions) | focus still lands on `#pclose` |
| `test-panel-errors.js` | PASS (unavailable + integrity states; loading badge in 35 ms) | |
| `test-mobile-map.js` | PASS | |
| `test-basemap-switch.js` | PASS (0 imagery requests before Satellite; one MapLibre instance) | |
| `test-lang-switch.js` | PASS (AF panel in 83 ms, no reload; hint follows the language — `probe-hint-focus`) | also check that the `#maphint` text follows the language |
| `test-af-labels.js` | PASS | now expects the rendered label "Graaff-Reinet" where the tiles say "Robert Sobukwe Town" |
| `test-renamed-places.js` | not yet run | former names on `plain.html` at province zoom (EN, AF, Satellite), Nieu-Bethesda at zoom 11, search by official name, fly-to Grahamstown, Umhlanga Rocks listed as outside the map area without moving the map |
| `test-failopen.js` | PASS (fails closed while blocked; link table after recovery) | |
| `test-race.js` | PASS (later click kept) | |
| `test-hotfix-matzikama.js` | PASS (Matzikama addresses suppressed; Drakenstein keeps its address) | the suppression must still hold |
| `test-crossview.js` | PASS (province view link `index.html`; zoom ≥ 9 carries `#m/<slug>`; `#m/stellenbosch` frames the municipality; Explore → `plain.html#m/swellendam`) | added with the last fixes |
| P0 tests | PASS (`tests/selection.test.mjs` in the 58 node tests; `test-failopen`/`test-race` above) | |

### Chrome and Firefox (manual)

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
4. **Static pages.** Open `http://127.0.0.1:8766/m/mossel-bay.html` and choose **AF** with the EN | AF
   toggle first: `assets/lang.js` sends a first-time visitor whose browser language is not Afrikaans
   from an `af/` page to its English twin. Then open `http://127.0.0.1:8766/af/m/mossel-bay.html`: the
   fonts are Plex and Source Serif, and DevTools Network shows no request to fonts.googleapis.com.

Not yet clicked through by hand; record the findings here before the merge.

## 5. Smoke matrix

Command (the screen must be unlocked; Safari with no windows):

```sh
cd ~/projects/western-cape-property-valuations
python3 extract/match/smoke_matrix.py --site http://127.0.0.1:8766 --db <prod config> --out reports/smoke-design-2026-09 --private
```

`<prod config>` is the R2 config URL,
`https://pub-dbe35b2129524bf1965d77e99d6989a6.r2.dev/b-93c01c0b6202/config.json`. Since 2026-09-24 the
matrices run against R2; runs before that date read the Supabase copy of the same build.

**Pending.** The matrix drives Safari through AppleScript and cannot render while the screen is locked (`document.hidden` is true). A launcher (`extract/match/design_smoke_when_ready_2026-09-23.sh`) runs it automatically once the P0 checkpoint run has finished and the screen is unlocked with Safari idle; its result lands in `extract/match/reports/design-smoke-2026-09-23.DONE` and `reports/smoke-design-2026-09/smoke.json`.

## 6. Screenshots

Made by `tests/browser/shots-delivery.js` (Playwright scenario) into `docs/design-2026-09/screenshots/`.

All twelve were re-captured on 82a0b07 (after the inline desktop credits) (1440×900 desktop; 390×844 phone). Explore pages are lossless PNG within the 400 KB budget. Map and satellite pages contain imagery that does not compress losslessly (0.4–2.5 MB as PNG), so those are stored as JPEG (quality 82). The two plain-map phone shots are PNG at 1×.

| Page | EN desktop | EN phone | AF desktop | AF phone |
|---|---|---|---|---|
| Explore (`index.html`) | [PNG 226 KB](screenshots/index-en-desktop.png) | [PNG 383 KB @3×](screenshots/index-en-phone.png) | [PNG 231 KB](screenshots/index-af-desktop.png) | [PNG 381 KB @3×](screenshots/index-af-phone.png) |
| Map (`plain.html`, Stellenbosch deep link) | [JPEG 370 KB](screenshots/plain-en-desktop.jpg) | [PNG 180 KB @1×](screenshots/plain-en-phone.png) | [JPEG 373 KB](screenshots/plain-af-desktop.jpg) | [PNG 180 KB @1×](screenshots/plain-af-phone.png) |
| Satellite (`map.html`, same link, `&b=sat`) | [JPEG 606 KB](screenshots/map-en-desktop.jpg) | [JPEG 132 KB](screenshots/map-en-phone.jpg) | [JPEG 609 KB](screenshots/map-af-desktop.jpg) | [JPEG 133 KB](screenshots/map-af-phone.jpg) |

## 7. Known limitations

- **Afrikaans basemap labels come from the vector tiles' `name:af`.** Coverage is about 90% of towns,
  30% of suburbs and close to 0% of streets and POIs. Everything without a `name:af` stays in the
  English or local name.
- **Renamed places not in the tiles get no override.** Seven registry entries (Triomf/Sophiatown,
  Loskop, Langeloop, Hartebeeskop, Schoemansdal, Oshoek, Goedgewonden) have no place feature in the
  vector tiles, so there is nothing to relabel; they are still found by the place search. Overrides are
  keyed on the tile feature ids of snapshot `20260913_164504_pt`: if OpenFreeMap changes a feature's id,
  class or name, that label falls back to the tiles' own until the registry is updated.
- **Renamed places outside the map bounds** (lon 13 to 28, lat −41.5 to −24.5) are listed by the search
  with "outside the map area" and are never flown to; the map cannot pan there. Most of the registry
  (KwaZulu-Natal, Gauteng, Limpopo, Mpumalanga) is outside.
- **Cape Town's share is derived from the findings.** `explore.json` carries the share with the
  allocation rows excluded (`ct_share`, 4 decimals) but not the excluded rand amount. The ledger
  recovers it as D = (C − s·T)/(1 − s) (≈ R36.6bn, within about R0.4bn). The shares add up to 100%, and
  Cape Town's share equals the finding exactly (64.2%). Rand totals still include both kinds of row, and
  the page says so. Concentration on Cape Town's own nodes (district, municipality) still counts the
  duplicates, because no exclusion-consistent per-node figures are exported. A cleaner fix is to export
  them from `export_explore.py`.
- **Static pages do not apply the Matzikama address suppression** (`ADDRESS_HIDDEN_MUNIS` is front-end
  only). `m/matzikama.html` and its AF twin show the same two most/least-valuable addresses as before this
  branch. This is not new exposure, but it should be decided together with lifting the
  suppression.
- **The Matzikama address suppression is lifted, gated by `extract/tests/test_no_owner_names_in_exports.py`** (data repo). The gate checked build `b-93c01c0b6202`, which reaches this branch only through the merge with `main`; on its own the branch still points `configUrl` at `b-2b502178f94f`, whose search DB holds the owner names. Do not deploy the branch without that merge, and rerun the gate on any new build.
- **Density and place bounding boxes are computed from the simplified municipal boundaries** (≤ 0.2%
  area drift) when `export_site.py` runs. This branch does not ship that drift: `stats.json`,
  `towns.json` and `places.json` are byte-identical to the previous commit. Pointing
  `export_site.py` / `export_places.py` at `extract/geo/source/` is follow-up work in the data repo.
- **The search DB is served from R2's public development endpoint** (`pub-….r2.dev`). No Cloudflare
  zone is managed for this site, so there is no custom data hostname; adding one later is a single
  config-URL switch (`scripts/rollback_db.sh <config-url>`).
- **The Supabase copy of `b-93c01c0b6202` is temporary.** It is the rollback copy until production has
  run on R2, then it is removed. At the time of writing Supabase still answers HTTP 402 for every
  storage read (the quota restriction is lifted with a delay Supabase does not specify), so that copy
  cannot serve as a rollback target until the restriction is gone.
- **A full `export_site.py` run rebuilds `data/db/`** with a new build id. Never run it on a
  checkout whose `config.json` must stay pinned to the live build. This branch's pages
  were regenerated with `extract/export_pages_only.py` (data repo, commit c5afaa6). That script execs
  `export_site.py` up to its `# ---- search DB (slim + indexed) ----` marker, so it writes stats.json,
  towns.json, the pages + sitemap.xml and places.json, and leaves `data/db/` untouched. To reproduce:

  ```sh
  cd ~/projects/western-cape-property-valuations
  python3 extract/export_pages_only.py --site ~/projects/western-cape-valuations-design
  cd ~/projects/western-cape-valuations-design
  git checkout -- data/stats.json data/geo/places.json   # drop the simplified-boundary density/bbox drift (see above)
  ```

  Follow-up: a real `--pages-only` flag in `export_site.py` should replace the wrapper.
- Afrikaans number formats (decimal separator, thousands spacing, rand abbreviations) are not yet
  harmonised between the static pages and the Explore page; the static pages keep their current
  formats. This is deferred.
- The Natural Earth raster on `plain.html` (656 KB) is still loaded (deferred in `05-perf-after.md`).
- A desktop Satellite screenshot may exceed the 400 KB PNG budget, because imagery compresses poorly.
  The scenario flags any file that does.
- After the merge, `extract/geo/simplify_geo.py`'s `DEFAULT_SITE` must be changed to the production
  checkout (the comment in the file says so).
- Static-page footer links are still separated by middle dots. They are navigation separators, not joined
  meta strings.
- The map's Explore link carries the municipality under the map centre (`#m/<slug>`) only at
  municipality scale (zoom ≥ 9); below that it opens the province overview (plain `index.html`), so the
  province view never sends a reader to whichever municipality happens to sit under the centre.
- The screenshots in §6 predate the last fixes: desktop map shots still show the ⓘ credits button
  rather than the inline credits line.

## 8. Deployment (after sign-off)

**The P0 integrity guards ship with this branch.** `design-2026-09` was cut from
`p0-integrity-guards` (f446fef, the fail-closed link-table gate and the selection token), so merging
the design branch deploys the guards too. The separate P0 checkpoint exists only to deploy the guards
earlier, on their own. It is not needed once this branch is merged.

**Find where `main` is checked out.** Git lets a branch be checked out in only one worktree. The layout
changes over time, so look first:

```sh
git -C ~/projects/western-cape-valuations worktree list
```

At the time of writing, the layout was:

```
~/projects/western-cape-valuations          f446fef [p0-integrity-guards]
~/projects/western-cape-valuations-design   <HEAD>  [design-2026-09]
~/projects/western-cape-valuations-hotfix   23a57b0 [main]
```

so `main` lives in the **hotfix worktree**. Set `MAIN` to whichever directory the listing shows for
`[main]`:

```sh
MAIN=~/projects/western-cape-valuations-hotfix     # the worktree that has [main] in `git worktree list`
```

Alternatively, move `main` back to the production checkout first:

```sh
git -C ~/projects/western-cape-valuations-hotfix checkout --detach
git -C ~/projects/western-cape-valuations checkout main    # needs a clean tree there
MAIN=~/projects/western-cape-valuations
```

**The database move to R2 is not part of this merge.** `main` switches its config URL to R2 with its own
commit (`scripts/rollback_db.sh https://pub-dbe35b2129524bf1965d77e99d6989a6.r2.dev/b-93c01c0b6202/config.json`),
so production reads R2 before the design branch lands; the branch already points at the same URL.
Before the merge, run the mandatory pre-switch check on that URL and confirm `main` reads it:

```sh
(cd "$MAIN" && scripts/preflight_db.sh https://pub-dbe35b2129524bf1965d77e99d6989a6.r2.dev/b-93c01c0b6202/config.json)   # must end in PREFLIGHT OK
grep -c 'r2.dev/b-93c01c0b6202/config.json' "$MAIN"/assets/atlas.js "$MAIN"/assets/map.js           # 1 each
```

(`scripts/preflight_db.sh` arrives on `main` with the merge; before that, run it from the branch
worktree, `~/projects/western-cape-valuations-design/scripts/preflight_db.sh`.) Once both files name the
same R2 URL on both sides, the config-URL lines merge cleanly. `DATA_CONTRACT.md` conflicts at the §7c/§8
boundary: keep `main`'s §7c followed by the branch's §8 (drop `main`'s old §8 heading).

`main` has three commits the branch does not have: the search-DB switch to `b-93c01c0b6202`, the
Matzikama repair export, and DATA_CONTRACT §7c. Today `git merge --no-ff` **stops** on three conflicts,
all on the `?v=` of the `atlas.js`/`map.js` script tags in `index.html`, `map.html` and `plain.html`
(checked on 2026-09-23 with `git merge-tree --write-tree main design-2026-09`). Keep the branch side,
which has the higher numbers. The Supabase `configUrl` change lives in the JS and auto-merges. The
resolve-and-commit lines below apply **only when the merge stops**; if a later `main` no longer
conflicts, the merge commits by itself — skip those lines and go on with the checks and the push.

```sh
git -C "$MAIN" status --short                      # must be empty
git -C "$MAIN" merge --no-ff design-2026-09
# ONLY if the merge stopped: the three script-tag conflicts, in favour of the branch (keep the branch's current `?v=` numbers):
git -C "$MAIN" checkout --theirs index.html map.html plain.html
grep -n 'atlas.js?v=\|map.js?v=' "$MAIN"/index.html "$MAIN"/map.html "$MAIN"/plain.html
grep -c 'r2.dev/b-93c01c0b6202' "$MAIN"/assets/atlas.js "$MAIN"/assets/map.js    # 1 each: the live R2 config URL survived
(cd "$MAIN" && node --test 'tests/*.test.mjs' && node tests/check-i18n.mjs)
git -C "$MAIN" add index.html map.html plain.html && git -C "$MAIN" commit --no-edit   # ONLY if the merge stopped
git -C "$MAIN" push origin main
git -C "$MAIN" log -1 --format=%H                 # the merge SHA, for a rollback
```

Afterwards, in the data repo, set `DEFAULT_SITE` in `extract/geo/simplify_geo.py` (and the
`--site` default in `extract/export_site.py`) to the checkout that holds `main` from now on, and
commit. The merge does not touch the search DB: the R2 bucket and the Supabase rollback copy stay as they are.

## 9. Rollback

Run the revert where `main` is checked out (`git worktree list`, as above):

```sh
MAIN=~/projects/western-cape-valuations-hotfix     # or wherever [main] is listed
git -C "$MAIN" status --short                      # must be empty
git -C "$MAIN" revert -m 1 <merge-sha>
git -C "$MAIN" push origin main
```

The revert also takes out the P0 integrity guards that came with the merge (see §8). Git treats the
reverted branch as already merged, so merging `p0-integrity-guards` again does nothing. To keep the
guards, cherry-pick their commit back after the revert, run the tests, and push:
`git -C "$MAIN" cherry-pick f446fef`.

**Front end:** reverting the merge commit (above) restores the previous front end. It keeps reading
whatever config URL `main` held before the merge, which is the R2 URL once `main` has switched.

**Database:** the merge does not change the data. To move the site off R2, point it at the Supabase copy
of the same build while that copy exists and Supabase serves it again (HTTP 200, not 402):

```sh
(cd "$MAIN" && scripts/preflight_db.sh https://nxeasppmwvzcqbbgrdvf.supabase.co/storage/v1/object/public/valuations/b-93c01c0b6202/config.json)
(cd "$MAIN" && scripts/rollback_db.sh https://nxeasppmwvzcqbbgrdvf.supabase.co/storage/v1/object/public/valuations/b-93c01c0b6202/config.json)
```

`rollback_db.sh` rewrites the config URL in both JS files, bumps the `?v=` on the pages, commits and
pushes. Back to R2 is the same command with the R2 config URL.
