# Performance: before and after the design refresh (Task 12)

Status: the after column is **pending**. The controller runs the scenarios and fills it in.

## Method

- **Same scenarios as the baseline.** The nine baseline runs plus the AF-labels check. The sources are in
  `tests/browser/perf-<name>.js`: byte copies of the data repo's `.playwright-mcp/scen/<name>.js` with only the
  base URL changed, from `https://calerio.github.io/western-cape-valuations/` to `http://127.0.0.1:8766/`
  (the design worktree). `map.html` and `plain.html` are still addressed by name; both still exist as thin
  shells over the one map page.
- **Cold contexts.** Each cold run gets a fresh browser context, so the HTTP cache is empty. A warm run reuses
  the previous context.
- **Engine and machine.** Playwright MCP, WebKit 26.6, on this Mac (8 GB RAM, usually swapping) over a fast
  home link.
- **Limitations (copied from the audit, 00-audit.md §4).** WebKit exposes navigation timing, resource timing
  and FCP, but **not LCP, CLS or long tasks**. It offers no CPU or network throttling, so "mobile" means a
  390×844 @3× iPhone context on the same fast link. Warm runs reuse the context's HTTP cache, but WebKit still
  reports full byte counts for them. Lighthouse was not run because it needs Chrome.
  LCP comes from WebKit's `largest-contentful-paint` entries where the engine reported them. Treat it as a
  rough guide only.
- **Extra limitation for this comparison.** The baseline was measured against GitHub Pages, which serves
  gzip over HTTP/2 from a CDN. The after runs hit the worktree's local `python -m http.server`
  (SimpleHTTP, HTTP/1.0, **no compression**, no CDN). So:
  - **Same-origin transferred KB are not directly comparable.** Local bytes are raw and Pages bytes were
    gzipped. The "What changed" table below gives raw and gzip -6 sizes for the files this task changed,
    so the Pages-equivalent saving can be read off it.
  - **Same-origin times favour localhost.** Third-party requests (jsDelivr, Supabase, OpenFreeMap, Esri,
    SG cadastre) take the same network path in both runs.
  - A final confirmation run against Pages after the branch ships is the clean comparison.

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

| Scenario | | transferred KB | requests | load | usable | FCP | parcels interactive | click → panel | basemap switch | language switch |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Explore desktop cold | before | 2586 | 35 | 407 ms | 680 ms | 351 ms | — | — | — | page reload |
| | after | pending | pending | pending | pending | pending | — | — | — | pending |
| Explore desktop warm | before | 2588 | 35 | 47 ms | 339 ms | 22 ms | — | — | — | page reload |
| | after | pending | pending | pending | pending | pending | — | — | — | pending |
| Explore mobile cold | before | 2585 | 35 | 186 ms | 293 ms | 166 ms | — | — | — | page reload |
| | after | pending | pending | pending | pending | pending | — | — | — | pending |
| Explore mobile warm | before | 2588 | 35 | 32 ms | 150 ms | 24 ms | — | — | — | page reload |
| | after | pending | pending | pending | pending | pending | — | — | — | pending |
| Satellite (map.html) desktop cold | before | 4318 | 104 | 635 ms | 3342 ms | 402 ms | 1089 ms | 568 ms | page reload (≥ 1 s) | page reload |
| | after | pending | pending | pending | pending | pending | pending | pending | pending | pending |
| Satellite (map.html) desktop warm | before | 4321 | 104 | 109 ms | 218 ms | 53 ms | 1006 ms | 316 ms | page reload | page reload |
| | after | pending | pending | pending | pending | pending | pending | pending | pending | pending |
| Satellite (map.html) mobile cold | before | 3744 | 65 | 365 ms | 379 ms | 318 ms | 950 ms | 653 ms | page reload | page reload |
| | after | pending | pending | pending | pending | pending | pending | pending | pending | pending |
| Map (plain.html) desktop cold | before | 4860 | 67 | 573 ms | 1121 ms | 378 ms | 1410 ms | 580 ms | page reload (≥ 1 s) | page reload |
| | after | pending | pending | pending | pending | pending | pending | pending | pending | pending |
| Map (plain.html) mobile cold | before | n/a | n/a | 400 ms | 750 ms | 290 ms | — | — | page reload | page reload |
| | after | pending | pending | pending | pending | pending | — | — | pending | pending |

Baseline detail for the metrics the targets name:

- **Explore cold.** 17 of the 35 requests (1219 KB) were the search DB, and the DB pre-warm ran during
  boot. The three boot GeoJSON files were 601 KB gzipped, wasm 502 KB, d3 90 KB, Google Fonts 66 KB.
- **Satellite desktop cold.** 59 Esri imagery tiles (836 KB), which is expected on the satellite shell.
  26 DB requests (1679 KB), MapLibre 271 KB, wards GeoJSON 253 KB and municipalities GeoJSON 206 KB
  (both gzipped).
- **Plain desktop cold.** 22 OpenFreeMap requests (1378 KB), the Natural Earth raster at 656 KB,
  26 DB requests (1679 KB).
- **Click → panel.** Every cold map run made 9 DB requests (460 KB) after the click.

Evaluation per target: pending.

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
   - **Expected effect:** the DB bytes (1.2 MB on Explore, 1.7 MB on the map) move after "usable". A cold run
     that settles for 3 s still records them in its total, because the fallback fires at 1.5 s in WebKit.
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
   `visibility: 'none'` in map mode. The cold plain-map run should show no `server.arcgisonline.com`
   request; this is pending confirmation.

### Asset sizes measured locally (bytes; gzip -6 approximates what GitHub Pages sends)

| file | before raw | before gzip | after raw | after gzip | loaded by |
|---|---:|---:|---:|---:|---|
| `za-provinces.geojson` → `za-outline.geojson` | 801,916 | 245,240 | 61,162 | 20,386 | Explore boot |
| `wc-districts.geojson` | 531,072 | 150,390 | 49,991 | 14,507 | Explore boot |
| `wc-municipalities.geojson` | 703,958 | 205,812 | 88,918 | 25,439 | Explore boot, place highlight |
| `wc-wards.geojson` | 972,656 | 257,606 | 224,425 | 50,739 | Explore drill, map ward layer |
| `wc-municipalities-full.geojson` (new, = old munis) | — | — | 703,958 | 205,843 | map muni gate |
| **Explore boot GeoJSON (3 files)** | **2,036,946** | **601,442** | **200,071** | **60,332** | |
| **Map boot GeoJSON (munis + wards)** | **1,676,614** | **463,418** | **928,383** | **256,582** | |

- **Size budgets.** `wc-districts` (60 KB) and `wc-municipalities` (90 KB) fit at tolerance 0.002°.
  `za-outline` (budget 12 KB) and `wc-wards` (budget 120 KB) are still over budget at the largest allowed
  tolerance, 0.004°. The outline is 61 KB because the coastline stays detailed at 0.004°; it would reach
  about 17 KB at 0.02°. The wards file would need about 0.02° to reach 120 KB. On Pages, the outline
  gzips to 20 KB and the wards to 51 KB.
- **Fonts.** `assets/fonts/*.woff2` total **85,144 bytes** (83 KB, within the 120 KB limit). These are
  self-hosted since Task 7. The baseline loaded 66 KB from Google Fonts.
- **d3 7.9.0.** 279,706 bytes raw, about 92.7 KB gzipped (baseline 90 KB). The size is the same; only when
  it loads has changed.
