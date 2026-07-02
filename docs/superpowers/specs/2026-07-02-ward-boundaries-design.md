# Ward boundaries on the Atlas and the satellite map — design

**Date:** 2026-07-02 · **Status:** approved for implementation (user pre-authorised: "if yes, do it")

## Goal

Show municipal **ward boundaries** on both public views:
- the **Atlas** (d3 SVG choropleth, `index.html` + `assets/atlas.js`), and
- the **satellite map** (MapLibre, `map.html` + `assets/map.js`).

Wards are an *orientation overlay* — no per-ward statistics. The valuation DB has no
ward assignment per property, so ward-level stats would need a 535k-parcel spatial
join; that is explicitly out of scope (noted as future work).

## Data

**Source (authoritative, already-trusted server):** Western Cape SpatialDataWarehouse
ArcGIS — `AfriGIS_MainAdminBoundaries/MapServer/10` ("Wards", SOURCE = Municipal
Demarcation Board, UPDATED 2024-04-19, current post-2021 delimitation). 406 wards
cover the whole province (116 City of Cape Town + 290 across the 24 locals);
`maxRecordCount` 2000, so a single query returns everything.

**Approach chosen: one committed, simplified GeoJSON** — `data/geo/wc-wards.geojson`
(~1 MB at `geometryPrecision=5&maxAllowableOffset=0.0002`), following the existing
pattern of `wc-districts` / `wc-municipalities`. Properties trimmed to:
`ward` (int, last 3 digits of WARD_NO), `ward_id` (full MDB WARD_NO),
`muni` (S12_NAME with " Local Municipality"/" Metropolitan Municipality" stripped —
matches our municipality names 1:1, verified for all 25).

Alternatives rejected:
- *Live viewport queries* (like the cadastre): boundaries change ~once per election
  cycle; a static file is faster, simpler, and keeps the map working if the service
  is down.
- *Ward choropleth with stats:* needs the spatial join (future work).

## Satellite map (`map.js` → `?v=5`)

- `wards` GeoJSON source + three layers, inserted **below** the parcel layers:
  - `ward-fill` — transparent (opacity 0), exists only so click queries can resolve
    "which ward is this point in".
  - `ward-lines` — amber dashed lines (`#eab308`-family, distinct from the white
    parcel lines and the muni outline), `minzoom` 8.5, width/opacity interpolated
    by zoom.
  - `ward-labels` — "Ward N" symbols from zoom 10.5, dark halo for readability.
- **Toggle chip** ("Wards") next to the existing hint UI; default ON; hides all
  three layers.
- **Panel enrichment:** the click-to-valuation panel appends a "Ward N" row using
  the `ward-fill` hit at the click point (2021 delimitation, MDB).
- Attribution line gains "Wards: Municipal Demarcation Board".

## Atlas (`atlas.js` → `?v=12`)

- Ward GeoJSON is fetched **lazily** on first drill into a municipality (keeps the
  ~1 MB off initial page load), cached for the session.
- New `gWard` SVG group between `gMuni` and `gLabel`. At drill level 3
  (municipality) it renders that municipality's wards: no fill,
  `pointer-events:none` (municipal hover/tooltip keeps working), thin dashed dark
  stroke, ward-number labels at ward centroids (`font-size ≈ 9/k`, like existing
  labels). Cleared/hidden at other levels.
- The muni-level dashboard note ("Municipality is the finest level…") is updated to
  say ward boundaries are shown on the map for orientation.

## Error handling

- Fetch failure of `wc-wards.geojson` degrades quietly: both maps simply show no
  wards (matches the site's degrade-don't-break contract §5).
- Ward features whose `muni` doesn't match a drilled municipality never render.

## Testing / verification

1. Local: `npx http-server` — Atlas drill to Stellenbosch shows ward lines +
   numbers; satellite map at z≥10.5 shows amber dashed lines + "Ward N" labels;
   clicking an erf shows the ward row; toggle hides everything.
2. Live after push: repeat on GitHub Pages (Playwright).
3. DATA_CONTRACT: bump both script versions (invariant 5); document the new geo
   file in §4.

## Future work (explicitly out of scope)

- Per-ward valuation stats (needs point-in-polygon assignment of 535k parcels into
  the DB — a build-time spatial join; would enable ward choropleth + ward drill).
