# Task 4 + 5 — Performance fixes & richer statistics (design + plan)

**Date:** 2026-07-03 · **Executor:** Opus 4.8 (decided with the user — this is debugging +
data-pipeline + statistics work, not the visual polish Task 3 was). **Repo:**
`~/projects/western-cape-valuations` (deploys to GitHub Pages). Export/build tooling lives in the
**sibling** `~/projects/western-cape-property-valuations` (NOT git-tracked, does not deploy).

This plan resumes after Task 3 (Apple/Flighty UI, live). It covers **Task 4 (performance)** and
**Task 5 (statistics + never-delete-data archival)**. Read `DATA_CONTRACT.md` before touching
`data/`, `export_site.py`, or the DB — every rule there still holds.

---

## The problems, and their real root causes (investigated, not guessed)

1. **20-second parcel-click valuation load.** The search DB is read from Supabase over HTTP *range
   requests* via `sql.js-httpvfs` (only the KB a query touches, not the 85 MB file). The first click
   after page-load pays a cold B-tree descent = many sequential ~200 ms round-trips. Two compounding
   suspects: (a) the boot pre-warm runs only `SELECT 1`, which never faults in the `erf_int` index or
   FTS pages, so the first *real* query is fully cold; (b) per `DATA_CONTRACT.md` §9, if the **hosted**
   DB predates the `erf_int` index, every click silently takes the slower FTS-token fallback
   (`map.js:311-331`). *Must measure before fixing* ("explain it, or improve it").

2. **Overlapping / nonsensical parcels ("East Reservoir" over 9 Suid-Ooster; George complex).** This
   is genuine Surveyor-General cadastre data — utility erven, sectional-scheme *parent* parcels,
   remnant old subdivisions — and we neither can nor should delete it (not our data). The bug is in
   **our** click handler (`map.js:259-266`): when parcels overlap a point it blindly takes
   `e.features[0]`, an arbitrary order that often surfaces the **largest** (last-drawn) polygon. So a
   huge reservoir erf beats the small house erf underneath it. The George screenshot is a *different*
   case (the whole townhouse complex is a single 12 263 m² parcel with no sub-parcels) — already
   handled honestly by the "this township wasn't found in the rolls" note.

3. **"Multiple possible erven" on click.** Two distinct multiplicities are conflated: (a) overlapping
   *parcels* under the cursor (problem 2), vs. (b) one erf *number* matching several valuation *rows*
   (portions / sectional units / same number in another township) — (b) is already handled by
   `rankRows` + `renderList`; only its labelling needs a light touch.

4. **Search clunky.** `runSearch` (`atlas.js:571`) already renders **area-name** matches instantly
   from in-memory JSON; only the **address** portion waits on the same cold range-reads as the parcel
   click. Same root cause as #1 — fixed by the same DB warm-up.

5. **Growth stats are impossible today (Task 5).** Every municipality in `wc-valuations.db` holds
   **exactly one** valuation cycle; property rows carry no prior value (verified: no muni has two
   distinct `roll.cycle` values). "Growth since previous roll" / CAGR needs two rolls over time. So we
   build the **append-only archival** now (the user's "never delete data" instinct), and growth turns
   on automatically when the next roll lands. Everything else the user listed *is* computable today.

---

## Decisions (from the user)

- **Executor:** Opus, this session.
- **Historical stats:** build every stat possible now **and** add roll-archival so growth/CAGR work
  on the next roll — don't hunt for old rolls yet.
- **Affordability proxy:** include it, clearly labelled as an estimate. For the interest rate: try a
  reliable **live** SARB/prime-rate source; if none is CORS-safe for a static site, store it as a
  **sourced, dated constant** (the `rates.json` pattern — §10 of the contract) and note in `CLAUDE.md`
  to re-verify after each SARB MPC meeting. Never an unlabelled guess.

---

## Milestones — commit AND push after each (user: "push before continuing to the next step")

Each milestone is independently shippable and reversible via git. Verify in Playwright
(desktop + mobile, light + dark where relevant) before every push. **Commit as the user only — no
Claude/AI authorship** (repo rule). Bump `?v=` on any edited JS.

### M1 — Fix the overlap bug (the #1 gripe), client-side only
`assets/map.js`, `onParcelClick`:
- Replace `e.features[0]` with: collect all parcels under the point, compute each outer ring's area
  (planar shoelace — relative ordering is all we need), and **auto-select the smallest (most
  specific) parcel**. This makes 9 Suid-Ooster beat the reservoir with zero data changes.
- When >1 distinct parcel (`PRCL_KEY`) sits under the click, prepend a compact **"N parcels here ›"**
  affordance in the panel that expands to let the user switch parcels (reuse the `renderList`
  pattern). Show each candidate's erf number + extent.
- Keep all degradation intact (no-match card, cadastre-down hint). Bump `map.js?v=8`.
- **Verify:** zoom to a known overlap (George Groenkloof; and a reservoir-over-house spot), confirm
  the small erf is picked and the chooser switches parcels. Commit + push.

### M2 — Kill the 20 s: measure, then fix the DB read path
- **Measure first ("explain it"):** drive `map.html` in Playwright — zoom in, click a parcel, capture
  the network waterfall + timing and console; profile a search too. Determine round-trip count and
  whether the hosted DB uses `erf_int` or the FTS fallback. Write findings into this doc.
- **Fixes (presentation/ops layer — no figures touched):**
  - Replace the `SELECT 1` boot warm-up in **both** `map.js` and `atlas.js` `ensureDB()` with tiny
    *real* queries that fault in the hot pages: one `erf_int=` index probe + one `psearch MATCH`
    probe. First click/search becomes warm.
  - If measurement shows the hosted DB lacks `erf_int`: re-run `export_site.py` and **re-upload** the
    4 `data/db/` files to Supabase (`supabase storage cp`; token from Keychain via
    `$(security find-generic-password -w -s supabase-access-token)` — never printed/committed). This
    removes the FTS fallback for every click. Bump the `configUrl` bucket path if cache staleness bites.
  - If round-trips dominate, evaluate raising `requestChunkSize` in `config.json` (fewer, larger
    fetches) — measure the trade-off, don't cargo-cult.
- **Verify:** before/after click + search latency numbers. Commit (JS + any config) + push.

### M3 — Never-delete-data archival + growth scaffolding (the "see change over time" infra)
Growth is aggregate (median/total/residential-median), so per-cycle **aggregate snapshots** suffice —
no per-property history needed.
- `export_site.py`: after writing `stats.json`, append an immutable dated snapshot to
  `data/history/stats-<cycle-or-date>.json` (append-only; never overwrite/delete an existing one).
- `export_site.py`: compute per-node **growth** vs. the most recent *earlier* snapshot with a
  different cycle — `median_growth`, `total_growth`, `res_median_growth`, and annualized **CAGR** from
  the cycle-year gap. All null until a second snapshot exists (UI guards → shows nothing, honestly).
- `DATA_CONTRACT.md`: new section — history is append-only, snapshots are never deleted, this is how
  valuation change is tracked; document the growth computation and the null-until-two-rolls behaviour.
- **Verify:** export runs, one snapshot written, growth fields null, site still renders. Commit
  (stats.json + history/ + docs) + push.

### M4 — The stats that ARE possible now (export engine + rate)
`export_site.py` `extra()` / stats block, all recomputed, never hardcoded, every field guarded:
- **R/m² distribution** (residential): add `ppm_q1`, `ppm_q3`, `ppm_p90` (already have `ppm_median`).
- **Land-size distribution** (residential): add `erf_q1`, `erf_q3` (already have `erf_median`).
- **Percentile spread:** `p10`, `p90`, and `p90_p10_ratio`.
- **Concentration:** `top5_share`, `top10_share` (already have `top1_share`).
- **Category-specific medians:** median value per class in `cat_mix` (res/com/agri/state/vacant/other).
- **Outlier counts:** `n_over_10m`, `n_over_50m`, `n_under_250k`.
- **Vacant land:** `vacant_median`, `vacant_ppm_median`, vacant share of land area.
- **Parcel density:** compute each municipality's area (km²) from `data/geo/wc-municipalities.geojson`
  (spherical polygon area); province/district = sum. Emit `parcels_per_km2`, `roll_value_per_km2`.
- **Affordability inputs:** median residential value is already present; add a small sourced
  **prime-rate** fact (live fetch if a CORS-safe SARB endpoint exists, else a dated constant in the
  `rates.json`-style contract) so the front end can model bond payment + income needed at export- or
  render-time. Assumptions (rate, 20 yr term, 30 % of income) shown with the figure.
- **Verify:** `stats.json` gains the fields, `field_coverage`/sanity checks pass, JSON valid. The
  live site is unaffected until M5 reads them (harmless to ship early). Commit + push.

### M5 — Surface the new stats in the place panel (UI)
`index.html` + `assets/atlas.js`, reusing the Task-3 design system (Flighty number-hero, hairline
rows, soft-shadow tiles, one accent). Add grouped, guarded sections to the existing panel dashboard:
- **Value distribution** — percentile spread (P10–P90, 90/10 ratio), R/m² quartiles, land-size middle-50 %.
- **Composition** — category-specific medians, vacant-land value, outlier counts.
- **Standing** — this municipality's **rank within its district** by median / total / R/m² / vacant
  share (computed **client-side** from the loaded `stats.json` — no export coupling), and biggest
  contributors (top suburb by total from `towns.json`; top category by total from `cat_mix`).
- **Affordability** — estimated monthly bond + income-needed for the median home, visibly marked as
  an estimate with its assumptions.
- **Growth** (renders only once two rolls exist) — median / total / residential-median change + CAGR.
- Every block auto-hides when its data is absent (contract §5). Don't clutter: scale each section to
  the data, keep the number-as-hero hierarchy. Bump `atlas.js?v=`.
- **Verify:** full drill (province → district → muni), light/dark/mobile; growth block absent now;
  affordability labelled; ranks correct; Cape Town still degrades gracefully. Commit + push.

---

## Hard constraints (carry-over — do not violate)
- **Commit as the user; no Claude/AI authorship** anywhere.
- **Never hardcode figures**; every number recomputed by `export_site.py`. `rates.json` + the new
  prime-rate fact are the only hand-maintained data, and each needs `year`/`source`/`quote`.
- **Data is append-only / never deleted** — history snapshots are immutable (the whole point of M3).
- **Graceful degradation** everywhere; missing data → quieter page, never a crash.
- **Bump `?v=`** on edited JS; re-upload `data/db/` to Supabase after any DB regen (committing to the
  repo alone does NOT update the live search DB — contract §6/§8).
- **Supabase token** only via Keychain inline; never echo/write/commit it.
- Static site — no build step, no framework.

## Verification (end-to-end, before each push)
Serve `python3 -m http.server 8099` in the repo; drive both pages with Playwright, desktop +
mobile (390×844), light + dark. Confirm: overlap picks the small erf + chooser switches; click/search
latency improved with numbers; Atlas drill + reset; new stat blocks render and auto-hide correctly;
affordability labelled as estimate; growth block absent (one roll); Cape Town graceful; satellite
click still resolves. Only push once the milestone's checks pass.
