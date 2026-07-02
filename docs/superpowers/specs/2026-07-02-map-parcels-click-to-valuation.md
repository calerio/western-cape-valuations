# Map increments #2+#3 — parcels + click-to-valuation (as built)

**Date:** 2026-07-02 · **Status:** built & browser-verified · **Repo:** `western-cape-valuations`
Completes the map feature begun in `2026-06-22-map-view-design.md` (increment #1, the shell).

## Decision: live cadastre queries, not PMTiles (for now)

MAP-FEASIBILITY.md (extraction repo) sketched a pre-built `parcels.pmtiles` pipeline (full
province pull → tippecanoe → Supabase). We shipped its **"open decision #4" lighter alternative
instead**: fetch parcels **live per viewport** from the WC SG planning cadastre and join on click.

Why: zero new hosting, zero geometry storage, no dependence on the (then-blocked) Supabase upload,
~150 lines instead of a multi-day pipeline — and the seams are unchanged, so PMTiles remains a
drop-in upgrade for `addParcels()` if the live service ever hurts.

## How it works

- **Parcels (#2):** at zoom ≥ 15.5, each `moveend` (debounced 250 ms, AbortController-cancelled)
  queries `SG_PlanningCadastre/MapServer/1` with the viewport envelope
  (`outFields=TAG_VALUE,Town_name,PRCL_KEY`, `outSR=4326`, esriJSON → GeoJSON inline).
  CORS was verified against the GitHub Pages origin. Below that zoom: municipality outlines
  (`data/geo/wc-municipalities.geojson`) + a "Zoom in to see erven" hint chip.
- **Click (#3):** `promoteId: PRCL_KEY` + feature-state highlight; the erf's digits are looked up
  in `search.db` on `prop.erf_int` (new indexed column, DATA_CONTRACT §4.2/§9), falling back to an
  FTS erf-token match (bare + 8-digit zero-padded) while the hosted DB predates `erf_int`.
- **Ranking:** cadastre `Town_name` vs `prop.suburb` (score 4-5) beats `prop.muni` (1-2), because
  several towns share a municipality (Stellenbosch town vs Franschhoek: both muni "Stellenbosch").
  Multiple same-score rows = genuine portions/sectional units → list view; muni-level-only matches
  are labelled "same erf number, other townships — may not be this parcel"; zero matches = an
  honest "No valuation found" card.

## Verified (Playwright, local server + local DB chunks)

- Stellenbosch University erf 17324 → single detail card SB17324 · R946.61m · 98 532 m² (the
  join case validated in MAP-FEASIBILITY.md).
- Erf 3350 → 2-valuation list → detail with back-link.
- Erf 2590 (town erf unvalued in roll) → 3 other-township rows, correctly caution-labelled.
- Zoom-out → parcels clear, hint returns. No console errors.

## Gotchas learned (don't relearn)

- **MapLibre rejects zoom expressions nested inside `case`** — the layer *silently never draws*
  (the error only surfaces via the map `error` event). Zoom `interpolate` must be the top-level
  expression; put the `case` inside the stops. This bug shipped briefly as "invisible parcel lines".
- `queryRenderedFeatures` "sees" near-invisible fills — don't use it to conclude lines render.
- Esri World Imagery has a few metres of georegistration offset vs the survey-accurate cadastre in
  places; parcel lines through building interiors are usually *real* sub-parcels, not bugs. The SA
  NGI aerial layer is the swappable basemap alternative if offset becomes a complaint.
- Cadastre town ≠ municipality: never treat a muni-name match as parcel-level confidence.

## Deferred

- PMTiles pipeline (scale/perf upgrade path — MAP-FEASIBILITY.md).
- Deep-linking a clicked parcel into the Atlas rates estimator.
- Sectional-unit search exposure (`unit_no` still not in the search export).
