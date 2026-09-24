# Performance: before and after the design refresh

Status: **measured.** The after runs are in the data repo at `.playwright-mcp/perf/after-notes.jsonl`: the ten
scenarios on the gzip server plus one "first-usable" run. The baseline is `baseline-notes.jsonl` in the same folder.

## Method

- **Same scenarios as the baseline.** The nine baseline runs plus the AF-labels check. The sources are in
  `tests/browser/perf-<name>.js`: byte copies of the data repo's `.playwright-mcp/scen/<name>.js` with only the
  base URL changed, from `https://calerio.github.io/western-cape-valuations/` to `http://127.0.0.1:8766/`
  (the design worktree). `map.html` and `plain.html` are still addressed by name; both still exist as thin
  shells over the one map page.
- **Cold contexts.** Each cold run gets a fresh browser context, so the HTTP cache is empty. A warm run reuses
  the previous context.
- **Engine and machine.** Playwright, WebKit 26.6, on this Mac over a fast
  home link.
- **Limitations (copied from the audit, 00-audit.md §4).** WebKit exposes navigation timing, resource timing
  and FCP, but **not LCP, CLS or long tasks**. It offers no CPU or network throttling, so "mobile" means a
  390×844 @3× iPhone context on the same fast link. Warm runs reuse the context's HTTP cache, but WebKit still
  reports full byte counts for them. Lighthouse was not run because it needs Chrome.
  LCP comes from WebKit's `largest-contentful-paint` entries where the engine reported them. Treat it as a
  rough guide only.
- **Server.** The baseline was measured against GitHub Pages (gzip, CDN). The after runs hit a
  gzip-enabled local server on the same worktree (`http://127.0.0.1:8768/`, gzip level 6), so transferred
  totals are comparable with the baseline. Pages' compressor may differ slightly from gzip -6.
  The scenario sources name port 8766; for the after run they were pointed at 8768.
- **Whole-run totals versus first usable.** The per-scenario "transferred" figure counts every request up to
  the end of the run: 3 s of settling, plus the click where the scenario makes one. The idle-time DB
  pre-warm (1.2–1.7 MB) and the after-click reads therefore land in those totals even though they now
  start after first paint. The spec's "transferred at first usable / style ready" targets use the separate
  **first-usable** run. It counts the bytes of requests started before the ready instant: the Explore
  loader gone, or `isStyleLoaded()` on the map.
  Same-origin latency is lower on localhost; third-party requests (jsDelivr, Supabase, OpenFreeMap, Esri,
  SG cadastre) take the same network path in both runs.

## Targets (spec 03-design-plan.md §8)

| Metric (cold, fast link) | Baseline | Target |
|---|---|---|
| Explore transferred at first usable | 2.6 MB | ≤ 0.9 MB (DB deferred, geo simplified, fonts ≤ 120 KB) |
| Explore first usable (desktop) | 0.68 s | ≤ 0.6 s; province stats visible without a click |
| Map transferred at style ready | 4.9 MB | ≤ 2.4 MB (DB deferred, Natural-Earth raster removed at low zoom or kept at half the tiles, GeoJSON simplified) |
| Satellite imagery | loaded at boot | only when Satellite is chosen |
| Click → panel | 0.32–0.65 s | unchanged or better |
| Basemap switch | page reload (≥ 1 s) | ≤ 150 ms, no reload |
| Language switch | page reload | ≤ 300 ms, no reload |
| Console | 2 sql.js warnings + sprite warnings | no errors; warnings from our code = 0 |

## Before / after

Baseline values come from `.playwright-mcp/perf/baseline-notes.jsonl` (data repo). The one exception is
Map (plain) mobile cold, which has no line in that file; its values come from the audit table (00-audit.md
§4) and it had no byte counts. "Usable" means the Explore loader has gone, or the map style has loaded
(`isStyleLoaded()`). "—" means the scenario does not measure that metric.

| Scenario | | transferred (whole run) | requests | load | usable | FCP | parcels interactive | click → panel | basemap switch | language switch |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Explore desktop cold | before | 2.59 MB | 35 | 0.41 s | 0.68 s | 0.35 s | — | — | — | page reload |
| | after | 2.04 MB | 41 | 0.18 s | 0.26 s | 0.12 s | — | — | — | not measured |
| Explore desktop warm | before | 2.59 MB | 35 | 0.05 s | 0.34 s | 0.02 s | — | — | — | page reload |
| | after | 1.99 MB | 39 | 0.03 s | 0.09 s | 0.02 s | — | — | — | not measured |
| Explore mobile cold | before | 2.59 MB | 35 | 0.19 s | 0.29 s | 0.17 s | — | — | — | page reload |
| | after | 2.04 MB | 41 | 0.14 s | 0.21 s | 0.13 s | — | — | — | not measured |
| Explore mobile warm | before | 2.59 MB | 35 | 0.03 s | 0.15 s | 0.02 s | — | — | — | page reload |
| | after | 1.99 MB | 39 | 0.03 s | 0.07 s | 0.02 s | — | — | — | not measured |
| Satellite (map.html) desktop cold | before | 4.32 MB | 104 | 0.64 s | 3.34 s | 0.40 s | 1.09 s | 0.57 s | page reload (≥ 1 s) | page reload |
| | after | 4.74 MB | 129 | 0.14 s | 0.79 s | 0.15 s | 1.43 s | 0.60 s | no reload | no reload |
| Satellite (map.html) desktop warm | before | 4.32 MB | 104 | 0.11 s | 0.22 s | 0.05 s | 1.01 s | 0.32 s | page reload | page reload |
| | after | 4.71 MB | 128 | 0.10 s | 1.17 s | 0.02 s | 0.93 s | 0.33 s | no reload | no reload |
| Satellite (map.html) mobile cold | before | 3.74 MB | 65 | 0.37 s | 0.38 s | 0.32 s | 0.95 s | 0.65 s | page reload | page reload |
| | after | 4.46 MB | 97 | 0.14 s | 0.57 s | 0.14 s | 1.30 s | 0.37 s | no reload | no reload |
| Map (plain.html) desktop cold | before | 4.86 MB | 67 | 0.57 s | 1.12 s | 0.38 s | 1.41 s | 0.58 s | page reload (≥ 1 s) | page reload |
| | after | 4.59 MB | 76 | 0.12 s | 0.52 s | 0.12 s | 1.00 s | 0.40 s | no reload | no reload |
| Map (plain.html) mobile cold | before | n/a | n/a | 0.40 s | 0.75 s | 0.29 s | — | — | page reload | page reload |
| | after | 4.45 MB | 70 | 0.13 s | 0.45 s | 0.12 s | — | — | no reload | no reload |

"No reload" comes from the `test-basemap-switch` and `test-lang-switch` browser tests, which both passed: the switch happens in place on a single MapLibre instance. No millisecond figure was
measured for either switch. The language test covers the map page; the Explore page's switch was not
timed.

**First-usable run (bytes of requests started before the ready instant):**

| page | ready | transferred before ready | requests | by host | first DB request |
|---|---:|---:|---:|---|---:|
| `index.html` (Explore) | 0.27 s | **298 KB** | 21 | local 207 KB, jsDelivr 90 KB | 1.87 s (no DB bytes before ready) |
| `map.html` (Satellite entry) | 0.61 s | **1.95 MB** | 74 | local 350 KB, jsDelivr 280 KB, OpenFreeMap 426 KB, sql.js worker blob 478 KB, Esri 412 KB (35 tiles) | 2.47 s (none before ready) |
| `plain.html` (Map entry) | 0.55 s | **2.23 MB** | 45 | local 350 KB, jsDelivr 280 KB, OpenFreeMap 1117 KB, sql.js worker blob 478 KB | 2.42 s (none before ready) |

The sql.js worker (478 KB) is created from a same-origin blob URL. Playwright counts it, but it is not a
network transfer, so the map figures are conservative.

**Regressions and why.**
- **Whole-run totals on the satellite entry grew** (4.32 → 4.74 MB desktop, 3.74 → 4.46 MB mobile). The
  unified page now also loads the Liberty vector tiles for labels and roads over the imagery (+577 KB,
  14 tiles on desktop); see "Costs accepted / deferred".
- **Satellite warm "usable" went from 0.22 s to 1.17 s.** The baseline satellite page had an inline
  raster-only style. The unified page fetches and transforms the Liberty style before `isStyleLoaded()`.
- **Parcels interactive on the satellite entry went from 1.09/0.95 s to 1.43/1.30 s.** Parcels come live
  from the SG cadastre, and on the satellite entry that request now shares the link with the vector tiles.
  On `plain.html` it improved (1.41 → 1.00 s). Treat single-run figures of about ±0.3 s as noise on this
  link.

Baseline detail for the metrics the targets name:

- **Explore cold.** 17 of the 35 requests (1219 KB) were the search DB, and the DB pre-warm ran during
  boot. The three boot GeoJSON files were 601 KB gzipped, wasm 502 KB, d3 90 KB, Google Fonts 66 KB.
- **Satellite desktop cold.** 59 Esri imagery tiles (836 KB), which is expected on the satellite shell.
  26 DB requests (1679 KB), MapLibre 271 KB, wards GeoJSON 253 KB and municipalities GeoJSON 206 KB
  (both gzipped).
- **Plain desktop cold.** 22 OpenFreeMap requests (1378 KB), the Natural Earth raster at 656 KB,
  26 DB requests (1679 KB).
- **Click → panel.** Every cold map run made 9 DB requests (460 KB) after the click.

## Evaluation against the spec §8 targets

| Target | Result | Verdict |
|---|---|---|
| Explore transferred at first usable ≤ 0.9 MB | **298 KB** (baseline 2.6 MB); no DB byte before ready, first DB request at 1.87 s | **met** |
| Explore first usable (desktop) ≤ 0.6 s; province stats visible without a click | **0.26 s** (baseline 0.68 s). The page lands on the province: `navigate()` with no hash renders the Western Cape headline and the four KPI figures in the same task that hides the loader, so the stats are visible with no click (`test-explore` passed). | **met** |
| Map transferred at style ready ≤ 2.4 MB | **1.95 MB** on `map.html` (Satellite entry), **2.23 MB** on `plain.html` (baseline 4.9 MB); no DB bytes before ready | **met** (the plain page's margin is small; see the Natural Earth raster below) |
| Satellite imagery only when Satellite is chosen | `plain.html`: **0 Esri requests** before ready (`esriBefore 0`), and `test-basemap-switch` saw no imagery request until Satellite was chosen. `map.html` is the Satellite entry point, so its 35 Esri tiles at boot are by design. | **met** |
| Click → panel unchanged or better | **0.33–0.60 s** (baseline 0.32–0.65 s); still 9 DB requests / 460 KB after the click | **met** |
| Basemap switch ≤ 150 ms, no reload | No reload, single MapLibre instance (`test-basemap-switch` passed). Not timed. | **met** for "no reload"; the 150 ms figure was not measured |
| Language switch ≤ 300 ms, no reload | No reload, single MapLibre instance (`test-lang-switch` passed). Not timed. | **met** for "no reload"; the 300 ms figure was not measured |
| Console: no errors; warnings from our code = 0 | **0 JS errors** in every run. Warnings that remain are all third-party: two sql.js-httpvfs warnings ("Accept-Ranges", chunk size ≠ page size) on every page that opens the DB; MapLibre missing-sprite-image warnings on the map pages (8–9, also in the baseline); and MapLibre "Expected value to be of type number, but found null instead." (1× `map.html`, 2× `plain.html`), which comes from the OpenFreeMap Liberty style (see below) | **met** |

### The "Expected value to be of type number, but found null instead." warning: upstream

- **What it is.** MapLibre logs this when an expression compares a feature property that is missing
  (`null`) against a number.
- **Where it comes from.** The OpenFreeMap Liberty style does exactly that in its own filters and paint.
  Its filters include `[">=", ["get", "rank"], …]` (`poi_r1`, `poi_r7`, `poi_r20`, `label_country_3`),
  `[">=", ["get", "admin_level"], 3]` (`boundary_3`) and `["<=", ["get", "ref_length"], 6]` (the highway
  shields), and `building-3d` uses `["get", "render_height"]` / `["get", "render_min_height"]`. Any tile
  feature without those properties triggers the warning.
- **Our code is not the source.**
  - No layer of ours reads a numeric property. Our expressions are:
    - `['get', 'PRCL_KEY']` (string equality);
    - `['get', 'class']` (string, in `NOT_PARKING` and the rename overrides);
    - `['get', 'ward']` inside `concat`;
    - `['get', 'name:af']`;
    - feature-state booleans and zoom interpolations.
  - The `wcv_paint` restore in `applyBasemap` passes `undefined` (which resets a property to the style
    default), never `null`. `transformStyle` deletes paint keys whose saved value is null instead of
    setting them. In any case, the perf scenarios never switch basemap.
- **Proof that it is upstream.** The same warning is in the **baseline** (`plain-desktop-cold`: "2x
  'Expected value to be of type number, but found null'"). At that time the production `plain.html`
  handed the **untransformed** Liberty URL straight to MapLibre (`style: PLAIN_STYLE`, production
  `assets/map.js` line 75).
- **Why it looks new on `map.html`.** The old satellite page used an inline raster style with no Liberty
  layers, and the unified page now loads Liberty on both entries.
- **Verdict.** Documented as upstream and left alone. Removing it would mean rewriting the third-party
  style's filters.

## Costs accepted / deferred

- **(a) Liberty vector tiles on the satellite entry.** `map.html` now also loads the Liberty vector tiles,
  so labels and roads can sit over the imagery: +577 KB, 14 tiles on desktop cold. This follows from the
  unified page (one MapLibre instance, in-place basemap switch) and is accepted. It is the main reason the
  satellite page's whole-run total grew. Its style-ready total (1.95 MB) is still under the 2.4 MB target.
- **(b) Natural Earth low-zoom raster on `plain.html`.** Unchanged: 656 KB on desktop and about 960 KB
  on mobile @3×. Spec §8 suggested dropping it at low zoom or halving its tiles, but that was left out of
  this refresh and is **deferred**. It is most of the reason `plain.html` sits at
  2.23 MB against the 2.4 MB target.
- **(c) `muniAt()` reads the unsimplified municipalities file.** `wc-municipalities-full.geojson` is
  201 KB gzipped, the same bytes the map page fetched before. It is accepted because the Integrity rule
  outranks bytes (DATA_CONTRACT §9, §11).

## What changed

1. **d3 is deferred, pinned and SRI-checked.** `index.html` loads
   `https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js` with `defer`,
   `integrity="sha384-CjloA8y00+1SDAUkjs099PVfnY2KmDC2BZnws9kh8D/lX1s46w6EPhpXdqMfjK6i"` and
   `crossorigin="anonymous"`. It used to be an unpinned, render-blocking `d3@7`. `atlas.js` boots on
   `DOMContentLoaded`, or at once if the document has already finished parsing. MapLibre on the map shells
   was already pinned, deferred and SRI-checked; it is unchanged.
2. **Search-DB pre-warm runs when the browser is idle.**
   - Atlas: `requestIdleCallback(…, { timeout: 4000 })`, with a 1.5 s `setTimeout` fallback where
     `requestIdleCallback` is missing (WebKit). The first `#search` focus also starts it.
   - Map: the same idle call, but only after `map.once('idle')`.
   - The warm-up queries in `ensureDB()` are unchanged. A click or search that comes first awaits
     `ensureDB()` itself.
   - **Measured effect:** no DB byte is requested before ready. The first DB request comes at 1.87 s on
     Explore and about 2.4 s on the map pages. Because the WebKit fallback fires at 1.5 s, a run that
     settles for 3 s still records the DB bytes in its whole-run total.
3. **Boundary GeoJSON is simplified.** `extract/geo/simplify_geo.py` (data repo) simplifies each feature with
   `shapely.simplify(preserve_topology=True)` and writes coordinates to 4 dp. Properties and feature order
   are kept verbatim. The largest per-municipality area drift is 0.195 %.
   - `za-provinces` is replaced by `za-outline`: South Africa (mainland) and the Western Cape, each
     dissolved into one shape. Internal borders between provinces disappear; the Atlas never stroked them.
   - The map page's municipality gate (Integrity rule) still reads the unsimplified borders, from
     `wc-municipalities-full.geojson`.
4. **Preconnect.** Supabase storage (`nxeasppmwvzcqbbgrdvf.supabase.co`) is preconnected on all three pages,
   and `tiles.openfreemap.org` on `map.html` and `plain.html`. Both carry `crossorigin` because both are
   fetched with CORS.
5. **Parcels are not refetched when the data already covers the view.** The map skips the SG cadastre
   request when a pan or zoom stays inside the bbox of the last successful, non-truncated fetch, at the
   same or a higher zoom (`assets/map/bbox.js`, unit-tested). Any error, truncation, or zoom-out below
   parcel zoom clears the stored bbox.
6. **Satellite imagery.** No change. `assets/map/style.js` already adds the Esri raster with
   `visibility: 'none'` in map mode. Confirmed by measurement: the cold `plain.html` run requested
   nothing from `server.arcgisonline.com` before ready, and `test-basemap-switch` saw no imagery request
   until Satellite was chosen.

### Asset sizes measured locally (bytes; gzip -6 approximates what GitHub Pages sends)

| file | before raw | before gzip | after raw | after gzip | loaded by |
|---|---:|---:|---:|---:|---|
| `za-provinces.geojson` → `za-outline.geojson` | 801,916 | 245,240 | 28,198 | 9,408 | Explore boot |
| `wc-districts.geojson` | 531,072 | 150,390 | 49,991 | 14,507 | Explore boot |
| `wc-municipalities.geojson` | 703,958 | 205,812 | 88,918 | 25,439 | Explore boot, place highlight |
| `wc-wards.geojson` | 972,656 | 257,606 | 224,425 | 50,739 | Explore drill, map ward layer |
| `wc-municipalities-full.geojson` (new, = old munis) | — | — | 703,958 | 205,843 | map muni gate |
| **Explore boot GeoJSON (3 files)** | **2,036,946** | **601,442** | **167,107** | **49,354** | |
| **Map boot GeoJSON (munis + wards)** | **1,676,614** | **463,418** | **928,383** | **256,582** | |

- **Size budgets.** `wc-districts` (60 KB) and `wc-municipalities` (90 KB) fit at tolerance 0.002°.
  The outline uses fixed per-feature tolerances: the "South Africa" backdrop at 0.02° (a fill and a 96 px
  locator) and the "Western Cape" feature at 0.004° (it is stroked and cuts the backdrop at every Atlas
  zoom; at 0.02° the coast showed straight ~2 km segments at municipality zoom). That gives 28.2 KB, so the
  achieved size is recorded as its budget (28 KB) instead of the 12 KB target.
  `wc-wards` stays at 0.004° so wards still read at municipality scale, and its budget is revised to
  230 KB. Wards load only on a municipality drill (Explore) or with the map's ward layer, **never at
  Explore first usable**, so they do not count against the Explore first-usable target.
- **Fonts.** `assets/fonts/*.woff2` total **85,144 bytes** (83 KB, within the 120 KB limit). These are
  now self-hosted. The baseline loaded 66 KB from Google Fonts.
- **d3 7.9.0.** 279,706 bytes raw, about 92.7 KB gzipped (baseline 90 KB). The size is the same; only when
  it loads has changed.
