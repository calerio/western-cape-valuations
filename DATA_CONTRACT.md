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

---

## 3. Database schema the export depends on (`wc-valuations.db`)

- `municipality(id, name, district)` — 24 local municipalities across 6 regions.
- `roll(id, municipality_id, roll_type, cycle, engine, source_file)` — `cycle` shows on the muni page.
- `property(id, roll_id, municipality_id, town, suburb, tenure_type, erf_no, portion, ss_scheme,
  unit_no, category, site_address, extent_m2, market_value_r, page)`

**Only `property.market_value_r` (>0) and the `municipality` join are essential.** Every other
field is optional and is consumed defensively (see §5). New municipalities just need rows in
`municipality` + `property` and the export handles the rest.

---

## 4. What the website consumes (keep these valid)

1. **`data/stats.json`** — `{ buckets[], province{…}, districts{ <district>: { …rollup, municipalities:{ <muni>:{…} } } } }`.
   Per-node fields: `median, mean, total, properties, q1, q3, min, max, residential_avg, cycle,
   hist[], hi{}, lo{}, std, cv, gini, top1_share, top1_count, cat_mix{}, sectional_share,
   vacant_share, erf_median, ppm_median`. **All optional fields are guarded** — a missing one just
   hides that piece of UI.
2. **`data/db/`** — `search.db` split into 32 MB chunks + `config.json`. **Served from Supabase
   Storage, not this repo** (see §8) — these committed files are the *upload source*. Table
   `prop(muni, suburb, erf, address, extent, value, tenure, category)` + an FTS5 index `psearch`
   (address/suburb/erf, for in-any-order token search) with indexes
   `idx_addr, idx_sub, idx_muni_value, idx_value`. `config.json.databaseLengthBytes` **must equal**
   the summed byte size of the chunk files (export computes this — don't touch it).
3. **`data/geo/*.geojson`** — province / WC districts / WC municipalities.

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
   over the network instead of a few KB.
4. `config.json.databaseLengthBytes` must match the chunk total (re-running the export guarantees this).
5. Bump `assets/atlas.js?v=N` in `index.html` whenever `atlas.js` changes (GitHub Pages caches assets).
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
files at the bucket root. `atlas.js` `ensureDB()` points `configUrl` at
`…/storage/v1/object/public/valuations/config.json`; the chunks resolve relative to it via
`config.json`'s `urlPrefix`. Chunking is retained because each chunk (≤32 MB) stays under Supabase's
50 MB-per-file upload limit. The vendored `sqlite.worker.js` + `sql-wasm.wasm` still load from this
repo (full GETs, so gzip is fine).
