# Task 5 — Stellenbosch governance & election data (pilot)

## Status: mostly complete, one field medium-confidence

### 1. 2021 election results — HIGH confidence
Source: Wikipedia's transcription of the IEC 2021 LGE results table
(https://en.wikipedia.org/wiki/Stellenbosch_Local_Municipality_elections). The IEC's own
results dashboard (results.elections.org.za) is a JS-rendered SPA that WebFetch could not
extract a table from, so the primary corroboration used is Wikipedia's IEC-derived table
rather than the IEC site directly — this is a common, generally reliable secondary source for
these numbers but was not cross-checked digit-for-digit against a raw IEC CSV/PDF.

- Winner: DA, 28/45 total seats (outright majority)
- Seat sum check: 28+8+3+2+1+1+1+1 = **45 = total_seats exactly matched**, no discrepancy.
- Ward seats (19 DA + 4 ANC = 23) + list seats (22) = 45, internally consistent.

### 2. Ward councillors (wards 1–23) — MIXED confidence
- **Names**: HIGH confidence — sourced directly from the municipality's own
  https://stellenbosch.gov.za/wards/ page, which lists councillor names per ward.
  **22 of 23 wards sourced**; **ward 12 omitted** because the page did not render a name for
  it and no other source could confirm one — per instructions, invented nothing there.
- **Party per ward**: MEDIUM confidence. No IEC per-ward results table was fetchable. Party
  was inferred by combining (a) the known seat totals (DA won 19 ward seats, ANC won 4) with
  (b) a municipal council-page summary that named wards 12–15 specifically as the ANC-held
  wards. The two are consistent (4 ANC-named wards = 4 ANC ward-seat total), which is decent
  corroboration, but this is still an inference, not a direct per-ward source citation. All
  other 19 wards were assigned DA. Flagged in SOURCE.md for re-verification against a real
  IEC ward-results table if precision matters later.

### 3. Current governing party & mayor — HIGH confidence
- Governing party: DA (majority), as of 2026.
- Executive Mayor: **Jeremy Fasser (DA, Ward 17)** — sourced directly from
  https://stellenbosch.gov.za/mayco/, which also confirms his full Mayoral Committee (all DA).

## Files produced
- `/private/tmp/.../scratchpad/politics-stellenbosch.py` — Python dict entry
- `Cape-Winelands/Stellenbosch/SOURCE.md` — appended "Governance & representation" section
  with all source URLs
- No raw IEC PDF was directly downloadable (JS dashboard, not a static file), so no
  `politics/` directory of mirrored source docs was created.

## Recommended follow-up (not done in this pass)
Fetch a genuine IEC ward-level results table (CSV/PDF export, if one exists) for WC024 to
upgrade the ward-party mapping from medium to high confidence, and to attempt sourcing
Ward 12's councillor name from an authoritative record.
