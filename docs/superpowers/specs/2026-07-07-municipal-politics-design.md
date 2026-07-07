# Municipal governance & representation on municipality pages — design

**Date:** 2026-07-07 · **Status:** approved for implementation

## Goal

Add, for each municipality, **who runs the council and how they got there**:

- the **2021 local-election result** (winner + seats/total) — stable, verifiable;
- **current governance** (governing party/coalition + sitting mayor) — dated;
- the **council seat breakdown** per party with **vote share %**; and
- the **ward councillors** (ward № → councillor + party).

This pairs with the existing "Who sets & governs these values" authorities block and
reuses its exact pattern: a keyed Python dict, all-optional fields, graceful
degradation (DATA_CONTRACT §5/§13), rendered on both the static municipality pages and
the Atlas panel.

## Scope

- **25 municipalities**: City of Cape Town (metro) + the 24 local municipalities.
- **District pages: excluded.** Local-election control sits at the local level; the 5
  district pages get no political block.
- Owner names are never involved. **Elected officials are public record** (IEC/gazette)
  so councillor/mayor names are shown; this is unrelated to the POPIA owner-name rule.

## Data model — new `extract/politics.py`

Mirrors `extract/authorities.py`: a `POLITICS` dict keyed by municipality name, a
`PARTY_COLOURS` shared map, and a `politics_for(name)` accessor. **Every field is
optional** — the renderer omits any absent row/section.

Shape per municipality (all keys optional):

    election  : {date, winner, winner_seats, total_seats, control}
                # control e.g. "outright majority" | "largest party (hung council)"
    governing : {party, basis, as_of}
                # basis e.g. "majority" | "coalition"; party may be a coalition string
    mayor     : {name, party, title}            # title e.g. "Executive Mayor"
    seats     : [ {party, seats, votes_pct}, ... ]   # ordered by seats desc
    wards     : [ {ward, councillor, party}, ... ]   # ordered by ward number

`PARTY_COLOURS` maps party abbreviations to their conventional colours (DA blue,
ANC green, EFF red, FF+ orange, ACDP …) with a **neutral fallback** for minor parties
and independents, used to colour the seat bars.

### Two labelled "as-of" facts (per the brainstorm)

- `election` — the **2021 IEC result**; never goes stale.
- `governing` + `mayor` — **current**, carrying an `as_of` year so a mid-term shift
  (coalition takeover, no-confidence) is legible.
- `wards` — anchored to **2021-elected councillors, with known by-election updates**.

### Validation

Each `wards[].ward` number must exist in `data/geo/wc-wards.geojson` for that `muni`
(the geojson already carries a `ward` int + `muni` name per feature). A build-time
check flags any ward number with no matching polygon. `seats[].seats` should sum to
`election.total_seats` when both are present (warn, don't fail — proportional/topup
seats can make this off by a small amount; note in data if intentional).

## Rendering — "Who represents this municipality"

A new block, same two-tier visual language as the authorities block, placed directly
below it.

**Municipality page (`export_pages.py` → `politics_section()`):** full block —
1. **Governance line:** `2021 election: DA won (27/43)` · `Now: DA majority
   (as of 2024)` · `Mayor: Jeremy Fasser (DA)`.
2. **Council seats:** a compact stacked/horizontal bar + a small table, seats and
   `votes_pct` per party, coloured via `PARTY_COLOURS`.
3. **Ward councillors:** a `<details>` list (`Ward 1 · A. Adams (DA)`), collapsed by
   default. **Page-only** (page-scale content).

**Atlas panel (`assets/atlas.js` → `renderPolitics()`):** the **summary only** —
governance line + seat bar — followed by a **"Full council & wards →"** link to the
municipality page. The full ward list is deliberately *not* in the panel.

Wiring mirrors authorities: new `${politics_section}` slot in
`templates/{muni,coct}.html`; `export_site.py` attaches a `"politics"` node to each
muni for the panel; bump `assets/atlas.js?v=24` in `index.html`.

## Sourcing & provenance

- **Primary source of truth: the IEC** (Electoral Commission of SA) 2021 Municipal
  Election results — authoritative for seats and vote %. Ward councillor names from
  IEC ward results; current mayor/governing party from official municipal sites or
  provincial gazettes.
- Collected via a **subagent fan-out** using cheap models (sonnet/haiku — per the
  "use cheaper subagent models" standing note), escalating only for stubborn cases,
  exactly as the authorities sweep was run. Every fact traces to a source.
- Provenance archived per municipality: a `## Governance & representation` section in
  each `<Muni>/SOURCE.md`, with raw IEC result PDFs under `<Muni>/politics/`.
- `extract/test_politics.py` (run directly, no pytest): asserts the dict shape, the
  ward-number ↔ geojson validation, and seat-sum sanity.

## Data flow / rebuild

Standard contract: after populating `politics.py`, run `python3 extract/build.py`
then `python3 extract/export_site.py` to regenerate the site data + static pages.
No valuation data changes, so `search.db` is untouched (no Supabase re-upload). Push
to the website repo (GitHub Pages) once live-useful.

## Future work / explicitly out of scope

This feature is built **panel-first knowing it will migrate to the page.** A separate,
later spec will:

1. **Rebalance panel vs. page** — shrink the Atlas panel to a summary (headline stats +
   "Full profile →"); move heavy detail (authorities, politics, ward lists,
   distributions) onto the municipality page. The panel-summary / page-full split above
   is a deliberate first step toward this.
2. **Make municipality pages discoverable** — real in-app entry points, not just
   deep-links/sitemap.
3. **Redesign the municipality pages** — currently generic/templated; bring them in
   line with the site's design principles (via the frontend-design skill).

Also future, not now:
- **Tie ward councillors to the map polygons** (click a ward → its councillor). The
  ward numbers already align to `wc-wards.geojson`, so this is a later render-only add.
- **District-level political data.**
