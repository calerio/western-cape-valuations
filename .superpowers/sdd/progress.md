# SDD progress — municipal politics

BASE (website repo): f75dc29d5e416ff347d6fc7f5b01308123a2d263

- Task 1: complete (data repo — politics.py + test_politics.py, 4/4 pass, review clean)
- Task 2: complete (export_pages politics_section + templates; commits e4f4085, a1aa94d; Critical swatch-escaping bug found+fixed+regression-tested; review clean)
- Task 3: complete (export_site panel_politics; commit 7d48f05; invariant verified directly — politics node present, wards stripped)
- Task 4: complete (index.html secPolitics + atlas.js renderPolitics; commit 6f5c7d1; browser-verified: section renders governance line+seat bar+legend+link, s.name key correct, no politics-caused overflow)
- Task 5: pending

Minor notes (for final review): PEP8 blank-line nit in politics.py; shape/ward tests skip when seed data absent; CCT has no wards key (placeholder).

Minor (pre-existing, out of scope): long unbreakable authorities email overflows pBody width (clipped by overflow-x:hidden) — candidate for the parked page-redesign.

## PAUSED 2026-07-07 (resume tomorrow)
- Tasks 1-4: COMPLETE + live (mechanism built, browser-verified, pushed).
- Task 5 (populate 25 munis): 1/25 done — **Stellenbosch** real 2021 data committed+pushed (28/45 DA, 22/23 wards, mayor Jeremy Fasser). User APPROVED the accuracy bar: "keep as-is" (inferred ward->party OK; Wikipedia IEC-derived seats OK).
- REMAINING: 24 municipalities. Targets file (folder+slug+ward list per muni) at scratchpad/muni-targets.json. Per-muni research-agent prompt template = the Stellenbosch pilot prompt. Fan-out was launched (batch 1 of 8) then HALTED by user + all agents killed; NO partial artifacts left (verified).
- TO RESUME: re-dispatch sonnet research agents for the 24 munis (write dict to scratchpad/politics-<slug>.py + append each SOURCE.md), then merge all scratchpad politics-*.py entries into extract/politics.py, run tests + build.py + export_site.py, browser-check a few, commit+push. Then final whole-branch review.
- Slugs remaining: beaufort-west, bergrivier, bitou, breede-valley, cape-agulhas, cederberg, city-of-cape-town, drakenstein, george, hessequa, kannaland, knysna, laingsburg, langeberg, matzikama, mossel-bay, oudtshoorn, overstrand, prince-albert, saldanha-bay, swartland, swellendam, theewaterskloof, witzenberg.
