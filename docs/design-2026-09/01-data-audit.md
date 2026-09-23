# Data audit for the Explore / overview page

**Date:** 2026-09-23. **Database:** `extract/wc-valuations.db` (257 MB, opened read-only). **Also read:** `extract/match/match.db` (`roll_unit`, read-only).
**Method:** only `sqlite3 -readonly` and Python `sqlite3` with `mode=ro`, streaming aggregates. No query took longer than 5.5 s once the category map was built as a TEMP table. I modified no file in either repository. Scratch scripts are in this folder (`q.py`, `t1.py` … `t10.py`).

Throughout, **"valued"** means `market_value_r > 0`, and percentiles are **nearest-rank**: the first value whose row number is at least p·n. At p50 this gives the same figures as `export_site.quant()`'s interpolation, for example 915 000 for the whole province.

---

## 0. Critical findings (read first)

1. **Owner names are in the public data (POPIA).** In Matzikama, the 864 rows with `suburb='0'` are column-shifted. `site_address` holds the **registered owner's name**, for example "Owies Johanna Gertruida" or "Jasson Mattheus Familie Trust, Cornelius Lesley Harry And other …", and `category` holds the town name (VREDENDAL, EBENEZER, KLAWER …). `site_address` is exported to `search.db` as `prop.address`, so these names are **live**. Test: `SELECT site_address FROM property WHERE municipality_id=12 AND suburb='0'`. A heuristic scan of the other municipalities found only street or estate names, but it was not exhaustive. **Blank `site_address` for these rows before any further export, and never show it on the Explore page.**
2. **Cape Town value is double-counted, by between R15.1bn and about R36bn.** The CoCT freehold roll lists each multi-use property twice: once as a parent "HOLDING – SEE HANGING BELOW" or "MULTIPLE PURPOSES" row, which has an erf, and again as per-use ALLOCATION rows. `coct_xlsx.py` keeps the allocation rows with no erf and no suburb.
   - 12 parents equal the exact sum of their allocation rows at the same address, R15,079,151,255 in total. One example is 35 Alfred Street: the parent is R14,531,325,255 and the allocations are 13,421,574,174 + 674,286,000 + 435,465,081.
   - All parents together total **R36.14bn** (1,315 rows), and all erf-less allocation rows total **R36.63bn** (1,951 rows). The two totals are almost equal, which suggests most of the ~R36bn is counted twice. That is about 1.4% of the province total.
   - The parser drops the valuation reference, so the remaining pairs cannot be joined until the parser is fixed.
   - The current `stats.json` "most valuable property" (`hi`) is this parent row, and the allocation row is the second most valuable.
3. **`stats.json` `vacant_land_share` is wrong (province 0.0001).** Its denominator sums every extent, and that sum is dominated by broken farm extents:
   - Oudtshoorn: 1,533 farm rows over 100 km² each, 1.9×10¹³ m² in total. The Western Cape is only 1.3×10¹¹ m². The largest is 1.18×10¹² m².
   - Knysna: 25 "full_title" farms with the farm number glued onto the extent, for example 53,024,308,663 m².
   - The 2026-09-22 extent fix and the `roll_unit` check tested **erven only**. Farm and rural rolls were never tested (see §3).
4. **Stale provenance.** `provenance.py` says Witzenberg's roll was "valued as at 2 July 2012" and that "the 2013 roll is still the most recent", and `stats.json` ships that text. The DB now holds **GV2023Combined** (cycle 2023-2027, date of valuation 2022-07-01, per `Witzenberg/SOURCE.md` and memory). `DATA_CONTRACT.md` §3/§7 are also stale: they say Cape Town is not in the DB, Stellenbosch has 0 sectional rows, and Witzenberg is on an old cycle.
5. **Bitou tenure is wrong for 4,775 rows.** Rows with `ss_scheme` like "-   220" are **farm portions tagged `sectional`**. They have ART 8 agricultural categories and extents up to 37.6 km². As a result, Bitou's sectional share reads 41%, when about 19% is real, and its farm count reads 44.

---

## 1. Schema summary

| Table | Rows | Columns |
|---|---|---|
| `municipality` | 25 | `id, name, district` (24 local municipalities plus the City of Cape Town; 6 districts) |
| `roll` | 196 | `id, municipality_id, roll_type (GV/SV0…SV7), cycle, engine, source_file`. These 196 rows are source files; they make up 58 distinct (municipality, roll_type) instruments, and 73 of the files are supplementary rolls. |
| `property` | 1,459,474 | `id, roll_id, municipality_id, town, suburb, tenure_type (full_title/sectional/farm/sectional_parent), erf_no, portion, ss_scheme, unit_no, category (raw), site_address, extent_m2, dwelling_extent_m2 (CoCT only), market_value_r, page, parent_erf` (`parent_erf` was added by ALTER, so it is the last column; 8,379 rows, Stellenbosch only) |

**Indexes:** `idx_property_muni(municipality_id)`, `idx_property_value(market_value_r)`, `idx_property_addr(site_address)`, `idx_property_erf(erf_no)`. There is no composite (municipality, value) index. Per-municipality percentiles use one windowed sort, which takes about 3 s (see §5).

**Personal data:** no column is meant to hold owner or personal information, and the build drops owner names by design. The exception is Matzikama's `site_address` for 864 rows (finding 0.1). Treat `site_address` as **not safe to aggregate or display** for those rows. None of the statistics below uses `site_address`, and the proposed "top places" list uses only suburb or town labels.

---

## 2. What `stats.json` contains today

The file lives at `western-cape-valuations/data/stats.json`: 91,376 B, **19,120 B gzipped**. Its top level is `{buckets[10], province{…}, districts{<6>:{…, municipalities{<25>}}}}`. Province, district and municipality nodes all carry the same fields:

| Field(s) | Computed in `export_site.py` | Definition |
|---|---|---|
| `buckets` | L53–55 `BUCKET_LABELS` | 10 fixed linear bands, from under R250k to over R10m |
| `properties` | L205 (province), L215 (muni), L233 (district) | `COUNT(*)`, including R0 and NULL rows |
| `valued, total, mean, median, q1, q3, min, max` | `stats()` L32–45 via `vals_for()` L47–50 | Over valued rows. `quant()` L26 interpolates. |
| `residential_avg, res_median` | `stats()` L40–44 | `UPPER(category) LIKE '%RES%'`. This is a substring match, so it also catches "MUNICIPAL PROPERTY RESIDENTI", "VACANT LAND : RESIDENTIAL" and "…RESERVE". |
| `hist` | `hist_for()` L56–63 | Counts per `BUCKETS` band |
| `hi`, `lo` | `extreme()` L72–88 | The highest-valued row, and the lowest residential row at or above R100k. **`hi` province = the CoCT holding row (finding 0.2).** |
| `std, cv, gini, res_gini` | `extra()` L107–154 | Population std; Gini over valued rows; residential Gini once there are at least 30 rows |
| `dq_no_value, dq_no_extent, dq_no_cat, dq_nominal` (+ `_share`) | `extra()` L155–159 | Counts. "Nominal" means value ≤ R1 000. |
| `top1_share, top1_count, top5_share, top10_share` | L161–163 | Share of value held by the top k properties |
| `p10, p90, p90_p10_ratio` | L165–166 | |
| `n_over_10m, n_over_50m, n_under_250k` | L168–170 | |
| `cat_mix{res,com,agri,state,vacant,other}{count,value,median}` | `classify()` L91–99 plus L118, L146–148 | Keyword classes. Industrial is merged into `com`, and PSI into `state`. |
| `sectional_share, vacant_share` | L172–173 | **Not comparable across municipalities** (§3, §4) |
| `erf_median/q1/q3, ppm_median/q1/q3/p90` | L175–182 | Residential extent and R/m² with **no tenure or reliability filter**, so sectional unit floor areas and farm rows are mixed in |
| `dwext_*`, `dw_ppm_median` | L185–188 | Cape Town dwelling floor area |
| `vacant_median, vacant_ppm_median, vacant_land_share` | L190–192 | **`vacant_land_share` is broken (finding 0.3)** |
| `area_km2, parcels_per_km2, roll_value_per_km2` | L244–294 | From the geojson polygons. The comment at L248 claiming "City of Cape Town is absent" is stale: the province area of 129,527 km² includes Cape Town. |
| Muni only: `cycle, provenance{kind,cycle,properties,+authored}, authorities, politics` | L216–227 | `kind` checks `t == "SV"`, but roll types are `SV1`… That test is never true, which is harmless because every municipality has a GV roll. |
| Growth: `median_growth, total_growth, res_median_growth, cagr, growth_from` | L345–371 | Absent today: only one cycle per municipality |

The other site files:
- `towns.json`: 51 KB, 14 KB gzipped. Per municipality, the 40 largest suburbs by parcel count, with `{name, parcels, total, median, avg}` over **all categories**. It is not suitable for a "most valuable places" ranking.
- `rates.json`: hand-curated rates tariffs, 3.9 KB gzipped.
- `history/stats-*.json`: aggregate snapshots from 2026-07-03, 07-16 and 07-19, about 4.5 KB each.

---

## 3. Per-municipality context

Measured in 0.9 s (one GROUP BY over `property JOIN roll`, using `idx_property_muni`). Column definitions:
- "R0" means `market_value_r=0`; "NULL" means no value.
- "sect%" is `tenure_type='sectional'`.
- "ext>0%" is the share of rows with `extent_m2 > 0`.
- **Extent reliability** comes from `match.db.roll_unit`. It compares the median absolute deviation (MAD) of log₁₀(roll extent ÷ SG parcel area) over tier-A erf matches; `adjudicate.py` L203–230 marks a roll unreliable when MAD > 0.3. After the Oudtshoorn fix, 127 of 154 tested rolls have n ≥ 30 and **none is unreliable**. The **42 untested rolls** are all sectional, farm or rural files (see `t8.py`): 258,780 rows, of which only 3,866 are full-title.
- **Date of valuation** is the date the values reflect. The **cycle** is the rating period in which the roll is in force; it normally starts 12 to 18 months later. Dates are quoted from each `SOURCE.md`; "n/d" means that file does not state one.

| Municipality | Rows | Total value (R) | DB cycle | Date of valuation | GV rows | SV rows | R0 | NULL | sect% | ext>0% | Extent reliability |
|---|---|---|---|---|---|---|---|---|---|---|---|
| City of Cape Town | 877,329 | 1,721,191,772,963 | 2025-2028 | GV2025: certified 30 Jan 2026, effective 1 Jul 2026. The date of valuation is n/d in SOURCE.md (the xlsx column says "as at 01 Jul 2026", which is the effective date; GV2025 naming implies 1 Jul 2025, so verify). **The DB cycle label looks wrong.** | 877,329 | 0 | 7,056 (7,049 sectional) | 549 | 26.0 (units; no parent erf) | 99.8 | Freehold MAD 0.001 ✔. Sectional extent is the **unit floor area**. ~R36bn double count (0.2). |
| George | 57,244 | 73,384,883,979 | 2023-2027 | n/d (implemented 1 Jul 2023) | 50,821 | 6,423 | 203 | 1,804 | 7.0 | 99.6 | Erf rolls ✔ (max MAD 0.074). Rural rolls untested. |
| Drakenstein | 52,896 | 121,211,814,387 | 2025-2029 | n/d (GV2024, in force 1 Jul 2025 to 2029) | 51,148 | 1,748 | 1,083 | 0 | 10.5 | 99.9 | ✔ (0.007). Paarl RD and sectional files untested. |
| Mossel Bay | 47,577 | 67,963,481,000 | 2022-2026 | 1 Jul 2021 | 42,508 | 5,069 | 417 | 210 | 16.1 | 100.0 | ✔ (0.003) |
| Overstrand | 42,792 | 89,250,944,500 | 2023-2028 | 2 Jul 2022 | 37,839 | 4,953 | 344 | 0 | 2.0 | 99.6 | ✔ (0.049) |
| Saldanha Bay | 41,223 | 76,649,463,500 | 2025-2030 | 1 Jul 2025 (implemented 1 Jul 2026) | 41,223 | 0 | 60 | 0 | 4.1 | 100.0 | ✔ (0.023) |
| Stellenbosch | 36,680 | 120,797,973,000 | 2025-2029 | 1 Jul 2025 | 36,680 | 0 | 631 (303 scheme parents) | 0 | 22.8 | 100.0 | ✔ (0.041). SBP/CDP farm volumes untested. |
| Breede Valley | 29,053 | 44,935,804,765 | 2026-2031 | n/d | 29,053 | 0 | 70 | 0 | 2.2 | 100.0 | ✔ (0.001). **24.6% of rows have no category.** |
| Swartland | 28,413 | 47,156,739,950 | 2023-2028 | 1 Jul 2023 | 28,413 | 0 | 148 | 0 | 2.7 | 100.0 | ✔ (0.039) |
| Knysna | 24,654 | 42,913,157,640 | 2023-2028 | n/d (in force 1 Jul 2023 to 30 Jun 2028) | 21,681 | 2,973 | 457 | 36 | 9.0 | 95.4 | Erven ✔ (0.007). **Farms are not reliable** (glued farm numbers, up to 5.3×10¹⁰ m²). |
| Oudtshoorn | 22,865 | 17,821,727,000 | 2024-2029 | "2024". SOURCE.md contradicts itself: it says certified 31 Jan 2024 but also "2024/07/01 (also 2023/07/01)". | 22,865 | 0 | 0 | 2,645 | 1.8 | 99.1 | Town erven ✔ after the fix (0.015). **Farms are not reliable** (×10⁴, 1,533 rows over 100 km²). |
| Langeberg | 22,226 | 31,323,460,800 | 2026-2031 | 1 Jul 2025 | 22,226 | 0 | 0 | 942 | 2.6 | 96.8 | ✔ (0.008). SVs are scanned, so none were ingested. |
| Bitou | 21,594 | 44,220,433,488 | 2025-2029 | n/d (in force 1 Jul 2025 to 30 Jun 2029) | 21,594 | 0 | 0 | 2,026 | 41.2 (**about 19% real**) | 94.3 | Erven ✔ (0.001). **4,775 farm portions are mis-tenured as sectional.** Categories are truncated ("DENTIAL PROPERTIES ART 8"). |
| Hessequa | 21,312 | 26,813,381,000 | 2021-2026 | 1 Jul 2020 | 21,312 | 0 | 42 | 0 | 4.3 | 98.8 | ✔ (0.015). **The roll's term ended 30 Jun 2026.** |
| Theewaterskloof | 19,624 | 30,704,523,000 | 2023-2028 | n/d | 19,624 | 0 | 201 | 0 | 1.5 | 100.0 | Town ✔ (0.002). Farm and sectional files untested. |
| Witzenberg | 16,393 | 19,524,150,500 | 2023-2027 | 1 Jul 2022 (**provenance.py still says 2 Jul 2012**) | 15,934 | 459 | 351 | 0 | 0.3 | 99.7 | ✔ (0.041) |
| Matzikama | 15,962 | 12,750,633,007 | 2025-2030 | n/d (effective 1 Jul 2025) | 15,962 | 0 | 87 | 0 | 1.3 | 90.2 | ✔ (0.022). **864 column-shifted rows contain owner names (0.1).** |
| Beaufort West | 14,984 | 7,598,002,400 | 2024-2029 | n/d (in force 1 Jul 2024 to 30 Jun 2029) | 14,984 | 0 | 0 | 6 | 0.0 | 100.0 | Towns ✔ (0.003). RD volumes untested. |
| Bergrivier | 14,752 | 17,001,392,500 | 2023-2028 | 1 Jul 2022 | 12,738 | 2,014 | 839 | 0 | 2.8 | 99.2 | ✔ (0.002) |
| Cape Agulhas | 13,907 | 17,183,346,667 | 2023-2028 | n/d | 13,162 | 745 | 26 | 35 | 2.9 | 99.8 | ✔ (0.003) |
| Swellendam | 10,453 | 10,930,066,830 | 2023-2028 | n/d (in force 1 Jul 2023 to 30 Jun 2028) | 9,506 | 947 | 135 | 21 | 3.5 | 99.1 | ✔ (0.012) |
| Cederberg | 10,285 | 9,479,837,000 | 2022-2027 | 1 Sep 2021 | 10,285 | 0 | 16 | 0 | 0.0 (not recorded) | 97.7 | ✔ (0.005). No farm tenure is recorded. |
| Kannaland | 9,513 | 5,058,326,000 | 2026-2031 | 1 Sep 2025 | 9,513 | 0 | 0 | 0 | 0.3 | 99.9 | ✔ (0.020) |
| Prince Albert | 4,047 | 3,368,675,000 | 2023-2028 | 1 Jul 2023 (per SOURCE.md) | 4,047 | 0 | 118 | 0 | 0.0 | 100.0 | Town ✔ (0.059). RD untested. |
| Laingsburg | 3,696 | 1,182,654,872 | **2018-draft** | n/d. This is a 2018 **draft** (CDV). The current GV2024-2029 roll (date of valuation 1 Sep 2023) has not been collected. | 3,696 | 0 | 1,223 (all CROSS REFERENCE) | 6 | 0.0 | 66.3 | ✔ (0.004, but only n=143) |
| **Province** | **1,459,474** | **2,660,416,645,748** | | | 1,434,143 | 25,331 (R48.6bn) | 13,507 | 8,280 | | | |

**Comparability flags:**
- **Dates of valuation range from 1 Jul 2020 (Hessequa) to 1 Sep 2025 (Kannaland), plus Laingsburg's pre-2018 draft.** That is a gap of five or more years of nominal house-price inflation, so cross-municipality value comparisons compare different years.
- **Supplementary rolls** are ingested for only 9 municipalities, where `build.supersede()` replaces GV rows with the later SV rows. The rest are GV-only snapshots. Deferred: Theewaterskloof, Matzikama, Bitou, Cederberg, Stellenbosch, Oudtshoorn, Hessequa and Langeberg (Langeberg's SVs are scanned).
- **Sectional units count as properties.** They are 26% of Cape Town rows and 23% of Stellenbosch rows, while several rolls record none. Their parent erven are R0 or absent.
- **R0 rows** include consolidations and cross-references (all 1,223 R0 rows in Laingsburg, 33% of its rows), sectional parents (Stellenbosch 303) and Cape Town sectional units at R0.
- **George** now includes its satellite towns. There are no other known missing towns, apart from tiny peripheral townships (memory: The Bridge, Mount Eland, Welmoed, Louis Rood).

---

## 4. Category taxonomy

Raw distinct `category` values per municipality:

| Municipality | Values | Municipality | Values | Municipality | Values |
|---|---|---|---|---|---|
| Knysna | **590** | Swellendam | 46 | Oudtshoorn | 15 |
| Bitou | 93 | Matzikama | 31 | Cape Agulhas | 15 |
| George | 77 | Mossel Bay | 24 | Beaufort West | 14 |
| Stellenbosch | 66 | Langeberg | 18 | Cederberg | 13 |
| Hessequa | 60 | City of Cape Town | 15 | Drakenstein | 13 |
| Theewaterskloof | 12 | Laingsburg | 12 | Swartland | 10 |
| Saldanha Bay | 10 | Overstrand | 10 | Kannaland | 10 |
| Bergrivier | 10 | Witzenberg | 9 | Breede Valley | 8 |
| Prince Albert | 8 | | | | |

There are 1,162 distinct (category, tenure) pairs. The full dump is in `cats.tsv` in this folder.

**Why the taxonomies differ:**
- **Knysna** appends a free-text use in brackets, for example "RESIDENTIAL [GARAGE]".
- **Stellenbosch** uses "Label [CODE]", for example "Residential [MUNR]".
- **Bitou** strings are **column-truncated**, for example "DENTIAL PROPERTIES ART 8" and "AR".
- **Mossel Bay** has 3,894 rows categorised "N" and 993 "Y" (a parser column slip, R8.2bn).
- **Matzikama** has town names in the category column (the shifted rows in 0.1).
- **Hessequa** uses codes such as RES IMP, FARAGR and MUNPOS.
- **Cape Town** uses the 15 statutory categories.
- **Seven rolls have no vacant category**: Drakenstein, Breede Valley, Witzenberg, Bergrivier, Kannaland, Prince Albert and Laingsburg. Vacant land there is rated as residential or other.
- **Bitou has no business category.**
- **Breede Valley has 7,161 uncategorised rows (R20.4bn, 45% of its value).**

**Proposed normalisation.** First take the primary label, which is the text before `[`, upper-cased. Then apply the first rule that matches:

1. `%ROSS REF%` or `REFER/%` → **other**. These are reference rows, usually R0.
2. PSI, `%INFRASTRUCT%`, RDST, PUBLIC ROAD or `%IMPERMISSIBLE%` → **public_infrastructure**.
3. `MUN%`, `%NICIPAL%`, `%IPAL PROP%`, `STATE%`, `% OF STATE%`, `%STATE AND%`, STATOW, STATVC, `%PSP%`, `%PUBLIC SERVICE%` or `%PUBLIC PURPOSE%` → **municipal_state**. These are ownership or use by government.
4. `%AGR%`, `FAR%`, `%FARM%`, `%ULTURAL%`, `%TURAL PROP%` or `%SMALLHOLD%` → **agricultural**.
5. `%VAC%` or `%LAND :%` → **vacant**. This covers private vacant land of any zoning; municipal vacant land is caught earlier by rule 3.
6. MULTI, PBO, BENEFIT, WORSHIP, RELIG, CHURCH, CONSERV, PROTECT, NOT LIABLE, NOT FOR PROFIT, MONUMENT, SHELTER, MISC, OPEN SPACE, RESERVE, `%USE PROPERTY%`, `%RSHIP%`, `POW%`, WOR, REL, PROT, POS, PROS, PUBBNR or PRIVATE ROAD(S) → **other**.
7. `%INDUSTR%`, `%STRIAL PROP%`, IND, INDUS, SS IND, `IND %`, MINING, `MINE%` or MIN → **industrial**.
8. `%BUS%`, `%COMMERC%`, COM, COMM, SHOP, OFFICE, RETAIL, GUEST, HOTEL or ACCOMMODATION → **business_commercial**.
9. `%RES%`, `%DENTIAL%`, `%NTIAL%`, `%DWELL%`, SECTIONAL, SEC SCHEME, FLAT or HOUSING → **residential**.
10. If no category rule matched and `tenure_type='farm'` → **agricultural** (tenure fallback).
11. Otherwise → **other (uncoded)**.

Order matters. Because rule 3 comes before rules 4 and 5, "MUNICIPAL VACANT" becomes municipal_state. Because rule 4 comes before rule 5, "AGRICULTURAL [VACANT]" becomes agricultural. Because rule 6 comes before rule 9, "NATURE RESERVE" becomes other.

This is implemented as a CTE over the 1,162 distinct pairs, materialised once as a TEMP table. That takes 0.4 to 1.3 s; after that every join is under 1 s.

```sql
CREATE TEMP TABLE catmap AS WITH catmap AS (SELECT k.c, k.t, CASE
 WHEN k.lbl LIKE '%ROSS REF%' OR k.lbl LIKE 'REFER/%' THEN 'reference'
 WHEN k.lbl LIKE '%PSI%' OR k.lbl LIKE '%INFRASTRUCT%' OR k.lbl='RDST' OR k.lbl='PUBLIC ROAD' OR k.lbl LIKE '%IMPERMISSIBLE%' THEN 'public_infrastructure'
 WHEN k.lbl LIKE 'MUN%' OR k.lbl LIKE '%NICIPAL%' OR k.lbl LIKE '%ICIPAL PROP%' OR k.lbl LIKE '%IPAL PROP%' OR k.lbl LIKE '%STATE AND%' OR k.lbl='STATOW' OR k.lbl LIKE 'STATE%' OR k.lbl LIKE '% OF STATE%' OR k.lbl LIKE 'STATVC%' OR k.lbl LIKE '%PSP%' OR k.lbl LIKE '%PUBLIC SERVICE%' OR k.lbl LIKE '%PUBLIC PURPOSE%' THEN 'municipal_state'
 WHEN k.lbl LIKE '%AGR%' OR k.lbl LIKE 'FAR%' OR k.lbl LIKE '%FARM%' OR k.lbl LIKE '%ULTURAL%' OR k.lbl LIKE '%TURAL PROP%' OR k.lbl LIKE '%SMALLHOLD%' THEN 'agricultural'
 WHEN k.lbl LIKE '%VAC%' OR k.lbl LIKE '%LAND :%' THEN 'vacant'
 WHEN k.lbl LIKE '%MULTI%' OR k.lbl LIKE '%PBO%' OR k.lbl LIKE '%BENEFIT%' OR k.lbl LIKE '%WORSHIP%' OR k.lbl LIKE '%RELIG%' OR k.lbl LIKE '%CHURCH%' OR k.lbl LIKE '%CONSERV%' OR k.lbl LIKE '%PROTECT%' OR k.lbl LIKE '%NOT LIABLE%' OR k.lbl LIKE '%NOT FOR PROFIT%' OR k.lbl LIKE '%MONUMENT%' OR k.lbl LIKE '%SHELTER%' OR k.lbl LIKE '%MISC%' OR k.lbl LIKE '%OPEN SPACE%' OR k.lbl LIKE '%RESERVE%' OR k.lbl LIKE '%USE PROPERTY%' OR k.lbl LIKE '%RSHIP%' OR k.lbl IN ('WOR','REL','PROT','POS','PROS','PUBBNR','PRIVATE ROAD','PRIVATE ROADS') OR k.lbl LIKE 'POW%' THEN 'other'
 WHEN k.lbl LIKE '%INDUSTR%' OR k.lbl LIKE '%STRIAL PROP%' OR k.lbl IN ('IND','INDUS','SS IND') OR k.lbl LIKE 'IND %' OR k.lbl LIKE '%MINING%' OR k.lbl LIKE 'MINE%' OR k.lbl='MIN' THEN 'industrial'
 WHEN k.lbl LIKE '%BUS%' OR k.lbl LIKE '%COMMERC%' OR k.lbl IN ('COM','COMM') OR k.lbl LIKE 'COM %' OR k.lbl LIKE '%SHOP%' OR k.lbl LIKE '%OFFICE%' OR k.lbl LIKE '%RETAIL%' OR k.lbl LIKE '%GUEST%' OR k.lbl LIKE '%HOTEL%' OR k.lbl LIKE '%ACCOMMODATION%' THEN 'business_commercial'
 WHEN k.lbl LIKE '%RES%' OR k.lbl LIKE '%DENTIAL%' OR k.lbl LIKE '%NTIAL%' OR k.lbl LIKE '%DWELL%' OR k.lbl LIKE '%SECTIONAL%' OR k.lbl LIKE '%SEC SCHEME%' OR k.lbl LIKE '%FLAT%' OR k.lbl LIKE '%HOUSING%' THEN 'residential'
 WHEN k.t='farm' THEN 'fallback_farm'
 ELSE 'unmapped' END AS rule
 FROM (SELECT DISTINCT COALESCE(category,'') c, COALESCE(tenure_type,'') t,
   UPPER(TRIM(CASE WHEN INSTR(category,'[')>1 THEN SUBSTR(category,1,INSTR(category,'[')-1) ELSE COALESCE(category,'') END)) lbl FROM property) k)
SELECT * FROM catmap;
-- join:  JOIN catmap cm ON cm.c=COALESCE(p.category,'') AND cm.t=COALESCE(p.tenure_type,'')
-- group: CASE cm.rule WHEN 'fallback_farm' THEN 'agricultural' WHEN 'unmapped' THEN 'other' WHEN 'reference' THEN 'other' ELSE cm.rule END
```

**Coverage** (0.8 s):

| Group | Rows | % rows | % value |
|---|---|---|---|
| residential | 1,265,890 | 86.74 | 81.44 |
| business_commercial | 45,121 | 3.09 | 5.59 |
| industrial | 8,818 | 0.60 | 1.13 |
| agricultural (incl. 3,736 by tenure fallback) | 35,586 | 2.44 | 6.32 |
| vacant | 39,168 | 2.68 | 1.13 |
| public_infrastructure | 9,972 | 0.68 | 0.08 |
| municipal_state | 20,300 | 1.39 | 1.04 |
| other (explicit 10,040 + reference 3,024 + uncoded 21,555) | 34,619 | 2.37 | 3.26 |

- **Mapped by a category rule: 98.26% of rows and 98.19% of value.**
- Adding the tenure fallback gives 98.52% of rows and 98.34% of value.
- Left uncoded: 1.48% of rows and 1.66% of value. The main sources are Breede Valley NULL (7,161), Mossel Bay "N"/"Y" (4,887), Drakenstein NULL (2,887), Overstrand NULL (1,662), Bitou NULL/"AR"/"ART", Kannaland "VP" (567) and the Matzikama town names.

Residential share by municipality, as % of rows / % of value (the full matrix is in `grp_muni.json`):

| Municipality | Residential | Municipality | Residential | Municipality | Residential |
|---|---|---|---|---|---|
| Cape Town | 95.7/92.4 | Overstrand | 77.2/82.1 | Bitou | 78.2/79.6 |
| Knysna | 71.5/76.1 | George | 75.7/72.5 | Saldanha Bay | 73.1/71.4 |
| Drakenstein | 81.9/68.9 | Mossel Bay | 75.0/67.5 | Cape Agulhas | 70.7/60.7 |
| Stellenbosch | 80.4/59.2 | Bergrivier | 80.2/58.0 | Swartland | 72.9/50.5 |
| Oudtshoorn | 69.0/50.5 | Hessequa | 60.2/46.8 | Breede Valley | 70.4/41.7 (45% uncoded) |
| Swellendam | 66.1/40.9 | Matzikama | 57.3/38.0 | Beaufort West | 74.1/37.2 |
| Cederberg | 71.2/36.1 | Langeberg | 69.1/35.2 | Prince Albert | 64.9/33.1 |
| Witzenberg | 81.0/30.0 | Kannaland | 42.3/25.2 | Theewaterskloof | 71.5/25.1 |
| Laingsburg | 30.8/10.4 | | | | |

Agricultural share of value: Laingsburg 69.1%, Theewaterskloof 63.0%, Kannaland 55.7%, Langeberg 48.7%, Prince Albert 47.2%, Cederberg 46.5%, Beaufort West 45.7%, Swellendam 44.2%, Witzenberg 41.3%, Hessequa 39.3%. Cape Town is 0.6%, because its roll has no farm tenure.

---

## 5. Candidate statistics

Every SQL statement below was run against the live DB. Unless noted, `v` means `market_value_r`. "Exists?" says whether `stats.json` already has the figure.

### (a) Headline totals

| # | Statistic | Definition | SQL | Time | Result | Caveats | Exists? |
|---|---|---|---|---|---|---|---|
| A1 | Properties, valued properties, total value | Count of rows; count and sum of valued rows | `SELECT COUNT(*), SUM(v>0), SUM(CASE WHEN v>0 THEN v END), SUM(v=0), SUM(v IS NULL) FROM property` | 0.19 s | 1,459,474 · 1,437,687 · **R2,660,416,645,748** · R0 13,507 · NULL 8,280 | Includes the ~R36bn Cape Town double count (0.2). Sectional units count as properties. Label the figure "valuation-roll entries". | Yes (`properties, valued, total`) |
| A2 | Coverage | Municipalities, roll files, instruments, SV files | `SELECT COUNT(DISTINCT municipality_id), COUNT(*), COUNT(DISTINCT municipality_id\|\|'/'\|\|roll_type), SUM(roll_type<>'GV'), COUNT(DISTINCT CASE WHEN roll_type<>'GV' THEN municipality_id END) FROM roll` | <1 ms | 25 · 196 files · 58 instruments · 73 SV files · 9 municipalities with SVs | | No |
| A3 | Supplementary contribution | Rows and value that come from SV rolls | `SELECT SUM(r.roll_type<>'GV'), SUM(CASE WHEN r.roll_type<>'GV' AND p.v>0 THEN p.v END) FROM property p JOIN roll r ON r.id=p.roll_id` | 0.30 s | 25,331 rows · R48.6bn | These rows are only what survived supersede. | No |
| A4 | District split | Value per district and share of the province | `SELECT m.district, COUNT(*), SUM(CASE WHEN v>0 THEN v END), 100.0*SUM(…)/(SELECT SUM(v) FROM property WHERE v>0) FROM property p JOIN municipality m … GROUP BY 1` | 0.43 s | Cape Town 64.70% · Cape Winelands 12.70% · Garden Route 10.46% · West Coast 6.13% · Overberg 5.57% · Central Karoo 0.46% | Mixed valuation dates | Partly (district `total`; no share field) |

### (b) Distributions

| # | Statistic | Definition | SQL | Time | Result | Caveats | Exists? |
|---|---|---|---|---|---|---|---|
| B1 | Province percentiles | p10, p25, p50, p75, p90 and p99 of valued rows (nearest-rank) | `SELECT COUNT(*), MIN(CASE WHEN rn>=0.10*n THEN v END) p10, … p99 FROM (SELECT v, ROW_NUMBER() OVER (ORDER BY v) rn, COUNT(*) OVER () n FROM property WHERE v>0)`. The plan uses the covering index `idx_property_value` plus one temp B-tree. | 1.77 s | 119k · 314k · **915k** · 2.14m · 3.80m · **14.6m** | All categories mixed together. Nominal R1–R1,000 rows are included (16,702). | p10/q1/median/q3/p90 yes; **p99 no** |
| B2 | Per-municipality percentiles | As B1, with `PARTITION BY municipality_id` | See `t3.py` (`q_muni`) | 3.09 s | Median: Overstrand 1.535m, Stellenbosch 1.425m, Cape Town 1.110m … Beaufort West 170k, Matzikama 156k, Witzenberg 154k, Prince Albert 125k, Laingsburg 40k | Affected by category mix and valuation date | Mostly yes; p99 no |
| B3 | Log-binned histogram | Quarter-decade bins: `bin = floor(4·log10(v)) − 16`, where bin 0 is R10k–17.8k. Bin −1 is under R10k and bin 99 is R1bn or more (22 bins). | `SELECT CASE WHEN v<10000 THEN -1 WHEN v>=1e9 THEN 99 ELSE CAST(FLOOR(LOG10(v)*4) AS INT)-16 END bin, COUNT(*), SUM(v) FROM property WHERE v>0 GROUP BY 1`. Add `municipality_id` for 454 cells. | 0.28 s (province); 0.64 s (per municipality) | Counts: 21,350 · 5,469 · 13,744 · 19,497 · 58,635 · 90,862 · 151,503 · 171,642 · 216,492 · 242,084 · **249,916** (R562k–1m) · 121,568 · 46,081 · 19,082 · 6,921 · 2,082 · 516 · 144 · 48 · 30 · 14 · 7 (≥R1bn) | Carrying count and value per bin also enables a "share of value by band" view. Needs `LOG10`, which both SQLite builds here have. | No (only the 10 linear buckets) |
| B4 | Residential percentiles | B1 restricted to `cm.rule='residential' AND v>1000` | `… FROM property p JOIN catmap cm … WHERE cm.rule='residential' AND p.v>1000` | 2.52 s | n 1,258,737 · p10 160k · p50 **960k** · p90 3.70m · p99 12.3m | Includes sectional units | `res_median` exists, but on the `LIKE '%RES%'` definition |

### (c) Municipal comparisons (each ranking must show the valuation date next to it)

| # | Statistic | Definition | SQL | Time | Result | Caveats | Exists? |
|---|---|---|---|---|---|---|---|
| C1 | Median **freehold residential** value | Residential group, `tenure_type<>'sectional'`, v > R1,000, split by tenure | `t4.py` query `q` (window `PARTITION BY municipality_id, is_sectional`) | 3.39 s | Overstrand 1.815m · Knysna 1.26m · Saldanha 1.155m · Mossel Bay 1.14m · Stellenbosch 1.035m · Cape Town 1.01m · Drakenstein 860k … Beaufort West 170k · Witzenberg 142k · Swellendam 140k · Prince Albert 90k · Laingsburg 42k | The most comparable level measure. **Still spans 2020–2025 dates.** Includes subsidised-housing erven, which drives the low medians in George and Bitou. | No (`res_median` mixes in sectional units and the RES substring) |
| C1b | Median sectional-unit value | Same query, sectional segment | Same query | same | Stellenbosch 1.679m · Swellendam 1.40m · Saldanha 1.362m · Cape Town 1.28m · Mossel Bay 1.25m | **Drop Bitou** (farm portions mis-tenured). Hide municipalities with n < 200 (Kannaland n=26; Matzikama and Bergrivier are small). | No |
| C2 | Mean value per valued property | `AVG(v)` | `SELECT m.name, AVG(CASE WHEN v>0 THEN v END) … GROUP BY m.name` | 0.43 s | Stellenbosch 3.35m · Drakenstein 2.34m · Bitou 2.26m · Overstrand 2.10m · Cape Town 1.98m … Laingsburg 479k | Skewed by farms and large commercial holdings. Show as context only, never ranked alone. | Yes (`mean`) |
| C3 | Share of province total | Municipality's value ÷ province value | Same query, `100.0*SUM(…)/(SELECT SUM(v) FROM property WHERE v>0)` | 0.43 s | Cape Town 64.70% · Drakenstein 4.56% · Stellenbosch 4.54% · Overstrand 3.35% · Saldanha 2.88% · George 2.76% … Laingsburg 0.04% | Mixed dates. Cape Town is inflated by the double count. | No (derivable client-side from `total`) |
| C4 | Residential share of rows and value | From the §4 matrix | `SELECT m.name, grp, COUNT(*), SUM(CASE WHEN v>0 THEN v END) FROM property p JOIN catmap cm … GROUP BY 1,2` (209 cells) | 1.35 s | See §4 (Cape Town 92.4% of value … Laingsburg 10.4%) | Breede Valley is unreliable (45% of value uncoded) | Similar: `cat_mix` with 6 classes, older rules |
| C5 | Vacant-land share | `grp='vacant'` | As C4 | 1.35 s | Saldanha 19.1% of rows · Swartland 14.7% · Overstrand 12.9% · Theewaterskloof 12.3% · Cape Agulhas 12.0% | **Not comparable.** Seven rolls have no vacant category, and Cape Town's is tiny (0.1%). Show only for municipalities that have a vacant category, with a note, or drop it. | Yes (`vacant_share`, same problem) |
| C6 | Agricultural share of value | `grp='agricultural'` | As C4 | 1.35 s | Laingsburg 69.1% · Theewaterskloof 63.0% · Kannaland 55.7% · Langeberg 48.7% … Cape Town 0.6% | Farm rolls were not ingested for everything (Stellenbosch SBP/CDP are in, Cape Town has no farm tenure) | Partly (`cat_mix.agri`) |
| C7 | Business, commercial and industrial share | `grp IN ('business_commercial','industrial')` | As C4 | 1.35 s | Stellenbosch 17.6% of value (business) · Knysna 11.7% · Cederberg 11.8% · Saldanha 9.1%+2.2% | **Bitou and Breede Valley show 0 business** (no category, or uncoded) | Partly (`cat_mix.com`) |
| C8 | Sectional-unit share | `tenure_type='sectional'` | In §3 | 0.9 s | Cape Town 26.0% · Stellenbosch 22.8% · Mossel Bay 16.1% · Drakenstein 10.5% | **Bitou is wrong (41%)**, and 4 rolls record 0. DATA_CONTRACT §7 already warns against showing this. | Yes (`sectional_share`), recommend removing it |

### (d) Land area and value per m², only where extents are reliable

**Reliability rule (tested):**
- `tenure_type='full_title'`. This excludes sectional rows, whose extent is the unit floor area, and farms, which were never validated and include broken rows in Oudtshoorn, Knysna and Bitou.
- The roll is in `match.db.roll_unit` with `unreliable=0 AND n>=30`: 127 rolls, loaded into TEMP `reliable_roll`.
- `v >= 10000` and `extent_m2 BETWEEN 20 AND 50000`.

1,025,349 residential rows pass. That is 81% of residential rows, and it excludes all of Cape Town's sectional file.

| # | Statistic | SQL | Time | Result | Caveats | Exists? |
|---|---|---|---|---|---|---|
| D1 | Median freehold residential **roll value per m² of land** | `t9.py` query `q`: `ROW_NUMBER() OVER (PARTITION BY municipality_id ORDER BY 1.0*v/extent_m2)` over rows matching the rule | 2.13 s | Stellenbosch R3,731 · Cape Town 3,633 · Drakenstein 2,873 · Overstrand 2,456 · Saldanha 2,189 · Bitou 2,102 … Swellendam 358 · Laingsburg 155 | This is land **plus buildings** divided by land area, not a land price. Mixed dates. | `ppm_median` exists but is unfiltered; recommend replacing it |
| D2 | Median freehold residential erf size | Same filter, over `extent_m2` | 1.96 s | Overstrand 595 m² · Cape Agulhas 563 · Hessequa 495 … Cape Town 264 · Witzenberg 262 | | `erf_median` exists but is unfiltered |
| D3 | Median vacant-land value per m² (n ≥ 100) | Same filter with `cm.rule='vacant'` | 0.44 s | Cape Town 3,540 · Stellenbosch 1,410 · Bitou 1,004 · Saldanha 993 … Beaufort West 40 | Vacant categories are inconsistent (C5). 17 municipalities qualify. | `vacant_ppm_median` exists but is unfiltered |
| D4 | Cape Town value per m² of floor area | Residential, `dwelling_extent_m2 BETWEEN 15 AND 5000`, v ≥ 10k | 0.89 s | n 644,667 · median R11,798/m² | Cape Town only | Yes (`dw_ppm_median`) |

**Not computable reliably:**
- Total land area on the roll, land share by category, and `vacant_land_share`. Farm extents are corrupt in Oudtshoorn and Knysna, mis-tenured in Bitou, and untested everywhere.
- Value per m² for sectional units: the extent is the unit area, and Cape Town has no parent erf.
- Any municipal-area density built from the extent sum.

### (e) Roll coverage and data quality (render from a small authored and derived table)

| # | Item | Source or SQL | Result |
|---|---|---|---|
| E1 | Per-municipality roll card: cycle, **date of valuation**, GV/SV rows, SVs ingested or deferred | `roll` + §3 query (0.9 s) + a new authored `valued_as_at` for every municipality in `provenance.py` | Only Stellenbosch, Oudtshoorn and Witzenberg are authored today, and Witzenberg's entry is wrong (0.4). Exists? Partly (`provenance`). |
| E2 | Data-quality strip: no value, R0, nominal ≤ R1,000, no category, extent coverage | §3 query | R0 13,507 · NULL 8,280 · nominal 16,702 · uncoded 1.48%. Exists? Mostly (`dq_*`), but R0 is not separated from NULL. |
| E3 | Known gaps list | Authored | Laingsburg is a 2018 **draft** (GV2024 missing). Hessequa's roll term expired 30 Jun 2026. SVs are deferred for 8 municipalities. Cape Town is GV2025 only (GV2022 raw files are held, a future growth source). Farms cannot be clicked on the map. Stellenbosch schemes are fixed. |
| E4 | Valuation-date spread | Authored dates | 1 Jul 2020 to 1 Sep 2025 (plus Laingsburg's draft). This frames every comparison. Exists? No. |

### (f) Interesting but responsible findings

| # | Statistic | SQL | Time | Result | Caveats | Exists? |
|---|---|---|---|---|---|---|
| F1 | Cape Town's share of provincial value and entries | `SELECT 100.0*SUM(CASE WHEN municipality_id=1 AND v>0 THEN v END)/SUM(CASE WHEN v>0 THEN v END), 100.0*SUM(municipality_id=1)/COUNT(*) FROM property` | 0.17 s | **64.7% of value, 60.1% of entries** | About 1.4 points is double counting | No |
| F2 | Concentration: Gini, and top 10%, 1%, 0.1% and bottom 50% shares | `SELECT 2.0*SUM(rn*1.0*v)/(COUNT(*)*1.0*SUM(v))-(COUNT(*)+1.0)/COUNT(*), SUM(CASE WHEN rn>0.9*n THEN v END)*1.0/SUM(v), … FROM (SELECT v, ROW_NUMBER() OVER (ORDER BY v) rn, COUNT(*) OVER () n FROM property WHERE v>0)` (multiply as REAL, because the integer form overflows) | 1.15 s (province), 2.91 s (per municipality) | Province: Gini 0.622 · top 10% hold **47.4%** · top 1% 16.6% · top 0.1% 6.0% · bottom 50% hold **10.0%**. Highest Gini: Theewaterskloof 0.832, Witzenberg 0.827, Laingsburg 0.827. Lowest: Cape Town 0.568, Mossel Bay 0.569. | This mixes property types, so rural municipalities score high because of farms. Prefer the residential-only Gini for comparisons. | Gini, top1/5/10 yes; **bottom-50 and top-0.1 no** |
| F3 | Most valuable places by median freehold residential value (n ≥ 200) | `t10.py`: `PARTITION BY municipality_id, UPPER(TRIM(COALESCE(NULLIF(TRIM(suburb),''),town)))`, then `HAVING MAX(n)>=200` | 3.20 s | 295 labels qualify. Top: Bantry Bay 26.5m · Bishopscourt 24.0m · Camps Bay 17.3m · Fresnaye 14.8m · De Zalze (Stellenbosch) 14.1m · Pearl Valley Estate 13.0m · Val de Vie 11.75m. Lowest: Bergsig (Laingsburg) 33k. | Cape Town labels are **SG township names**, not colloquial suburbs. **Exclude the "… HOLDING – SEE HANGING BELOW" label** (it ranks 24th). Mixed dates; n ≥ 200 guards privacy and noise. | No (`towns.json` ranks by size) |
| F4 | Properties at or above R10m, R50m and R1bn | `SELECT SUM(v>=1e7), SUM(v>=5e7), SUM(v>=1e9) FROM property` | 0.17 s | 28,844 · 1,007 · 7 (7 rows worth R36.97bn in total) | The R1bn+ rows include the Cape Town holding **and** its allocation. Show counts only. | ≥10m and ≥50m yes |
| F5 | Median value per m² of dwelling floor area (Cape Town) | D4 | 0.89 s | R11,798/m² | Cape Town only | Yes |

**Do not publish:**
- Individual top properties by address. The source is public, but the current #1 and #2 are a double count.
- Anything from `site_address` for Matzikama.
- Any owner-derived measure.
- Growth or CAGR until a second cycle exists. Cape Town's GV2022 files are the nearest candidate.

---

## 6. Recommended export shape

Keep `stats.json` (19 KB gzipped) as the per-node source. Add **one** new file, `data/explore.json`, generated by `export_site.py` from the SQL above. Pre-compute on the server anything that needs row-level data: percentiles, the histogram, category rules, the extent filter and place medians.

| Block | Content | Estimated raw / gzipped |
|---|---|---|
| `meta` | Build date, number of rolls, SV municipalities, reliability rule text, category rule version | 1 KB / 0.5 KB |
| `rolls[25]` | name, district, cycle, valued_as_at, kind, gv_rows, sv_rows, r0, null, nominal, uncoded, ext_share, `extent_reliable` flag, notes | 6 KB / 1.5 KB |
| `pct` | p10…p99 for all and residential-freehold, for province, 6 districts and 25 municipalities (31 nodes × 2 × 6) | 6 KB / 2 KB |
| `loghist` | 22-bin counts and values for province and 25 municipalities | 9 KB / 3 KB |
| `groups` | 8-group {n, v, median} for 31 nodes | 10 KB / 3 KB |
| `land` | D1–D3 p25/p50/p75 and n for 25 municipalities | 3 KB / 1 KB |
| `conc` | Gini, top 10/1/0.1, bottom 50, residential Gini for 31 nodes | 3 KB / 1 KB |
| `places` | Top 30 and bottom 10 place labels by median freehold residential value (n ≥ 200) | 3 KB / 1 KB |
| **Total** | | **about 41 KB / 13 KB gzipped** |

Together with the existing `stats.json` (19 KB) and `towns.json` (14 KB), the page loads **about 46 KB gzipped**, well under 150 KB.

**Compute in the browser from existing files:**
- Share of province (C3) and district shares (A4), from `total`.
- Cape Town's share (F1).
- Rankings and sort orders.
- Mean-to-median ratios.
- Density, from `area_km2`.

**Fix in `export_site.py` before redesigning:**
- `vacant_land_share`, and the `ppm_*`, `erf_*` and `vacant_ppm_median` fields: apply the §5(d) filter.
- `res_median` and `residential_avg`: use the group rule instead of `LIKE '%RES%'`.
- Drop `sectional_share`, or mark it unreliable.
- `hi`: skip Cape Town HOLDING and ALLOCATION rows until the double count is fixed.
- `provenance.py` for Witzenberg.
- The Matzikama address leak (upstream, in the parser).

---

## 7. Sanity checks against the live `stats.json`

| Check | DB (now) | `stats.json` (22 Sep 22:26) | Match |
|---|---|---|---|
| properties | 1,459,474 | 1,459,474 | ✔ |
| valued | 1,437,687 | 1,437,687 | ✔ |
| total | R2,660,416,645,748 | 2,660,416,645,748 | ✔ |
| median / q1 / q3 | 915,000 / 314,000 / 2,140,000 | 915,000 / 314,000 / 2,140,000 | ✔ |
| p10 / p90 | 119,000 / 3,800,000 | 119,000 / 3,800,000 | ✔ |
| gini / top10 / top1 | 0.622 / 0.474 / 0.166 | 0.622 / 0.4744 / 0.1657 | ✔ |
| n_over_10m / 50m | 28,844 / 1,007 | 28,844 / 1,007 | ✔ |
| dq_nominal | 16,702 | 16,702 | ✔ |
| history snapshot 2026-07-19 | 1,448,573 rows, R2.647tn (earlier state) | not applicable | The DB changed after that snapshot (+10,901 rows, +R13.6bn). No new snapshot was written because the cycle signature is unchanged, as designed (L374). I did not trace the delta. |

`STATUS.md` still quotes older headline figures (535,567 properties, R880.9bn) from before Cape Town was added. Those are historical, not current.
