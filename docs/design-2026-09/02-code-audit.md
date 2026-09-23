# Code audit: Western Cape Valuation Atlas front end (read-only, 2026-09-23)

Repositories: website `~/projects/western-cape-valuations` (HEAD `9d9302a`, JS `atlas.js?v=36`, `map.js?v=34`, live build `b-2b502178f94f`); data repo `~/projects/western-cape-property-valuations` (reference only). Nothing was modified.
Paths below are relative to the website repo unless noted. `DC` means `DATA_CONTRACT.md`.

---

## 0. Findings to deal with before or during the redesign (bugs found in this audit)

| # | Severity | Finding | Where |
|---|---|---|---|
| B1 | **High, integrity** | **Fail-open hole.** `hasLinkTable()` catches *any* error, including a transient `ensureDB()` failure, returns `false` and caches that promise for the whole session. `lookupLink` then returns `null`, and `showValuation` runs the legacy heuristic (`lookupErf`), which retries `ensureDB()` and can succeed. So one network blip at the first click permanently switches the page to the heuristic. That breaks DC §9: the heuristic may run only when the table is absent or `?nolink=1` is set. `hasTownCol()` has the same caching pattern (lower impact). | `assets/map.js:548-557`, `:563`, `:917-919`, `:457-464` |
| B2 | **High, integrity** | **Stale-response race.** `showValuation` has no request token. Click parcel A, then B before A's lookup resolves, and A's result can overwrite the panel while B is highlighted. The same applies to the chooser (`pickParcel`) and to the scheme route. | `assets/map.js:366-373`, `:891-957` |
| B3 | High (UX, desktop) | **Atlas hover tooltip throws on every mousemove.** `tip()` declares `const t = $("tip")`, which shadows the i18n `t()`, and then calls `t("Median")`, giving a TypeError. The desktop region tooltip has never rendered since the AF i18n commit `cd3c1ad` (2026-07-16). Also, `st.parcels` does not exist in stats.json, so the code falls back to `valued`, which is inconsistent with the KPI that uses `properties`. | `assets/atlas.js:412-425` |
| B4 | Medium, honesty | The Atlas property-detail dialog prints a **hard-coded year**: `municipal market value · 2024 / 25` for every property, whatever the municipality's cycle (`YEAR` constant). | `assets/atlas.js:15`, `:1115`; also the fallback at `:599` |
| B5 | Medium | **Duplicate kicker and chooser** in the unverified list. `renderUnverified` calls `renderList`, which already renders its own kicker, the "Erf X — n valuations" heading and the chooser bar. It then prepends a second kicker and title, and calls `maybeInjectChooser()` again, so there are 2× "⇅ n parcels overlap" bars when parcels overlap. | `assets/map.js:591-604`, `:848-863`, `:867-875` |
| B6 | Medium | Raw linker reason codes are shown to users: `Evidence: TOWN_MATCH · SCHEME_PARENT_R0 …`. They are untranslated and machine-speak. | `assets/map.js:620` |
| B7 | Low | `#mapfail` appears only when `window.maplibregl` is missing (CDN failure). If WebGL is unavailable, the `maplibregl.Map` constructor throws and nothing is shown. The second line "View the Atlas instead." is not translated. | `assets/map.js:993-996`; `map.html:198-203` |
| B8 | Low (tooling) | The smoke matrix reads `document.getElementById('hint')`, but the element is `#maphint`, so the "Loading…" wait guard is a no-op. | data repo `extract/match/smoke_matrix.py:129` |
| B9 | Verify | Satellite ward labels: the inline satellite style has **no `glyphs` URL**. `map.js` claims MapLibre "draws the default font locally", but DC §14 and the place-search spec say text layers on that style silently render nothing. The two claims contradict each other; check in a browser. | `assets/map.js:184-202` vs `DATA_CONTRACT.md:603-604` |
| B10 | Low | `rates.js` falls back to a default `residential_reduction \|\| 15000`, but DC §10 says "never a default". Every current entry probably carries the field, but it is still a latent default. | `assets/rates.js:49` |

---

## 1. View inventory and navigation

**Pages**

| Page | Role | Engine | Theme |
|---|---|---|---|
| `index.html` ("Explore", the Atlas SPA) | d3 SVG choropleth SA → WC → district → municipality, left-rail panel (bottom sheet on phones), address search, top-N and property dialogs | `assets/atlas.js?v=36` | follows the system (tokens media query) |
| `map.html` ("Satellite") | MapLibre + Esri World Imagery, live SG parcels, click-to-valuation, wards, place search | `assets/map.js?v=34` (+ `places.js?v=2`, `rates.js?v=1`) | `<html data-theme="dark">` (`map.html:2`) |
| `plain.html` ("Map") | the same map.js in `MODE='plain'` using OpenFreeMap `liberty` | the same | `<html data-theme="light">`, `<body data-basemap="plain">` |
| `m/<slug>.html` ×24 + `m/index.html` + `m/city-of-cape-town.html`, `d/<slug>.html` ×6, `guide/how-valuations-work.html` | generated static SEO pages (never hand-edit) | `templates/shell.html` + `muni.html`/`district.html`/`browse.html`/`coct.html`, rendered by the data repo's `extract/export_pages.py` | follows the system |
| `af/m/…`, `af/d/…`, `af/gids/hoe-waardasies-werk.html` | generated Afrikaans twins (`${root}` = `../../`) | the same | the same |
| `404.html` | hand-written; its own inline lang script (`404.html:44-48`) | — | — |
| `design/…dc.html` | original prototype (reference only, never served as a view) | — | — |

**The `.viewseg` control.** It is a `<nav class="viewseg" aria-label="Map view">` with three `<a>` elements: Explore `index.html`, Map `plain.html`, Satellite `map.html`. The current view gets `aria-current="page"`. A second `.viewseg` (`aria-label="Language / Taal"`) holds `<a href="#" data-lang="en|af">`.
- index.html has it twice: in `#mbar` (phones, `index.html:325-333`) and in `#viewsegWrap.desk.platter` (desktop, `:431-441`).
- map.html and plain.html: `:163-173`.
- Generated pages: `templates/shell.html:124-132`, with no `aria-current` on the view nav, and real URLs on the language links.
- The CSS for `.viewseg` is copied four times (index `:137-143`, map/plain `:55-62`, shell `:57-61`).

**State carried between views**

| State | Where it lives | Carried? |
|---|---|---|
| Atlas drill | `#m/<slug>` / `#d/<slug>`; `parseHash()`/`syncHash()` use `history.replaceState` only (`atlas.js:156-172`) | **No.** index → map/plain links are static; the municipality context is lost. |
| Selected place on the map pages | `#p/t<MP_CODE>` / `#p/s<SP_CODE[_…]>` / `#p/m<normname>` (`places.js:62-64`, `:187`, `:235-243`) | Only map ↔ plain: `syncViewLinks()` rewrites `a[href^=map.html]`/`a[href^=plain.html]` (`places.js:212-215`). The Explore link drops it. |
| Map camera (centre/zoom), selected parcel | not persisted | Lost on every view switch and reload. Not shareable. |
| `?db=<configUrl>` | read by `map.js:535`, `:972` | **Not carried by any link.** atlas.js ignores `?db` entirely (hard-coded `atlas.js:1145`). |
| `?nolink=1` | `map.js:558` | Not carried. |
| Language | `localStorage['wcv-lang']` → `navigator.language` → `en` (`atlas.js:29-30`, `map.js:776-777`, `lang.js:12-19`) | Yes, via storage. SPA and map pages call `location.reload()` on toggle (`atlas.js:49-57`, `map.js:798-806`); the hash survives the reload. Static pages navigate to the twin URL; `lang.js` redirects with `location.replace` when the preference differs (`lang.js:27-35`). |
| Static → Atlas | `templates/muni.html:12` `${root}index.html#m/${slug}`, `district.html:10` `#d/${slug}` | Yes (hash contract, DC §13.4). |

`index.html#siteFooter` (`:422-426`) is the JS-free crawl path to `m/index.html` and is required by DC §13.6. JS rewrites it for AF (`atlas.js:44-47`).

---

## 2. Asset loading per page

**index.html (in order)**
1. Google Fonts `Inter:wght@400;600;800&display=swap`, render-blocking CSS with preconnects (`:44-46`).
2. `assets/tokens.css?v=4`, blocking (`:47`).
3. `https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js`: a **synchronous, parser-blocking** classic script in `<head>` on a **floating major** version with no SRI (`:48`). About 280 KB minified, used only for `geoIdentity`, `geoPath`, `interpolateRgbBasis` and `select`/`join` (`atlas.js:203-205`, `:199`, `:727`).
4. Inline `<style>` (`:49-300`).
5. `<script type="module" src="assets/atlas.js?v=36">` (deferred, `:503`), which statically imports `./rates.js?v=1`.
6. Runtime: if AF, `data/i18n-af.json` is fetched and **awaited before** the data fetches (`atlas.js:95-98`, a serial waterfall). Then `Promise.all` loads `data/stats.json` (91 KB), `towns.json` (52 KB), `geo/za-provinces.geojson` (802 KB), `wc-districts.geojson` (531 KB) and `wc-municipalities.geojson` (704 KB) (`:100-106`). The full-screen `#loading` overlay stays up until all of them are parsed and planarized (`:111-112`). `rates.json?v=2` loads via `rates.js:15`. `ensureDB()` pre-warm (`:138`) does a dynamic `import('https://cdn.jsdelivr.net/npm/sql.js-httpvfs@0.8.12/+esm')`, then loads `assets/vendor/sqlite.worker.js` (84 KB) and `sql-wasm.wasm` (1.24 MB, **no `?v`**), then Supabase `config.json`, then 64 KB range reads. `wc-wards.geojson` (973 KB) loads lazily on the first municipality drill (`:261-263`).

**map.html / plain.html (identical loading)**
1. Google Fonts, then `tokens.css?v=4` (`:35-38`).
2. `maplibre-gl@5` CSS plus a **synchronous `<script>` in `<head>`**, floating major, no SRI (`:39-40`).
3. Inline style (`:41-158`), then module `map.js?v=34` (`:205`), which imports `rates.js?v=1` and `places.js?v=2` (`map.js:26-27`).
4. At module evaluation: `wc-municipalities.geojson`, `sg-towns.json`, `town-aliases.json` and `rates.json` (`map.js:109-115`, `:415`, `:392`), plus i18n if AF (`:784`).
5. On map `load`: `wc-wards.geojson` (`:163`). In satellite mode, Esri tiles. In plain mode, the OpenFreeMap style JSON, sprites, glyphs and tiles.
6. `ensureDB()` pre-warm at boot (`:1014`).
7. Lazily: `places.json?v=1` (258 KB, on the first search focus), StatsSA boundary polygons on selection, cadastre queries per viewport, the CoCT scheme layer on some clicks, and `verifyBuild()` (`config.json` + `manifest.json` with `cache:'no-store'`) on the first click.

**Generated pages.** Google Fonts, `tokens.css` (**no `?v`**, `shell.html:43`), inline style and `lang.js?v=2` at the end of `<body>` (`shell.html:146`). Because `lang.js` is loaded last, AF-preference visitors see the full English page render before the redirect.

**Cache-busting rules in force**
- `?v=` on `atlas.js`/`map.js` in the HTML. DC §6.5 says to bump them whenever the file changes. `scripts/rollback_db.sh` bumps `(map|atlas)\.js\?v=N` in `map.html`, `plain.html` and `index.html` by regex (`rollback_db.sh:20-22`).
- Import specifiers `./rates.js?v=1` and `./places.js?v=2` inside the modules are their only cache-bust.
- `rates.json?v=2` (DC §10.6) and `places.json?v=1`.
- `tokens.css?v=4` on the SPA pages only.

**Immutable build and integrity contract (DC §8, §8b, §11): what must be preserved exactly**
1. `DB_CONFIG_URL` in **both** `map.js:962` and `atlas.js:1145` is the literal `https://nxeasppmwvzcqbbgrdvf.supabase.co/storage/v1/object/public/valuations/b-2b502178f94f/config.json`. `rollback_db.sh:16-18` rewrites it by the regex `valuations/<prefix>/config.json` and **asserts** it exists in both files. Renaming or splitting these files, or building the URL dynamically, breaks one-step rollback.
2. Chunks resolve relative to `config.json` via `urlPrefix`. The worker is created with absolute URLs `assets/vendor/sqlite.worker.js` + `assets/vendor/sql-wasm.wasm` (`map.js:973-974`, `atlas.js:1146-1147`). The DB must stay on Supabase (GitHub Pages gzip breaks range reads, DC §8).
3. `ensureDB()` caching semantics: never cache a broken worker (`.catch → dbwPromise=null`), `resetDB()` on failure, and a pre-warm that runs `SELECT 1`, the `erf_int` probe and the FTS `a*` probe (`map.js:979-983`; atlas `:1151-1155`). DC §11 names this pre-warm as one of the four performance measures.
4. `verifyBuild()` (`map.js:533-547`) compares `config.buildId`, `manifest.build_id` and `link_meta.build_id`, plus `manifest.size_bytes === config.databaseLengthBytes`. Any mismatch, or a null value, returns `false`, and `lookupLink` throws `'build mismatch'` (`:564`), which renders the integrity card on every click and never runs the heuristic. Config and manifest are fetched `no-store`.
5. Link-first flow (`showValuation:903-917`). A key missing from `link` means `decision:'missing'`, which renders "Not in this data build" and is **not** a fallback. The heuristic runs only if the table is absent or `LINK_DISABLED`. (See B1 for the current hole in this.)
6. Query shapes that seek indexes: `erf_int=?` with town-first ORDER BY, LIMIT 80 then a 600 widen (`:481-495`); scheme `= ? COLLATE NOCASE` and the NOCASE range `>= ? AND < ?`, never a parameterised LIKE (`:697-704`); `pid IN (…)` for link rows (`:575`).
7. The Atlas does **not** verify the build (search and top-N only) and ignores `?db`. That is acceptable today but asymmetric.

---

## 3. map.js in depth

**Init** (`initMap`, `:69-94`). `new maplibregl.Map({container:'map', style, bounds: WC_FIT [[17.2,-34.95],[24.3,-30.55]], fitBoundsOptions:{padding:30}, minZoom 4.8, maxZoom 19, maxBounds WC_PAN, attributionControl:false, dragRotate:false, pitchWithRotate:false})`. Touch rotation is disabled. Controls: `NavigationControl({showCompass:false})` top-right, `ScaleControl` bottom-left, compact `AttributionControl` bottom-right. `window._map = map` (`:998`).

**Basemaps.** `MODE = body.dataset.basemap==='plain' ? 'plain' : 'satellite'` (`:30`).
- Satellite uses an inline style `{version:8, sources:{}, layers:[bg background --map-bg]}`. On `load`, `addBasemap` adds the raster source `esri-world-imagery` with tiles `…/World_Imagery/MapServer/tile/{z}/{y}/{x}`, 256 px, maxzoom 19, and Esri attribution (`:43-49`, `:96-105`).
- Plain uses `PLAIN_STYLE='https://tiles.openfreemap.org/styles/liberty'` (`:55`).
- map.html and plain.html are **two separate pages and separate map instances**, not a toggle. Every switch is a full page load (MapLibre, fonts and the DB worker re-boot).
- In plain mode every overlay is inserted before `firstSymbolLayerId()` (`:1003`, `:208-211`).

**Layers added on load** (`:999-1010`):

| Layer | Details |
|---|---|
| `munis-line` | maxzoom 15.5, `--map-muni-line` |
| `ward-fill` | opacity 0, used for hit-testing |
| `ward-lines` | minzoom 8.5, dashed `--map-ward` |
| `ward-labels` | minzoom 10.5, `'Ward ' + ward` uppercase; in plain mode `text-font: Noto Sans Regular`; halo `rgba(12,21,18,.85)` is hard-coded rather than a token |
| `parcels-fill` | `--map-parcel-sel`, opacity 0.30 when selected, else 0.03 |
| `parcels-line` | colour chosen by `feature-state sel`; zoom-interpolated width |
| `place-hl-fill`, `place-hl-line` | from places.js |

The `#wardchip` switch toggles the three ward layers' visibility (`:213-226`).

**Parcels** (`:255-319`)
- Source `parcels` is GeoJSON with `promoteId:'PRCL_KEY'` and attribution "Parcels: Surveyor-General / Western Cape Government (as-is)".
- `moveend` triggers a 250 ms debounce, then `loadParcels`. Below z15.5 it clears the layer and shows the hint "Zoom in to see erven".
- Otherwise it aborts the previous request and GETs `CADASTRE.url` (`gis.westerncape.gov.za/server2/…/SG_PlanningCadastre/MapServer/1/query`) with the viewport envelope in 4326, `where:"WSTATUS='C'"`, `outFields TAG_VALUE,Town_name,Town_code,PRCL_KEY,WSTATUS`, `geometryPrecision 6`, `f=json`.
- `esriToGeoJSON` also filters out any feature whose `WSTATUS` is not `'C'` on the client (`:247`), then calls `setData` with the whole set.
- Hints: "Loading erven…", then "Tap or click an erf for its valuation", or "Too many erven for one view — zoom in" (`exceededTransferLimit`), or "Erf boundaries unavailable right now".
- There is no tile or viewport cache: each pan refetches everything.

**Click, from start to rendered panel**
1. `click` on `parcels-fill` (`:347`) runs `queryRenderedFeatures(point,{layers:['parcels-fill']})`, dedupes by id, sorts ascending by `parcelAreaM2` (planar shoelace, `:333-342`), stores `parcelCands`, `parcelWard = wardAt()` (`queryRenderedFeatures` on `ward-fill`) and `lastClickLL`, then calls `pickParcel(parcelCands[0])`.
2. `pickParcel` (`:366-373`) clears the old selection feature-state and sets the new one. It awaits `SG_TOWNS` and `MUNIS`, then calls `showValuation({...props, Town_name: townOf(p) /* Town_name || sgTowns[Town_code] */, _ward, _muni: muniAt(lastClickLL) /* ray-cast over wc-municipalities */})`.
3. `showValuation` (`:891`) immediately renders a loading card: kicker `Town_name`, heading "Erf {TAG_VALUE}", sub "Looking up valuation…". It opens the panel and injects the chooser.
4. `lookupLink(PRCL_KEY)` (`:562-579`):
   - `LINK_DISABLED` or no table returns `null`.
   - `verifyBuild()` false throws.
   - `SELECT * FROM link WHERE prcl_key=?`. No row gives `{decision:'missing'}`.
   - Otherwise it fetches `rows` (pids, cap 400) and `cands` (cap 40) from `prop`.
   - A throw renders the **integrity card** (`:909-913`).
   - A link result goes to `renderLink` (`:605-657`).
5. Before the decision cards, for `not_in_roll` and `abstain` only, the CoCT scheme route runs:
   - `schemesAtClick()` checks the `COCT_BBOX` gate, then queries `citymaps.capetown.gov.za/…/SL_WGDB_ST_SCHM/MapServer/0` with a 6 s timeout (`:666-683`).
   - `lookupSchemes()` tries the exact `NAME SSno/year`, falling back to a name-prefix range and grouping by scheme (`:688-712`).
   - One group renders `renderSchemeList`; more than one renders `renderSchemeChooser`.
6. Legacy path, only when `link === null`:
   - `lookupErf(TAG_VALUE, Town_name, _muni)` (`:466-517`). `normTown` (`:404-409`) uppercases, strips parentheticals, applies RIVER→RIVIER, BAY→BAAI, EAST→OOS and WEST→WES, removes non-letters and collapses doubled letters. `TOWN_ALIAS` is a literal fallback, replaced by `data/geo/town-aliases.json` (`:413-415`).
   - `rankRows` scores 5 for a suburb or town match (exact or after normalisation), 4 for containment or alias, 2 or 1 for a municipality-only match, and takes the max of suburb and town (`:416-448`).
   - It runs a muni-gated query, widens to LIMIT 600 if `best<4` and 80 rows came back, and accepts cross-municipality rows only when `best>=4`. If `erf_int` is absent, it falls back to an FTS erf-token query and sets `stale=true`.
   - A weak result (`best<4`) triggers the scheme route. No rows gives "No valuation found". One row gives `renderDetail`, several give `renderList`, plus a note for `best` 0 or below 4.

**Rendering per disposition.** All strings are English catalog keys, quoted as they appear in the code.

| Decision | Structure | Strings |
|---|---|---|
| **accepted_high** (1 row) | `renderDetail` (`:825-846`): `.pKick` "suburb · muni", `.pAddr` address or "Unnamed erf", `.pVal` R(value), `.pSub` "municipal market value", `.pRow`s (Erf / unit, Ward, Category, Extent, Dwelling extent, Value per m², Rates / year ({year}), Rates / month), `.pNote` with tariff and "Parcel {key}. Roll valuation as at the municipality’s valuation date, set for rates — not today’s sale price." | extra note: "Verified link: this roll entry is tied to this parcel by its town and erf number. Evidence: …" |
| **accepted_group** | `renderList` (`:848-863`): kicker "Town · Ward n", `.pAddr` "Erf {erf} — {n} valuations", `.pSub`, up to 40 `.pRow.pPick` (address, value), then "Showing the 40 highest of {n}." If `complete`, `renderSchemeSum` (`:718-726`) inserts `.pVal` with the total and "sum of the {n} unit valuations on the roll for scheme {scheme} — not the erf’s official valuation, which is R0", and the sub becomes "{n} sectional-title units on this parcel". | sub: "{n} sectional-title units on this parcel (verified scheme) — list may be incomplete; no parcel valuation is implied", then "Evidence: …" |
| **review** (`show≠0`, rows exist; also accepted_* whose row count doesn't fit) | `renderList` | sub "possible match — town not confirmed"; note "Likely but unconfirmed: the roll entry fits the erf number, but its locality could not be tied to this SG town with certainty. Evidence: … [rejected note]" |
| **review** (`show=0` or no rows) | `renderUnverified` with no rows: kicker, "Erf X", `.pVal`(22px) | "Could not link this parcel to the roll" + "The evidence is insufficient or conflicting; no entry can be shown as a possible match." |
| **ambiguous** | `renderUnverified(cands)`: title "Erf {erf} — several entries fit" + list sub "unverified — same erf number, with some locality or area evidence" (or the no-rows card) | note "Several roll entries fit this erf number and cannot be told apart. Evidence: …" plus `rejectedNote`: "{n} roll entries with this erf number were found but rejected: their locality refers to other towns." / "{n} further entries share the number but carry no locality or area evidence and are not shown." |
| **not_in_roll** | (scheme route first) kicker, "Erf X", `.pVal` "No valuation found" | "Checked: the roll covers this town but has no entry for this erf. Evidence: …" |
| **abstain** | (scheme route first) `renderUnverified(cands)` titled "Could not link this parcel to the roll" | "The evidence is insufficient or conflicting; any entries below are unverified." (with cands) or "…no entry can be shown as a possible match." |
| **missing** (key absent) | kicker, "Erf X", `.pVal` "Not in this data build" | "This parcel is newer than, or missing from, the current link table — no valuation is shown rather than a guess." |
| **integrity / version error** (verifyBuild false or link read throws) | same card | "Not in this data build" + "The link table in this data build could not be read — no valuation is shown rather than a guess." |
| CoCT scheme (1 group) | `renderSchemeList` (`:727-750`): kicker Town · Ward, `.pAddr` scheme, exact match shows `.pVal` sum + "sum of the {n} unit valuations…", otherwise "{n} sectional-title units matched — list may be incomplete; no parcel valuation is implied" | "Scheme identified from the City’s sectional-scheme layer at the click point; units matched by scheme reference or name."; picking a unit opens detail with "← All {n} valuations on this erf" |
| CoCT scheme (>1) | `renderSchemeChooser` | "{n} schemes match here", "same scheme name registered more than once — pick the one you mean", rows "{n} units" |
| Legacy heuristic | detail or list | subs "portions or sectional-title units share this parcel" / "same erf number, other townships — may not be this parcel"; notes "No town match — the same erf number exists in several municipalities; verify the address." / "Same erf number, other townships — this may not be the right parcel."; empty: "No valuation found" + "Not in the extracted rolls — possibly state land, a supplementary roll, or another town name." + " The search index is one update behind." if stale; DB error appends "The valuation database is still loading — try the parcel again in a moment." |
| Loading | kicker, "Erf X", "Looking up valuation…" | |
| Map hint chip `#maphint` | | "Zoom in to see erven", "Loading erven…", "Tap or click an erf for its valuation", "Too many erven for one view — zoom in", "Erf boundaries unavailable right now", "Boundary unavailable — zoomed to the area" |
| `#mapfail` | | "The map couldn’t load." / "View the Atlas instead." (untranslated) |
| Place search empty | | "Search unavailable right now" / "No matches" |

There are no badges or pills. Status is conveyed only by the `.pSub`/`.pNote` wording and the `.pVal` size (22px for "no value" states). `.pVal` is the same large number style whether the state is verified or a scheme sum. A redesign could add explicit verified or unverified badges, but must keep the substrings the smoke test asserts (§10).

**Test hooks.**
- `window._integrity = Object.freeze({hasLinkTable, lookupLink, verifyBuild, linkDisabled})` (`:561`).
- `window._map` (`:998`), used by the smoke test for `jumpTo`, `project`, `unproject`, `fire('click')` and `querySourceFeatures('parcels')`, and internally by `pickParcel` and `closePanel`.

Panel: `#ppanel` / `#pbody` / `#pclose`. `Escape` anywhere closes it (`:1013`).

---

## 4. Overlapping parcels today

When one click hits several parcels, the code gathers every hit, dedupes by `PRCL_KEY`, and **auto-picks the smallest by footprint** (`:349-360`). When there are two or more candidates, `maybeInjectChooser()` prepends a `.pLink` bar "⇅ {n} parcels overlap here — choose" to whatever the panel shows, including the loading state (`:867-875`). The bar opens `renderParcelChooser()` (`:877-889`): "Overlapping parcels" / "{n} parcels at this point" / "smallest (most specific) first — pick the one you mean", with one row per parcel as "Erf N · Town" and "N m²". Picking a row re-runs `pickParcel`.

Limits:
- The selection is not visually distinct on the map before picking (only the chosen parcel is tinted).
- There is no hover preview of the other candidates.
- Because only `WSTATUS='C'` parcels are drawn, obsolete superseded erven no longer compete.
- B5 double-injects the bar on unverified lists.

---

## 5. i18n

- Catalog: `data/i18n-af.json` = `{names:{14}, strings:{450}, blocks:{explainer_body}}`. **The keys are the English source strings.** Every `t()`/`tf()` literal and `data-i18n*` attribute in atlas.js, map.js, places.js, index.html and map.html has a catalog entry (checked by script: 0 missing).
- JS: `t(str)` looks up `I18N.strings`, `tn(name)` looks up `I18N.names` (display only; slugs, hashes and SQL stay English), and `tf(str,{k})` interpolates `{k}` (`atlas.js:31-34`, `map.js:778-781`).
- DOM: `[data-i18n]` sets textContent, `[data-i18n-ph]` sets the placeholder (map.js also sets aria-label from it), and `[data-i18n-aria]` sets aria-label (`atlas.js:37-48`, `map.js:782-797`). This only runs for AF. English is the HTML itself.
- Switching:
  - SPA and map pages switch client-side, **with a reload** on toggle.
  - Static pages are separate URL trees; the AF twin is generated, and `lang.js` redirects based on the stored or device preference.
  - `<html lang>` is set to `af`. The title is translated; so is the meta description on index.
- Numbers:
  - atlas `R()` (`atlas.js:62-69`): EN `R1.2bn`, `R3.45m`, `R850k`, `R2.66tn`; AF `mjd.`/`mn.`/`bilj.` with a decimal comma; `bn` uses 1 or 0 decimals.
  - map `R()` (`map.js:377-384`): `R2.34 bn` / `R1.25 m` (with a space and always 2 decimals), and **no `k` abbreviation** (full `R850 000`). The formatting is **inconsistent between views.**
  - `N()`: atlas uses `toLocaleString('en-ZA').replace(/,/g,' ')`; map uses plain `en-ZA`. Both give space grouping, but the characters may differ (NBSP vs space).
  - Rates use `RZA` (full Rand).
  - `/mo` and `R…/m²` suffixes are hard-coded.
- Untranslated literals:
  - `Erf ` and `Ward ` in map.js panels (`:598`, `:642`, `:737`, `:850`, `:883`).
  - `'Unnamed'` (`:855`).
  - The **map ward labels** `'Ward '` in the style expression (`:188`).
  - `#mapfail` line 2.
  - aria-labels in index.html (`Go up one level`, `Valuation breakdown`, `Expand or collapse the panel`, `View the most valuable properties`, `Reset the map…`, `title="Back to the full map"`, `Close`).
  - `Top 10/20/30` buttons.
  - `#pclose` "Close".
- **Map labels are not localised at all.** The OpenFreeMap liberty labels are whatever the style ships (OSM `name`/latin). The satellite style has no labels. Place names in places.json are deliberately not translated (spec 2026-07-19). The Atlas SVG labels do use `tn()` (`atlas.js:388-391`).
- Race: map.js `initI18n()` is not awaited (`:992`), so early hints or panels can render in English before the catalog arrives.

---

## 6. atlas.js (Explore)

**Boot** (`:93-139`): fetch the data, then `clipMainland()` (drops sub-Antarctic islands), `toPlanar()` (forward Mercator on every coordinate, in place), `buildHierarchy()` (districts→munis, slug maps), `initMap()` (d3 `geoIdentity().reflectY(true).fitExtent([[46,40],[954,720]], PROV)` into an SVG `viewBox 0 0 1000 760`), hide `#loading`, and `navigate(parseHash(), false)`.

**Rendering and navigation**
- Zoom is a CSS transform on the `<g>` (`transform .95s cubic-bezier(.4,0,.2,1)`), with `railVB()` offsetting the fit for the 400 px desktop rail (`:301-314`).
- Layers: `gProv`, `gDist`, `gMuni`, `gWard`, `gLabel`. Parent levels are dimmed to 0.16 (`setLayers:289-295`).
- Choropleth: `color()` = `d3.interpolateRgbBasis(RAMP)` over the extent of the **displayed set's medians** (`:198-199`). NODATA is used for null.
- Labels: pole of inaccessibility via an inlined polylabel (`:322-381`), shrink-to-fit with `getComputedTextLength()` (`:405-408`), font `--font-map`, halo `--map-halo`.
- Wards (municipality level): dashed outlines + numbers from `wc-wards.geojson` filtered by `properties.muni`.
- Legend `#legendBox`: shown only at levels 1 and 2 on desktop, with title "Median value · district/municipality" and min/max R().
- Tooltip `#tip`: broken (B3). Province popup: at level 0 the only interactive shape is WC (`o-wc`), and clicking it drills in. There is no separate "popup"; the hint `#hint0` says "Select the Western Cape on the map to begin".

**Panel `#panel`** (`renderChrome` `:533-583`, `renderDash` `:585-665`)
- Breadcrumb `#crumbs` (spans, keyboard via `wireAct` role=link), `#scopeLabel` (h1), `#scopeSub` (roll cycle with a `.rollprov` provenance popover `#provPop`, `:428-477`).
- KPIs: `#statMedian`, `#statAvg`, `#statTotal`, `#statParcels`.
- `#distChart`: horizontal histogram of `STATS.buckets` × `hist`, built as HTML divs, not d3.
- `#closer`: `#statTiles` (q1/q3, mean÷median, std/cv, res_gini|gini, top1_share, ppm_median, erf_median, dwext_median, dw_ppm_median, vacant_share, vs province) and `#catMix` (cat_mix count and value bars).
- M5 sections: `#secValueDist` (p10/p90/p90_p10_ratio/ppm_q1/q3/p90/erf_q1/q3), `#secComposition` (cat_mix medians, vacant_median, vacant_ppm_median, n_under_250k, n_over_10m, n_over_50m), `#secStanding` (district and WC rank of median/total/ppm_median/vacant_share; biggest suburb from towns.json `total`; biggest category), `#secGrowth` (median_growth, total_growth, res_median_growth, cagr, growth_from; live for some munis), `#secAfford` (`rates.json.prime_rate` + res_median), `#secQuality` (dq_*), `#secAuthorities` (`authorities.primary/shared`), `#secPolitics` (`politics`, **2 of 25 munis populated**), `#ranked` (children by median, or the quartile spread at municipality level).
- `#hiCard`/`#loCard` from `hi`/`lo` open the `#toplist` dialog, which runs a live SQL top-N: `ORDER BY value DESC|ASC LIMIT 10/20/30`; "lo" filters `value>=100000 AND UPPER(category) LIKE '%RES%'`. `#dashNote` holds the caveats.
- **stats.json fields not consumed:** area_km2, parcels_per_km2, roll_value_per_km2, top5_share, top10_share, top1_count, vacant_land_share, sectional_share (intentionally hidden, DC §7), dwext_q1/q3, min, max.
- Search (`:991-1081`): `#search`/`#results` (desktop) and `#msearch`/`#mresults` (phones). It builds an area index (districts, munis, towns.json names, with EN and AF aliases), renders area matches instantly, then runs an FTS5 prefix-AND query (`ftsQuery` drops noise words) `ORDER BY value DESC LIMIT 8`. A property result opens `#propdetail` (`openProp`, `:1101-1127`) with a rates block and "View {muni} on the map →", which drills the **Atlas**, not the map view.

**Per-render costs**
- Every `navigate()` recomputes `ext()` over medians, rebuilds labels (polylabel per feature, forced layout per label), rewrites ~10 sections of innerHTML and rebuilds the crumbs.
- `resize` (200 ms debounce) re-runs the whole `navigate(statePath,false)` (`:121`).
- `setLayers` recomputes the province extent every call.
- `drawWards` calls `path.centroid` twice per ward.

---

## 7. Design tokens and CSS

- `assets/tokens.css` (150 lines):
  - `:root` light: surfaces `--bg #fff`, `--bg2 #fbfbfd`, `--bg3 #f5f5f7`; ink `--ink #1d1d1f`, `--ink2 #6e6e73`; `--label2 rgba(60,60,67,.75)` (AA); `--label3 .45` (decoration only); `--sep`, `--hairline`, `--scrim`.
  - Accent `#0071e3`; `--ok`, `--warn` (**unused anywhere**), `--bad`; `--seg-on`.
  - Radii: `--r-panel 16`, `--r-card 20`, `--r-ctl 8`, `--r-chip 10`, `--r-pill 999`.
  - Shadows: `--shadow-platter`, `--shadow-card`, `--shadow-overlay`; `--platter-bg rgba(255,255,255,.72)`; `--blur blur(20px) saturate(180%)`.
  - `--font-ui` (Inter first) and `--font-map` (system/SF first, then Inter).
  - `--ramp-1..5` (blue), `--land`, `--nodata`, `--map-stroke`, `--map-outline`, `--map-halo`, and `--cat-*` ×6.
  - Dark: `@media (prefers-color-scheme:dark) :root:not([data-theme="light"])`. `:root[data-theme="dark"]` **duplicates the whole dark block** (`:113-145`) and adds the six `--map-*` overlay tokens. `:root[data-theme="light"]` carries only the `--map-*` tokens.
  - Global `:focus-visible{outline:2px solid var(--accent);outline-offset:2px}`.
- There are **no spacing or type-scale tokens**. Every size is a px literal: 11/11.5/12/12.5/13/13.5/14/15/16.5/19/20/22/23/24/26/30/32/34 px, and the audit counted ~56 off-grid paddings. There is no `rem` at all.
- Fonts: Inter 400/600/800 from Google Fonts. index.html body uses `--font-ui` (Inter). **map.html and plain.html body use `--font-map`** (`map.html:44`), so the map pages render in SF on Apple devices and in Inter elsewhere: the typography differs between views.
- JS reads tokens **once at boot** via `cssVar()` (`atlas.js:11-14`, `:277`; `map.js:25`; `places.js:19`). An OS theme flip while index.html is open leaves stale SVG colours. The MapLibre layers bake in colours at `addLayer`.
- `prefers-reduced-motion`: a blanket `transition/animation-duration:.01ms` block in index (`:298-300`), map and plain (`:63-65`) and shell (`:113-115`). It does **not** cover JS motion: the Atlas zoom sets `gNode.style.transition` inline, which is still clamped by `!important`; but MapLibre `fitBounds({duration:900})` (`places.js:185-186`) and map easing are **not** gated.
- Inline `<style>` blocks: index ~250 lines, map/plain ~117 lines each, shell ~70 lines. There are also many inline `style=""` attributes and JS-built style strings (atlas.js renders almost all panel content with inline styles, e.g. `:625-628`, `:1042-1043`).
- **map.html vs plain.html duplication.** The files are byte-identical apart from 10 hunks: theme pin, title/meta/og/ld (6-8, 15, 18-20, 25-26, 30-32), the comment on line 150, the icon `filter:invert` rule (line 155, map only), `body data-basemap`, and `aria-current`. The project notes say this near-copy is **hand-maintained**.
- The `.viewseg` rules appear 4×, `.platter` 2×, and the reduced-motion block 4×.

---

## 8. Accessibility and keyboard (as implemented) and gaps

**Present**
- `wireAct()` makes div controls tabbable with role=button and Enter/Space (`atlas.js:19-22`, `map.js:769-773`).
- Comboboxes with `aria-expanded`, `aria-activedescendant` and arrow/Enter/Escape: Atlas `#search`/`#msearch` (`atlas.js:1004-1026`) and `#placeSearch` (`places.js:217-229`).
- Dialogs `#tlPanel`/`#pdPanel` have `role=dialog aria-modal`, move focus in, trap Tab (`trapTab`), restore focus, and close on Escape (`atlas.js:136-137`, `:929-962`).
- `#wardchip` has `role=switch aria-checked`.
- `#maphint` has `role=status aria-live=polite`; results boxes and `#tlBody` are aria-live.
- 44 px hit areas for closes and MapLibre buttons; `aria-current` on the view nav; `<h1 id="scopeLabel">` on index.

**Gaps**
1. **Atlas map is mouse/touch-only.** SVG regions aren't focusable, and level 0 tells users "Select the Western Cape on the map to begin", which a keyboard user cannot do. They must discover the search box; the crumbs are hidden at level 0.
2. **Map pages: `#ppanel` is not a live region, and focus is not moved into it** on open or returned on close. Screen readers get no announcement of the valuation result. Parcels can't be selected by keyboard at all (inherent to the design, but there's no alternative such as "search an erf").
3. There are no `<main>` or `<header>` landmarks on the map pages and no `<h1>` (`#brandTitle` is a div). There is no skip link anywhere.
4. The language toggle is `<a href="#">` with `aria-current="page"`. It should be a button, or a link with `hreflang`/`lang`; the AF label also lacks `lang="af"`.
5. `#tlSeg` uses `role=tablist`/`tab` but has no tabpanel, no arrow-key roving, and no `aria-controls`.
6. The `#grab` sheet handle has no `aria-expanded`. On phones, `#panel.full` state changes are not announced.
7. `#provPop` is `role=tooltip` but contains links (the tooltip role must not hold interactive content). It is not referenced with `aria-describedby`.
8. The listbox containers carry `aria-live` (`#results role=listbox aria-live=polite`, `index.html:349`), which is noisy and a non-standard combination.
9. All sizes are px, so user font-size preferences have no effect (deferred in the July audit).
10. `aria-label` strings are English-only in AF mode (see §5).
11. Accent-coloured non-interactive kicker labels (`#pdKicker`, `#tlKicker`, `hiCard` label) invite mis-taps (the July audit deferred this).
12. Reduced motion does not gate the MapLibre fly-to or the 950 ms Atlas camera move (the latter is clamped by the CSS `!important` on inline transitions; OK).

---

## 9. Performance observations

**Before first paint**
- index: blocking Google Fonts CSS, tokens.css and **the d3 UMD sync script in head**.
- map/plain: **a sync maplibre-gl script (~800 KB) in head**.
- index keeps a full-screen `#loading` overlay until 2.1 MB of GeoJSON is downloaded **and** parsed, clipped and planarized on the main thread (`atlas.js:100-112`). This is a guaranteed long task (hundreds of ms on mid-range phones). Simplified TopoJSON or pre-projected geometry would remove most of it.
- AF: the i18n catalog (48 KB) is fetched **serially before** the data (`atlas.js:95-98`).

**Contention at boot.** Both SPA pages start `ensureDB()` immediately: the httpvfs ESM from jsDelivr, the 1.24 MB wasm, the worker and the Supabase config and range reads. This competes with first-paint assets. DC §11 requires the pre-warm; it can be moved to `requestIdleCallback` or run after first paint without violating it. Map pages also fetch 704 KB munis + 973 KB wards at load. Both are parsed on the main thread **and** structured-cloned to the MapLibre worker (`setData` with an object).

**Per interaction**
- Atlas: every drill or resize does a full re-render (labels with polylabel + `getComputedTextLength` forced reflow, ~10 innerHTML sections).
- Map: every `moveend` at z≥15.5 refetches the full viewport from ArcGIS (up to 1000 polygons at 6 dp) and replaces the source (worker re-tiling). There is no reuse between overlapping viewports.
- Per keystroke: places search is a linear scan of 1,880 entries (cheap). Atlas search runs one FTS query per keystroke after a 150 ms debounce, with sequence guarding.
- GPU: several `backdrop-filter: blur(20px) saturate(180%)` platters over a WebGL canvas that repaints every frame during pan and zoom. This is costly on low-end mobile.
- There are no style mutations on move or zoom beyond `setData` and the hint text. Feature-state is used for selection (good).

**Unused, with confidence**
- `--warn` token.
- CSS class `.o-other` (set, never styled).
- The stats.json fields listed in §6.
- `design/…dc.html` is reference only.
- The places.js `boundaryCache` is fine.
- Nothing large is dead in the JS apart from the legacy heuristic, which is intentionally kept for `?nolink=1` and old DBs.

---

## 10. Tests and smoke tooling

- **`extract/match/smoke_matrix.py`** (data repo) drives real Safari via AppleScript.
  - Usage: `python3 smoke_matrix.py --site <base> --db <configUrl> [--out reports/…] [--private] [--limit N] [--seed 20260922]`.
  - It opens **`{site}/plain.html?db={db}&{token}=1`** (it only ever tests plain.html), forces `localStorage wcv-lang='en'` and reloads.
  - Global checks via `window._integrity`: `hasLinkTable()===true`; `lookupLink('NO-SUCH-KEY').decision==='missing'`; `linkDisabled===false`; `verifyBuild()===true`; JS errors captured.
  - For one parcel per municipality × decision from `match.db`, it calls `_map.jumpTo(…zoom 18)`, polls `querySourceFeatures('parcels')`, fires a synthetic `click` via `_map.fire('click',{point,lngLat})`, then reads `#pbody.innerText` until it contains neither 'Looking up' nor 'Slaan waardasie'.
  - It asserts `EXPECT` substrings (`smoke_matrix.py:25-32`):
    - accepted_high must contain "municipal market value" and must not contain "unverified", "Could not link" or "Not in this data build".
    - accepted_group: "sectional-title units", not "municipal market value" or "Could not link".
    - review: "possible match" or "Could not link", not "Verified link".
    - ambiguous: "several entries fit", not "municipal market value" or "Verified link".
    - not_in_roll: "No valuation found", not "municipal market value" or "unverified".
    - abstain: "Could not link", not "municipal market value" or "Verified link".
  - It also asserts that no drawn feature has `WSTATUS≠'C'`.
  - Last runs: `reports/smoke-final-b-2b502178f94f` (131/131) and `reports/smoke-live-D/smoke.json` (14/14, all global checks true).
  - **To point it at a redesign preview:** serve the preview anywhere and pass `--site http://localhost:PORT` (or a Pages branch or fork URL) and `--db <production configUrl>` or a local `http://localhost:PORT/data/db/config.json`. The preview must keep `plain.html`, the `?db=` handling, `window._map`, `window._integrity`, the `parcels` source and `parcels-fill` click layer, `#pbody`, and the English substrings.
- **`scripts/verify_remote_db.sh data/db/manifest.json`** downloads every chunk, checks the per-chunk and whole-file sha256 and size, then runs `PRAGMA integrity_check`.
- **`scripts/rollback_db.sh <namespace>`** rewrites configUrl in map.js and atlas.js, bumps `?v=` in the three pages, then commits and pushes.
- Data repo `extract/match/test_export.py`: manifest/chunk hashes, `databaseLengthBytes`, prop and link row counts, the decision vocabulary, no dangling pids. Plus 39 pytest unit tests (`.venv/bin/python -m pytest -q`).
- There is **no JS unit test, lint or `package.json`**; the July audit used `node --check`. **The Atlas (index.html) and map.html have no automated check at all.** B3 would have been caught by a single hover in any browser test.

---

## 11. Existing design documents

- `design/design_handoff_wc_valuation_atlas/README.md` + `.dc.html` (June): the original editorial prototype (Newsreader serif, paper/cream palette, teal accent, Voronoi towns, scroll-reveal dashboard). **Largely superseded** by the July Apple/Flighty re-skin (`1f69656`; tokens.css cites `design-specs/apple-maps.md` + `flighty.md`, which are **not in this repo**). Still authoritative:
  - the planar-Mercator + `geoIdentity` rendering gotchas;
  - island clipping;
  - the CSS-transform zoom formula;
  - "nothing hardcoded" data rule.
  The Voronoi town layer was deliberately removed ("no fabricated geography", project notes).
- `docs/apple-design-audit-2026-07-19.md`: contrast fixes (`--label2` .75), keyboard reachability, 44 px targets, the 11 px type floor, focus ring, copy sweep. **Deferred items are still open:** rem-based sizing, off-grid spacing, one-off radii, the untokenised chip shadow `0 1px 4px rgba(0,0,0,.18)` ×5, heavy dark shadows, and accent-tinted non-interactive kickers.
- `docs/superpowers/specs/` (all shipped):
  - map-view (06-22)
  - parcels click-to-valuation (07-02)
  - wards (07-02)
  - performance & stats (07-03): M1 is the overlap chooser, M2 the DB read path, M5 the panel sections
  - provenance popover (07-05)
  - explainer/authorities (07-06)
  - politics (07-07)
  - place search + plain map (07-19)
  - parcel-link (09-22)

  One point in the parcel-link spec is superseded: it says "no row → today's heuristic". DC §9 and the code instead say a missing key means "Not in this data build".
- `docs/superpowers/plans/`: the implementation plans for the above.
- `.superpowers/sdd/`: task reports for the municipal-politics rollout. **Paused 2026-07-07 at Task 5, 1/25** (stats.json now shows politics for 2/25 munis). `#secPolitics` auto-hides elsewhere.
- `handoff.md` (2026-09-22) is Supabase/quota-oriented. It says the site reads `v9/`, which is **stale**: the code reads `b-2b502178f94f`.

---

## 12. Invariants a front-end redesign must not break

1. **Golden rule:** no figure is hard-coded. Everything shown comes from `stats.json`/`towns.json`/`search.db`/`rates.json`. Generated files (`m/`, `d/`, `af/**`, `sitemap.xml`, `data/*.json` except `rates.json`, `data/geo/places.json`, `sg-towns.json`) are never hand-edited. Change the `templates/` or the generator instead (DC §1, §13.1). Templates: **no literal `$`** outside placeholders.
2. **Graceful degradation:** every optional field or section auto-hides (`showSec`, DC §5). Keep the honest empty states: "No valuation found", "No public valuation roll", "No distribution data for this area.", and the rest.
3. **Deep-link hash contract:** `index.html#m/<slug>` and `#d/<slug>`, slug = `name.strip().lower().replace(" ","-")` (the same as `export_pages.slugify`), `replaceState` only. Unknown slugs fall back to the province view. `#m/city-of-cape-town` renders the no-data state (DC §13.4). Map pages: `#p/t…|s…|m…` (DC §14).
4. **Single-URL SPA and map pages.** No `/af/index.html` exists. Language comes from `localStorage['wcv-lang']`, then the device language. The i18n key is the **English string**. Every new user-facing EN string needs an `af` entry in `data/i18n-af.json`. Slugs, URLs, hashes and SQL filters stay English; only display names go through `names`.
5. **Search DB location and integrity:** the Supabase absolute `configUrl` literal in **both** `map.js` and `atlas.js` (the `rollback_db.sh` regex), the vendored worker and wasm paths, `ensureDB` retry and pre-warm semantics, `verifyBuild` fail-closed across the three `build_id`s + the size check, link-table-first, and "missing key ⇒ 'Not in this data build', never a fallback". `?db=` and `?nolink=1` must keep working on the map pages.
6. **Disposition semantics** (DC §9):
   - accepted_high: the only certain single card ("verified").
   - accepted_group: a unit list; the sum appears only when `complete`, and is labelled as a sum of units, not the erf's R0 value.
   - review: a list labelled a possible match, never a certain card; `show=0` means nothing is listed.
   - ambiguous and abstain: only the filtered `cands`, labelled unverified; `n_rejected`/`n_weak` are reported, never listed.
   - not_in_roll: "No valuation found".
   - CoCT scheme route: sum only on an exact reference; name-prefix matches show counts only; same-named schemes get a chooser and are never merged.
   - The **Integrity rule**: a click never shows another municipality's rows (the `muniAt` gate).
7. **Smoke-test surface:**
   - `plain.html` exists and accepts `?db=`.
   - `window._map` (a MapLibre Map) and `window._integrity` exist.
   - The source id `parcels`, the click layer `parcels-fill`, and `WSTATUS` on feature properties.
   - `#pbody` holds the panel text.
   - The EXPECT substrings in English: "municipal market value", "sectional-title units", "possible match", "Could not link", "several entries fit", "No valuation found", "Verified link", "unverified", "Not in this data build". Loading text contains "Looking up" (EN) or "Slaan waardasie" (AF).
   - The loading placeholder must be replaced in the same `#pbody` element.
8. **Cadastre rules:** only `WSTATUS='C'` is drawn and clickable (server filter + client filter). The parcels source keeps the attribution "Parcels: Surveyor-General / Western Cape Government (as-is)". No owner names, ever (POPIA). The live fetch stays at zoom ≥15.5. The degrade hint "Erf boundaries unavailable right now".
9. **Theme tokens:** the six `--map-*` tokens live on the `[data-theme]` pins, not on base `:root` (DC §15). map.html pins dark, plain.html pins light. JS reads the tokens via `cssVar()`.
10. **Cache-busting:** bump `atlas.js?v=` / `map.js?v=` (and the import `?v=` on places.js/rates.js, `rates.json?v=`) on change. `rollback_db.sh` expects the `(map|atlas).js?v=N` pattern in `index.html`, `map.html` and `plain.html`.
11. **SEO and crawl:** `#siteFooter` static link to `m/index.html` in index.html. Canonical, og and hreflang structure. `plain.html` and `map.html` are listed in the sitemap. The generated pages sit exactly one directory below their language root (the `${root}` prefix). `google4a9f7e6a1f57c0ea.html` must never be deleted. `404.html` is hand-written.
12. **Honesty copy:** "roll value ≠ today's sale price" caveats (panel, `#dashNote`, provenance, detail note). The affordability block stays labelled as an estimate. Rates appear only when a verified tariff exists: no default, and no rates figure when the municipality is absent.
13. **Git:** website-repo commits carry the owner's authorship only (project notes).
