# Task 1 report — politics.py data module + accessors

## What was done

Created two files in the (non-git-tracked) data repo
`/Users/valeriocosta/projects/western-cape-property-valuations/extract/`:

- `test_politics.py` — the failing test, written first per TDD, exactly as specified
  in the plan (4 tests: `test_accessor_and_fallback`, `test_shapes`,
  `test_ward_numbers_match_geojson`, `test_seat_sum_sane`).
- `politics.py` — the implementation, modelled on `extract/authorities.py`'s
  conventions (module docstring, shared-constants-then-per-entry dict pattern,
  simple accessor functions). Exports `POLITICS`, `PARTY_COLOURS`, `party_colour()`,
  `politics_for()`.

## Ward number check (Stellenbosch)

Ran:
```
python3 -c "import json;g=json.load(open('/Users/valeriocosta/projects/western-cape-valuations/data/geo/wc-wards.geojson'));print(sorted({int(f['properties']['ward']) for f in g['features'] if f['properties']['muni']=='Stellenbosch'}))"
```
Result: `[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]`

Ward 1 is present, so the plan's placeholder `wards` entry (`{"ward": 1, ...}`) was
kept as-is.

## TDD sequence

1. `cd .../extract && python3 test_politics.py`
   Result (before `politics.py` existed): **FAILED** as expected —
   `ModuleNotFoundError: No module named 'politics'`.
2. Created `extract/politics.py` per the plan's Step 3 code, seeded with the two
   worked examples (Stellenbosch, City of Cape Town).
3. `cd .../extract && python3 test_politics.py`
   Result: **FAILED** — `test_seat_sum_sane` tripped on both seed entries, because
   the plan's own illustrative seat figures don't sum close enough to
   `total_seats` (Stellenbosch: 27+8+2=37 vs 43, diff 6 > allowed 2; City of Cape
   Town: 136+43=179 vs 231, diff 52 > allowed 2).
4. **Deviation from the plan's literal seed numbers:** adjusted the placeholder
   seat breakdowns (still fictitious/illustrative, not sourced — Task 5 replaces
   them) so `sum(seats) `is within 2 of `total_seats`, satisfying the test the plan
   itself specifies:
   - Stellenbosch: DA 27, ANC 10, EFF 4 (sum 41, total 43, diff 2)
   - City of Cape Town: DA 136, ANC 43, EFF 27, GOOD 23 (sum 229, total 231, diff 2)
5. `cd .../extract && python3 test_politics.py`
   Result: **PASSED** —
   ```
   PASS test_accessor_and_fallback
   PASS test_seat_sum_sane
   PASS test_shapes
   PASS test_ward_numbers_match_geojson

   All 4 tests passed.
   ```

## Concerns / deviations

- Only deviation from the plan: the exact placeholder seat numbers in Step 3's code
  block don't satisfy the plan's own Step-1 test (`test_seat_sum_sane`). I kept the
  same parties and DA/ANC totals close to the plan's spirit but added seats to the
  minor parties so the sum-vs-total check passes. These remain explicitly-flagged
  placeholders; Task 5 replaces all of it with real IEC-sourced figures, so this has
  no downstream effect on scope.
- Everything else — module shape, docstring, function signatures, ward number 1 for
  Stellenbosch — matches the plan verbatim.
- Did not touch any files in `~/projects/western-cape-valuations` (website repo)
  other than reading the plan and the wards geojson, per instructions.
- No commit was made — the data repo is not git-tracked, per the plan's Step 5 note
  and the task instructions.
