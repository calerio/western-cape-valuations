# DATA CONTRACT — Western Cape Valuation Atlas

**Read this before changing the database, the export script, or the site's data files.**
It explains how data flows to the website and the rules that keep the site working **even when
the data is updated, incomplete, or has missing fields**. The site is built to *degrade*, not break
— this document is how you keep it that way.

---

## 1. The pipeline (one direction — always regenerate, never hand-edit)

```
source rolls (PDFs/spreadsheets)
   └─ extract/parsers/*.py  ──>  extract/wc-valuations.db   (SQLite, the source of truth)
                                      └─ extract/export_site.py  ──>  THIS repo's data/:
                                            • data/stats.json          (all aggregate stats)
                                            • data/towns.json          (suburb names for search)
                                            • data/db/  search.db.* + config.json   (per-property SQLite, chunked)
                                                  └─► UPLOAD these 4 files to Supabase Storage (see §8)
                                            • data/geo/*.geojson        (boundaries — committed once, rarely change)
   website (index.html + assets/atlas.js):
       • stats.json · towns.json · geo  → served from THIS repo (GitHub Pages)
       • search.db (chunked SQLite)     → served from SUPABASE STORAGE, not GitHub Pages (see §8)
```

The extraction project lives at `~/projects/western-cape-property-valuations` (NOT git-tracked).
This website repo is the deployed artefact (GitHub Pages). **The search database is the one piece
NOT served from this repo** — it lives in Supabase Storage because GitHub Pages corrupts the HTTP
range requests sql.js-httpvfs depends on (see §8).

**Golden rule:** every number on the site is recomputed from `wc-valuations.db` by `export_site.py`.
**Never** hand-edit `stats.json` / `search.db`, and **never** hardcode figures in `atlas.js`/`index.html`.
To change what the site shows, change the DB (or the export) and re-run the export.

---

## 2. After updating the database — do exactly this

```bash
cd ~/projects/western-cape-property-valuations
python3 extract/build.py            # rebuild wc-valuations.db from the source rolls (if sources changed)
python3 extract/export_site.py      # regenerate stats.json, towns.json, search.db chunks INTO this repo

cd ~/projects/western-cape-valuations
# RE-UPLOAD the regenerated search DB to Supabase Storage — the site reads it from there, NOT this
# repo. Upload the 4 files in data/db/ (config.json + search.db.000/001/002) to the `valuations`
# bucket ROOT: dashboard drag-drop, or `supabase storage cp` (after `supabase login`; run
# `supabase storage cp --help` for the ss:// URI syntax). Objects cache 1h (cache-control
# max-age=3600) — allow up to an hour for new data to show, or version the bucket path + bump the
# configUrl in atlas.js. (If only stats/figures changed and the DB didn't, you can skip this.)

# if you changed assets/atlas.js, bump the ?v=N on its <script> tag in index.html (CDN cache-bust)
git add -A && git commit -m "…"    # commit as the user ONLY — no Claude attribution (see CLAUDE.md)
git push
```

Then verify live: load the site, drill country → WC → district → municipality, open the
"most valuable property" overlay AND search a known address (e.g. "55 Lovell") — those last two
steps prove the Supabase-hosted chunked DB + indexes are intact and reachable.

### Sanity-check the rebuild BEFORE exporting (avoid double-counting)

`build.py` deletes and rebuilds `wc-valuations.db` from whatever source files are present, so adding
an **overlapping** source roll (e.g. a combined roll *and* its per-town files, or a re-downloaded
file) silently duplicates properties and inflates every total. After `build.py`, before
`export_site.py`, check for duplicates:

```bash
cd extract && python3 - <<'PY'
import sqlite3; c=sqlite3.connect('wc-valuations.db').cursor()
cols="roll_id,municipality_id,town,suburb,tenure_type,erf_no,portion,ss_scheme,unit_no,category,site_address,extent_m2,market_value_r,page"
dups=c.execute(f"SELECT COALESCE(SUM(n-1),0) FROM (SELECT COUNT(*) n FROM property GROUP BY {cols} HAVING n>1)").fetchone()[0]
print("identical-row duplicates:", dups, "(should be ~0)")
print("total properties:", c.execute("SELECT COUNT(*) FROM property").fetchone()[0])
PY
```

If duplicates are non-zero, **do not export** — remove the overlapping source file(s) and re-run
`build.py`, or de-duplicate, until the count is ~0. Run **`extract/field_coverage.py`** any time to
see per-municipality field richness (writes `FIELD-COVERAGE.md`; pairs with `STRUCTURE-ANALYSIS.md`).

> **⚠️ "byte-identical" must mean a true duplicate, not a distinct unit.** `dedup()` keys on
> `DEDUP_COLS` (which includes `unit_no`), so each parser MUST give every sectional unit a unique
> `unit_no` — otherwise identical-value units in one scheme (e.g. 49 identical flats, or 561 storage
> units) become one byte-identical row and dedup silently deletes the rest. This was happening across
> the sectional-heavy municipalities and had quietly removed **~6,987 rows / ~R7.8bn** before it was
> caught. Fixed 2026-06-26 in the `qhawekazi` (Bitou) and `pensoft` (Drakenstein/Saldanha/Breede
> Valley/Bergrivier/Overstrand) parsers — `unit_no` now carries the SG code / section number, and the
> total rose from R876.5bn to **R884.18bn**. **The residual dedup tail was audited & fixed 2026-07-02**
> (total now **R880.86bn / 535,567 properties** — the *drop* is a correction, not a loss):
> `pensoft` was also *ingesting* 'Apportionment A/B' value-breakdown continuation lines as fake
> properties (~R4.98bn double-count, removed), and dropped portions glued to the next column
> (Drakenstein rural erven, Breede Valley — real properties restored); `hessequa` read R-prefixed
> HA-AREA tariff codes as the market value (~R1.61bn undercount, recovered) and now extracts
> addresses; `knysna` flats and `hessequa` share-scheme units printed with NO unit number get a
> synthetic printed-order `unit_no` ('#2', '#3', … — not exported) so dedup can't destroy them;
> `theewaterskloof` now captures portions and its sectional file's scheme headers. What dedup removes
> now (~38 rows / R39m) was verified line-by-line at the source to be genuine double-prints — the
> build's ⚠ warning for 'Bitou: 3 units' is a verified false positive (identical SG codes printed
> twice). When adding/altering a parser, confirm units keep distinct identities:
> `cd extract && PYTHONPATH=. python3 test_sectional_identity.py && python3 test_freehold_identity.py`.

---

## 3. Database schema the export depends on (`wc-valuations.db`)

- `municipality(id, name, district)` — 24 local municipalities across 6 regions.
- `roll(id, municipality_id, roll_type, cycle, engine, source_file)` — `cycle` shows on the muni page;
  `roll_type` (`GV`/`SV`) + `cycle` feed the roll-date provenance popover (see §4, and the authored
  notes in `extract/provenance.py`).
- `property(id, roll_id, municipality_id, town, suburb, tenure_type, erf_no, portion, ss_scheme,
  unit_no, category, site_address, extent_m2, market_value_r, page)`

**Only `property.market_value_r` (>0) and the `municipality` join are essential.** Every other
field is optional and is consumed defensively (see §5). New municipalities just need rows in
`municipality` + `property` and the export handles the rest.

---

## 4. What the website consumes (keep these valid)

1. **`data/stats.json`** — `{ buckets[], province{…}, districts{ <district>: { …rollup, municipalities:{ <muni>:{…} } } } }`.
   Per-node fields: `median, mean, total, properties, q1, q3, min, max, residential_avg, cycle,
   hist[], hi{}, lo{}, std, cv, gini, res_gini, top1_share, top1_count, cat_mix{}, sectional_share,
   vacant_share, erf_median, ppm_median`, plus the data-quality counts
   `dq_no_value, dq_no_extent, dq_no_cat, dq_nominal` (each with a `*_share`) — straight counts of
   parcels missing a value/extent/category or carrying a ≤R1 000 placeholder value; they feed the
   panel's "Data quality" section. `res_gini` is the residential-only Gini (emitted at ≥30 res
   parcels) — the UI prefers it over the pooled `gini`, which conflates property-type mix with
   dispersion. **All optional fields are guarded** — a missing one just hides that piece of UI.
   *Municipality nodes also carry* `provenance{ kind, cycle, properties, valued_as_at?, coverage?,
   note?, source_url? }` — the "how was this valued?" popover on the roll date. `kind`
   (`general`/`supplementary`/`draft`), `cycle` and `properties` are derived from the DB roll; the
   optional `valued_as_at`/`coverage`/`note`/`source_url` are authored per-muni in
   `extract/provenance.py`. If a muni has no `provenance`, the roll date renders plain (no popover).
2. **`data/db/`** — `search.db` split into 32 MB chunks + `config.json`. **Served from Supabase
   Storage, not this repo** (see §8) — these committed files are the *upload source*. Table
   `prop(muni, suburb, erf, address, extent, dwext, value, tenure, category, scheme, erf_int)` + an FTS5 index
   `psearch` (address/suburb/erf, for in-any-order token search) with indexes
   `idx_addr, idx_sub, idx_muni_value, idx_value, idx_erf_int_value`. `erf_int` is the numeric core
   of `erf` ('SB17324' / '00017324' / '17324' → 17324) — the **map view's cadastre join key** (§9).
   **Two things make the map click fast over HTTP range-reads (see §11):** the composite
   `idx_erf_int_value (erf_int, value)` (no ORDER BY temp-sort), and the `prop` rows are **physically
   clustered by `erf_int`** (rows inserted in erf_int order) so one erf's matches are contiguous.
   `config.json` sets `requestChunkSize: 65536` to pull those contiguous rows in a few range reads.
   `config.json.databaseLengthBytes` **must equal** the summed byte size of the chunk files
   (export computes this — don't touch it).
3. **`data/geo/*.geojson`** — province / WC districts / WC municipalities /
   WC wards (`wc-wards.geojson`: 406 MDB wards, properties `ward`/`ward_id`/`muni`;
   `muni` matches the DB municipality names exactly — it drives the Atlas's per-municipality
   ward overlay and the satellite map's ward layer + click panel's "Ward" row. Refresh it from
   the WC SpatialDataWarehouse `AfriGIS_MainAdminBoundaries/MapServer/10` after a ward
   re-delimitation; both maps degrade quietly if it's missing).

---

## 5. Why incomplete data will NOT break the site (graceful degradation)

The front-end guards everything. Add a sparse municipality, or leave fields null, and the site
shows *less*, it does not crash:

| Situation | What the user sees |
|---|---|
| No stats node for an area (e.g. City of Cape Town, search-only) | "No public valuation roll"; property cards disabled; "A closer look" hidden |
| `hist` null/empty | "No distribution data for this area" |
| `hi` / `lo` null | property cards show "—" |
| node missing `gini` | the whole "A closer look" section auto-hides |
| `address` null | "Unnamed erf"; null `extent` → "extent n/a"; null `suburb` → omitted |
| top-N DB query fails | retry message (and it self-heals), never a blank crash |
| `cycle` missing | falls back to the generic year label |

So a partial data update = a quieter page, not a broken one.

---

## 6. Invariants that WILL break the site if violated

1. `stats.json` must be valid JSON with `province{}` and `districts{}` present (nodes may be sparse).
2. **geojson `properties.name` for districts & municipalities must exactly match the DB
   `district` / `municipality.name` strings** — otherwise regions won't colour or drill.
   (24 munis: Beaufort West, Bergrivier, Bitou, Breede Valley, Cape Agulhas, Cederberg, Drakenstein,
   George, Hessequa, Kannaland, Knysna, Laingsburg, Langeberg, Matzikama, Mossel Bay, Oudtshoorn,
   Overstrand, Prince Albert, Saldanha Bay, Stellenbosch, Swartland, Swellendam, Theewaterskloof,
   Witzenberg. Regions: Cape Winelands, Central Karoo, City of Cape Town, Garden Route, Overberg,
   West Coast.)
3. `search.db` must keep the `prop` columns above **and the value indexes** — without
   `idx_value` / `idx_muni_value` the top-N query scans the whole table and downloads the entire DB
   over the network instead of a few KB. The same applies to `idx_erf_int_value` for the map view's
   click-to-valuation lookup (map.js falls back to an FTS erf-token match if the hosted DB predates
   `erf_int`, so an old upload degrades rather than breaks — but don't remove the column/index). Do
   NOT drop the erf_int clustering or lower `requestChunkSize` without re-measuring (§11) — either
   alone reverts the map click to the 20s+ cold-read stall.
4. `config.json.databaseLengthBytes` must match the chunk total (re-running the export guarantees this).
5. Bump `assets/atlas.js?v=N` in `index.html` whenever `atlas.js` changes, and
   `assets/map.js?v=N` in `map.html` whenever `map.js` changes (GitHub Pages caches assets).
6. Always re-run `export_site.py` after any DB change (it rewrites all data files together).
7. **The search DB must stay reachable on Supabase Storage** (see §8). `atlas.js` `ensureDB()` hard-codes
   the absolute `configUrl` to the `valuations` bucket; if you rename the bucket/paths or rotate the
   project, update that URL. The bucket must stay **public** (so the object endpoint returns
   `Access-Control-Allow-Origin: *` for the cross-origin range requests). After regenerating the DB,
   **re-upload the 4 `data/db/` files** — committing them to this repo alone does NOT update the live site.

---

## 7. Known data caveats — these are INTENTIONAL; do not "fix" them

- **Category strings differ per municipality** (hundreds of variants). `export_site.classify()` buckets
  them by keyword + tenure into `res / com / agri / state / vacant / other`. An "Other/uncoded" share
  (~8%) is expected, not a bug.
- **Tenure / sectional-title is NOT shown.** `tenure_type`, `ss_scheme`, `unit_no` are only populated
  by *some* municipalities (e.g. Stellenbosch records 0 sectional), so a sectional-share stat would be
  misleading. Don't add it back unless that field is reliably filled for every municipality.
- **Extents are in m².** Hectare values from source rolls are converted (e.g. `19.7376 Ha` → 197 376 m²).
- **Nominal/placeholder valuations** (R1, sub-R100k residential) are genuine artefacts in the rolls.
  The "most affordable home" floors at R100 000 and filters these; don't report R1 as the cheapest home.
- **`build.py` caps single values at R2bn** to drop misparsed totals lines.
- **The R618,975,000 "Dagbreekstraat / PSP / Malmesbury" record is the Malmesbury Prison** — REAL,
  verified against the OCR source and two independent extractions. Not an error.
- **Witzenberg & Laingsburg** are on older valuation cycles; **City of Cape Town** publishes no
  downloadable roll (search-only) and has no stats node — all intentional.

---

## 8. Why the search DB is hosted on Supabase Storage (NOT GitHub Pages)

`sql.js-httpvfs` reads `search.db` with HTTP **Range requests** (it fetches only the few KB of pages a
query touches, instead of the whole 85 MB file). This requires the host to serve **raw byte ranges**.

- **GitHub Pages (Fastly) gzips every response** and serves ranges against the **compressed** bytes:
  `content-range` totals come back as the gzip size, deep ranges return `416`, and the first bytes are
  gzip magic instead of `SQLite format 3`. SQLite then reads garbage → **every address search returns
  "No matches"** (the map still works because it loads via full GETs, which the browser transparently
  un-gzips — only *ranged* reads break). A browser can't opt out: `Accept-Encoding` is a forbidden
  header, so JS can't request `identity`.
- **jsDelivr is also unusable** — it stores files Brotli-compressed at rest and ranges against the
  compressed blob, ignoring `Accept-Encoding` entirely (and rejects >20 MB files).
- **Supabase Storage** (S3-backed) serves raw byte-ranges with `Accept-Ranges: bytes`, correct
  `content-range` totals, and `Access-Control-Allow-Origin: *` — **verified** returning real
  `SQLite format 3` bytes and resolving "55 Lovell" end-to-end.

**Setup:** Supabase project `nxeasppmwvzcqbbgrdvf`, **public** bucket `valuations`, the 4 `data/db/`
files under a **versioned path prefix** (`v4/` since 2026-07-16 — added Cape Town + the `dwext` column; `v3/` before that). `atlas.js` + `map.js` `ensureDB()` point `configUrl`
at `…/storage/v1/object/public/valuations/v3/config.json`; the chunks resolve relative to it via
`config.json`'s `urlPrefix`. Chunking is retained because each chunk (≤32 MB) stays under Supabase's
50 MB-per-file upload limit. **Why a versioned path:** objects cache `max-age=3600`, so overwriting
in place risks an hour of stale/mismatched chunks; uploading a rebuilt DB to a *new* prefix
(`v4/`, …) and flipping the one `configUrl` in both JS files makes the swap atomic and instantly
reversible (revert the configUrl) — the old path stays serving until the flip deploys. The vendored `sqlite.worker.js` + `sql-wasm.wasm` still load from this
repo (full GETs, so gzip is fine).

---

## 9. The map view's data path (map.html + assets/map.js)

The satellite map draws **cadastral parcels live** from the WC Surveyor-General planning cadastre
(`gis.westerncape.gov.za/...SG_PlanningCadastre/MapServer/1`, CORS-verified) — fetched per viewport
at zoom ≥ 15.5, never stored in this repo. Clicking a parcel joins its erf number (`TAG_VALUE`) to
valuations via `prop.erf_int` (§4.2) and ranks matches by the cadastre `Town_name` against
`prop.suburb` (town evidence) then `prop.muni` — town-level matches are the parcel's own rows;
muni-level-only matches are labelled as "other townships" in the UI, honestly.

Degradation rules (keep these):
- Cadastre down / CORS broken → hint "Erf boundaries unavailable", imagery keeps working.
- No valuation match → an explicit "No valuation found" card, never a fabricated match.
- Hosted search.db older than the `erf_int` schema → FTS erf-token fallback (bare + 8-digit
  zero-padded), confirmed client-side; Stellenbosch-style prefixed erven ('SB17324') only resolve
  once the new DB is uploaded.
- Parcel geometry has **no published open licence**: attribution "Surveyor-General / Western Cape
  Government (as-is)" is required on the parcels source (see MAP-FEASIBILITY.md in the extraction
  repo). Do not ingest owner names from cadastre services.
- `?db=<configUrl>` on map.html overrides the search-DB location for local testing.

**Cape Town sectional-scheme fallback (since 2026-07-17, search.db ≥ v5).** The CoCT sectional roll
carries **no erf numbers** (units live under a scheme ref, e.g. "PORTSIDE SS240/2012"), so the
erf_int join can never find them. When the erf lookup is empty or weak (`best < 4`) the map
point-queries the City's sectional-scheme polygon layer
(`citymaps.capetown.gov.za/agsext/...Search_Layers/SL_WGDB_ST_SCHM/MapServer/0`, CORS-verified) and
resolves units via the `prop.scheme` column (= `property.ss_scheme`, indexed `idx_scheme` NOCASE).
Rules: queries must **seek** idx_scheme — equality needs `COLLATE NOCASE`, name-prefix must be an
explicit range (`scheme >= ? AND scheme < ?`, both NOCASE), never a parameterised LIKE (full scan
over httpvfs). The layer's ST_SCHM_NO is sometimes a plan number, not the SS ref — exact-ref match
falls back to name-prefix, and same-named schemes render as a chooser, never merged. Layer down /
nothing found → the normal "No valuation found" card.

**Town disambiguation (since 2026-07-19, search.db ≥ v6).** The same erf NUMBER recurs in
100–500 townships, so a click is resolved by matching the cadastre's `Town_name` against
`prop.suburb`. Three rules keep this working:
- **Export**: `prop.suburb` falls back to the roll's *Town Allotment* when the Suburb column is
  blank (`export_site.py` — Cape Agulhas, Swellendam, George, CoCT sectional). Never export a
  blank locality when the roll has a town.
- **Query**: the erf lookup orders town-matching rows ABOVE the value sort *before* the 80-row
  cap (a plain `ORDER BY value DESC LIMIT 80` silently dropped modest-value houses in the clicked
  town). If the top 80 still don't match, a wide re-fetch (LIMIT 600) re-ranks client-side —
  cheap because rows are clustered by `erf_int`.
- **Matching** (`normTown()` in map.js): both sides are normalised — parentheticals stripped,
  RIVER→RIVIER / BAY→BAAI / EAST→OOS / WEST→WES, punctuation dropped, doubled letters collapsed —
  so cadastre English ("BOT RIVER", "STILL BAY EAST", "BETTY\`S BAY") meets roll Afrikaans
  ("BOTRIVIER", "STILBAAI OOS", "BETTYS BAY"). True aliases/typos live in `TOWN_ALIAS`
  (ARNISTON→WAENHUISKRANS, MCGREGOR→MCREGOR roll typo, BELVEDERE→BELVIDERE,
  GRAAFWATER→GRAAFFWATER).
Audited 2026-07-19 against ~950 random cadastre parcels across all 316 WC townships: 72% resolve
to a town-level match; most of the rest are parcels genuinely absent from the rolls (roads/public
land/newer subdivisions, honest "no valuation"), plus townships absent from collected rolls —
notably George's satellite towns (Wilderness, Hoekwil, Herolds Bay, Uniondale) whose roll
coverage is a Phase-1 collection gap, not a map bug.

**Supplementary rolls (since 2026-07-19, search.db ≥ v9).** `extract/jobs.py` now loads
current-cycle SUPPLEMENTARY rolls (SV#) for 9 municipalities (Overstrand, Witzenberg,
Drakenstein, Bergrivier, Swellendam, Cape Agulhas, George, Knysna, Mossel Bay);
`build.supersede()` keeps only the LATEST roll's row per property identity, so an SV
revaluation replaces its GV row instead of duplicating it. Identity township is
engine-dependent (`jobs.SV_TOWN_KEY_MUNIS`): setvolume munis key on `town`, all others on
`suburb`. Rules when adding SVs: GV job lines must precede SV lines, SVs ascending; verify
the SV's cycle from its OWN title page (filenames lie); verify the muni's engine parses the
SV layout AND emits the same township convention as its GV — if it can't, do NOT ingest
(currently deferred for that reason: Theewaterskloof, Matzikama, Bitou, Cederberg,
Stellenbosch, Oudtshoorn, Hessequa; Langeberg SVs are scanned images; Breede Valley &
Kannaland have no current-cycle SVs). Knysna's SVs use a dedicated `knysnasv` engine —
its SV01 ADDS townships the GV omitted entirely (all of Belvidere).

If the live service ever becomes a bottleneck, the pre-built PMTiles pipeline sketched in
MAP-FEASIBILITY.md is the upgrade path — swap `addParcels()`'s source, keep everything else.

---

## 10. Curated municipal rates (`data/rates.json`) — the ONE hand-maintained data file

Everything else under `data/` is machine-generated (golden rule §1). `data/rates.json` is the
single deliberate exception: per-municipality **rate-in-the-rand tariffs transcribed by hand from
official documents** (municipal tariff books / rates policies, or the Provincial Gazette rates
promulgations required by MPRA s14). It exists because tariffs are *curated facts about documents*,
not derivable from `wc-valuations.db`.

Rules that keep it honest:
1. **Every entry MUST carry** `year`, `source` (URL of the verified official document) and `quote`
   (the exact tariff line transcribed). No quote → the entry does not ship.
2. Rates are stored as **Rand-per-Rand decimals** exactly as gazetted (0.6954 c/R → `0.006954`).
   `residential_reduction` is the TOTAL value excluded for an ordinary residential property
   (statutory R15,000 impermissible amount per MPRA s17(1)(h) + any municipal extension).
3. **A municipality absent from the file means the UI shows no rates figure at all** — the front
   end (assets/rates.js `computeRates`) returns null and both panels omit the block. Never a
   default, never a guess. Same for a category missing from a municipality's `rates{}`.
4. Keys must exactly match the DB `municipality.name` strings (§6.2 list) + `"City of Cape Town"`.
5. The formula (assets/rates.js): `annual = max(0, value − residential_reduction) × rate` for
   residential; other categories apply no reduction. `monthly = annual / 12`. Two optional
   residential extras (used by Overstrand): `residential_rebate_pct` (percentage rebate applied to
   the calculated amount, e.g. Overstrand's 20% improved-residential rebate) and
   `residential_exempt_below` (annual = 0 when the valuation is at or below this threshold,
   e.g. Overstrand's R350,000 relief). Both MUST be covered by the entry's `quote`. Category strings are
   bucketed by the same keyword logic as `export_site.classify()` — keep the two in sync.
6. When editing rates.json, **bump the `?v=` in assets/rates.js's fetch** (Pages CDN caches it),
   and re-verify one hand-computed example per changed municipality.
7. Refresh cycle: tariffs change every 1 July (municipal financial year) — re-verify annually.
8. **Top-level `prime_rate`** (`{pct, repo_pct, effective, year, source, quote}`) is the SARB prime
   lending rate, used **only** for the labelled affordability estimate (est. monthly bond + income
   needed for the median home). Same honesty rules: it needs `source`/`quote`; absent → the panel's
   Affordability block simply hides. **Re-verify after each SARB MPC meeting** (~every 2 months).

---

## 11. Why the map click / search is fast (do not silently undo this)

The search DB is read from Supabase over HTTP **range requests** — each uncached SQLite page fault
is one network round-trip. A cold query's cost is (pages touched) × (per-request latency), so on a
slow connection it is dominated by the *number of round-trips*, not CPU. A clicked erf resolves via
`SELECT … FROM prop WHERE erf_int=? AND value>0 ORDER BY value DESC LIMIT 80`. Measured on a live
DB, clicking a **common** erf number (they recur in 100-500 townships) took **~30 s cold** while the
same query **warm was ~15 ms** — pure uncached-page latency. Three things fixed it (verified: the
common erf-222 click dropped from **32 s → 0.84 s**; worst case ~4 s):

1. **Composite index `idx_erf_int_value (erf_int, value)`** — a single-column `(erf_int)` index
   forced `USE TEMP B-TREE FOR ORDER BY`, reading *every* matching row to sort it. The composite
   walks the top matches in value order and stops at `LIMIT` (query-plan verified, no temp sort).
2. **`prop` physically clustered by `erf_int`** (rows inserted in erf_int order in `export_site.py`).
   Rows were stored municipality-order, so one erf's ~80 matches sat on ~80 pages scattered across
   the 99 MB file = ~80 cold round-trips. Clustered, they are contiguous.
3. **`requestChunkSize: 65536`** in `config.json` (was 4096 = one page). The contiguous erf rows +
   index leaves now arrive in one or two 64 KB range reads instead of dozens.

Plus a boot pre-warm: `ensureDB()` (both `atlas.js` and `map.js`) runs tiny `erf_int` / FTS / value
probes right after opening the worker, faulting the shared index pages before the user's first click
or search — the pre-warm used to be only `SELECT 1`, so the first real query paid the whole cold
descent. **If you re-measure and any of these regresses the click past ~2 s, check that all four are
still in place.** A future structural upgrade (pre-built PMTiles / precomputed top-N in `stats.json`)
is sketched in the extraction repo's MAP-FEASIBILITY.md.

## 12. History snapshots (`data/history/`) — append-only, never deleted

Every municipality currently holds exactly **one** valuation cycle, so "how has this area's value
changed?" is unanswerable today. To make growth appear **automatically** the moment a municipality
gets a second roll, `export_site.py` archives an **immutable aggregate snapshot** of each data state.

- **What is written:** after `stats.json`, the export writes `data/history/stats-<YYYY-MM-DD>.json`
  — but **only when the roll state changed** (the muni→cycle signature differs from the newest
  existing snapshot). Re-running the export with unchanged data writes nothing. So history holds
  **one entry per roll-state change**, not one per export run.
- **Shape:** `{ "date", "cycles": {muni: cycle}, "nodes": {<node>: {cycle, properties, valued,
  median, total, res_median}} }`. Aggregates only — **no per-property data** (growth is aggregate).
  Node keys are province/district/municipality names (globally unique).
- **Immutability (the whole point):** a snapshot file is **never overwritten or deleted**. If
  `stats-<today>.json` already exists, the export leaves it intact. This is the "never delete data"
  guarantee — each past data state is preserved verbatim. **Do not hand-edit or prune `data/history/`.**
- **Growth computation:** for each **municipality**, the export finds the most recent *earlier*
  snapshot in which that muni's `cycle` differed from now, and emits onto the `stats.json` node:
  `median_growth`, `total_growth`, `res_median_growth` (each `= current/previous − 1`), `cagr`
  (median annualized over the gap between cycle **start-years**, e.g. `2019-2023`→`2025-2029` = 6 yr),
  and `growth_from` (the previous cycle label, for the UI caption). Growth is **municipality-level
  only** — province/district aggregates mix munis on different cadences, so they carry no growth.
- **Null-until-two-rolls:** with one roll everywhere, no muni has a differing earlier snapshot, so
  **none of the growth fields are emitted at all**. Per §5's guard philosophy, the front-end simply
  hides its Growth block until the fields appear. Nothing to configure — it lights up on the next roll.
- **These files live in this repo (GitHub Pages), not Supabase** — they're small JSON, read directly
  like `stats.json`/`towns.json`. No `data/db/` or Supabase involvement.

---

## 13. Static SEO pages (`m/`, `d/`, `sitemap.xml`, `templates/`) — generated, never hand-edited

Since 2026-07-05 the export also writes **~32 crawlable static pages** so search engines can rank
per-municipality queries (the SPA alone exposes only 2 URLs):

- **`m/<slug>.html`** — one page per municipality (24), plus **`m/index.html`** (the browse index,
  canonical `…/m/`) and **`m/city-of-cape-town.html`** (an honest explainer: the metro is
  search-only — links the City's own GV portal, notes the PAIA request; **no Dataset JSON-LD**,
  because there is no dataset).
- **`d/<slug>.html`** — one page per district (5), each with a ranked child-municipality table
  (every muni shows its **own** `cycle` — this is how Witzenberg/Laingsburg's older rolls surface
  honestly at district level).
- **`guide/how-valuations-work.html`** — a plain-language explainer of how municipal valuations
  are determined and what they represent (mass appraisal, valuation date, market-value-not-a-floor,
  objections), grounded in the MPRA. Its own SEO URL; rendered through `shell.html` (so it sits one
  level deep in `guide/`, per rule 5). Muni/district/CoCT pages and the Atlas panel link to it via
  an **"How valuations work →"** line (`explainer_link_section()` / `renderAuthorities`).
- **`sitemap.xml`** — now **generated** by the export (66 URLs since the Afrikaans mirror —
  see rule 9; `lastmod` = export run date). It is no longer hand-maintained.
- **`templates/*.html`** (this repo, git-tracked) — the page skeletons, rendered by
  `extract/export_pages.py` (extraction repo) via stdlib `string.Template`. Every optional section
  placeholder is always substituted ("" when data is absent). **No literal `$` may appear in a
  template outside a real placeholder — `string.Template` scans comments too.**

Rules:
1. **Never hand-edit `m/*.html`, `d/*.html`, or `sitemap.xml`** — they join `stats.json` /
   `towns.json` / `search.db` under §1's golden rule. Edit `templates/` or the generator, then
   re-run `python3 extract/export_site.py`.
2. **Graceful degradation** (extends §5): muni missing from `towns.json` (e.g. Cederberg) → no
   towns section; missing from `rates.json` (Breede Valley) → no rates section;
   growth fields absent → no change-over-time section; district pages carry no towns/rates/
   affordability at all (they don't roll up meaningfully). The **"Who sets & governs these values"**
   authorities block is the same way: any absent field (valuer, phone, objection form URL, …) simply
   omits that row; a municipality with no primary data shows only the shared role-players; districts
   show none. So a thinner authorities entry makes the block quieter, never broken.
8. **Authorities data** (the valuer + who-to-contact block) is authored in
   `extract/authorities.py` (extraction repo), keyed by the exact DB municipality name, mirroring
   `provenance.py`. `export_pages.authorities_section()` renders it on the static pages;
   `export_site.py` attaches `authorities_for(name)` to each muni node so `atlas.js`
   `renderAuthorities()` shows the same block in the panel. Province/national role-players
   (Appeal Board / Dept of Local Government / CoGTA) are shared constants, authored once. Facts are
   transcribed from each municipality's `SOURCE.md` "Authorities & role-players" section — never
   guessed; owner names are never stored or shown (POPIA).
3. **Slug rule** (Python `export_pages.slugify` ⇄ JS `slugOf` in `atlas.js` — keep in sync):
   `name.strip().lower().replace(" ", "-")`. Verified sufficient for all 30 current names in
   §6.2's list; revisit if a future name carries punctuation/accents.
4. **Deep-link hash contract** (new §6-grade invariant): `index.html#m/<slug>` and
   `index.html#d/<slug>` boot the Atlas pre-drilled (`parseHash()`/`syncHash()` in `atlas.js`,
   `history.replaceState` only — never `pushState`). The static pages' "Explore interactively"
   buttons rely on it; breaking the hash format orphans those links. Unknown slugs fall back to
   the province view. `#m/city-of-cape-town` intentionally renders the existing no-data state.
5. All generated pages sit exactly **one directory below their language tree's root** — English
   under `m/`, `d/`, `guide/`; Afrikaans under `af/m/`, `af/d/`, `af/gids/`. `templates/shell.html`
   prefixes asset/nav paths with the `${root}` placeholder (`../` for English pages, `../../` for
   `/af/` pages); links that should stay inside the language tree (e.g. the footer's browse link)
   remain literal `../m/index.html`.
6. `index.html`'s `#siteFooter` is the static (JS-free) crawl path into `m/index.html` — do not
   remove it; sitemaps alone are a weaker discovery signal than links.
7. `404.html` is hand-written (NOT generated). GitHub Pages serves it automatically on the live
   domain; `python3 -m http.server` does not — that difference is not a bug.
9. **Language variant (`/af/`, since 2026-07-16)** — the site is bilingual (English + Afrikaans,
   informal *jy/jou* register):
   - **The `/af/` tree is generated** — every generated English page has an Afrikaans twin
     (`af/m/<slug>.html`, `af/m/index.html`, `af/d/<slug>.html`,
     `af/gids/hoe-waardasies-werk.html`). Same golden rule: never hand-edit; re-run
     `python3 extract/export_site.py`.
   - **One string catalog:** `data/i18n-af.json` (this repo). gettext-style — **English source
     strings are the keys**; `export_pages.t()/tn()/T()` (Python) and `atlas.js`/`map.js`
     `t()/tn()/tf()` (JS) read the SAME file, so panel and static pages stay in lockstep. A key
     missing from the catalog falls back to English (graceful degradation, never broken). When
     adding/changing any user-facing English string, add its `af` entry to the catalog.
   - **Slugs, URLs, hashes, and SQL filters stay English.** Only *display* names translate, via
     the catalog's `names` map (e.g. City of Cape Town → Stad Kaapstad, Cape Winelands → Kaapse
     Wynland, Mossel Bay → Mosselbaai). The Atlas search index carries both names as aliases.
   - **Language selection:** `localStorage['wcv-lang']` (set by the EN|AF toggle, persistent)
     → else `navigator.language` starting with `af` → else English. `assets/lang.js` (loaded by
     every generated page) redirects a static page to its twin when the resolved language differs,
     using the page's own toggle/hreflang URLs. The Atlas SPA, `map.html` and `404.html` are
     **single-URL** and switch strings client-side (no `/af/index.html` exists).
   - **SEO:** every generated page carries `<link rel="alternate" hreflang="en|af|x-default">`;
     `sitemap.xml` lists both languages (66 URLs) with `xhtml:link` alternates; single-URL pages
     (`/`, `map.html`) are listed once with no alternates. `<html lang>` is set per page/state.
   - **Data prose:** `authorities.py` objection instructions and other authored English prose are
     translated by exact-string lookup in the catalog — new authored prose without a catalog entry
     simply renders in English on the `/af/` pages until translated.
