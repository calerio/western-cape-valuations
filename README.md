# Western Cape Property Valuation Atlas

An interactive, editorial-style choropleth map for exploring municipal **property valuations**
across the Western Cape, South Africa. Drill **South Africa → Western Cape → district →
municipality**, with fluid zoom, hover tooltips, search, and a scroll-reveal stats dashboard.

**Live:** https://calerio.github.io/western-cape-valuations/

## How it works
- **Static site on GitHub Pages** — vanilla HTML/CSS/JS + **D3 v7**. No build step, no server.
- **Map:** self-hosted boundary GeoJSON (provinces / WC districts / WC municipalities), rendered
  with the planar-Mercator + `d3.geoIdentity()` approach (winding-agnostic) and CSS-transform zoom.
  **Municipality is the finest level** — it is the smallest area with reliable, openly-published
  boundaries. Suburb/town borders aren't released as open data, so we deliberately don't fake a
  finer subdivision; instead the municipality view carries a richer detail panel.
- **Dashboard:** at each level a scroll-reveal breakdown shows median / average / total / parcels,
  a **price-distribution histogram** (parcels by value band), children ranked by median (province
  & district) or a quartile **valuation spread** (municipality), plus two "perspective" cards —
  the single **most valuable property** and the **most affordable home** (address, suburb, value,
  m² and R/m²).
- **Stats** (`data/stats.json`, `data/towns.json`): province / district / municipality figures —
  totals, mean, **true median**, quartiles, min/max, residential average, value-band histogram and
  extreme properties — **generated from the source valuation database, never hardcoded.** Re-running
  the export refreshes everything.
- **Search** (`data/db/`): area names (district / municipality) and suburb names (which jump to the
  parent municipality) **plus** per-property **address** search via
  [`sql.js-httpvfs`](https://github.com/phiresky/sql.js-httpvfs) — real SQL over a chunked static
  SQLite file (HTTP range requests; only a few KB fetched per query).

## Data
24 Western Cape local municipalities, ~514,000 properties, current/recent valuation cycles
(Witzenberg & Laingsburg are on older cycles — no newer complete roll is published). City of Cape
Town is search-only at source and shown as "no public roll". Owner names are not stored.

## Regenerating the data
From the extraction project: `python3 extract/build.py` then `python3 extract/export_site.py`,
which writes `data/stats.json`, `data/towns.json`, and the chunked `data/db/` here.

## Credits & design
Built to the **WC Valuation Atlas** design handoff (see `design/`). Boundary data derived from the
Municipal Demarcation Board (via HDX, CC BY). Fonts: Newsreader + Libre Franklin.

*Public data, shared for transparency and ease of access.*
