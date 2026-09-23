# Parcel → valuation linker ("Integrity") Implementation Plan

> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the click-time heuristic with an offline, evidence-carrying parcel→roll-row link table, validated on a frozen 1,000-parcel fixture, and ship it in `search.db`.

**Architecture:** Deterministic SQLite stages under `extract/match/` (snapshot → profile → normalize → crosswalk → candidates → adjudicate → lookup), a Python port of today's `map.js` lookup as the baseline, a frozen fixture with adjudicated ground truth, and a `link` table the site reads before any heuristic.

**Tech Stack:** Python 3.14 stdlib + sqlite3 (pandas/numpy available; no geopandas/shapely — pure-Python point-in-polygon), `pdftotext` (poppler) for evidence packets, MapLibre `map.js` (ES module) on the site.

**Spec:** `docs/superpowers/specs/2026-09-22-parcel-link-design.md`

## Global Constraints

- Data repo (`~/projects/western-cape-property-valuations`) is NOT git; website repo (`~/projects/western-cape-valuations`) is — commit as the user only, always push.
- 8 GB laptop: no process may hold more than ~1.5 GB; stream SQL, never load all 1.46M roll rows × all parcels.
- No owner names anywhere (POPIA). Public sources only.
- Never show a wrong valuation as certain: `accepted_*` requires the vetoes in the spec to be clear.
- Fixture `fixtures/eval-1000.json` is frozen before any matcher code exists and is never edited; adjudicators never see the matcher's decision.
- Every `link` row carries `reason_codes`, `matching_method`, `confidence_score`, `confidence_tier`, provenance and versions.
- Site must never let the old heuristic override an explicit `ambiguous`/`abstain`/`not_in_roll` link row.

---

### Task 0: SG town table + frozen fixture

**Files:**
- Create: `extract/match/common.py`, `extract/match/fetch_towns.py`, `extract/match/freeze_fixture.py`
- Create (data): `extract/match/cache/cadastre.db` table `town`; `extract/match/fixtures/eval-1000.json`, `extract/match/fixtures/eval-holdout-250.json`
- Test: `extract/match/test_common.py`

**Interfaces:**
- Produces `common.norm(s) -> str` (exact port of `map.js normTown`), `common.erf_int(s) -> int|None`, `common.strip_prefix(s)`, `common.MuniIndex().muni_at(x, y) -> str|None`, `common.open_cadastre()`, `common.open_roll()`, `common.open_match()`, constants `PIPELINE_VERSION`, `FIXTURES`, `REPORTS`.
- Produces table `town(code TEXT PK, name TEXT, tag_x REAL, tag_y REAL, muni TEXT, straddle INT)`.
- Fixture row shape: `{"muni","prcl_key","objectid","town_code","town_name","tag_value","erf_int","remainder","x","y","area","lstatus","date_stamp"}`; meta `{"seed":20260922,"drawn":"<iso date>","universe":"erf WHERE wstatus='C' AND prcl_type='E'","sha256":"<of sorted prcl_keys>","point_check":{...}}`.

- [ ] **Step 1: Write the failing tests**

```python
# extract/match/test_common.py
from common import norm, erf_int, strip_prefix

def test_norm_matches_js():
    assert norm("BETTY`S BAY") == "BETYSBAI"
    assert norm("STILL BAY EAST") == "STILBAIOS"
    assert norm("GROOT BRAK RIVER (MOSSEL BAY)") == "GROTBRAKRIVIER"
    assert norm("Bot River") == "BOTRIVIER"

def test_erf_int():
    assert erf_int("00015773") == 15773 and erf_int("SB518/2") == 518
    assert erf_int("RE/2851") == 2851 and erf_int("") is None

def test_strip_prefix():
    assert strip_prefix("SB Stellenbosch") == "Stellenbosch"
    assert strip_prefix("KWA MANDLENKOSI") == "KWA MANDLENKOSI"
```

- [ ] **Step 2: Run to verify failure** — `cd extract/match && python3 -m pytest test_common.py -q` → ImportError.

- [ ] **Step 3: Implement `common.py`**

```python
"""Shared helpers for the parcel→valuation linker (extract/match/)."""
import json, os, re, sqlite3

HERE = os.path.dirname(os.path.abspath(__file__))
EXTRACT = os.path.dirname(HERE)
PROJECT = os.path.dirname(EXTRACT)
SITE = os.path.expanduser('~/projects/western-cape-valuations')
CACHE, FIXTURES, REPORTS = (os.path.join(HERE, d) for d in ('cache', 'fixtures', 'reports'))
CADASTRE_DB = os.path.join(CACHE, 'cadastre.db')
MATCH_DB = os.path.join(HERE, 'match.db')
ROLL_DB = os.path.join(EXTRACT, 'wc-valuations.db')
MUNIS_GEOJSON = os.path.join(SITE, 'data', 'geo', 'wc-municipalities.geojson')
ALIASES_JSON = os.path.join(SITE, 'data', 'geo', 'town-aliases.json')
PIPELINE_VERSION = '2026-09-22.1'

def norm(s):
    """Exact port of map.js normTown(): EN↔AF pairs, punctuation, doubled letters."""
    s = (s or '').upper()
    s = re.sub(r'\(.*?\)', '', s)
    for a, b in (('RIVER', 'RIVIER'), ('BAY', 'BAAI'), ('EAST', 'OOS'), ('WEST', 'WES')):
        s = re.sub(rf'\b{a}\b', b, s)
    s = re.sub(r'[^A-Z]', '', s)
    return re.sub(r'(.)\1+', r'\1', s)

def strip_prefix(s):
    """Stellenbosch valreg township prefix: 'SB Stellenbosch' → 'Stellenbosch'."""
    return re.sub(r'^[A-Z]{1,3}\s+(?=[A-Z][a-z])', '', s or '')

def erf_int(s):
    m = re.search(r'\d+', s or '')
    return int(m.group()) if m else None

def load_aliases():
    """{norm(cadastre name): norm(roll name)} — shared with map.js TOWN_ALIAS."""
    with open(ALIASES_JSON) as fh:
        return {norm(k): norm(v) for k, v in json.load(fh).items()}

def open_cadastre(): return sqlite3.connect(CADASTRE_DB)
def open_roll(): return sqlite3.connect(f'file:{ROLL_DB}?mode=ro', uri=True)
def open_match():
    os.makedirs(HERE, exist_ok=True)
    return sqlite3.connect(MATCH_DB)

def _in_ring(x, y, ring):
    inside, j = False, len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]; xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside

def in_geometry(x, y, geom):
    polys = [geom['coordinates']] if geom['type'] == 'Polygon' else geom['coordinates']
    for rings in polys:
        if _in_ring(x, y, rings[0]) and not any(_in_ring(x, y, h) for h in rings[1:]):
            return True
    return False

def bbox(geom):
    polys = [geom['coordinates']] if geom['type'] == 'Polygon' else geom['coordinates']
    xs = [p[0] for rings in polys for p in rings[0]]; ys = [p[1] for rings in polys for p in rings[0]]
    return min(xs), min(ys), max(xs), max(ys)

class MuniIndex:
    """Municipality containing a point (MDB polygons; bbox prefilter, holes respected)."""
    def __init__(self, path=MUNIS_GEOJSON):
        with open(path) as fh:
            self.feats = [(f['properties']['name'], bbox(f['geometry']), f['geometry'])
                          for f in json.load(fh)['features']]
    def muni_at(self, x, y):
        for name, (x0, y0, x1, y1), g in self.feats:
            if x0 <= x <= x1 and y0 <= y <= y1 and in_geometry(x, y, g):
                return name
        return None
```

- [ ] **Step 4: Run tests** → 3 passed.

- [ ] **Step 5: Implement `fetch_towns.py`** (allotment layer → `town` table, muni by label point, straddle flag by 12-parcel sample)

```python
"""SG Allotment Township layer → cadastre.db `town` (code, name, label point, municipality).
Municipality = MDB polygon containing the SG label point; `straddle`=1 when a 12-parcel sample of
the code falls in >1 municipality (then parcels of that code are placed one by one)."""
import json, random, urllib.parse, urllib.request
from common import open_cadastre, MuniIndex

LAYER = ('https://gis.westerncape.gov.za/server2/rest/services/SpatialDataWarehouse/'
         'SG_Boundaries/MapServer/2/query')

def main():
    q = urllib.parse.urlencode({'where': '1=1', 'outFields': 'TOWN_CODE,allot_name,TAG_X,TAG_Y',
                                'returnGeometry': 'false', 'resultRecordCount': 2000, 'f': 'json'})
    with urllib.request.urlopen(f'{LAYER}?{q}', timeout=60) as r:
        feats = [f['attributes'] for f in json.load(r)['features']]
    assert len(feats) < 2000, 'paginate'
    mi = MuniIndex(); rows = {}
    for a in feats:
        code, name = a['TOWN_CODE'], (a['allot_name'] or '').strip()
        if not code or not name: continue
        cur = rows.get(code)
        if cur is None or len(name) < len(cur[0]):        # 'KRAAIFONTEIN' over 'KRAAIFONTEIN (PAARL)'
            rows[code] = (name, a['TAG_X'], a['TAG_Y'], mi.muni_at(a['TAG_X'], a['TAG_Y']))
    con = open_cadastre()
    con.execute('DROP TABLE IF EXISTS town')
    con.execute('CREATE TABLE town(code TEXT PRIMARY KEY, name TEXT, tag_x REAL, tag_y REAL, muni TEXT, straddle INTEGER)')
    rng = random.Random(1)
    for code, (name, x, y, muni) in rows.items():
        pts = con.execute("SELECT tag_x,tag_y FROM erf WHERE town_code=? AND wstatus='C' ORDER BY random() LIMIT 12", (code,)).fetchall()
        ms = {mi.muni_at(px, py) for px, py in pts}
        straddle = int(len(ms) > 1)
        if muni is None and ms: muni = max(ms, key=lambda m: sum(1 for px, py in pts if mi.muni_at(px, py) == m))
        con.execute('INSERT INTO town VALUES(?,?,?,?,?,?)', (code, name, x, y, muni, straddle))
    con.commit()
    n, s = con.execute('SELECT COUNT(*), SUM(straddle) FROM town').fetchone()
    missing = con.execute('SELECT COUNT(DISTINCT town_code) FROM erf WHERE town_code NOT IN (SELECT code FROM town)').fetchone()[0]
    print(f'{n} towns, {s} straddling, {missing} parcel town codes without a town row')
    assert missing == 0

if __name__ == '__main__': main()
```

Run: `python3 fetch_towns.py` → `316 towns, 1 straddling, 0 …`.

- [ ] **Step 6: Implement `freeze_fixture.py`**

```python
"""Freeze the 40-per-municipality evaluation fixture (+ a disjoint 10-per-municipality holdout).
Universe = current erven a user can click (wstatus='C', prcl_type='E'); seed 20260922; drawn by
random.sample over each municipality's OBJECTID list. Written ONCE — refuses to overwrite."""
import hashlib, json, os, random, sys
from datetime import date
from common import open_cadastre, FIXTURES, MuniIndex, erf_int

SEED, N_EVAL, N_HOLD = 20260922, 40, 10
OUT, HOLD = os.path.join(FIXTURES, 'eval-1000.json'), os.path.join(FIXTURES, 'eval-holdout-250.json')

def parcel_muni(con, mi):
    """{objectid: muni} for every clickable parcel — by town code, per-parcel for straddling codes."""
    tm = dict(con.execute('SELECT code, muni FROM town WHERE straddle=0'))
    out = {}
    for oid, code, x, y in con.execute("SELECT objectid, town_code, tag_x, tag_y FROM erf WHERE wstatus='C' AND prcl_type='E'"):
        out[oid] = tm.get(code) or mi.muni_at(x, y)
    return out

def main():
    if os.path.exists(OUT): sys.exit(f'{OUT} exists — the fixture is frozen; delete deliberately to redraw')
    os.makedirs(FIXTURES, exist_ok=True)
    con = open_cadastre(); mi = MuniIndex()
    by_muni = {}
    for oid, m in parcel_muni(con, mi).items():
        if m: by_muni.setdefault(m, []).append(oid)
    rng = random.Random(SEED); ev, hold = [], []
    for m in sorted(by_muni):
        ids = sorted(by_muni[m]); pick = rng.sample(ids, N_EVAL + N_HOLD)
        for i, oid in enumerate(pick):
            r = con.execute('SELECT prcl_key, town_code, tag_value, tag_x, tag_y, geom_area, lstatus, date_stamp FROM erf WHERE objectid=?', (oid,)).fetchone()
            name = con.execute('SELECT name FROM town WHERE code=?', (r[1],)).fetchone()[0]
            row = {'muni': m, 'prcl_key': r[0], 'objectid': oid, 'town_code': r[1], 'town_name': name, 'tag_value': r[2],
                   'erf_int': erf_int(r[2]), 'remainder': r[2].startswith('RE/'), 'x': r[3], 'y': r[4], 'area': r[5],
                   'lstatus': r[6], 'date_stamp': r[7]}
            (ev if i < N_EVAL else hold).append(row)
    for path, rows in ((OUT, ev), (HOLD, hold)):
        sha = hashlib.sha256('\n'.join(sorted(r['prcl_key'] for r in rows)).encode()).hexdigest()
        json.dump({'meta': {'seed': SEED, 'drawn': date.today().isoformat(), 'n': len(rows), 'sha256': sha,
                            'universe': "erf WHERE wstatus='C' AND prcl_type='E'", 'muni_by': 'town code (per-parcel for straddling codes)'},
                   'rows': rows}, open(path, 'w'), indent=1)
        print(path, len(rows), sha[:12])

if __name__ == '__main__': main()
```

Run: `python3 freeze_fixture.py` → `eval-1000.json 1000 <sha>`, `eval-holdout-250.json 250 <sha>`. Then verify 25 random fixture points against the live layer (point query must return the fixture's `prcl_key`) and record the result in the fixture's `meta.point_check` — the ONLY permitted edit, made by a one-off script that touches `meta` only.

---

### Task 1: Site — draw and click only current parcels

**Files:**
- Modify: `assets/map.js` `loadParcels()` params (~line 296), `map.html`/`plain.html` `?v=26`, `DATA_CONTRACT.md` §9.

- [ ] **Step 1:** add `where: "WSTATUS='C'"` to the `URLSearchParams` in `loadParcels` with the comment `// obsolete erven (WSTATUS='H', 5.4%) sit inside their successors and the smallest-first chooser preferred them`.
- [ ] **Step 2:** bump `map.js?v=26` in `map.html` and `plain.html`.
- [ ] **Step 3:** DATA_CONTRACT §9 "Integrity" block: one bullet — obsolete erven are never drawn or clickable.
- [ ] **Step 4:** `node --check assets/map.js`; commit `Integrity: draw and click only current (WSTATUS='C') erven`; push; confirm live `?v=26`.

---

### Task 2: Repaired input — export the roll's `town` column

**Files:**
- Modify: `extract/export_site.py:444-460` (prop table), `assets/map.js` `lookupErf`/`rankRows`, `DATA_CONTRACT.md` §4.2/§9.
- Create: `~/projects/western-cape-valuations/data/geo/town-aliases.json` (moved out of `map.js`).

**Interfaces:** `prop` gains `town TEXT` = the roll's `town` only where that column is informative for the municipality (≥ 2 distinct non-blank values), else NULL; `rankRows` scores `max(score(suburb), score(town))`.

- [ ] **Step 1:** in `export_site.py` compute `info = {muni for (muni,n) in SELECT m.name, COUNT(DISTINCT NULLIF(TRIM(p.town),'')) … GROUP BY 1 if n >= 2}`; select `CASE WHEN m.name IN (…) THEN NULLIF(TRIM(p.town),'') END AS town`; add column `town TEXT` to `CREATE TABLE prop`, index `idx_town ON prop(town COLLATE NOCASE)`.
- [ ] **Step 2:** `map.js`: SQL adds `town` to every `SELECT` on `prop`, ORDER BY becomes `(suburb=?2 COLLATE NOCASE OR town=?2 COLLATE NOCASE) DESC, (?2<>'' AND (instr(upper(suburb),upper(?2))>0 OR instr(upper(?2),upper(suburb))>0 OR instr(upper(coalesce(town,'')),upper(?2))>0)) DESC`; `rankRows`'s `score(r)` → `Math.max(scoreLabel(r.suburb, …), scoreLabel(r.town, …))` where `scoreLabel` is today's suburb branch; `TOWN_ALIAS` loaded from `data/geo/town-aliases.json` (fetch at boot, same fallback literal kept).
- [ ] **Step 3:** run `python3 extract/export_site.py`; `sqlite3 data/db/search.db "SELECT muni, COUNT(town) FROM prop GROUP BY 1"` → George/Beaufort West/Knysna/Cape Agulhas/Swellendam/Cederberg non-zero, constant-town munis 0. (Do NOT commit `data/` yet — it ships with the link table in Task 9.)
- [ ] **Step 4:** commit the JS/contract change only (the site keeps working against v9 because every new column is optional: `r.town` undefined → score 0).

---

### Task 3: Baseline port + evaluator skeleton (three measurements)

**Files:**
- Create: `extract/match/baseline.py`, `extract/match/evaluate.py`, `extract/match/test_baseline.py`

**Interfaces:**
- `baseline.lookup(db, erf_tag, town, muni, use_town=False) -> {"rows": [...], "best": int, "disposition": str}`; dispositions `detail_sure | detail_unsure | list_sure | list_unsure | none`.
- `evaluate.run(name, fn) -> writes reports/results-<name>.json` and `evaluate.report()` writes `reports/eval-<date>.md`.

- [ ] **Step 1: Failing test** — `rank_rows` port must reproduce the JS ranking on a fixture of rows: `[{"suburb":"SB Stellenbosch","muni":"Stellenbosch"}]` with town `STELLENBOSCH` → best 4; `{"suburb":"BETTYS BAY"}` with `BETTY\`S BAY` → 5; muni-only → 2.
- [ ] **Step 2:** implement `baseline.py`:

```python
"""Faithful Python port of map.js lookupErf()+rankRows() (v25/v26) so the click heuristic can be
measured offline. use_town=True adds the repaired-input variant (prop.town scored too)."""
import re, sqlite3
from common import norm, load_aliases
ALIAS = load_aliases()

def score_label(label, t, nt, at):
    sub = (label or '').upper().strip()
    if not t or not sub: return 0
    if sub == t: return 5
    ns = norm(sub)
    if ns and ns == nt: return 5
    if ns and nt and (nt in ns or ns in nt): return 4
    if at and ns and (ns == at or at in ns or ns in at): return 4
    return 0

def rank_rows(rows, town, use_town=False):
    t = (town or '').upper().strip(); nt = norm(t); at = ALIAS.get(nt)
    def score(r):
        s = score_label(r['suburb'], t, nt, at)
        if use_town: s = max(s, score_label(r.get('town'), t, nt, at))
        if s: return s
        mun = (r['muni'] or '').upper().strip()
        if mun == t: return 2
        nm = norm(mun)
        if nm and nt and (nt in nm or nm in nt): return 1
        return 0
    scored = sorted(((score(r), r) for r in rows), key=lambda x: (-x[0], -(x[1]['value'] or 0)))
    best = scored[0][0] if scored else 0
    return {'rows': [r for s, r in scored if s == best] if best > 0 else [r for _, r in scored], 'best': best}

COLS = 'muni,suburb,erf,address,extent,dwext,value,tenure,category,town'
def q(db, sql, args):
    db.row_factory = sqlite3.Row
    return [dict(r) for r in db.execute(sql, args)]

def lookup(db, erf_tag, town, muni, use_town=False):
    m = re.search(r'\d+', erf_tag or '')
    if not m: return {'rows': [], 'best': 0, 'disposition': 'none'}
    n = int(m.group()); t = (town or '').strip(); has_town_col = use_town
    cols = COLS if has_town_col else COLS.replace(',town', '')
    match = "(suburb=?2 COLLATE NOCASE" + (" OR town=?2 COLLATE NOCASE)" if has_town_col else ")")
    like = ("(?2<>'' AND (instr(upper(suburb),upper(?2))>0 OR instr(upper(?2),upper(suburb))>0" +
            (" OR instr(upper(coalesce(town,'')),upper(?2))>0))" if has_town_col else "))"))
    def query(gate, lim):
        sql = (f"SELECT {cols} FROM prop WHERE erf_int=?1 AND value>0 {'AND muni=?3 ' if gate else ''}"
               f"ORDER BY {match} DESC, {like} DESC, value DESC LIMIT {lim}")
        return q(db, sql, (n, t, muni) if gate else (n, t))
    rows = query(bool(muni), 80); res = rank_rows(rows, town, use_town)
    if res['best'] < 4 and len(rows) == 80:
        wide = rank_rows(query(bool(muni), 600), town, use_town)
        if wide['best'] > res['best']: res = wide
    if muni and not res['rows']:
        x = rank_rows(query(False, 600), town, use_town)
        if x['best'] >= 4: res = x
    if muni and res['rows'] and res['best'] < 1: res['best'] = 1
    sure = res['best'] >= 4
    d = ('none' if not res['rows'] else
         ('detail_sure' if sure else 'detail_unsure') if len(res['rows']) == 1 else
         ('list_sure' if sure else 'list_unsure'))
    return {**res, 'disposition': d}
```

- [ ] **Step 3:** `evaluate.py` skeleton: loads the fixture, runs a callable per row, writes `reports/results-<name>.json` as `{prcl_key: {"disposition", "best", "rows":[{muni,suburb,town,erf,address,value}]}}`; `report()` is completed in Task 11.
- [ ] **Step 4:** run three measurements once the link exists; now run the two baselines: `python3 evaluate.py baseline-v9 --db ../../..../data/db/search.db(v9 reassembled)` and `baseline-town --db <fresh export> --use-town`. Record the disposition mix per municipality in `reports/baselines.md`.

---

### Task 4: Data-audit surveyor — `profile.py`

**Files:** Create `extract/match/profile.py`, test `extract/match/test_profile.py`.

**Interfaces:** tables `field_profile(muni, roll_id, column, n, n_null, n_distinct, constant, unreliable, reason, top_values)` and `label(muni, source_col, label_raw, label_norm, n_rows, n_erfs, erf_lo, erf_hi, n_farm, reliable, reason)`; `profile.label_reliable(muni, source_col, label_raw) -> (bool, reason)` reused by later stages via the table.

- [ ] **Step 1: Failing test** — after `profile.main()`, `label` has `('Matzikama','suburb','0')` with `reliable=0, reason='placeholder'`; `('Laingsburg','town','Laingsburg')` `reliable=0, reason='constant column'`; `('George','town','GEORGE')` `reliable=1`.
- [ ] **Step 2: Implement**

```python
"""Data-audit surveyor: per municipality×roll field profile + locality-label vocabulary with
reliability flags. Downstream stages must not treat an unreliable label as locality evidence."""
import json, re
from common import open_roll, open_match, norm, strip_prefix, erf_int

COLS = ('town', 'suburb', 'erf_no', 'portion', 'unit_no', 'ss_scheme', 'category', 'site_address', 'extent_m2', 'market_value_r')
PLACEHOLDER = {'', '0', '-', '.', 'N/A', 'NA', 'NONE', 'NULL'}

def main():
    r, m = open_roll(), open_match()
    m.executescript('''DROP TABLE IF EXISTS field_profile; DROP TABLE IF EXISTS label;
      CREATE TABLE field_profile(muni, roll_id, column, n, n_null, n_distinct, constant, unreliable, reason, top_values);
      CREATE TABLE label(muni, source_col, label_raw, label_norm, n_rows, n_erfs, erf_lo, erf_hi, n_farm, reliable, reason,
                         PRIMARY KEY(muni, source_col, label_raw));''')
    munis = dict(r.execute('SELECT id, name FROM municipality'))
    const = {}                                   # (muni, col) -> True when constant over the muni
    for mid, muni in munis.items():
        for col in COLS:
            n, nn, nd = r.execute(f"SELECT COUNT(*), SUM({col} IS NULL OR TRIM({col})=''), COUNT(DISTINCT NULLIF(TRIM({col}),'')) FROM property WHERE municipality_id=?", (mid,)).fetchone()
            top = r.execute(f"SELECT {col}, COUNT(*) c FROM property WHERE municipality_id=? GROUP BY 1 ORDER BY c DESC LIMIT 5", (mid,)).fetchall()
            c = int(nd <= 1); const[(muni, col)] = bool(c)
            unrel, reason = (1, 'constant column') if c and col in ('town', 'suburb') else (0, '')
            m.execute('INSERT INTO field_profile VALUES(?,?,?,?,?,?,?,?,?,?)', (muni, None, col, n, nn, nd, c, unrel, reason, json.dumps(top)))
        for col in ('town', 'suburb'):
            for raw, n_rows, n_erfs, lo, hi, n_farm in r.execute(f"""
                SELECT {col}, COUNT(*), COUNT(DISTINCT erf_no), MIN(erf_no), MAX(erf_no), SUM(tenure_type='farm')
                FROM property WHERE municipality_id=? GROUP BY 1""", (mid,)):
                raw = raw or ''
                ln = norm(strip_prefix(raw))
                if const[(muni, col)]: rel, why = 0, 'constant column'
                elif raw.strip().upper() in PLACEHOLDER: rel, why = 0, 'placeholder'
                elif raw.strip().upper().startswith('UNREGISTERED'): rel, why = 0, 'unregistered street'
                elif re.search(r'\bNo\.?\s*\d+\s*RD\b', raw) or raw.strip().upper().endswith(' RD'): rel, why = 0, 'farm/rural label'
                elif ln == norm(muni) and not const[(muni, col)] and n_rows > 0.5 * sum(1 for _ in [0]) and False: rel, why = 1, ''
                else: rel, why = 1, ''
                m.execute('INSERT OR REPLACE INTO label VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                          (muni, col, raw, ln, n_rows, n_erfs, lo, hi, n_farm, rel, why))
    m.commit()
    n, u = m.execute('SELECT COUNT(*), SUM(reliable=0) FROM label').fetchone()
    print(f'labels: {n} ({u} unreliable)')

if __name__ == '__main__': main()
```

(The dead `elif` guarding `ln == norm(muni)` is removed in implementation — a label equal to the municipality name is fine when the column varies; see AUDIT §3.4.)

- [ ] **Step 3:** run test → pass. Print the unreliable labels with > 100 rows into `reports/profile-<date>.md`.

---

### Task 5: Identifier-normalization surveyor — `normalize.py`

**Files:** Create `extract/match/normalize.py`, `extract/match/test_normalize.py`.

**Interfaces:** table `ident(prop_id INTEGER PRIMARY KEY, muni, roll_id, erf_raw, erf_int, erf_prefix, portion_raw, portion_int, unit_raw, scheme_norm, namespace, town_raw, suburb_raw, town_norm, suburb_norm, extent, value, transforms)`; `namespace ∈ {'erf','unit','farm'}`.

- [ ] **Step 1: Failing test**

```python
from normalize import parse_ident
def test_parse():
    assert parse_ident('00015773', None) == (15773, '', None, ['strip_zeros'])
    assert parse_ident('SB518/2', None) == (518, 'SB', 2, ['prefix:SB', 'glued_portion'])
    assert parse_ident('15773', '00003') == (15773, '', 3, ['portion_col'])
    assert parse_ident('GE   0000', None)[0] is None
```

- [ ] **Step 2: Implement**

```python
"""Identifier surveyor: municipality-aware parsing of erf / portion / unit / scheme, raw preserved,
every transform recorded. The roll's ROW stays the unit of identity (prop_id)."""
import re
from common import open_roll, open_match, norm, strip_prefix

ERF_RE = re.compile(r'^\s*([A-Z]{1,3})?\s*0*(\d+)\s*(?:/\s*0*(\d+))?\s*$')

def parse_ident(erf_raw, portion_raw):
    t, m = [], ERF_RE.match(erf_raw or '')
    if not m: return None, '', None, ['unparsed']
    pre, n, glued = m.group(1) or '', int(m.group(2)), m.group(3)
    if pre: t.append(f'prefix:{pre}')
    if (erf_raw or '').strip().lstrip(pre).startswith('0'): t.append('strip_zeros')
    portion = None
    if glued is not None: portion = int(glued); t.append('glued_portion')
    pm = re.search(r'\d+', portion_raw or '')
    if pm and portion is None: portion = int(pm.group()); t.append('portion_col')
    if (portion_raw or '').strip().upper().startswith('RE'): portion = 0; t.append('remainder')
    return n, pre, portion, t

def main():
    r, m = open_roll(), open_match()
    m.executescript('''DROP TABLE IF EXISTS ident;
      CREATE TABLE ident(prop_id INTEGER PRIMARY KEY, muni, roll_id, erf_raw, erf_int, erf_prefix, portion_raw, portion_int,
        unit_raw, scheme_norm, namespace, town_raw, suburb_raw, town_norm, suburb_norm, extent, value, transforms);''')
    rows = []
    for pid, muni, rid, erf, por, unit, scheme, ten, town, sub, ext, val in r.execute('''
        SELECT p.id, mu.name, p.roll_id, p.erf_no, p.portion, p.unit_no, p.ss_scheme, p.tenure_type, p.town, p.suburb,
               p.extent_m2, p.market_value_r FROM property p JOIN municipality mu ON mu.id=p.municipality_id'''):
        n, pre, pint, t = parse_ident(erf, por)
        ns = 'farm' if ten == 'farm' else 'unit' if ((unit or '').strip() or (scheme or '').strip()) else 'erf'
        rows.append((pid, muni, rid, erf, n, pre, por, pint, unit, norm(scheme), ns, town, sub,
                     norm(strip_prefix(town)), norm(strip_prefix(sub)), ext, val, ','.join(t)))
        if len(rows) >= 50000: m.executemany('INSERT INTO ident VALUES(' + ','.join('?'*18) + ')', rows); rows = []
    m.executemany('INSERT INTO ident VALUES(' + ','.join('?'*18) + ')', rows)
    m.executescript('CREATE INDEX idx_ident_me ON ident(muni, erf_int); CREATE INDEX idx_ident_ns ON ident(namespace);')
    m.commit()
    print(dict(m.execute('SELECT namespace, COUNT(*) FROM ident GROUP BY 1')), 'unparsed:', m.execute("SELECT COUNT(*) FROM ident WHERE erf_int IS NULL").fetchone()[0])

if __name__ == '__main__': main()
```

- [ ] **Step 3:** run → `{'erf': ~1.1M, 'unit': ~0.3M, 'farm': ~36k}`; list the unparsed count per municipality in the profile report (they are `not_matchable`, never guessed).

---

### Task 6: Locality-crosswalk surveyor — `crosswalk.py`

**Files:** Create `extract/match/crosswalk.py`, `extract/match/crosswalk-manual.json` (`[]`), `extract/match/test_crosswalk.py`.

**Interfaces:** table `crosswalk(muni, source_col, label_norm, town_code, method, n_support, n_contra, share, tier, evidence, contra, status, version, created, PRIMARY KEY(muni, source_col, label_norm))`; `tier ∈ {'A','B','C'}`; labels evaluated but rejected go to `crosswalk_rejected(muni, source_col, label_norm, reason, evidence)`.

- [ ] **Step 1: Failing test** — synthetic: a label whose exclusive erfs are 40 in town X and 0 elsewhere → tier B (`erfdist`), 40 ≥ 20 but < 50 → C; with a name match → A; with 3/40 in town Y (7.5% contra) → rejected.
- [ ] **Step 2: Implement** (core of the design; kept to the three routes + manual):

```python
"""Locality-crosswalk surveyor: roll locality label → SG town code, per municipality.
Routes: name (label ≡ SG town / alias), erfdist (EXCLUSIVE erf numbers — those that exist in exactly
one SG town of the municipality — vote for their town), statssa (the Stats SA place with the label's
name: parcels inside it carrying the label's erf numbers vote for their town code), manual.
Tiers: A = name/manual or erfdist+statssa agreeing; B = erfdist ≥50 obs @ ≥0.97 or statssa ≥30 votes
@ ≥0.9; C = erfdist ≥20 @ ≥0.95. Any contra share > 0.05 → rejected (recorded)."""
import json, os
from collections import Counter, defaultdict
from datetime import date
from common import open_cadastre, open_match, norm, load_aliases, in_geometry, bbox, CACHE, HERE

VERSION = date.today().isoformat()

def sg_towns(c):
    by_muni = defaultdict(dict)
    for code, name, muni in c.execute('SELECT code, name, muni FROM town'): by_muni[muni][code] = name
    return by_muni

def erf_sets(c):
    """{muni: {town_code: set(erf_int)}} over current erven."""
    out = defaultdict(lambda: defaultdict(set))
    for code, muni, tag in c.execute("SELECT e.town_code, t.muni, e.tag_value FROM erf e JOIN town t ON t.code=e.town_code WHERE e.wstatus='C' AND e.prcl_type='E'"):
        d = ''.join(ch for ch in tag if ch.isdigit())
        if d: out[muni][code].add(int(d))
    return out

def statssa_places():
    feats = []
    for f in ('statssa-subplaces.json', 'statssa-mainplaces.json'):
        for ft in json.load(open(os.path.join(CACHE, f)))['features']:
            a = ft['attributes']; name = a.get('SP_NAME') or a.get('MP_NAME')
            name = name.replace(' SP', '').strip() if name.endswith(' SP') else name
            g = {'type': 'Polygon', 'coordinates': ft['geometry']['rings']}
            feats.append((norm(name), a.get('MN_NAME'), bbox(g), g))
    return feats

def main():
    c, m = open_cadastre(), open_match(); alias = load_aliases()
    m.executescript('''DROP TABLE IF EXISTS crosswalk; DROP TABLE IF EXISTS crosswalk_rejected;
      CREATE TABLE crosswalk(muni, source_col, label_norm, town_code, method, n_support, n_contra, share, tier, evidence, contra, status, version, created, PRIMARY KEY(muni, source_col, label_norm));
      CREATE TABLE crosswalk_rejected(muni, source_col, label_norm, reason, evidence);''')
    towns = sg_towns(c); esets = erf_sets(c); places = statssa_places()
    manual = {(d['muni'], d['source_col'], norm(d['label'])): d for d in json.load(open(os.path.join(HERE, 'crosswalk-manual.json')))}
    # exclusive-erf index per municipality
    excl = {}
    for muni, bytown in esets.items():
        cnt = Counter(e for s in bytown.values() for e in s)
        excl[muni] = {e: code for code, s in bytown.items() for e in s if cnt[e] == 1}
    labels = m.execute("SELECT muni, source_col, label_norm, SUM(n_rows) FROM label WHERE reliable=1 AND label_norm<>'' GROUP BY 1,2,3 HAVING SUM(n_rows)>=5").fetchall()
    for muni, col, ln, n_rows in labels:
        names = {norm(v): k for k, v in towns.get(muni, {}).items()}
        ev, contra, cands = {}, {}, Counter()
        # route: manual
        md = manual.get((muni, col, ln))
        if md: ev['manual'] = md; cands[md['town_code']] += 10**6
        # route: name
        hit = names.get(ln) or names.get(alias.get(ln, ''))
        if not hit:
            for nn, code in names.items():                     # alias in the other direction (roll name is the alias value)
                if alias.get(nn) == ln: hit = code
        if hit: ev['name'] = {'town_code': hit}; cands[hit] += 10**5
        # route: erfdist
        erfs = {e for (e,) in m.execute("SELECT DISTINCT erf_int FROM ident WHERE muni=? AND namespace<>'farm' AND erf_int IS NOT NULL AND (CASE ? WHEN 'town' THEN town_norm ELSE suburb_norm END)=?", (muni, col, ln))}
        votes = Counter(excl[muni][e] for e in erfs if e in excl.get(muni, {}))
        if votes:
            top, n_top = votes.most_common(1)[0]; tot = sum(votes.values())
            ev['erfdist'] = {'votes': dict(votes), 'n_exclusive': tot, 'n_label_erfs': len(erfs)}
            if n_top >= 20 and n_top / tot >= 0.95: cands[top] += n_top
            for code, n in votes.items():
                if code != top and n / tot > 0.05: contra[code] = contra.get(code, 0) + n
        # route: statssa (only when the name route failed)
        if not hit:
            for pn, mn, (x0, y0, x1, y1), g in places:
                if pn != ln or (mn and norm(mn) != norm(muni)): continue
                v = Counter()
                for code in towns.get(muni, {}):
                    for tag, x, y in c.execute("SELECT tag_value, tag_x, tag_y FROM erf WHERE town_code=? AND wstatus='C' AND tag_x BETWEEN ? AND ? AND tag_y BETWEEN ? AND ?", (code, x0, x1, y0, y1)):
                        d = ''.join(ch for ch in tag if ch.isdigit())
                        if d and int(d) in erfs and in_geometry(x, y, g): v[code] += 1
                if v:
                    top, n_top = v.most_common(1)[0]; tot = sum(v.values())
                    ev['statssa'] = {'votes': dict(v), 'place': pn}
                    if n_top >= 30 and n_top / tot >= 0.9: cands[top] += n_top
        if not cands:
            m.execute('INSERT INTO crosswalk_rejected VALUES(?,?,?,?,?)', (muni, col, ln, 'no evidence', json.dumps(ev))); continue
        code = cands.most_common(1)[0][0]
        n_contra = sum(n for k, n in contra.items() if k != code)
        n_support = sum(v for k, v in ev.get('erfdist', {}).get('votes', {}).items() if k == code) + sum(v for k, v in ev.get('statssa', {}).get('votes', {}).items() if k == code)
        methods = [k for k in ('manual', 'name', 'erfdist', 'statssa') if k in ev and (ev[k].get('town_code') == code or (ev[k].get('votes', {}).get(code, 0) > 0))]
        if n_contra and n_contra / max(n_contra + n_support, 1) > 0.05:
            m.execute('INSERT INTO crosswalk_rejected VALUES(?,?,?,?,?)', (muni, col, ln, 'conflicting', json.dumps({'ev': ev, 'contra': contra}))); continue
        if 'manual' in methods or 'name' in methods or ('erfdist' in methods and 'statssa' in methods): tier = 'A'
        elif ('erfdist' in methods and n_support >= 50 and n_support / max(n_support + n_contra, 1) >= 0.97) or ('statssa' in methods and n_support >= 30): tier = 'B'
        elif 'erfdist' in methods and n_support >= 20: tier = 'C'
        else:
            m.execute('INSERT INTO crosswalk_rejected VALUES(?,?,?,?,?)', (muni, col, ln, 'weak', json.dumps(ev))); continue
        m.execute('INSERT OR REPLACE INTO crosswalk VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                  (muni, col, ln, code, '+'.join(methods), n_support, n_contra, n_support / max(n_support + n_contra, 1), tier,
                   json.dumps(ev), json.dumps(contra), 'manual' if md else 'auto', VERSION, date.today().isoformat()))
    m.commit()
    print(dict(m.execute('SELECT tier, COUNT(*) FROM crosswalk GROUP BY 1')), 'rejected', m.execute('SELECT COUNT(*) FROM crosswalk_rejected').fetchone()[0])

if __name__ == '__main__': main()
```

- [ ] **Step 3:** run; write `reports/crosswalk-<date>.md`: every B/C proposal with its votes (the human-review queue, ordered by rows affected), and the rejected/conflicting labels. Spot-check: `BRIDGTON - WOONGEBIED → OUDTSHOORN`, `GOLDNERVILLE → LAINGSBURG`, `MCREGOR → MCGREGOR` (alias), `RUSTDENE → BEAUFORT WEST` (statssa+erfdist = A).

---

### Task 7: Candidate generation — `candidates.py`

**Files:** Create `extract/match/candidates.py`.

**Interfaces:** tables `parcel(prcl_key TEXT PRIMARY KEY, muni, town_code, erf_int, remainder, area, lstatus, wstatus, date_stamp, x, y)` (one row per key; multi-piece remainders summed in `area`) and `cand(prcl_key, prop_id, via, PRIMARY KEY(prcl_key, prop_id))`; `via ∈ {'erf','unit'}`.

- [ ] **Step 1:** build `parcel` from `erf` (current, type E) joined to `town` (straddling codes → `MuniIndex.muni_at`), `GROUP BY prcl_key`.
- [ ] **Step 2:** `cand`: `INSERT INTO cand SELECT p.prcl_key, i.prop_id, i.namespace FROM parcel p JOIN ident i ON i.muni=p.muni AND i.erf_int=p.erf_int WHERE i.namespace IN ('erf','unit')` — indexed join; portion rule: erven-layer parcels are whole erven or remainders, so roll rows with `portion_int > 0` are excluded from `via='erf'` unless the parcel is a remainder and the row is marked `remainder` (they would be farm-style sub-portions the erven layer does not draw).
- [ ] **Step 3:** sanity prints: parcels 1.34M; candidates per parcel distribution (0 / 1 / 2–5 / >5) per municipality → `reports/candidates-<date>.md`.

---

### Task 8: Adjudicator — `adjudicate.py`

**Files:** Create `extract/match/adjudicate.py`, `extract/match/test_adjudicate.py`.

**Interfaces:** tables `link(prcl_key TEXT PRIMARY KEY, municipality_id, roll_version, roll_row_id, group_key, relationship_type, decision, confidence_score, confidence_tier, matching_method, reason_codes, positive_evidence, negative_evidence, crosswalk_version, cadastre_version, source_document, source_page, pipeline_version, generated_at)` and `cand_diag(prcl_key, group_key, prop_id, town_ev, area_log_ratio, unique_in_muni, label_unreliable, date_conflict, decision_contrib)`; `decide(parcel, groups, ctx) -> dict` pure function for tests.

- [ ] **Step 1: Failing tests** for `decide()`: one erf group with `town_ev='direct'`, area ratio 0.02 → `accepted_high` 0.97 with `TOWN_DIRECT,AREA_OK`; two groups both direct → `ambiguous` `MULTI_GROUP:2`; one group `xwalkB` → `review`; one group direct but `|area_log_ratio|=1.2` → `review` `AREA_CONFLICT`; one group `contra` → `abstain` `TOWN_CONTRA`; no groups and roll coverage 0.8 → `not_in_roll`; sectional group direct → `accepted_group`.
- [ ] **Step 2: Implement** feature computation streaming per parcel (`ORDER BY prcl_key`), town evidence per row = evaluate `(town_raw→town_norm)` and `(suburb_raw→suburb_norm)` against: reliability (`label` table), direct name (parcel town name / alias), crosswalk row (`tier`), another SG town's name or crosswalk → `contra`; combine as: any `contra` and no `direct` → `contra`; two different `direct`s → `conflict`; else the best. Area: `log10(extent/area)`; per roll, if the median over direct-matched pairs ≈ 4 → unit factor 10⁴ applied and reason `AREA_UNIT_HA`. Roll coverage per SG town = distinct erf_ints in the roll ∩ town's erfs ÷ town's erfs (for `not_in_roll`). `date_conflict` = `lstatus in ('S','A')` and `date_stamp` after the roll cycle's first year (Jul 1). Decisions exactly as the spec table; `confidence_score` from the tier table; `matching_method` = e.g. `erf+town_direct`, `erf+xwalk:erfdist`, `unique_in_muni`, `scheme_group`.
- [ ] **Step 3:** run on all parcels (~10 min); print decision mix per municipality → `reports/decisions-<date>.md`.

---

### Task 9: Static lookup in `search.db` + site reads it first

**Files:**
- Create: `extract/match/build_lookup.py`, `extract/match/run.py` (orchestrator: towns → profile → normalize → crosswalk → candidates → adjudicate → build_lookup, each logged with row counts and versions).
- Modify: `extract/export_site.py` (copy `link` projection into `search.db`, bump `config.json` to `v10`), `assets/map.js` `lookupErf`, `DATA_CONTRACT.md` §4/§9.

**Interfaces:** `search.db` table `link(prcl_key TEXT PRIMARY KEY, prop_id INTEGER, group_key TEXT, decision TEXT, tier TEXT, conf REAL, method TEXT, reasons TEXT) WITHOUT ROWID` — every clickable parcel has a row (`abstain` included). `map.js`: `lookupLink(prcl_key)` → `{decision, rows, tier, conf, method, reasons}`; `showValuation` renders by decision: `accepted_high` detail card with a "verified match" line; `accepted_group` unit list; `review`/`ambiguous` candidate list titled honestly ("Possible matches — same erf number, town not confirmed"); `not_in_roll` no-valuation card; `abstain` "Could not link this parcel" with the candidates as a list; only when NO link row exists does the heuristic run, and its card says "unverified (heuristic)".

- [ ] **Step 1:** `build_lookup.py` writes `match.db.link` (already) and a `lookup_export` view; `export_site.py` `ATTACH`es `match.db` and copies `link` (+ `prop_id` mapped to `prop.id` — `prop.id` = `property.id` order? No: `prop.id` is assigned in erf_int order — so export `prop` with a `pid` = `property.id` column and map through it).
- [ ] **Step 2:** `map.js` query `SELECT l.decision,l.tier,l.conf,l.method,l.reasons,l.group_key,p.* FROM link l LEFT JOIN prop p ON p.id=l.prop_id WHERE l.prcl_key=?` (group: `… JOIN prop p ON p.pid IN (SELECT …)` — for groups store `group_key = 'scheme:<norm>'` and fetch `WHERE muni=? AND scheme_norm=?` via an exported `prop.gkey` column).
- [ ] **Step 3:** DATA_CONTRACT: regeneration order `build.py → match/run.py → export_site.py`; the link table contract; the honesty rules above.
- [ ] **Step 4:** export locally, click-test on `localhost` via Safari against `?db=` the local file (needs a range-capable server: `python3 -m http.server` is fine), then Task 12 uploads.

---

### Task 10: Evidence packets, adjudication, challenge set

**Files:** Create `extract/match/review_sheet.py`, `extract/match/fixtures/eval-1000-truth.json`, `extract/match/fixtures/challenge.json`, `extract/match/reports/adjudication-notes.md`.

- [ ] **Step 1:** `review_sheet.py` writes `fixtures/packets/<prcl_key>.md` per fixture row: cadastre attributes (erf, SG town, area, status, date), Stats SA main/sub-place at the label point, every candidate roll row in the municipality with the same erf number **from the roll itself** (`property` + `roll.source_file` + `page`) and the raw page text lines containing the erf (via `pdftotext -f page -l page -layout`; CoCT: the XLSX row), plus the crosswalk table's entries for the labels involved (evidence, not decisions). No matcher decision appears in the packet.
- [ ] **Step 2:** adjudicate in batches of 50 packets with the fixed rubric: label ∈ `verified_unique | probable_unique | candidate_list | no_roll_entry | unresolved | unverifiable`, `prop_ids` chosen, one-line justification quoting the evidence, `evidence_used` list. Output JSON per packet → merged into `eval-1000-truth.json` with `truth_status: provisional`.
- [ ] **Step 3:** independent check: I re-adjudicate (a) every packet where the linker later disagrees with the truth, (b) 5 random per municipality (125) — those become `truth_status: checked`; disagreements with the first-pass adjudication are logged in `adjudication-notes.md` and the truth corrected.
- [ ] **Step 4:** `challenge.json` (≥ 60 parcels): 10 collision-heavy erf numbers (erf 36/518/1107-type in CoCT/Cape Agulhas), 10 obsolete `WSTATUS='H'` parcels, 10 CoCT sectional buildings, 10 remainders (`RE/`), 10 town-disagreement labels (Oudtshoorn Bridgton, Laingsburg Goldnerville, Langeberg McGregor, Bettys Bay), 5 straddling-code parcels (C0390005), 5 Laingsburg 2018-draft parcels, 5 OCR-corrupt rows (Bitou `GE 0000`). Each with expected disposition and why.

---

### Task 11: Validation report

**Files:** Modify `extract/match/evaluate.py` (`report()`), create `extract/match/reports/eval-<date>.md`, `extract/match/FAILURE-MODES.md`, `extract/match/README.md` (run instructions + runtimes), `extract/match/reports/review-queue-<date>.csv`.

- [ ] **Step 1:** metrics per municipality and overall for each of the three runs vs truth: verified-unique coverage, high-confidence precision, incorrect-link rate, candidate-list rate, abstention/unresolved, no-roll; macro and micro averages; Wilson 95% intervals (n=40 → ±13–15 pts, stated); deltas vs both baselines; every incorrect high-confidence link listed with its reason codes; every regression (baseline right → new wrong) listed.
- [ ] **Step 2:** calibration: precision per `confidence_tier` on the truth; if any tier's precision < 0.98 for `accepted_*`, tighten that rule and re-run (record the change and mark the fixture rows that motivated it as `dev_contaminated`; report the holdout separately).
- [ ] **Step 3:** review queue = `review` + `ambiguous` rows ordered by (rows affected by the same label, value at stake); export CSV.
- [ ] **Step 4:** README: `python3 run.py` (full), per-stage commands, runtimes measured on this laptop, what to do when a new roll/cadastre arrives.

---

### Task 12: Ship

- [ ] **Step 1:** `python3 extract/export_site.py` → `data/db/` chunks; upload to Supabase `valuations/v10/` (retry loop, range-verify one chunk); flip `configUrl` in `map.js` + `atlas.js`; bump `?v=`; commit + push; wait for Pages; live click-test the Stellenbosch erf, an Oudtshoorn Bridgton erf, a Beaufort West Hillside erf, a CoCT sectional building, an ambiguous CoCT erf 36; screenshot for the report.
- [ ] **Step 2:** copy `AUDIT.md`, `FAILURE-MODES.md`, the eval report into `docs/` of the website repo (git-tracked) and commit; update `handoff.md` + memory.
