# Satellite map view — design spec

**Date:** 2026-06-22 · **Status:** approved (design) · **Repo:** `western-cape-valuations` (website)
**Increment:** #1 of the map feature — *the map shell only*. Later increments add parcels + click-to-valuation.

---

## 1. Goal & context

The long-term goal is a **Cape-Farm-Mapper-style map view** of the site: high-resolution **aerial/satellite
imagery** with municipal **cadastral parcels (erven)** drawn on top, where clicking a parcel highlights it and
shows that property's municipal valuation.

The site today (`index.html` + `assets/atlas.js`, vanilla HTML/CSS/JS + D3 v7, no build step, GitHub Pages)
has only a **D3 SVG choropleth** (district → municipality drill-down) — *not* a slippy tile map. This feature
adds a genuinely new **"Map" view** alongside the existing **"Atlas" view**, switchable via a toggle.

This spec covers **only the first increment: standing up the satellite map shell.** It deliberately defers the
geometry pipeline so that no mistake here forces a restart — the basemap and the data layers are isolated,
swappable concerns.

## 2. Scope

**In scope (this increment):**
- A new page `map.html` rendering a full-screen **MapLibre GL JS** map of the Western Cape using **aerial
  satellite imagery**.
- Pan/zoom **bounded to the Western Cape**, with sensible min/max zoom.
- Map navigation controls (zoom, compass), a scale control, and correct **imagery attribution**.
- An **"Atlas ⇄ Map" toggle** in the chrome of both pages, styled to match the site.
- Site look-and-feel applied to the page chrome (warm paper `#f3efe6`, teal `#1f6f63`, Newsreader serif);
  the imagery itself is the canvas.
- Module structure (`assets/map.js`) with **reserved seams** (`addParcels()`, `onParcelClick()`) so later
  increments are additive.

**Explicitly out of scope (later increments — named so they aren't half-built now):**
- Any parcel/erf polygons or points on the map.
- Click-to-highlight and click-to-valuation behaviour.
- The geometry-acquisition pipeline (WC SG Planning Cadastre → join → `parcels.pmtiles`) — see
  `MAP-FEASIBILITY.md` in the sibling extraction repo.
- Reusing/extracting the `#propdetail` valuation modal (only needed once parcels are clickable).
- Any change to the existing data path (`stats.json`, `towns.json`, `data/db/` on Supabase) — **untouched.**

## 3. Architecture

**A separate page, not an in-place view swap.**

```
index.html  (Atlas — D3 choropleth + dashboard)   ──[ toggle ]──►  map.html  (Map — satellite)
 assets/atlas.js  (unchanged except a toggle link)                  assets/map.js  (new)
```

- `map.html` — a thin page shell that mirrors the site's fonts/colors and hosts a single full-bleed map
  container plus the toggle. No D3, no dashboard.
- `assets/map.js` — an ES module (loaded the same way `atlas.js` is) that owns all map logic.
- **MapLibre GL JS** + its CSS loaded from CDN, pinned to a specific recent stable version (same pattern as
  D3 loaded from CDN today — no build step, no bundler).
- **Rationale for a separate page:** the existing Atlas (`atlas.js`) is left byte-for-byte intact apart from
  adding one toggle link, so the new map **cannot break the existing site**. It also keeps map state and D3
  state from entangling. Merging into a single-page toggle later (if ever wanted) is possible but unnecessary
  and riskier now. This is the lowest-risk, non-corner-painting choice.

### Module shape of `assets/map.js`
```
initMap()        → create the maplibregl.Map (container, style, bounds, zoom limits, controls)
addBasemap()     → register the satellite raster source + layer + attribution
addParcels(src)  → RESERVED (no-op this increment): will add the parcel source/layer
onParcelClick()  → RESERVED (no-op this increment): will resolve a clicked feature → valuation UI
```
`initMap()` and `addBasemap()` are implemented now; the two reserved functions exist as documented stubs so
the next increment fills them in without touching the shell.

## 4. Basemap (satellite imagery)

- **Primary source: Esri World Imagery** (raster XYZ), free, no API key, ~24 zoom levels (validated live
  serving JPEG tiles over the Western Cape):
  - Tiles: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`
  - ⚠️ **Esri tile path is `{z}/{y}/{x}` (y before x)** — write the URL placeholders in that order.
  - `tileSize: 256`, `maxzoom` capped at **19** (imagery is densest at ≤19; avoids blank high-zoom tiles).
  - **Attribution (required):** "Esri, Maxar, Earthstar Geographics, and the GIS User Community."
- **Swappable seam.** The basemap source lives only inside `addBasemap()`. Alternatives we may evaluate later
  are a one-function change, not a restart:
  - **NGI `RSA_NGI_AERIAL`** (`imagery.esri-southafrica.com`, public ImageServer) — South African government
    aerial imagery; **served via dynamic `exportImage`, not cached tiles**, so usable via a MapLibre WMS-style
    bbox-templated raster source but slower; a *local-licensing* upgrade to assess later.
  - **EOX Sentinel-2 cloudless** (CC-BY) — free, but ~10 m resolution: fine when zoomed out, too coarse to
    see an individual erf. Possible low-zoom layer only.
- **Licensing:** Esri World Imagery is free to use with the attribution above (standard for public-good
  sites). NGI is the fully open SA-government fallback if we ever want zero third-party dependency.

## 5. Map configuration

- **Initial framing (responsive):** the map is **fit to the Western Cape extent on load**
  (`bounds ≈ SW [17.2, -34.95], NE [24.3, -30.55]`, `fitBoundsOptions.padding 30`) rather than a hardcoded
  center/zoom, so the whole province frames itself on any viewport aspect — wide desktop or tall phone.
- **Pan clamp (`maxBounds`):** a deliberately **generous** box (`SW [13, -41.5], NE [28, -24.5]`). It must be
  tall: framing the wide province on a tall phone exposes ~15° of latitude, so a tight clamp would force a
  zoom-in to obey it (this caused a "too close up on phone" bug during build). The clamp only prevents panning
  off across the country; the load-fit does the framing.
- **Zoom:** `minZoom 4.8`, `maxZoom 19` (matches imagery).
- **Controls:** `NavigationControl` (zoom + compass, top-right), `ScaleControl`, and an `AttributionControl`
  carrying the imagery credit. Cooperative gestures are not required (desktop + mobile pan/zoom default is fine).
- **Style:** a minimal MapLibre style object defined inline in `map.js` (one raster source + one raster layer)
  — no external style JSON needed for an imagery-only map.

## 6. The toggle

- A small **"Atlas ⇄ Map"** control added to the chrome of **both** pages:
  - On `index.html`: a link styled to sit with the existing header controls (does not disturb the D3 map,
    search, legend, or dashboard).
  - On `map.html`: the mirror link back to the Atlas.
- Implemented as plain anchor links between the two static pages (no JS state to manage). Styled with the
  site's existing tokens (teal accent, uppercase letter-spaced label) so it reads as part of the design.
- The only edit to existing files is adding this toggle link to `index.html` (and bumping the `?v=` query on
  `atlas.js` only if `atlas.js` itself changes — it should not need to).

## 7. Responsiveness & chrome

- `map.html` is full-viewport (`100dvh`) with the map filling it; the toggle and attribution overlay the map,
  matching the translucent-panel treatment the Atlas already uses for its legend/search.
- Mobile: the map is touch pan/zoom; controls sized for touch; respects safe-area insets like the existing
  mobile bar. No separate mobile layout work beyond control placement.

## 8. Error handling

- **Imagery tiles fail to load:** MapLibre renders the map background color for missing tiles; the map remains
  pannable. We set a neutral map `background` so a tile outage degrades to a blank canvas, not a broken page —
  consistent with the site's "degrade quietly" principle. No hard error surfaced to the user.
- **MapLibre CDN fails to load:** `map.html` shows a brief inline fallback message ("Map failed to load —
  view the Atlas") linking back to `index.html`. The Atlas view is unaffected.

## 9. Verification (how we'll confirm the increment works)

- `map.html` loads and shows Western Cape aerial imagery.
- Panning is clamped to the WC; zoom respects min/max; imagery sharpens to rooftop level near `maxZoom`.
- Imagery attribution is visible.
- "Atlas ⇄ Map" toggle navigates both directions; the Atlas view is visually and behaviourally unchanged.
- Works on a desktop and a mobile viewport.
- No console errors; the existing site's data path is untouched.

## 10. Files

| File | Change |
|------|--------|
| `map.html` | **new** — page shell + map container + toggle + CDN MapLibre |
| `assets/map.js` | **new** — `initMap()` + `addBasemap()` implemented; `addParcels()` / `onParcelClick()` reserved stubs |
| `index.html` | **edit (minimal)** — add the "Map" toggle link to the header chrome |

No changes to `atlas.js`, `data/**`, `DATA_CONTRACT.md`, or the Supabase assets in this increment.

## 11. Deferred decisions (recorded, not blocking)
- Esri vs NGI imagery for the long term (revisit if Esri terms/currency become a concern).
- Where `parcels.pmtiles` is hosted (expected: Supabase Storage, per the existing `search.db` pattern).
- Whether the eventual click-to-valuation reuses `#propdetail` via a shared module (expected: yes).
