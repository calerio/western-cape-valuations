# Design & performance refresh — audit (2026-09-23)

**Production baseline: immutable valuation build `b-2b502178f94f` (build D) — current and untouched.**
The live site (commit `9d9302a`, `map.js?v=34`, `atlas.js?v=36`) reads it; the project brief's
`b-9dadc03c7f1f` is the previous build C, kept as a rollback target. Neither build, the linker, the Supabase
namespaces nor any disposition semantics are touched by this project.

Work is isolated on the website-repo branch `design-2026-09`. GitHub Pages deploys `main` only.

Sources: read-only code audit (`audit-code.md`, 12 sections with file:line references), data audit
(`audit-data.md`), OpenFreeMap style + decoded vector tiles, and live measurements through the Playwright
(WebKit 26.6, the only browser used).

---

## 1. What works and stays

- The three-view model (Explore / Map / Satellite) and the EN/AF toggle are understood by users and by the
  smoke tests; the view names stay.
- The fail-closed build-integrity chain (config → manifest → `build_id` in the DB), link-table-first lookup,
  the muniAt gate, and the wording rules per disposition (DATA_CONTRACT §8b, §9) are correct and untouched.
- The click path is fast once parcels are loaded: **0.32–0.65 s click-to-panel** across all runs, 9 range
  requests (~460 KB) per click.
- The parcel layer (SG cadastre, `WSTATUS='C'` only), place search and the province → district → municipality
  drill in Explore are solid foundations.
- The Apple-style token system (`tokens.css`) is a reasonable base: colour, radius and shadow tokens exist and
  the light/dark map pins already work.

## 2. Visual and information-architecture findings

### Explore (index.html)
- **Empty landing state.** Level 0 is a grey South Africa outline and the sentence "Select the Western Cape on
  the map to begin". Every visitor must click once before seeing a single number. On desktop 60% of the
  viewport is empty; on mobile the choropleth sits above a bottom sheet that hides all statistics until dragged.
- **Statistics are a KPI grid plus a scroll of sections** (`#statTiles` alone holds 11 tiles: middle-50%,
  average ÷ median, σ, Gini, top-1% share, per-m², erf size, dwelling size, per floor m², vacant share).
  Dense and honest, but presented as identical tiles with no hierarchy or narrative, no comparison between
  municipalities, and no explanation of valuation dates per municipality.
- **Desktop hover tooltip is broken** (TypeError on every mousemove since 2026-07-16; `atlas.js:412-425`).
- **Mobile header truncates the title** to "S… W." beside the view switcher (see `perf/explore-mobile-cold-drill-full.png`).
- Money formatting differs between views (Explore `R1.2bn`/`R850k`, map `R1.25 m`/`R850 000`).
- A hard-coded "2024 / 25" appears in the property dialog regardless of municipality (`atlas.js:15`).

### Map (plain.html, OpenFreeMap Liberty)
- At parcel zoom the Liberty style is dense (every shop, parking icon, POI label); parcel outlines are drawn as
  dark lines over buildings and compete with the basemap. Ward labels ("WARD 9") repeat every few hundred
  metres in bold brown.
- Selection is a blue fill + blue outline; verified and unverified results look identical on the map.
- Console: 8× "Image … could not be loaded" (sprite icons missing for some POI classes) and 2× "Expected value
  to be of type number, but found null".
- Grammar: "Erf 1942 — 1 valuations".

### Satellite (map.html, Esri World Imagery)
- Imagery only: no street names, no place labels, no roads, so orientation depends on the parcel lines and
  repeated yellow "WARD n" labels. The satellite style declares no glyphs; ward labels render in MapLibre's
  local fallback font.
- The dark translucent panel (`backdrop-filter` over imagery) makes 11–12 px explanatory text hard to read.
- **Mobile: the attribution bar shows through the translucent bottom panel**, overlapping the explanatory note
  (`perf/map-mobile-cold-panel.png`). Controls (view switcher, brand, search, wards chip, zoom) occupy ~45% of
  the mobile viewport before any map is visible.
- map.html and plain.html are two hand-maintained near-copies (10 differing hunks); switching Map ↔ Satellite is
  a full page load and a second MapLibre instance.

### Result panel (all dispositions)
- Status is carried only by wording and the size of the number; there is no badge, colour, or icon that
  distinguishes *verified* from *possible match* / *unverified* / *could not link* at a glance.
- Raw linker codes are printed to the public ("Evidence: TOWN_A · CONTRA_GROUPS:1 · AREA_OK", "TOWN_SPAN",
  "AREA_CONFLICT"), untranslated.
- Data artefacts leak ("VOORTREKKER STREET #NAME?").
- Unverified lists render the kicker/title twice and the overlap chooser twice (`map.js:591-604`).
- Loading, error and empty states exist ("Looking up valuation…", "Erf boundaries unavailable right now",
  `#mapfail` for a missing CDN script) but a WebGL failure shows nothing, and the panel is not announced to
  screen readers.

### Navigation between views
- Explore → Map loses the drilled municipality; Map → Explore loses the selected place and `?db=`; only
  Map ↔ Satellite carries the `#p/…` hash. Camera position and selected parcel are never in the URL.

### Language (EN/AF)
- Catalogue is complete for JS/HTML strings; toggling reloads the SPA pages; static pages redirect to `/af/`.
  Untranslated literals: "Erf", "Ward", map ward labels, most aria-labels, "Top 10/20/30", the second line of
  `#mapfail`.
- **Basemap labels are never localised.** With `wcv-lang=af` the UI reads "Wes-Kaap / Wyke / Soek 'n dorp"
  but the map still says "Mossel Bay", "Beaufort West", "Cape Town".

### Accessibility
- Explore's map cannot be used by keyboard although level 0 requires a map click.
- Map pages have no h1/landmarks/skip link; the panel does not receive focus; the language toggle is
  `<a href="#">`; reduced-motion does not stop MapLibre fly-to; contrast of `--label2` text on translucent
  platters over imagery is below 4.5:1 in places.

## 3. Bugs found by the code audit (must be decided, not silently fixed)

| # | Severity | Finding |
|---|---|---|
| B1 | High, integrity | `hasLinkTable()` swallows any error (even a transient network failure) and caches `false` for the session → every later click uses the legacy heuristic. DATA_CONTRACT §9 forbids that. `map.js:548-557`. |
| B2 | High, integrity | No request token in `showValuation`/`pickParcel`: a slow result for parcel A can overwrite the panel while parcel B is highlighted. `map.js:366-373, 891-957`. |
| B3 | High, UX | Explore hover tooltip throws on every mousemove (`const t = $("tip")` shadows `t()`). `atlas.js:412-425`. |
| B4 | Medium | Hard-coded "2024 / 25" year in the Explore property dialog. `atlas.js:15, 1115`. |
| B5 | Medium | Duplicate kicker/title and duplicate overlap chooser in unverified lists. `map.js:591-604`. |
| B6 | Medium | Raw evidence codes shown to the public, untranslated. `map.js:620`. |
| B7 | Low | `#mapfail` only covers a missing CDN script, not a WebGL failure; second line untranslated. |
| B8 | Low | Smoke matrix reads `#hint` but the element is `#maphint` (loading guard is a no-op). |
| B9 | Verify | Satellite ward labels rely on MapLibre's local font fallback (no glyphs URL). They do render (seen in screenshots). |
| B10 | Low | `rates.js` has a latent default `residential_reduction || 15000` contrary to §10. |

B1 and B2 are front-end lookup bugs, not linker changes; fixing them *strengthens* the safe-abstention
contract. They are listed as decisions for the owner.

## 4. Technical / performance findings

### Asset loading (per page, cold, measured)
| | Explore | Map (plain) | Satellite |
|---|---|---|---|
| Requests | 35 | 67 | 104 |
| Total transferred | 2.59 MB | 4.86 MB | 4.32 MB |
| Search-DB range requests at load (before any click/search) | 17 · 1.22 MB | 17 · 1.22 MB | 17 · 1.22 MB |
| Vendor JS | d3 90 KB | maplibre 271 KB | maplibre 271 KB |
| sql.js wasm + worker blob | 502 + 478 KB | 502 + 478 KB | 502 + 478 KB |
| GeoJSON | provinces 244 + districts 151 + munis 206 KB | munis 206 + wards 253 KB | munis 206 + wards 253 KB |
| Basemap | — | OpenFreeMap 22 req · 1.38 MB (4 Natural-Earth PNGs = 656 KB at province zoom) | Esri 59 tiles · 836 KB |
| Fonts | Inter 2 files · 66 KB | none (system) | none (system) |

- d3 (Explore) and maplibre-gl (map pages) are **synchronous scripts in `<head>`** on unpinned major versions,
  without integrity hashes.
- All three pages start the search-DB worker immediately (the "pre-warm" of DATA_CONTRACT §11): 1.24 MB of
  wasm/worker plus 17 range reads compete with first paint. §11 requires the pre-warm, not its timing.
- Explore shows a full-screen loader until 601 KB of GeoJSON is downloaded and planarized on the main thread.
- Map pages fetch munis + wards GeoJSON (459 KB) on load and clone them to the MapLibre worker.
- Every `moveend` at z ≥ 15.5 refetches the full viewport of parcels from ArcGIS and replaces the source.
- Several `backdrop-filter: blur(20px)` platters sit over a WebGL canvas that repaints on every pan frame.
- Cache-busting is `?v=N` by hand; `rollback_db.sh` depends on that pattern.
- `plain.html` duplicates `map.html`; the view-switcher CSS is copied four times; tokens have no spacing or
  type-scale, no `rem`, and the dark block is duplicated.

### Baseline timings (Playwright, WebKit 26.6, fast home link, this Mac)
Limitations: WebKit exposes navigation/resource timing and FCP but **not LCP, CLS or long tasks**, and offers no
CPU/network throttling; "mobile" is a 390×844 @3× iPhone context on the same link. Warm runs reuse the
context's HTTP cache (WebKit still reports full byte counts). Lighthouse was not run (it needs Chrome).

| Scenario | load | usable | FCP | LCP* | parcels interactive | click → panel |
|---|---|---|---|---|---|---|
| Explore desktop cold | 0.41 s | 0.68 s (loader gone); KPIs 52 ms after province click | 0.35 s | 0.81 s | — | — |
| Explore desktop warm | 0.05 s | 0.34 s | 0.02 s | 0.46 s | — | — |
| Explore mobile cold | 0.19 s | 0.29 s | 0.17 s | 0.22 s | — | — |
| Map (plain) desktop cold | 0.57 s | style 1.12 s | 0.38 s | 0.90 s | 1.41 s after zoom-in | 0.58 s |
| Satellite desktop cold | 0.64 s | style 3.34 s | 0.40 s | 0.94 s | 1.09 s | 0.57 s |
| Satellite desktop warm | 0.11 s | style 0.22 s | 0.05 s | 0.62 s | 1.01 s | 0.32 s |
| Satellite mobile cold | 0.37 s | style 0.38 s | 0.32 s | 0.45 s | 0.95 s | 0.65 s |
| Map (plain) mobile cold | 0.40 s | style 0.75 s | 0.29 s | 0.52 s | — | — |

*LCP from WebKit's `largest-contentful-paint` entries where reported by the engine (it was reported in these
runs); treat as indicative only. Console on every page: sql.js "Accept-Ranges" warning and "Chunk size does not
match page size" (65536 vs 4096). No JS errors. No horizontal overflow at 390 px.

Raw JSON per run and screenshots: data repo `.playwright-mcp/perf/` (git-ignored). Scenario files:
`.playwright-mcp/scen/`.

## 5. Map naming and Afrikaans labels — facts from the tiles

- Style: `https://tiles.openfreemap.org/styles/liberty` (v8, 111 layers, 25 symbol layers, `cache-control:
  max-age=86400`). Every name label uses the same expression: nonlatin → `name:latin` + `name:nonlatin`,
  else `coalesce(name_en, name)`. The style never references `name:af`.
- Tiles (`planet/20260913_164504_pt`, z0–14) **do carry `name:af`**, measured on decoded tiles:
  - places at province zoom (z7): 69 of 77 have `name:af` (Kaapstad, Mosselbaai, Beaufort-Wes, Noord-Kaap…);
  - places, Stellenbosch/Cape Flats z10: 37 of 54; Cape Town suburbs z12: 32 of 112 (Seepunt, Nuweland,
    Soutrivier…); Stellenbosch z14: 3 of 19;
  - roads: 7 of 117 named roads at z14; POIs: 28 of 769; water: partial (rivers often yes).
  So Afrikaans coverage is good for towns/cities, partial for suburbs, and near-zero for streets and POIs.
  Fallback to `name` is required and must be documented as "Afrikaans where OpenStreetMap has it".
- Graaff-Reinet: place feature **id 302117011** (the OSM node), `class=town`, `rank=6`, `name` = `name_en` =
  `name:latin` = "Robert Sobukwe Town", `name:af` = `name:en` = "Graaff-Reinet". The same id appears in every
  tile from z7 to z13, so an override can key on `["id"] == 302117011` (plus a defensive name check) — no text
  replacement. The label is on screen at the site's initial province view (the viewport reaches 25.2°E; the
  pan limit is 28°E). Nearby renamed places also carry the new names (Xamdeboo/Aberdeen, Kwa Noheleni/
  Nieu-Bethesda, Bishop Limba/Adendorp) — out of scope unless asked. A railway-station POI (id 2473261371) and
  the airport ("Robert Sobukwe Airport", ICAO FAGR, `name:en` "Graaff Reinet Airport") are separate features.
- The satellite view has no vector basemap, so today it has no place labels to localise or override; whatever
  label layer the redesign gives Satellite must reuse the same expression.
- Both requirements can be met **client-side**: fetch the Liberty JSON once, rewrite the `text-field` of every
  symbol layer that reads `name`, and pass the object to MapLibre; switching language then becomes a
  `setLayoutProperty` on ~20 symbol layers (no reload). A vendored copy of the style is the fallback if
  OpenFreeMap changes the label expressions. No paid dependency is needed.

## 6. Tests and tooling today
- `extract/match/smoke_matrix.py` (data repo) drives Safari against `plain.html?db=…`; needs `window._map`,
  `window._integrity`, source `parcels`, layer `parcels-fill`, `#pbody`, and fixed English substrings
  ("municipal market value", "possible match", "Could not link", "several entries fit", "No valuation found",
  "Verified link", "unverified", "Not in this data build"). It can target a preview with `--site … --db …`.
- `scripts/verify_remote_db.sh`, `scripts/rollback_db.sh vN|b-…` (one-step switch/rollback), `test_export.py`.
- No JS unit tests; `index.html` and `map.html` are never exercised automatically; no AF test; no mobile test.

## 7. Invariants the redesign must not break
See `audit-code.md` §12: no hard-coded figures; graceful auto-hiding sections and honest empty states;
`index.html#m/<slug>` / `#d/<slug>` and `#p/…` hashes; EN string = i18n key with an `af` entry for every new
string; the Supabase `configUrl` literal in both JS files (rollback regex); `verifyBuild` fail-closed;
link-table-first, "missing key ⇒ Not in this data build"; `?db=` and `?nolink=1`; the disposition wording rules;
the smoke-test ids/strings; `WSTATUS='C'`; attribution strings; the six `--map-*` tokens on `[data-theme]`
pins; `?v=` bump pattern; SEO files; commits carry the owner's authorship only.

## 8. Data audit — summary (full report: `01-data-audit.md`)

Read-only audit of `wc-valuations.db` (1,459,474 properties, 196 roll files, 25 municipalities). Headline
figures on the live site match the database exactly (R2.66 tn, median R915 k, Gini 0.62). Findings that are
outside the design scope but need the owner's decision:

1. **Personal data on the live site (POPIA) — verified.** 864 Matzikama rows with `suburb='0'` are
   column-shifted: `site_address` holds the registered owner's name (a person's or a family trust's name) and
   `category` holds the town name. `site_address` is exported as `prop.address` in the
   search DB, so the names are public now. Fix belongs in the Matzikama parser + a new build; until then the
   Explore redesign never displays `site_address` for these rows. Fixed 2026-09-23 by the Matzikama parser
   repair (DATA_CONTRACT §7).
2. **Cape Town double count.** Multi-use properties appear as a parent "HOLDING / MULTIPLE PURPOSES" row and
   again as erf-less allocation rows: R15.1 bn certain, up to ~R36 bn (1.4% of the province). The current
   "most valuable property" on the site is one of these parents.
3. `vacant_land_share` in `stats.json` is broken (0.0001): farm extents (1,533 Oudtshoorn farms > 100 km²,
   Knysna farm numbers glued to extents) swamp the denominator.
4. Witzenberg's provenance note still says "valued as at 2 July 2012"; the roll is GV2023 (1 Jul 2022).
5. Bitou labels 4,775 farm portions as sectional units (41% shown, ~19% real).

Usable for Explore now: 25 candidate statistics with tested SQL (percentiles incl. p99, log histogram,
median freehold residential value per municipality, Cape Town share 64.7% of value, top-10% share 47.4%,
places by median with n ≥ 200, value per m² only under the reliability rule: full-title residential, value
≥ R10 k, extent 20–50,000 m², rolls that passed the extent check), an 8-group category rule covering 98% of
rows and value, dates of valuation per municipality (1 Jul 2020 Hessequa → 1 Sep 2025 Kannaland; Laingsburg
2018 draft; 9 municipalities state no date). Proposed `explore.json` ≈ 41 KB (13 KB gzipped). There is no
multi-period series, so no sparklines or growth figures.

## 9. P0 prerequisites — done 2026-09-23 (branch `p0-integrity-guards`)

The fail-open gate (B1) and the stale-click race (B2) are fixed, unit-tested (`tests/selection.test.mjs`)
and covered by two Playwright/WebKit browser regressions that failed on `9d9302a` and pass after the fix;
DATA_CONTRACT §9b documents the semantics. The smoke matrix is run unchanged against the fixed tree.
