# Valuations Explainer + Per-Municipality Authorities — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a plain-language "how municipal valuations work" explainer (dedicated page + inline links) and a per-municipality "who sets & governs these values" block (valuer + authorities/role-players), rendered on both the static muni pages and the Atlas click-panel — backed by freshly-collected, raw-archived source data.

**Architecture:** Hand-authored `extract/authorities.py` (mirrors `provenance.py`) is the single source of truth; `export_site.py` attaches it to Atlas nodes and `export_pages.py` renders it into static pages, exactly as `rates`/`provenance` already flow. Data is collected per-municipality from official `*.gov.za` sources, raw files kept in each muni folder, and each `SOURCE.md` updated.

**Tech Stack:** Python 3 (stdlib + existing `extract/` scripts), SQLite (`wc-valuations.db`), vanilla JS (`assets/atlas.js`), `string.Template` HTML (`templates/shell.html`), `pytest` (existing in `extract/`), `curl`/`WebFetch` for downloads.

## Global Constraints

- Official / `*.gov.za` sources only; keep **original municipal filenames** for raw downloads.
- Never publish **owner names** (POPIA). Sales/transfer data is **out of scope**.
- Every authorities field is **optional** — UI omits missing rows/sections (DATA CONTRACT §5/§13).
- Two repos: scripts + data in `~/projects/western-cape-property-valuations` (not git); generated site in `~/projects/western-cape-valuations` (git, Pages). Regenerate: `python3 extract/build.py` → `python3 extract/export_site.py`. Never hand-edit generated files.
- Git: commit as the **user only**, no AI authorship; never push unless told. Correct author email already set in the website repo.
- Bump `?v=` on the `atlas.js` `<script>` tag whenever `atlas.js` changes (CDN cache).
- Fan-out subagents use **cheaper models** (sonnet/haiku).

---

### Task 1: Pilot data collection — one municipality (Oudtshoorn)

Establishes the raw-folder convention, the `SOURCE.md` "Authorities & role-players" block format, and the `authorities.py` entry shape that Task 2 replicates 25×.

**Files:**
- Create: `Garden-Route/Oudtshoorn/authorities/` (raw downloads, original filenames)
- Modify: `Garden-Route/Oudtshoorn/SOURCE.md` (add "Authorities & role-players" section)

- [ ] **Step 1:** Identify Oudtshoorn's official valuations presence (valuations/rates dept page, contact details, appointed municipal valuer, s49 general-valuation public notice, objection form, rates policy, appeal-board info) via existing `SOURCE.md` + `oudtshoorn.gov.za` + WC provincial/appeal-board sites. Record source URLs.
- [ ] **Step 2:** Download every remotely-relevant artifact (public notices, objection forms, valuer-appointment notices, valuations FAQ/brochures, rates policy PDFs, the contact page saved as PDF/HTML) into `Garden-Route/Oudtshoorn/authorities/`, preserving original filenames. Official sources only.
- [ ] **Step 3:** Append an "Authorities & role-players" section to `SOURCE.md` using this exact shape (fields omitted where unknown):

```markdown
## Authorities & role-players
- **Municipal (General) Valuer:** <name> (<GV cycle>) — <source URL> (retrieved YYYY-MM-DD)
- **Valuations / Rates department:** <phone> · <email> · <postal address> · <official URL>
- **Objections (MPRA s50):** to <office>; <how/where>; form: <URL>
- **Raw files:** see `authorities/` (list filenames)
```

- [ ] **Step 4 (verify):** Confirm `authorities/` holds the downloaded files and `SOURCE.md` renders; every claim traces to a downloaded file or cited URL (no guessing).
- [ ] **Step 5:** No commit yet (data repo is not git). Present the pilot result for a quick sanity check before fan-out.

### Task 2: Fan-out data collection — remaining 25 (24 locals + City of Cape Town)

**Files:** per municipality: create `<District>/<Muni>/authorities/`, modify `<District>/<Muni>/SOURCE.md`. (CoCT: `City-of-Cape-Town/` — also fold in the existing PAIA/cctdata provenance.)

- [ ] **Step 1:** Dispatch one subagent per municipality (cheaper model) with the Task-1 protocol as its brief; each returns a structured summary `{muni, valuer, valuer_cycle, dept{...}, objections{...}, raw_files[], source_urls[], gaps[]}` and performs Steps 1–3 of Task 1 for its municipality.
- [ ] **Step 2:** Collect the 25 summaries. Log municipalities with material gaps (they degrade gracefully).
- [ ] **Step 3 (verify):** Spot-check 3–4 `SOURCE.md` updates and their `authorities/` folders for source-grounding and original filenames.

### Task 3: `extract/authorities.py` module

**Files:**
- Create: `extract/authorities.py`
- Create/Modify test: `extract/test_authorities.py`

**Interfaces:**
- Produces: `AUTHORITIES: dict[str, dict]` keyed by municipality name (fields all optional: `valuer`, `valuer_note`, `dept{name,phone,email,address,url}`, `objections{to,how,url}`); shared constants `APPEAL_BOARD`, `PROVINCE`, `NATIONAL` (each `{name,url,note?,phone?}`); helper `authorities_for(name) -> dict` returning `{"primary": {...or {}}, "shared": {appeal_board, province, national}}`.

- [ ] **Step 1: Write failing test** `extract/test_authorities.py`:

```python
from authorities import authorities_for, AUTHORITIES, APPEAL_BOARD

def test_known_muni_has_primary_and_shared():
    a = authorities_for("Oudtshoorn")
    assert a["primary"].get("valuer")            # transcribed from SOURCE.md
    assert a["shared"]["appeal_board"] == APPEAL_BOARD

def test_unknown_muni_degrades_to_shared_only():
    a = authorities_for("Nowhere")
    assert a["primary"] == {}
    assert a["shared"]["appeal_board"]["name"]
```

- [ ] **Step 2:** Run `cd extract && python3 -m pytest test_authorities.py -q` → FAIL (no module).
- [ ] **Step 3:** Implement `authorities.py`: the module docstring (mirror `provenance.py`'s), `AUTHORITIES` populated from Tasks 1–2 summaries, the three shared constants, and:

```python
def authorities_for(name):
    return {"primary": AUTHORITIES.get(name, {}),
            "shared": {"appeal_board": APPEAL_BOARD, "province": PROVINCE, "national": NATIONAL}}
```

- [ ] **Step 4:** Run pytest → PASS.
- [ ] **Step 5 (verify):** No commit (data repo not git). Proceed.

### Task 4: Render on static pages — `export_pages.py`

**Files:**
- Modify: `extract/export_pages.py` (new section builders + new page + sitemap entry)
- Modify: `extract/test_*` or add `extract/test_export_pages_authorities.py`

**Interfaces:**
- Consumes: `authorities_for(name)` from Task 3.
- Produces: `authorities_section(muni_name) -> str`, `explainer_link_section() -> str`, and a generated `how-valuations-work.html`; both section builders return `""` when data absent (existing pattern).

- [ ] **Step 1: Write failing test** (assert an authorities section renders the valuer for Oudtshoorn and empty string for an unknown muni; assert `how-valuations-work` URL is in the generated sitemap list):

```python
def test_authorities_section_hides_when_empty(...):
    assert authorities_section("Nowhere") == ""
def test_authorities_section_shows_valuer(...):
    assert "Municipal" in authorities_section("Oudtshoorn")
```

- [ ] **Step 2:** Run pytest → FAIL.
- [ ] **Step 3:** Implement `authorities_section()` (two-tier: prominent valuer/dept/objections via `hair_row`/`tile`; shared role-players in a `.note`-styled "Other role-players" trailer), `explainer_link_section()` (2–3 sentence summary + `How valuations work →` link), and `how-valuations-work.html` generation through `templates/shell.html` (title/meta/canonical/jsonld). Wire both sections into the muni-page block list and the district-page block list (shared-only) alongside `source_section` etc.; append the explainer URL to the sitemap in `generate()`.
- [ ] **Step 4:** Run pytest → PASS.
- [ ] **Step 5 (verify):** `python3 extract/export_site.py`; open `~/projects/western-cape-valuations/how-valuations-work.html` and `m/oudtshoorn.html`; confirm the authorities block + explainer link render and `sitemap.xml` includes the new URL.

### Task 5: Feed the Atlas — `export_site.py`

**Files:** Modify: `extract/export_site.py`

**Interfaces:**
- Consumes: `authorities_for(name)` from Task 3.
- Produces: each municipality node in the exported Atlas JSON gains an `authorities` key = `authorities_for(name)`.

- [ ] **Step 1:** Import `authorities` (as `provenance`/`rates` are), and where each municipality node is assembled, set `node["authorities"] = authorities_for(node_name)`.
- [ ] **Step 2 (verify):** `python3 extract/export_site.py`; grep the exported data JSON for `"authorities"` on a known muni; confirm present with `primary` + `shared`.

### Task 6: Render in the Atlas panel — `assets/atlas.js`

**Files:** Modify: `~/projects/western-cape-valuations/assets/atlas.js`; bump `?v=` on its `<script>` tag in `index.html`.

**Interfaces:**
- Consumes: `scope.authorities` (`{primary, shared}`) from Task 5.

- [ ] **Step 1:** Add an `authoritiesBlock(a)` renderer mirroring `ratesBlock` — prominent valuer/dept/objections, a quiet "Other role-players" trailer for `shared`; returns `""` when `a.primary` is empty and there's no shared data. Insert it into the place-panel section assembly (near `ratesBlock`).
- [ ] **Step 2:** Extend the existing provenance popover copy and add a `How valuations work →` link to `how-valuations-work.html`.
- [ ] **Step 3:** Bump `assets/atlas.js?v=` in `index.html`.
- [ ] **Step 4 (verify):** Serve the site locally (`python3 -m http.server` in the website repo) or open `index.html`; click a municipality; confirm the authorities block + explainer link appear and missing-data municipalities render cleanly.

### Task 7: Contract, regenerate, verify, commit

**Files:** Modify: `~/projects/western-cape-valuations/DATA_CONTRACT.md` (§13); regenerate generated files.

- [ ] **Step 1:** Document in `DATA_CONTRACT.md §13`: the new `how-valuations-work.html` page, the authorities section/source (`authorities.py`), and their graceful-degradation rules.
- [ ] **Step 2:** Full regen: `python3 extract/build.py` → `python3 extract/export_site.py`.
- [ ] **Step 3 (verify):** Explainer page, a data-rich muni page, a data-poor muni page, a district page, sitemap, and the Atlas panel all render correctly.
- [ ] **Step 4:** In the **website repo**, commit generated + source changes (author = user only, no AI authorship). Do not push unless asked.
- [ ] **Step 5:** Data repo raw files/SOURCE.md remain local (not git); note any very large binaries kept uncommitted.

---

## Self-Review

- **Spec coverage:** explainer page ✓(T4) · inline explainer+link on pages ✓(T4) · panel explainer link ✓(T6) · authorities data model ✓(T3) · two-tier layout ✓(T4,T6) · both render targets ✓(T4,T6) · data collection "download everything + keep raw + update SOURCE.md" ✓(T1,T2) · district pages shared-only ✓(T4) · contract/regen ✓(T7). No gaps.
- **Placeholder scan:** `<name>`/`<phone>` in the SOURCE.md template are field slots filled during collection, not plan placeholders; test bodies show real assertions. OK.
- **Type consistency:** `authorities_for()` returns `{primary, shared}` in T3 and is consumed identically in T4/T5/T6; `scope.authorities` shape matches. OK.
