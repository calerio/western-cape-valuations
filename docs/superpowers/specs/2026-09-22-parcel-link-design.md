# Parcel → valuation linker ("Integrity") — design

**Date:** 2026-09-22 · **Status:** approved by the brief (autonomous execution) · **Repos:** data
repo `extract/match/` (new), website repo `assets/map.js` + `DATA_CONTRACT.md`.

## Problem

A map click hands us a Surveyor-General erf (`PRCL_KEY`, erf number, `Town_code`, label point,
area, status) and we must show that parcel's roll valuation. The roll has no parcel key; erf numbers
restart in every township; the roll names localities in its own vocabulary (neighbourhoods,
Afrikaans, typos). Today's client-side lookup (`lookupErf` in `map.js`) is a heuristic run at click
time and cannot carry evidence or be validated offline. Audit: `extract/match/AUDIT.md`.

## Non-negotiables (from the brief)

Wrong valuations are never shown as certain; abstain rather than guess; every link carries evidence,
method, confidence and reason codes; ambiguity stays visible; no owner data; public sources only;
static output; reproducible on new rolls/cadastre; runs on an 8 GB laptop; no all-pairs comparison;
an LLM may propose crosswalks but never mints authoritative links.

## Architecture

Pipeline of bounded stages under `extract/match/`, communicating through SQLite tables (the repo's
idiom; no new dependencies — pandas/numpy only, pure-Python geometry). Each stage is a script with
an explicit input/output table and is idempotent.

```
fetch_cadastre.py   ArcGIS erven layer 1, attributes only ──▶ cache/cadastre.db  erf(1.42M)
profile.py          field/label reliability per muni×roll   ──▶ match.db  field_profile, label
normalize.py        identifiers, raw preserved                ──▶ match.db  ident
crosswalk.py        roll label → SG town, 3 evidence routes    ──▶ match.db  crosswalk
candidates.py       parcel × roll rows (muni, erf_int index)   ──▶ match.db  cand
adjudicate.py       features + tiered decision, reason codes   ──▶ match.db  link, cand_diag
build_lookup.py     static link table into search.db           ──▶ website data/db  link
evaluate.py         frozen fixture, baseline vs new, report     ──▶ fixtures/, reports/
```

### Universes

- **Parcels:** current erven only (`WSTATUS='C'`, 1,339,403). Obsolete erven (`H`, 77,120) are
  excluded from the lookup and from the map's draw (`loadParcels` gets `where WSTATUS='C'`), and
  are represented in the challenge set. Municipality of a parcel = municipality of its `Town_code`
  (allotment label point in `wc-municipalities.geojson`), verified per code by point-in-polygon
  of a parcel sample; a code straddling a boundary is split by per-parcel point-in-polygon.
- **Roll rows:** all `property` rows of the applicable (latest, post-supersede) roll. Namespaces:
  `erf` (full title), `unit` (sectional; parent erf + scheme), `farm` (not clickable today — the map
  draws no farm layers; kept in tables, decision `not_clickable`).

### Stage contracts

**profile** — `field_profile(muni, roll_id, column, n, n_null, n_distinct, constant, unreliable,
reason, top_values)` and `label(muni, source_col, label_raw, label_norm, n_rows, n_erfs, erf_lo,
erf_hi, reliable, reason)`. Unreliable: constant columns; labels in {'', '0', '-', municipality
name}; `UNREGISTERED …`; `CROSS REFERENCE` rows; columns the audit shows displaced.

**normalize** — `ident(prop_id, erf_raw, erf_int, erf_prefix, portion_raw, portion_int, unit_raw,
scheme_norm, namespace, transforms)`. `transforms` lists every rule applied (e.g. `strip_zeros`,
`prefix:SB`, `glued_portion`). Raw values are never overwritten.

**crosswalk** — `crosswalk(muni, source_col, label_norm, town_code, method, n_support, n_contra,
share, confidence_tier, evidence, contra, status, version, created)`. Methods:
- `name`: `norm(label)` equals `norm(SG town)` or a listed alias (`data/geo/town-aliases.json`,
  the single source shared by Python and `map.js`).
- `erfdist`: observations are the label's erf numbers that exist in **exactly one** SG town of the
  municipality (exclusive erfs). Propose town T when `support(T) ≥ 20` and
  `support(T)/all_exclusive ≥ 0.95`; other towns' exclusive hits are `contra`.
- `statssa`: `norm(label)` equals a Stats SA sub-place or main place in the municipality; parcels
  inside its polygon (label points, pure-Python point-in-polygon with bbox prefilter) whose erf
  numbers are among the label's erfs vote for their `Town_code`; propose when ≥ 30 votes and
  share ≥ 0.9.
- `manual`: `crosswalk-manual.json`, human-approved rows (empty initially; the review queue
  proposes entries and records who approved them).
Tiers: **A** = `name`/`manual`, or `erfdist` and `statssa` agreeing; **B** = `erfdist` alone with
≥ 50 observations at ≥ 0.97, or `statssa` alone with ≥ 30 votes; **C** = `erfdist` at the minimum
thresholds; **span** = consistent but not the label's home (shared numbering, ≥ 5 obs at ≥ 5%).
Name and Stats SA routes share the label's *name*; erfdist is independent of it — the tiering
reflects that dependence. Every row records its `route` (the exact evidence behind the tier).

Revisions made during the conflict review (2026-09-22, see `extract/match/crosswalk.py` semantics):
- A label maps to a *distribution* of towns (one row per consistent town), never a forced single
  answer; a 90/10 split without a name match is `span-only`.
- **§2b:** when a label uniquely *names* a town, no other town can rise above `span` on numbers
  alone (`route = span:demoted-by-name`). Exclusivity is computed within the municipality, so the
  town owning the top of the numbering range collects "exclusive" votes by density (Overstrand:
  every Zwelihle-labelled erf above 2117 is "exclusive" to HERMANUS only because HERMANUS numbers
  run to 9805). A manual entry can still lift such a town.
- **Conflict** (name says X, numbers establish Y ≠ X) is declared only when X was *testable* —
  has ≥ 20 exclusive erf numbers in the cadastre. A fully shadowed allotment (ZWELIHLE has 0) cannot
  be contradicted by a route that cannot see it.
- **Leave-one-out:** the adjudicator recomputes a pair's tier with the row's own vote removed.
- Same-named allotments inside one municipality are kept as sets (`span:name-ambiguous`), never
  collapsed.

**candidates** — `cand(prcl_key, prop_id, via)` for every current parcel: roll rows in the
parcel's municipality with `ident.erf_int = parcel erf` (namespace `erf` or `unit`). Indexed join;
no cross-municipality candidates. Portion-bearing parcels (`PRCL_KEY` portion ≠ 000000) match rows
with the same `portion_int`; portion 0 matches rows with no portion or portion 0.

**adjudicate** — per parcel, candidates are grouped (one group per full-title row; one group per
sectional scheme). Features per group: `town_ev` = max over the row's town/suburb labels of
{`direct`, `xwalkA`, `xwalkB`, `xwalkC`, `none`, `contra`}; `n_groups_town` (groups with
`town_ev ≥ B` for *this* parcel's town); `n_groups_muni`; `unique_in_muni` (erf number exists in one
SG town of the municipality and one non-unit roll row); `area_log_ratio` (roll extent vs
`GEOM_AREA`, ha/m² unit errors detected from the per-municipality ratio distribution);
`label_unreliable`; `date_conflict` (parcel `DATE_STAMP` after the roll's cycle start with
`LSTATUS` S/A). Decisions:

| decision | rule (all vetoes must be clear) | conf |
|---|---|---|
| `accepted_high` | one group with `town_ev ∈ {direct, xwalkA}`, no other group at ≥ B, area agrees or unknown | 0.97 / 0.93 |
| `accepted_high` | `unique_in_muni`, `town_ev ≠ contra`, area agrees | 0.90 |
| `accepted_group` | as above but the group is a sectional scheme (units listed, never one value) | same |
| `review` | one leading group with `xwalkB/C` or muni-only evidence, or area disagrees | 0.6–0.8 |
| `ambiguous` | ≥ 2 groups at the same evidence level | — |
| `not_in_roll` | no candidate and the roll covers ≥ 50% of the parcel's SG town | — |
| `abstain` | otherwise | — |

Vetoes: `contra` town evidence; `date_conflict`; `|area_log_ratio| > 0.7` with both areas known;
label unreliable (drops the town evidence to `none`, never to a match). Reason codes are strings
like `TOWN_DIRECT`, `XWALK_B:erfdist`, `UNIQUE_MUNI`, `AREA_OK`, `AREA_CONFLICT`, `LABEL_UNRELIABLE`,
`MULTI_GROUP:3`, `DATE_AFTER_ROLL`. Thresholds are re-fitted on the adjudicated fixture and the
fit is recorded in the report; they are not tuned on the fixture's individual cases (contaminated
cases are marked and a holdout of 10 per municipality is drawn).

**build_lookup** — `link(prcl_key, municipality_id, roll_version, roll_row_id, group_key,
relationship_type, decision, confidence_score, confidence_tier, matching_method, reason_codes,
positive_evidence, negative_evidence, crosswalk_version, cadastre_version, source_document,
source_page, pipeline_version, generated_at)` in `match.db`; `cand_diag` keeps per-candidate
features. `export_site.py` copies a compact projection into `search.db` as
`link(prcl_key PRIMARY KEY, prop_id, group_key, decision, tier, conf, method, reasons)` WITHOUT
ROWID. Only decided rows (`accepted_*`, `review`, `ambiguous`, `not_in_roll`) are exported.

**evaluate** — `fixtures/eval-1000.json`: 40 current parcels per municipality, `random.Random(20260922)`,
drawn by uniform row offset within the municipality's parcels, frozen (hash recorded) before any
matcher code ran; `fixtures/challenge.json`: hand-picked collisions, farms, sectional, OCR, town
disagreements, boundary, obsolete. `baseline.py` is a faithful port of `map.js` `lookupErf` +
`rankRows` (v25). `reports/eval-<date>.md`: per municipality and overall — verified-unique
coverage, high-confidence precision, incorrect-link rate, candidate-list rate, abstention,
no-roll, deltas vs baseline, macro/micro averages, Wilson 95% intervals; every incorrect
high-confidence link listed.

**Ground truth** — `review_sheet.py` writes one evidence packet per fixture parcel: cadastre
attributes; Stats SA main/sub-place at the label point; the roll page's raw text (`pdftotext` of
the recorded source page) for each candidate; all candidate rows. Adjudicators (subagents on a
cheap model + spot checks) label each packet `verified_unique | probable_unique | candidate_list |
no_roll_entry | unresolved | unverifiable` with a one-line justification and the evidence used;
the matcher's own decision is not shown to them.

## Site changes (website repo)

1. `loadParcels`: `where: "WSTATUS='C'"` — obsolete erven are no longer drawn.
2. `export_site.py`: `prop.town` exported; `lookupErf` ranks on town *or* suburb (immediate win,
   independent of the link table).
3. `lookupErf`: `SELECT … FROM link WHERE prcl_key=?` first; `accepted_high` → detail card;
   `accepted_group` → unit list; `review`/`ambiguous` → candidate list with the honest label;
   `not_in_roll` → "No valuation found"; no row → today's heuristic (labelled as such).
4. `DATA_CONTRACT.md` §9: the link table contract and the regeneration order
   (`build.py` → `match/run.py` → `export_site.py`).

## Runtime (laptop)

Cadastre snapshot ~6 min (1,420 requests, 6 threads); normalize ~1 min; crosswalk < 1 min;
candidates ~2 min (SQL join); adjudicate ~10 min (pure Python over ~1.5M candidate pairs);
export + upload as today. No cluster stage is required; geocoding is not used (no free public
geocoder covers these towns reliably and the design reaches its precision without it).

## Failure modes watched

Big-town bias in erf coverage (why exclusivity, not coverage, is the observation); crosswalks from
one coincidental erf (minimum support); label vocabulary drift on new rolls (profile stage re-flags);
provider attribute outages (`Town_code` presence is asserted by `fetch_cadastre`); obsolete
parcels; sectional units shown as a single value; boundary slivers (municipality by town code, not
by fragile per-click geometry); the fixture leaking into rule design (contamination flags +
holdout).
