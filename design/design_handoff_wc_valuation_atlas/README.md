# Handoff: Western Cape Property Valuation Atlas

An interactive, editorial-style choropleth map for exploring municipal **property valuations** in the Western Cape, South Africa. The user starts on a map of South Africa where only the Western Cape reads as a province, then drills **South Africa → Western Cape → district → local municipality → town**, with a fluid "Apple-style" zoom at each step, hover tooltips, search, and a scroll-reveal statistics dashboard.

---

## About the design files

The file in this bundle — `Western Cape Property Valuations.dc.html` — is a **design reference created in HTML** (a working prototype showing the intended look, motion, and behaviour). It is **not** production code to ship as-is.

Your task is to **recreate this experience in the target codebase** using its established stack and patterns (React + D3, Vue + D3, Svelte, etc.). If there is no existing front end yet, **React + `d3` (or `d3-geo` + `d3-delaunay`) + a light state store** is the natural choice and mirrors how the prototype is built.

> The prototype is a self-contained "Design Component": one HTML file with an inline `<style>`, a D3-driven `<svg>` built imperatively, and a small logic class. Read it alongside this README — every behaviour described here exists and works in that file.

## Fidelity

**High-fidelity.** Final colours, typography, spacing, motion, and interaction model. Recreate it pixel-faithfully. The only placeholder is the **valuation numbers** (see *Data*), which are deliberately generated so they can be swapped for a real source without touching layout.

---

## The single most important implementation detail (read first)

The map geometry is **real**, fetched at runtime from the open **geoBoundaries** dataset (CC BY 4.0). Three gotchas cost the most time — handle them exactly:

1. **Use the Git-LFS media endpoint, not `raw.githubusercontent.com`.** geoBoundaries stores these files in Git LFS; the normal raw URL returns an LFS *pointer*, not JSON. Use:
   ```
   https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/main/releaseData/gbOpen/ZAF/ADM1/geoBoundaries-ZAF-ADM1_simplified.geojson   // provinces (9)
   …/ZAF/ADM2/geoBoundaries-ZAF-ADM2_simplified.geojson   // districts/metros (52)
   …/ZAF/ADM3/geoBoundaries-ZAF-ADM3_simplified.geojson   // local municipalities (213)
   ```
   Each feature's name is in `properties.shapeName`. **In production, host/cache these yourself** (CORS is open, but don't depend on GitHub at request time).

2. **Clip off the Prince Edward / Marion Islands before projecting.** geoBoundaries' "Western Cape" and "City of Cape Town" include the sub-Antarctic islands (~37°E, ‑47°S). Left in, they blow up the bounding box and break the projection. Drop any polygon ring with no vertex inside mainland bounds `lng ∈ [14,34], lat ∈ [-35.6,-21]` (for a `MultiPolygon`, filter its member polygons; collapse to `Polygon` if one remains).

3. **The polygons are wound the opposite way to what d3's *spherical* path expects** — so `d3.geoMercator()` / `geoPath` render each province as "the whole globe minus a hole" (you get a solid rectangle) and `d3.geoBounds` returns `[[-180,-90],[180,90]]`. Fix by **pre-projecting to planar Mercator and rendering with `d3.geoIdentity()`** (planar, even-odd fill, winding-agnostic):
   ```js
   // forward web-mercator, in place, on every coordinate of ADM1/2/3:
   const conv = a => { if (typeof a[0] === 'number') {
       const lng=a[0], lat=a[1];
       a[0] = lng*Math.PI/180;
       a[1] = Math.log(Math.tan(Math.PI/4 + lat*Math.PI/360));
     } else a.forEach(conv); };
   features.forEach(f => f.geometry && conv(f.geometry.coordinates));

   const projection = d3.geoIdentity().reflectY(true)
       .fitExtent([[46,40],[W-46,H-40]], adm1FeatureCollection);   // W=1000, H=760
   const path = d3.geoPath(projection);
   ```
   After this, `path(feature)`, `path.bounds(feature)`, and `path.centroid(feature)` all return pixel coordinates in the `1000×760` viewBox and behave correctly. (If you'd rather keep a spherical projection, run the features through a topojson round-trip or `d3-geo-projection`'s rewind first — but the planar approach above is what the prototype ships.)

---

## The four levels (drill-down hierarchy)

| Level | Shows | Source | Click target |
|---|---|---|---|
| **country** | All 9 SA provinces. Non-WC = flat beige, **no internal borders** (single landmass effect). WC = tinted + dark outline, clickable. | ADM1 | WC → province |
| **province** (Western Cape) | The **6 WC districts** as a choropleth. | ADM2, filtered to WC | district → district |
| **district** | The district's **local municipalities** as a choropleth. | ADM3, filtered by name | municipality → municipality |
| **municipality** | **Towns** as Voronoi cells clipped to the municipality outline (real town polygons aren't in the open data — see *Towns*). | generated | terminal |

**The WC hierarchy is hardcoded by name** (geoBoundaries has no parent-key linking ADM3→ADM2→ADM1), and is correct:

- **City of Cape Town** (metro) — district *City of Cape Town*: `City of Cape Town`
- **West Coast**: Matzikama, Cederberg, Bergrivier, Saldanha Bay, Swartland
- **Cape Winelands**: Witzenberg, Drakenstein, Stellenbosch, Breede Valley, Langeberg
- **Overberg**: Theewaterskloof, Overstrand, Cape Agulhas, Swellendam
- **Garden Route** (the ADM2 feature is still named **"Eden"** — relabel for display): Kannaland, Hessequa, Mossel Bay, George, Oudtshoorn, Bitou, Knysna
- **Central Karoo**: Laingsburg, Prince Albert, Beaufort West

Match names with a normaliser (`lowercase`, strip non-letters) so spelling/spacing differences resolve. The full town list per municipality is in the prototype's `TOWNS` map — copy it verbatim.

---

## Layout & screens

Design canvas reference: SVG viewBox **1000 × 760**; the prototype page is full-viewport.

### Screen 1 — Map stage (`100vh`, `overflow:hidden` until WC is entered)
- **Background**: `radial-gradient(120% 90% at 30% 0%, #f7f3ea 0%, #efe9dc 70%, #e9e2d2 100%)`.
- **SVG map**: absolutely fills the stage (`inset:0`).
- **Title block** (top-left, `top:34px left:38px`, `pointer-events:none`):
  - Kicker: `MUNICIPAL PROPERTY VALUATIONS` — 11px, weight 600, `letter-spacing:.22em`, colour = theme accent `#1f6f63`.
  - Headline: current focus name — **Newsreader serif**, 54px, weight 400, `line-height:.96`, `letter-spacing:-.015em`, `#1a1714`. ("South Africa" → "Western Cape" → district → municipality.)
  - Subline: Newsreader *italic*, 18px, `#6f685c` (e.g. "Six districts · 2024 / 25").
- **Search** (top-right, width 312px): input with inset search glyph, `padding:11px 14px 11px 40px`, `border:1px solid rgba(26,23,20,.16)`, `border-radius:2px`, translucent paper bg `rgba(251,249,243,.92)` + `backdrop-filter:blur(6px)`, 13.5px. Results dropdown: paper card, 1px hairline rows, label left + uppercase 10.5px sub right.
- **Legend** (bottom-left): paper card; uppercase 10px title (`MEDIAN VALUE · DISTRICT/MUNICIPALITY/TOWN`); a 9px gradient bar painted with the active theme ramp; min/max value labels (tabular figures) below. Min/max are **recomputed** from whatever set is currently displayed.
- **Breadcrumb** (bottom-center): paper pill, `›`-separated clickable crumbs (`South Africa › Western Cape › …`) + a `RESET` link (accent, uppercase).
- **Scroll cue** (bottom-right, only once WC entered): `SCROLL FOR THE VALUATION BREAKDOWN ↓` with a pulsing arrow; clicking it smooth-scrolls down one viewport.
- **Tooltip**: `position:fixed`, dark `#1a1714` card, `#f3efe6` text, follows cursor (flips near edges); shows name, Median, Total roll, Parcels, and "Click to explore →" on drillable features.
- **Loading overlay**: paper screen with pulsing Newsreader-italic "Drawing the boundaries…" and a thin indeterminate bar; error copy "Could not reach the boundary service".

### Screen 2 — Valuation breakdown (revealed by scroll once WC is entered)
`min-height:100vh`, `padding:78px 56px 90px`, `background:#f3efe6`, `border-top:1px solid rgba(26,23,20,.1)`, content `max-width:1180px` centered.
- Kicker (accent) + Newsreader 46px scope name + italic 18px sub.
- **Stat row**: 4 columns separated by hairlines, framed top & bottom by `1px solid rgba(26,23,20,.14)`. Each: uppercase 10.5px grey label + Newsreader 40px tabular value. Order: **Median valuation · Average valuation · Total roll value · Registered parcels**.
- **Two-column body** (`1.15fr / .85fr`, gap 64px):
  - Left: "**\<Kind\> ranked**" + "by median value"; one row per child — name + value (right), then a 5px track (`rgba(26,23,20,.07)`) with a fill bar coloured by the choropleth ramp, width = `median / maxMedian`. Rows are clickable to drill in.
  - Right: two paper cards — **Highest median** (accent label) and **Lowest median** (`#b8623c` label), each Newsreader 27px name + value; plus a small grey note ("Figures are recomputed live from the underlying valuation roll…").

---

## Interactions & behaviour

- **Drill in**: click WC (country→province), a district (→district), a municipality (→municipality/towns). Each navigation recomputes the visible layer, the choropleth extent, the legend, and the dashboard, then **zooms**.
- **Zoom ("Apple-style fluid")**: zoom-to-bounding-box of the target feature(s). Compute `k = min(46, 0.84 / max(dx/W, dy/H))`, `tx = W/2 − k·cx`, `ty = H/2 − k·cy` from `path.bounds(...)`. **Animate with a CSS transition on the group's `transform`, not a JS/rAF tween** — `transition: transform .95s cubic-bezier(.4,0,.2,1)`. Set `transform-box:view-box; transform-origin:0 0` on the `<g>` and write `transform: translate(${tx}px,${ty}px) scale(${k})`. (CSS transitions keep working/settle correctly even when the tab is backgrounded; the original d3 `.transition()` froze in hidden tabs.)
  - Keep strokes crisp at any zoom with `vector-effect:non-scaling-stroke`.
- **Layer context**: lower levels stay as a dimmed backdrop — active layer `opacity:1, pointer-events:auto`; the parent layer `opacity:.16, pointer-events:none`; other provinces hold at `opacity:.5`.
- **Labels**: feature centroids (`path.centroid`) / town seed points, rendered inside the zoomed group with `font-size = base/k` (≈12px effective) and a paper-coloured `paint-order:stroke` halo; `WESTERN CAPE` is tracked-out and bold. Toggleable (see tweaks).
- **Hover**: tooltip + raise/darken the hovered shape's stroke.
- **Search**: substring match over a flat index of every district, municipality, and town; selecting a result navigates+zooms to it (towns navigate to their municipality). Blur hides results after ~160ms.
- **Breadcrumb / Reset**: each crumb navigates to that level; Reset returns to country, clears search, scrolls to top.
- **Scroll lock**: at **country** level `document.body.style.overflow = 'hidden'` (it's "just the map"); once WC is entered, set it to `auto` to expose the dashboard.

---

## Towns (Voronoi cells)

Real town/ward polygons aren't in the open dataset, so towns are represented as a **Voronoi tessellation** clipped to the municipality outline:
1. Reject-sample one interior seed point per town inside the municipality polygon (planar point-in-polygon).
2. `d3.Delaunay.from(seedsInPixels).voronoi([x0,y0,x1,y1])` over the municipality's pixel bounds.
3. Render `vor.renderCell(i)` per town, **clip the group to a `<clipPath>` of the municipality `path`**, colour each cell by its town median, draw the municipality outline on top.

When you connect real town/suburb geometry, drop it straight into this layer in place of the Voronoi step — nothing else changes.

---

## Data — **nothing is hardcoded; everything is recomputed**

This is a hard requirement from the client ("the median and stuff shouldn't be hard-coded … if we update the data later I don't want anything to break"). In the prototype the per-area figures are **deterministic placeholders** (seeded hash → stable pseudo-random), and every displayed statistic is **derived** from them:

- Leaf data lives per **municipality** and per **town**: `{ parcels, median, total, avg }`.
- **District** stats = aggregate of its municipalities. **Province** stats = aggregate of districts. Aggregation: `parcels = Σ`, `total = Σ`, `avg = total/parcels`, `median = median(children.median)`.
- Choropleth colour and legend min/max use the **extent of the currently displayed set**, recomputed per level.

**To connect a real source (e.g. Supabase):** replace only the leaf accessors `getMunicipalityStats(name)` and `getTownStats(muni, town)` with queries/joins; keep the aggregation + formatting layer untouched. Suggested shape:
```
parcels(id, municipality_code, town, market_value)   -- one row per property
-- median/avg/total are SQL aggregates (percentile_cont(0.5) … ) grouped by area,
-- or compute client-side from the returned rows. Never store a precomputed median that can drift.
```
Currency formatter (`R`): `≥1e12 → "R{n}tn"`, `≥1e9 → "R{n}bn"`, `≥1e6 → "R{n}m"`, `≥1e3 → "R{n}k"`. Counts use thousands separators (tabular figures).

> On the client's hosting question: SQL can't be "hosted on GitHub." A managed Postgres such as **Supabase** (or any Postgres on the platform they deploy to) is the right home for the valuation roll; the front end queries it over HTTPS. GitHub Pages/Vercel can host the static front end, but not the database.

---

## State

- `level` ∈ `country | province | district | municipality` (derive from a `path` array of `{type,name,label}`).
- `path` — the active breadcrumb chain (drives headline, breadcrumb, dashboard scope, zoom target).
- `searchQuery`, `searchResults`, `showResults`.
- `ready` (geometry loaded) / `error`.
- Map drawing is **imperative D3** (build once, mutate on navigation); keep it outside your reactive render so re-renders don't wipe the SVG. Hover state is handled directly on the DOM (not app state) to avoid re-render churn.

---

## Design tokens

**Colour**
| Token | Value |
|---|---|
| Paper / page bg | `#f3efe6` |
| Card / panel | `#fbf9f3` |
| Ink (text) | `#1a1714` |
| Muted text | `#6f685c` · lighter `#9a9286` |
| Hairline | `rgba(26,23,20,.10)` (heavier `.14`) |
| Land (non-WC provinces) | `#e6e0d3` |
| Choropleth stroke | `#fbf9f3` (white-ish), WC/municipality outline `#1a1714` |
| Low-value accent (lowest-median label) | `#b8623c` |

**Choropleth themes** (tweakable; sequential ramps via `d3.interpolateRgbBasis`)
- **Teal** (default) — ramp `#eef0e3 → #bcd9c7 → #6cab95 → #2f7d6b → #16524a`, accent `#1f6f63`
- **Terracotta** — `#f4ece0 → #e9c9a6 → #d99368 → #bf5c38 → #7d3320`, accent `#bf5c38`
- **Slate** — `#eef1f3 → #c2d0d9 → #8aa6b5 → #4f7186 → #284656`, accent `#4f7186`

**Type** (Google Fonts)
- Display / numbers / headlines: **Newsreader** (serif; 400 + italic). Sizes used: 54 (hero), 46 (dashboard title), 40 (stat values), 27 (high/low), 23/18.
- UI / labels / body: **Libre Franklin** (400/500/600/700). Labels: 10–11px uppercase, `letter-spacing:.12–.22em`. Body 12.5–15px. All figures `font-variant-numeric:tabular-nums`.

**Geometry / motion**
- Radius: `2px` (cards/inputs/pills), `3px` (tooltip).
- Shadows: dropdown `0 14px 40px -18px rgba(26,23,20,.45)`; tooltip `0 12px 30px -10px rgba(0,0,0,.5)`.
- Zoom transition `transform .95s cubic-bezier(.4,0,.2,1)`; layer opacity `.5s ease`; map viewBox `1000×760`, fit padding 46/40, max zoom `k=46`.

**Tweakable props** (surface as settings if useful): `colorTheme` (Teal/Terracotta/Slate), `showLabels` (bool), `valuationYear` (string, shown in sublines/notes).

---

## Assets & libraries
- **No image assets.** Everything is SVG/CSS. The search icon is an inline SVG; gradients/keyframes are inline.
- **Libraries**: `d3` v7 (includes `d3-geo`, `d3-delaunay`/`d3.Delaunay`, `d3-scale`, `d3-interpolate`). Fonts: Newsreader + Libre Franklin (Google Fonts).
- **Geodata**: geoBoundaries ZAF ADM1/2/3 (CC BY 4.0) — **attribute geoBoundaries**, and self-host the files for production.

## Files in this bundle
- `Western Cape Property Valuations.dc.html` — the full working prototype (open it in a browser). It is one file: inline `<style>` + an HTML template + a JS logic class. All names, town lists, ramps, formatters, projection fix, clip bounds, Voronoi setup, and aggregation logic referenced above live here — copy values from it directly.
