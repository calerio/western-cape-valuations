# Western Cape Property Valuations

An interactive map of **municipal property valuations across the Western Cape**, South Africa.
Zoom from the province → districts → municipalities, hover for totals, and search any address.
All figures are public municipal valuation-roll data (values for *rates*, not market prices).

**Live site:** https://calerio.github.io/western-cape-valuations/

## How it works
- **Static site on GitHub Pages** — no server.
- **Map:** D3 + GeoJSON boundaries, with smooth zoom-to-region drill-down.
- **Stats** (`data/stats.json`): per-province / district / municipality totals, mean, median,
  quartiles, min/max and residential average — **generated from the source database**, never
  hardcoded. Re-running the export after a data update refreshes everything.
- **Address search** (`data/search.db`): the valuation roll is queried *in the browser* with
  [`sql.js-httpvfs`](https://github.com/phiresky/sql.js-httpvfs) — real SQL over a static SQLite
  file via HTTP range requests, so only a few KB are fetched per query.

## Data
- 24 Western Cape local municipalities, ~514,000 properties, current/recent valuation cycles
  (two municipalities — Witzenberg, Laingsburg — are on older cycles; no newer complete roll is
  published). City of Cape Town is search-only at source, so it is not yet included.
- Built from each municipality's official general valuation roll. Owner names are not stored.

## Regenerating the data
From the extraction project (separate repo): `python3 extract/build.py` then
`python3 extract/export_site.py`, which writes `data/stats.json` + `data/search.db` here.

*Public data, shared for transparency and ease of access.*
