# Task 4 — renderPolitics() in the Atlas panel

## Status
Implemented and verified (no live browser extension/webkit available, so verification done via
curl + node syntax check + node-executed logic trace against real exported data).

## Files changed
- `index.html` — added `<div class="dsec" id="secPolitics">…<div id="secPoliticsBody"></div></div>`
  immediately after `id="secAuthorities"` (with comment); bumped `atlas.js?v=23` → `atlas.js?v=24`.
- `assets/atlas.js` —
  - Added `PARTY_COLOURS` const + `partyColour` helper near the top-level consts (after `slugOf`),
    with a comment noting it must stay in sync with `extract/politics.py PARTY_COLOURS`.
  - Added `renderPolitics(scope);` call right after `renderAuthorities(scope);` (in the panel
    render function, ~line 593→594).
  - Added `renderPolitics(s)` function immediately after `renderAuthorities` (~line 810), verbatim
    from the plan.

## Name-key used for the muni link
Traced how the panel's `scope` object is built: `renderPanel` sets `scope = muniStat(m)` where
`muniStat(n)` looks up `STATS.districts[d].municipalities[n]` — i.e. `scope` IS the muni node
object from `data/stats.json` (the same object `renderAuthorities` reads `s.authorities` from).
That node has its own `"name"` field (confirmed via `python3 -c "json.load(...)"` on
`data/stats.json`, e.g. `municipalities['Stellenbosch']['name'] == 'Stellenbosch'`). So the plan's
`s.name` is correct as-is — used unchanged for `slugOf(muni)`.

## Verification
- `node --input-type=module --check < assets/atlas.js` → exit 0 (valid JS syntax).
- `curl -s http://localhost:8765/index.html | grep -o 'atlas.js?v=[0-9]*\|secPolitics'` →
  `secPolitics` (x2, container div id), `atlas.js?v=24`.
- No Chrome extension connected (`mcp__claude-in-chrome`) and no webkit browser installed for
  Playwright MCP (`Browser "webkit" is not installed`), so a live visual check in the Atlas page
  itself wasn't possible in this session. Instead, ran a Node script against the actual
  `data/stats.json` exercising the exact logic `renderPolitics` uses:
  - `data.districts["Cape Winelands"].municipalities["Stellenbosch"].politics` exists and
    `(p.election || p.governing || p.seats)` is truthy → section would be shown.
  - `p.mayor` = `{name: 'Jeremy Fasser', party: 'DA', title: 'Executive Mayor'}` → governance line
    renders "Jeremy Fasser".
  - `p.seats` = DA 27/60.1%, ANC 10/18.4%, EFF 4/5.2% → seat bar + legend would render with
    `partyColour('DA')` = `#0071e3` etc.
  - `slugOf('Stellenbosch')` → `"stellenbosch"` → link `m/stellenbosch.html`, matching the actual
    static page filename.
  - District scope check: `data.districts["Cape Winelands"]` has **no** `politics` key at all
    (districts never get one — Task 3 only attaches it to muni nodes), so `p` is `undefined` and
    `showSec("secPolitics", false)` hides the section when the panel is on a district — matches
    the plan's "drill to a district and confirm the section is ABSENT" requirement.
- Recommend a manual spot-check in an actual browser next session (or once claude-in-chrome /
  playwright webkit is available) to visually confirm layout/no-horizontal-scroll, per the plan's
  Step 4 note.

## Commit
Committed `index.html` and `assets/atlas.js` only (left `CLAUDE.md`/`README.md` untouched per
instructions), authored as the user, no AI attribution. See parent report for commit hash.
