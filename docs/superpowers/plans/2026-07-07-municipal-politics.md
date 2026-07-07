# Municipal Governance & Representation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show, per municipality, the 2021 election result, current governing party + mayor, the council seat/vote-share breakdown, and the ward councillors — on the static municipality pages and (summary only) the Atlas panel.

**Architecture:** Mirror the existing *authorities* feature exactly. A single source-of-truth Python data module (`extract/politics.py`) holds one dict per municipality; `export_pages.py` renders the full block onto static pages and `export_site.py` attaches a lean summary to each muni node for the Atlas panel, which `assets/atlas.js` renders. All rendering is data-driven — no municipality facts or figures live in the website repo.

**Tech Stack:** Python 3 (stdlib only, plain-`assert` test scripts run directly — no pytest), vanilla JS (d3-era `assets/atlas.js`), `string.Template` HTML templates.

## Global Constraints

- **No hardcoding into the website.** Every per-municipality fact (parties, seats, %, mayor, ward councillors, colours) lives ONLY in `extract/politics.py`. `index.html`, `assets/atlas.js`, `templates/*.html`, and the static pages must contain zero municipality-specific literals — they loop over exported data. Changing a coalition/mayor = edit `politics.py`, re-run the export. (Standing user instruction.)
- **Graceful degradation** (DATA_CONTRACT §5/§13): every field optional; the renderer omits any absent row/section; a section auto-hides when empty. Never emit an empty table or a `null`.
- **Provenance:** every fact traces to an official source (IEC 2021 results primary; municipal site/gazette for current mayor/governing). Raw docs archived under `<Muni>/politics/`; a `## Governance & representation` section added to each `<Muni>/SOURCE.md`.
- **Names:** elected officials (councillors, mayors) are public record and shown. Property-OWNER names are never involved.
- **Git authorship:** commit as the user only — no Claude/AI attribution (repo CLAUDE.md). Push after each committed task (this is the GitHub-Pages website repo; unpushed = not live).
- **Rebuild contract:** after data changes run `python3 extract/build.py` then `python3 extract/export_site.py`. No valuation data changes → `search.db` untouched, no Supabase re-upload.
- Data project (`~/projects/western-cape-property-valuations`, contains `extract/`) is NOT git-tracked — its `.py`/`SOURCE.md`/`politics/` edits persist on disk only. The website repo (`~/projects/western-cape-valuations`) IS git-tracked — commit/push there.
- `slugOf(name) = name.trim().toLowerCase().replace(/ /g, "-")` — the muni-page slug rule, shared by `atlas.js` and `export_pages.slugify`. Use it for the panel's "full council" link.

---

### Task 1: `politics.py` data module + accessors

**Files:**
- Create: `~/projects/western-cape-property-valuations/extract/politics.py`
- Test: `~/projects/western-cape-property-valuations/extract/test_politics.py`
- Reference (do not modify): `extract/authorities.py` (pattern), `~/projects/western-cape-valuations/data/geo/wc-wards.geojson` (ward validation).

**Interfaces:**
- Produces:
  - `POLITICS: dict[str, dict]` — keyed by municipality name.
  - `PARTY_COLOURS: dict[str, str]` — party abbrev → hex; includes key `"_"` as neutral fallback.
  - `party_colour(party: str) -> str` — returns `PARTY_COLOURS.get(party, PARTY_COLOURS["_"])`.
  - `politics_for(name: str) -> dict` — returns `POLITICS.get(name, {})` (empty dict for unknown/ districts; renderer then hides the block).

Per-muni dict shape (all keys optional):
```
election  : {"date": str, "winner": str, "winner_seats": int, "total_seats": int, "control": str}
governing : {"party": str, "basis": str, "as_of": str}
mayor     : {"name": str, "party": str, "title": str}
seats     : [ {"party": str, "seats": int, "votes_pct": float}, ... ]   # ordered seats desc
wards     : [ {"ward": int, "councillor": str, "party": str}, ... ]     # ordered by ward
```

- [ ] **Step 1: Write the failing test**

Create `extract/test_politics.py`:
```python
import json, os, sys
from politics import POLITICS, PARTY_COLOURS, party_colour, politics_for

WARDS_GEOJSON = os.path.expanduser(
    "~/projects/western-cape-valuations/data/geo/wc-wards.geojson")

def test_accessor_and_fallback():
    assert politics_for("No Such Muni") == {}, "unknown muni -> empty dict"
    assert party_colour("DA").startswith("#"), "known party -> hex colour"
    assert party_colour("ZZZ_unknown") == PARTY_COLOURS["_"], "unknown party -> neutral fallback"

def test_shapes():
    for name, p in POLITICS.items():
        for s in p.get("seats", []):
            assert {"party", "seats"} <= s.keys(), f"{name}: seat row missing party/seats"
            assert isinstance(s["seats"], int)
        for w in p.get("wards", []):
            assert isinstance(w["ward"], int) and w.get("councillor") and w.get("party"), \
                f"{name}: bad ward row {w}"
        e = p.get("election", {})
        if "winner_seats" in e and "total_seats" in e:
            assert e["winner_seats"] <= e["total_seats"], f"{name}: winner_seats > total"

def test_ward_numbers_match_geojson():
    gj = json.load(open(WARDS_GEOJSON))
    by_muni = {}
    for f in gj["features"]:
        pr = f["properties"]
        by_muni.setdefault(pr["muni"], set()).add(int(pr["ward"]))
    for name, p in POLITICS.items():
        valid = by_muni.get(name)
        if not p.get("wards") or valid is None:
            continue
        for w in p["wards"]:
            assert w["ward"] in valid, f"{name}: ward {w['ward']} not in wc-wards.geojson"

def test_seat_sum_sane():
    for name, p in POLITICS.items():
        seats, e = p.get("seats"), p.get("election", {})
        if seats and "total_seats" in e:
            tot = sum(s["seats"] for s in seats)
            assert abs(tot - e["total_seats"]) <= 2, \
                f"{name}: seats sum {tot} vs total {e['total_seats']} (note in data if intentional)"

if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns:
        fn(); print("PASS", fn.__name__)
    print(f"\nAll {len(fns)} tests passed.")
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ~/projects/western-cape-property-valuations/extract && python3 test_politics.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'politics'`.

- [ ] **Step 3: Write minimal implementation**

Create `extract/politics.py` (docstring modelled on `authorities.py`; seed with two *worked examples* only — the rest is filled in Task 5). **The seat/ward figures below are illustrative placeholders to make tests pass; Task 5 replaces every entry with IEC-sourced data.**
```python
"""Per-municipality governance & representation, keyed by municipality name.

Powers the "Who represents this municipality" block on each municipality page and
(summary only) the Atlas panel. Every field is OPTIONAL — the renderer omits any
absent row/section (DATA_CONTRACT §5/§13), so an incomplete entry just shows less.

Source of truth: this file. NOTHING municipality-specific is hardcoded in the
website — the site loops over what the export ships from here. Update a coalition /
mayor / councillor HERE, then re-run build.py + export_site.py.

Provenance: IEC 2021 Municipal Election results (seats + vote %); municipal site or
provincial gazette for current mayor/governing party. See each <Muni>/SOURCE.md
"## Governance & representation" and raw docs under <Muni>/politics/.

Shape per municipality (all keys optional):
    election  : {date, winner, winner_seats, total_seats, control}
    governing : {party, basis, as_of}          # party may be a coalition string
    mayor     : {name, party, title}
    seats     : [{party, seats, votes_pct}]     # ordered seats desc
    wards     : [{ward, councillor, party}]      # ordered by ward number
"""

# Party colours for the seat bars. "_" is the neutral fallback for minor parties /
# independents. Conventional South African party colours.
PARTY_COLOURS = {
    "DA": "#0071e3", "ANC": "#00853f", "EFF": "#e7261f", "FF+": "#f39200",
    "VF Plus": "#f39200", "ACDP": "#c8102e", "PA": "#6a1b9a", "GOOD": "#00a3a3",
    "ASA": "#1565c0", "Cope": "#e30613", "IFP": "#e2001a", "Al Jama-ah": "#2e7d32",
    "Ind.": "#8a8f98", "Independent": "#8a8f98",
    "_": "#8a8f98",
}

def party_colour(party):
    return PARTY_COLOURS.get(party, PARTY_COLOURS["_"])

POLITICS = {
    "Stellenbosch": {
        "election": {"date": "1 Nov 2021", "winner": "DA",
                     "winner_seats": 27, "total_seats": 43, "control": "outright majority"},
        "governing": {"party": "DA", "basis": "majority", "as_of": "2024"},
        "mayor": {"name": "Jeremy Fasser", "party": "DA", "title": "Executive Mayor"},
        "seats": [
            {"party": "DA", "seats": 27, "votes_pct": 60.1},
            {"party": "ANC", "seats": 8, "votes_pct": 18.4},
            {"party": "EFF", "seats": 2, "votes_pct": 5.2},
        ],
        "wards": [
            {"ward": 1, "councillor": "TBD-from-IEC", "party": "DA"},
        ],
    },
    "City of Cape Town": {
        "election": {"date": "1 Nov 2021", "winner": "DA",
                     "winner_seats": 136, "total_seats": 231, "control": "outright majority"},
        "governing": {"party": "DA", "basis": "majority", "as_of": "2024"},
        "mayor": {"name": "Geordin Hill-Lewis", "party": "DA", "title": "Executive Mayor"},
        "seats": [
            {"party": "DA", "seats": 136, "votes_pct": 58.3},
            {"party": "ANC", "seats": 43, "votes_pct": 18.6},
        ],
    },
}

def politics_for(name):
    return POLITICS.get(name, {})
```
Note: the Stellenbosch `wards` entry uses ward 1 (present in the geojson) with a placeholder councillor so the shape test passes; Task 5 fills real names. If the geojson has no ward `1` for Stellenbosch, use the lowest ward number it does have.

- [ ] **Step 4: Run to verify it passes**

Run: `cd ~/projects/western-cape-property-valuations/extract && python3 test_politics.py`
Expected: `All 4 tests passed.`

- [ ] **Step 5: Commit** (data repo is not git-tracked — nothing to commit here; just confirm the files exist. Proceed to Task 2.)

---

### Task 2: `politics_section()` renderer + template slots (static pages)

**Files:**
- Modify: `~/projects/western-cape-property-valuations/extract/export_pages.py` (add builder near `authorities_section`, ~line 246; wire into muni + coct `.substitute` at ~lines 342 and 450)
- Modify: `~/projects/western-cape-valuations/templates/muni.html` (after line 30)
- Modify: `~/projects/western-cape-valuations/templates/coct.html` (after line 30)
- Test: `~/projects/western-cape-property-valuations/extract/test_politics_render.py`

**Interfaces:**
- Consumes: `politics_for(name)` (Task 1), existing `esc()` and `_arow(label, value_html)` in `export_pages.py`.
- Produces: `politics_section(name: str) -> str` — full HTML block, or `""` when `politics_for(name)` is empty.

- [ ] **Step 1: Write the failing test**

Create `extract/test_politics_render.py`:
```python
import sys
from export_pages import politics_section

def test_empty_for_unknown():
    assert politics_section("No Such Muni") == "", "unknown -> empty string (section omitted)"

def test_stellenbosch_block():
    html = politics_section("Stellenbosch")
    assert "Who represents this municipality" in html
    assert "Jeremy Fasser" in html          # mayor
    assert "DA" in html and "27" in html     # seat row
    assert "60.1" in html                    # vote %
    assert "<details" in html                # ward list collapsible
    assert "background:#0071e3" in html or "#0071e3" in html  # party colour used

if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns: fn(); print("PASS", fn.__name__)
    print(f"\nAll {len(fns)} tests passed.")
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ~/projects/western-cape-property-valuations/extract && python3 test_politics_render.py`
Expected: FAIL — `ImportError: cannot import name 'politics_section'`.

- [ ] **Step 3: Write minimal implementation**

In `export_pages.py`, add the import near the other data imports at the top (after `from authorities import ...`):
```python
from politics import politics_for, party_colour
```
Add this builder immediately after `authorities_section` (~line 273):
```python
def _seat_bar(seats, total):
    """Horizontal proportional bar, one coloured segment per party (widths from seat share)."""
    total = total or sum(s["seats"] for s in seats) or 1
    segs = "".join(
        f'<span title="{esc(s["party"])}: {s["seats"]} seats" '
        f'style="display:inline-block;height:10px;width:{100*s["seats"]/total:.2f}%;'
        f'background:{party_colour(s["party"])}"></span>'
        for s in seats)
    return f'<div style="display:flex;border-radius:4px;overflow:hidden;margin:6px 0 10px">{segs}</div>'

def _seat_table(seats):
    rows = []
    for s in seats:
        pct = f' · {s["votes_pct"]:.1f}%' if s.get("votes_pct") is not None else ""
        swatch = (f'<span style="display:inline-block;width:10px;height:10px;border-radius:2px;'
                  f'background:{party_colour(s["party"])};margin-right:7px;vertical-align:middle"></span>')
        rows.append(_arow(f'{swatch}{esc(s["party"])}',
                          f'{s["seats"]} seat{"s" if s["seats"] != 1 else ""}{esc(pct)}'))
    return f'<table>{"".join(rows)}</table>' if rows else ""

def politics_section(name):
    """'Who represents this municipality': 2021 result + current governing party/mayor,
    the council seat/vote breakdown, and (page-only) the ward-councillor list.
    Returns '' when there is no data for this name (districts / unknown)."""
    p = politics_for(name)
    if not p:
        return ""
    parts = []
    e, g, m = p.get("election") or {}, p.get("governing") or {}, p.get("mayor") or {}
    line = []
    if e.get("winner"):
        seatfrag = (f' ({e["winner_seats"]}/{e["total_seats"]})'
                    if e.get("winner_seats") and e.get("total_seats") else "")
        line.append(f'<strong>{esc(e.get("date","2021 election"))}:</strong> '
                    f'{esc(e["winner"])} won{esc(seatfrag)}'
                    + (f' — {esc(e["control"])}' if e.get("control") else ""))
    if g.get("party"):
        asof = f' (as of {esc(g["as_of"])})' if g.get("as_of") else ""
        line.append(f'<strong>Now:</strong> {esc(g["party"])}'
                    + (f' {esc(g["basis"])}' if g.get("basis") else "") + asof)
    if m.get("name"):
        pty = f' ({esc(m["party"])})' if m.get("party") else ""
        line.append(f'<strong>{esc(m.get("title","Mayor"))}:</strong> {esc(m["name"])}{pty}')
    if line:
        parts.append('<p class="sub" style="max-width:64ch">' + " &nbsp;·&nbsp; ".join(line) + '</p>')
    seats = p.get("seats") or []
    if seats:
        parts.append('<h3 style="font-size:15px;margin:16px 0 4px">Council seats</h3>')
        parts.append(_seat_bar(seats, e.get("total_seats")))
        parts.append(_seat_table(seats))
    wards = p.get("wards") or []
    if wards:
        items = "".join(
            f'<li>Ward {w["ward"]} · {esc(w["councillor"])} '
            f'<span class="note">({esc(w["party"])})</span></li>' for w in wards)
        parts.append(
            '<details style="margin-top:12px"><summary style="cursor:pointer;font-weight:600">'
            f'Ward councillors ({len(wards)})</summary>'
            f'<ul style="columns:2;font-size:13px;line-height:1.7;margin-top:8px">{items}</ul></details>')
    return ('<h2>Who represents this municipality</h2>'
            '<p class="sub">Who runs the council, and how they were elected</p>'
            + "".join(parts))
```
Wire it into the three page builders — add `politics_section=politics_section(<name>)` to the `.substitute(...)` calls that already pass `authorities_section=...`:
- muni (~line 358): `politics_section=politics_section(muni),`
- district (~line 400): `politics_section="",`  ← districts get no political block
- coct (~line 454): `politics_section=politics_section("City of Cape Town"),`

Add the slot to `templates/muni.html` and `templates/coct.html` immediately after line 30 (`${authorities_section}`):
```
${politics_section}
```
`templates/district.html` — add `${politics_section}` too (kept for template-parity) so the substitute key always resolves; it receives `""`. If `district.html` has no such line, add one after its `${authorities_section}`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd ~/projects/western-cape-property-valuations/extract && python3 test_politics_render.py`
Expected: `All 2 tests passed.`

Then smoke-test the whole export builds:
Run: `cd ~/projects/western-cape-property-valuations && python3 extract/export_site.py`
Expected: completes without `KeyError` (all template slots resolved).

- [ ] **Step 5: Commit** (website repo — templates changed there)
```bash
cd ~/projects/western-cape-valuations
git add templates/muni.html templates/coct.html templates/district.html m/ d/ data/
git commit -m "Municipality pages: add 'Who represents this municipality' block"
git push
```

---

### Task 3: Attach a lean politics summary to each muni node (Atlas panel data)

**Files:**
- Modify: `~/projects/western-cape-property-valuations/extract/export_site.py` (import ~line 9; node build ~line 207)
- Test: `~/projects/western-cape-property-valuations/extract/test_politics_export.py`

**Interfaces:**
- Consumes: `politics_for(name)` (Task 1).
- Produces: each muni node in the exported site JSON gains a `"politics"` key holding a **panel-lean** dict — `election`, `governing`, `mayor`, `seats` — but **NOT `wards`** (ward list is page-only; keeps the JSON small and honours the panel-summary design).

- [ ] **Step 1: Write the failing test**

Create `extract/test_politics_export.py`:
```python
from export_site import panel_politics   # helper added in Step 3

def test_strips_wards():
    pol = panel_politics("Stellenbosch")
    assert "wards" not in pol, "panel payload must not carry the ward list"
    assert pol.get("seats"), "panel payload keeps seats"
    assert pol.get("mayor", {}).get("name") == "Jeremy Fasser"

def test_empty_for_unknown():
    assert panel_politics("No Such Muni") == {}, "unknown -> empty (panel hides block)"

if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns: fn(); print("PASS", fn.__name__)
    print(f"\nAll {len(fns)} tests passed.")
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ~/projects/western-cape-property-valuations/extract && python3 test_politics_export.py`
Expected: FAIL — `ImportError: cannot import name 'panel_politics'`.

- [ ] **Step 3: Write minimal implementation**

In `export_site.py`, add to the imports (~line 9, beside `from authorities import authorities_for`):
```python
from politics import politics_for
```
Add a module-level helper (near the top, after imports):
```python
def panel_politics(name):
    """Panel-lean politics: everything politics_for gives EXCEPT the ward list
    (wards are page-only, per the panel-summary design). Empty dict -> block hidden."""
    p = politics_for(name)
    return {k: v for k, v in p.items() if k != "wards"} if p else {}
```
In the muni-node dict (~line 207, where `"authorities": authorities_for(name),` is), add:
```python
        "politics": panel_politics(name),
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd ~/projects/western-cape-property-valuations/extract && python3 test_politics_export.py`
Expected: `All 2 tests passed.`
Then: `cd ~/projects/western-cape-property-valuations && python3 extract/export_site.py` — regenerates site data with the `politics` node.

- [ ] **Step 5: Commit** (website repo — exported data changed)
```bash
cd ~/projects/western-cape-valuations
git add data/
git commit -m "Export: attach panel-lean politics summary to each municipality node"
git push
```

---

### Task 4: `renderPolitics()` in the Atlas panel

**Files:**
- Modify: `~/projects/western-cape-valuations/index.html` (add section container after line 383; bump `atlas.js?v=` to `24`)
- Modify: `~/projects/western-cape-valuations/assets/atlas.js` (add `renderPolitics` after `renderAuthorities` ~line 810; add call after line 593; add a party-colour map)

**Interfaces:**
- Consumes: `scope.politics` (panel-lean dict from Task 3), existing helpers `esc()`, `showSec(id,on)`, `$(id)`, `slugOf(name)`.
- Produces: `renderPolitics(scope)` — fills `#secPoliticsBody`; hides `#secPolitics` when no data.

- [ ] **Step 1: Write the failing test**

No JS test harness exists in this repo (rendering is verified in-browser). The verification step is the browser check in Step 4. Skip a code test; do NOT invent a framework.

- [ ] **Step 2: (n/a — see Step 4 browser verification)**

- [ ] **Step 3: Write implementation**

In `index.html`, add a section container immediately after the authorities one (line 383):
```html
      <div class="dsec" id="secPolitics"><h3 class="dh">Who represents this municipality</h3><div id="secPoliticsBody"></div></div>
```
Bump the atlas script version (find `atlas.js?v=23`) → `atlas.js?v=24`.

In `assets/atlas.js`, add a party-colour map near the top-level consts (keep in sync with `politics.PARTY_COLOURS` — this is the ONE unavoidable duplication; comment it):
```javascript
// Party colours for seat bars — keep in sync with extract/politics.py PARTY_COLOURS.
const PARTY_COLOURS = {DA:"#0071e3",ANC:"#00853f",EFF:"#e7261f","FF+":"#f39200",
  "VF Plus":"#f39200",ACDP:"#c8102e",PA:"#6a1b9a",GOOD:"#00a3a3",ASA:"#1565c0",
  Cope:"#e30613",IFP:"#e2001a","Al Jama-ah":"#2e7d32","Ind.":"#8a8f98",Independent:"#8a8f98"};
const partyColour = p => PARTY_COLOURS[p] || "#8a8f98";
```
Add the call after `renderAuthorities(scope);` (line 593):
```javascript
  renderPolitics(scope);
```
Add the renderer after `renderAuthorities` (~line 810):
```javascript
// Who represents this municipality — panel SUMMARY only (governance line + seat bar).
// Full seat table + ward councillors live on the muni page; link out to it.
// Data = scope.politics (panel-lean, from export_site.panel_politics). Hidden when absent.
function renderPolitics(s) {
  const p = s && s.politics;
  if (!showSec("secPolitics", !!(p && (p.election || p.governing || p.seats)))) return;
  const e = p.election || {}, g = p.governing || {}, m = p.mayor || {}, seats = p.seats || [];
  const line = [];
  if (e.winner) {
    const sf = (e.winner_seats && e.total_seats) ? ` (${e.winner_seats}/${e.total_seats})` : "";
    line.push(`<strong>${esc(e.date || "2021 election")}:</strong> ${esc(e.winner)} won${esc(sf)}`);
  }
  if (g.party) line.push(`<strong>Now:</strong> ${esc(g.party)}${g.basis ? " " + esc(g.basis) : ""}`
    + (g.as_of ? ` <span style="color:var(--label2)">(as of ${esc(g.as_of)})</span>` : ""));
  if (m.name) line.push(`<strong>${esc(m.title || "Mayor")}:</strong> ${esc(m.name)}`
    + (m.party ? ` (${esc(m.party)})` : ""));
  let html = line.length ? `<div style="font-size:13.5px;line-height:1.7">${line.join(" · ")}</div>` : "";
  if (seats.length) {
    const total = e.total_seats || seats.reduce((a, x) => a + x.seats, 0) || 1;
    const bar = seats.map(x =>
      `<span title="${esc(x.party)}: ${x.seats}" style="display:inline-block;height:10px;`
      + `width:${(100 * x.seats / total).toFixed(2)}%;background:${partyColour(x.party)}"></span>`).join("");
    const legend = seats.map(x =>
      `<span style="white-space:nowrap;margin-right:12px">`
      + `<span style="display:inline-block;width:9px;height:9px;border-radius:2px;`
      + `background:${partyColour(x.party)};margin-right:5px"></span>${esc(x.party)} ${x.seats}`
      + (x.votes_pct != null ? ` · ${x.votes_pct.toFixed(1)}%` : "") + `</span>`).join("");
    html += `<div style="display:flex;border-radius:4px;overflow:hidden;margin:10px 0 8px">${bar}</div>`
      + `<div style="font-size:11.5px;line-height:1.9;color:var(--label2)">${legend}</div>`;
  }
  const muni = s && s.name;
  if (muni) html += `<div style="margin-top:14px;font-size:12.5px">`
    + `<a href="m/${slugOf(muni)}.html">Full council &amp; ward councillors →</a></div>`;
  $("secPoliticsBody").innerHTML = html;
}
```
Note: confirm the scope object exposes its municipality name as `s.name` (grep `renderAuthorities`/panel code for how the current place name is read — e.g. `scope.name`); if it is stored under a different key, use that key for the `slugOf(...)` link.

- [ ] **Step 4: Verify in the browser**

Run: `cd ~/projects/western-cape-valuations && python3 -m http.server 8765` then load `http://localhost:8765/#m/stellenbosch`.
Expected: a "Who represents this municipality" section appears in the panel with the governance line, a coloured seat bar + legend, and a "Full council & ward councillors →" link. Drill to a district — the section is absent. Open `http://localhost:8765/m/stellenbosch.html` — the full block incl. the collapsible ward list is present. Confirm the panel does NOT horizontally scroll (Task from earlier).

- [ ] **Step 5: Commit** (website repo)
```bash
cd ~/projects/western-cape-valuations
git add index.html assets/atlas.js
git commit -m "Atlas panel: render governing party + seat bar with link to full council"
git push
```

---

### Task 5: Populate all 25 municipalities from IEC + provenance

**Files:**
- Modify: `~/projects/western-cape-property-valuations/extract/politics.py` (fill every municipality)
- Create: `<District>/<Muni>/politics/` (raw IEC result PDFs) and a `## Governance & representation` section in each `<District>/<Muni>/SOURCE.md`
- Re-run the export; commit the regenerated website.

**Interfaces:** produces complete `POLITICS` data conforming to the Task-1 shape; consumed by Tasks 2–4 unchanged.

- [ ] **Step 1: Dispatch the data-collection fan-out**

Use `superpowers:dispatching-parallel-agents`. One subagent per municipality (25 total, plus a few spares for stubborn cases), **cheap models (sonnet/haiku)** per the standing "use cheaper subagent models" note; escalate only for munis whose data resists. Each subagent's brief:
- From **IEC 2021 Municipal Election results** for this municipality: the winning party, seats won, total council seats, and each party's seats + vote %. From IEC ward results: each ward's elected councillor name + party.
- From the municipality's **official site / provincial gazette**: the current governing party/coalition and sitting mayor (with an `as_of` year).
- Return the data as a `politics.py` dict entry matching the documented shape. Every figure must cite its source URL. Download the primary IEC result PDF to `<Muni>/politics/`. **Do not guess** — omit a field rather than fabricate it (graceful degradation covers gaps).
- Ward numbers MUST match `data/geo/wc-wards.geojson` (`muni` + `ward`); flag mismatches instead of forcing them.

- [ ] **Step 2: Merge returns into `politics.py`, replacing the Task-1 placeholders.**

- [ ] **Step 3: Run the full test suite**

Run:
```bash
cd ~/projects/western-cape-property-valuations/extract
python3 test_politics.py && python3 test_politics_render.py && python3 test_politics_export.py
```
Expected: all pass — in particular `test_ward_numbers_match_geojson` and `test_seat_sum_sane` now cover real data. Fix any flagged ward-number or seat-sum discrepancy at the data level (add a note in `politics.py` if a sum is intentionally off due to PR top-up seats).

- [ ] **Step 4: Rebuild + verify + append provenance**

Run: `cd ~/projects/western-cape-property-valuations && python3 extract/build.py && python3 extract/export_site.py`
Append the `## Governance & representation` section to each `<Muni>/SOURCE.md` (source URLs, IEC result file, cycle). Spot-check 3 muni pages + the Atlas panel in the browser (as Task 4 Step 4).

- [ ] **Step 5: Commit + push** (website repo — regenerated pages + data)
```bash
cd ~/projects/western-cape-valuations
git add m/ d/ data/ index.html assets/atlas.js
git commit -m "Populate municipal governance & representation for all 25 municipalities"
git push
```

---

## Self-Review

- **Spec coverage:** election result → Task 1/2/4 (`election`); current governing + mayor → same (`governing`/`mayor`); seat breakdown + vote % → `seats` + `_seat_bar`/`_seat_table`/panel bar; ward councillors (page-only) → Task 2 `<details>`, excluded from panel via `panel_politics` (Task 3); party colours → `PARTY_COLOURS`/`party_colour`; districts excluded → district builder passes `""` + no node change; provenance/IEC + `<Muni>/politics/` + SOURCE.md → Task 5; ward↔geojson validation → Task 1 test; panel-summary/page-full split → Tasks 2 vs 3/4; no-hardcoding constraint → Global Constraints + data-driven renderers. All spec sections map to a task.
- **Placeholder scan:** the only intentional placeholder data is the seed `POLITICS` in Task 1, explicitly flagged and replaced in Task 5. No `TODO`/"handle edge cases"/bare "write tests" steps.
- **Type consistency:** `politics_for`→dict, `party_colour`/`partyColour`→hex string, `panel_politics`→dict (no `wards`), `politics_section`→str used identically across tasks; `seats[].votes_pct` treated as optional (`is not None`/`!= null`) in both Python and JS.
