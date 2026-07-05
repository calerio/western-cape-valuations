# Valuation-provenance popover — design

**Date:** 2026-07-05
**Status:** Approved (design), pending implementation plan
**Repos touched:** `western-cape-property-valuations` (extract pipeline, non-git local) and
`western-cape-valuations` (site + DATA_CONTRACT, this repo).

## Problem

Each municipality's dashboard shows a terse roll date, e.g. `Valuation roll · 2013–2017`. That
line hides a lot: *which* roll the figures come from, whether it's a general or supplementary roll,
what date the values reflect, and — crucially for honesty — why some municipalities are on an old
vintage (Witzenberg's last full general roll is 2013; Laingsburg's is a draft; Cape Town is
search-only). Users can't tell a fresh 2023 revaluation from a decade-old one.

## Goal

On hover/tap of the roll date, show a small popover that paints a short, honest picture of the data
the Atlas holds for that municipality: what roll produced the figures, its coverage and vintage, and
— where it adds value — a one/two-sentence note on gaps or caveats.

Non-goals: no change to the underlying figures, schema, or DB; no province/district-level popover
(the roll date only exists at municipality level); no attempt to ingest newer partial rolls (that is
a separate future project).

## Content model

Per municipality, two tiers, assembled at export time:

**Backbone — always present, never fabricated (from the `roll` table the extractor already writes):**
- `roll` — display name of the roll used (e.g. "2013 General Valuation Roll").
- `roll_type` — `general` | `supplementary` | `draft`, derived from the `roll` table's stored type
  (`GV` → general, `SV` → supplementary) and overridden to `draft` when the cycle label ends in
  `-draft` (e.g. Laingsburg's `2018-draft`).
- `cycle_years` — the valuation cycle label already shown (e.g. "2013–2017").
- `properties` — parcel count (already in the muni node).
- `source_file` — the parsed filename(s), for a "where this came from" line.

**Note — authored, present only where it adds value:**
- `valued_as_at` — human date the values reflect, e.g. "2 July 2012" (optional).
- `coverage` — e.g. "all towns", "Ceres only" (optional).
- `note` — one or two plain sentences on vintage/coverage/gaps (optional; absent where there is
  nothing interesting to say).

Where an authored entry is missing, the popover shows the backbone alone. Where the whole
`provenance` object is missing, the subtitle renders exactly as today (no ⓘ, no popover).

## Data pipeline (respects DATA_CONTRACT)

1. **New authored source of truth:** `extract/provenance.py` — a `PROVENANCE` dict keyed by
   municipality name, holding only the *authored* fields (`roll` display name, `valued_as_at`,
   `coverage`, `note`). The backbone fields are NOT duplicated here — they come from the DB.
2. **Export merge:** `extract/export_site.py`, at the point it already reads
   `SELECT DISTINCT cycle FROM roll WHERE municipality_id=?` (currently line ~180), also reads
   `roll_type` and `source_file`, merges with `PROVENANCE.get(name)`, and emits a `provenance`
   object into each muni node of `stats.json`. Deterministic; no hand-editing of exported files.
3. **Frontend:** `assets/atlas.js` renders the popover purely from `scope.provenance`. Nothing about
   provenance is hardcoded in the frontend.
4. **DATA_CONTRACT.md:** add a short section documenting the `provenance` field and its
   graceful-degradation rule.

Regeneration remains: after any change, `python3 extract/build.py` then
`python3 extract/export_site.py`.

## UI / interaction

- Trigger: the municipality-level subtitle `Valuation roll · <cycle>` gains a dotted underline on
  the date and a trailing ⓘ affordance. Only rendered when `scope.provenance` exists.
- Desktop: hover → popover fades in, anchored just below the date; hides on mouse-out. Focusable
  (tab), Enter to open, Esc to close.
- Mobile: tap → open; tap-away or Esc → close (no hover on touch).
- Styling: existing glass `.platter` tokens + hairline separator, matching the panel. Popover is its
  own element (not the dark map `#tip`), light-card style, theme-aware via the shared tokens.
- Accessibility: `aria-describedby`/`role="button"` on the trigger; popover reachable by keyboard;
  respects reduced-motion.

## Authoring plan

- ~24 entries. Backbone is automatic. Notes are authored only where the `SOURCE.md` warrants one
  (Witzenberg, Laingsburg draft, Ceres-only 2023, Cape Town search-only, and any others the survey
  surfaces).
- Author by fanning cheap subagents over each municipality's existing `SOURCE.md`, each returning a
  structured `PROVENANCE` entry (or "backbone only" where nothing extra is warranted). Assemble into
  `extract/provenance.py`.

## Graceful degradation (the failure modes)

- Muni with `provenance` but no `note` → popover shows backbone only.
- Muni with no `provenance` at all → plain subtitle, no ⓘ (today's behaviour).
- `stats.json` built by an older export without the field → same as above; site stays valid.

## Effort

One focused pass: small frontend popover, a few lines of export change, one new `provenance.py`, a
DATA_CONTRACT note, and the parallelized authoring of 24 short entries. No schema/DB migration —
`provenance` is export-only.
