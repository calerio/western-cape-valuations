# Design & performance refresh 2026-09 — Implementation Plan

> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved refresh of the Western Cape valuations site — an editorial Explore page fed by `explore.json`, one canonical map page with an in-place Map/Satellite switch and Afrikaans basemap labels, a result panel with text+glyph trust states, self-hosted civic typography, and a measurably lighter first load — without touching the linker, the DB builds or any disposition semantics.

**Architecture:** Static site (GitHub Pages) of vanilla ES modules; MapLibre GL 5 with the OpenFreeMap Liberty style fetched once and transformed by a pure function; d3 v7 for the Explore choropleth; sql.js-httpvfs search DB on Supabase (build `b-2b502178f94f`, immutable). New shared modules (`format.js`, `i18n.js`, `map/style.js`, `map/panel.js`, `evidence.js`, `explore-charts.js`) are pure or DOM-light and unit-tested with `node --test`; page behaviour is verified with Playwright (WebKit) scenario files.

**Tech Stack:** HTML/CSS/JS (ES2022 modules, no bundler), MapLibre GL 5.x (pinned), d3 7.x (pinned), sql.js-httpvfs 0.8.12, Node 24 `node --test`, Playwright (WebKit 26), Python 3 for the data-repo exports.

**Spec:** `docs/design-2026-09/03-design-plan.md` and `docs/design-2026-09/04-visual-direction.md` (wireframes `docs/design-2026-09/wireframes/index.html`; audit `00-audit.md`; invariants in `02-code-audit.md` §12).

## Global Constraints
- Work only in the worktree `~/projects/western-cape-valuations-design` (branch `design-2026-09`, served at `http://127.0.0.1:8766/`). Never edit `~/projects/western-cape-valuations` (production checkout) or push.
- Commits as the user only (repo rule). One commit per task.
- Browser automation only through Playwright (WebKit). Scenario files must live under `~/projects/western-cape-property-valuations/.playwright-mcp/scen/` to be runnable; keep the readable source in `tests/browser/`.
- Every new user-facing English string is an i18n key and gets an `af` entry in `data/i18n-af.json` `strings`. Slugs, hashes, SQL stay English.
- Preserve: `window._map`, `window._integrity` (`hasLinkTable`, `lookupLink`, `verifyBuild`, `linkDisabled`, `stats`), source id `parcels`, layer id `parcels-fill`, `#pbody`, `#maphint`, `plain.html?db=…`, `?nolink=1`, the EN substrings asserted by `extract/match/smoke_matrix.py` (`municipal market value`, `sectional-title units`, `possible match`, `Could not link`, `several entries fit`, `No valuation found`, `Verified link`, `unverified`, `Not in this data build`, `Looking up`), the Supabase `configUrl` literal in `map.js` and `atlas.js` (rollback regex), the `(map|atlas).js?v=N` script-tag pattern in `index.html`, `map.html`, `plain.html`, hash forms `#m/<slug>`, `#d/<slug>`, `#p/…`, `WSTATUS='C'`, attribution strings, six `--map-*` tokens on `[data-theme]` pins, `google4a9f7e6a1f57c0ea.html`, generated files never hand-edited.
- No new runtime dependency; vendor scripts pinned to exact versions with `integrity` + `crossorigin`.
- Status is never colour alone: badge = glyph + text; contrast ≥ 4.5:1.
- Matzikama address suppression (`ADDRESS_HIDDEN_MUNIS`) stays until the corrected build ships.
- Fonts: WOFF2 subsets only, latin + latin-ext, `font-display: swap`, total ≤ 120 KB, OFL licence files vendored.

## Review Focus
1. AF selected while a tile feature has no `name:af` → the label falls back to the original expression (never blank). Test: Task 5 `transformStyle` unit test "af-fallback".
2. Basemap switched while a valuation lookup is in flight → the panel still shows the selected parcel and the hatch/selection layer survives the switch. Test: Task 7 browser test `test-basemap-switch.js` (switch during "Looking up").
3. An old link `#p/tS…` without `b=`/`c=`/`s=` → parses to the page default basemap, no error. Test: Task 6 `parseMapHash` unit test "legacy-hash".
4. `explore.json` fails to load (404/timeout) → Explore still renders headline figures from `stats.json`, the data-driven sections hide, no console error. Test: Task 10 browser test `test-explore-degrade.js` (route abort).
5. Language switched with a panel open → the panel re-renders in the new language, selection and camera unchanged, no reload. Test: Task 8 browser test `test-lang-switch.js`.
6. `prefers-reduced-motion` → MapLibre `easeTo/fitBounds` durations are 0 and the Explore reveal is skipped. Test: Task 3 `motion.test.mjs`.

---

## File structure

Website repo (design worktree):
- `assets/tokens.css` — modify: `@font-face` (6 faces), rem type scale `--t-*`, spacing `--s-*`, status tokens `--st-*`, cadastral accent, dark block de-duplicated.
- `assets/fonts/` — create: `IBMPlexSans-{Regular,Medium,SemiBold}-{latin,latin-ext}.woff2`, `SourceSerif4-SemiBold-{latin,latin-ext}.woff2`, `SourceSerif4-Italic-{latin,latin-ext}.woff2`, `OFL-IBMPlexSans.txt`, `OFL-SourceSerif4.txt`.
- `assets/format.js` — create: one money/number formatter for both pages (`fmtR`, `fmtN`, `fmtPct`, `fmtM2`), EN/AF.
- `assets/i18n.js` — create: catalogue loader, `t/tf/tn`, `applyDom(root)`, `setLang(lang)` in place, `onLangChange(fn)`.
- `assets/motion.js` — create: `reducedMotion()`, `dur(ms)`.
- `assets/map/hash.js` — create: `parseMapHash(str)`, `buildMapHash(state)`.
- `assets/map/style.js` — create: `transformStyle(style, opts)`, `nameExpression(lang, overrides)`, `SAT_HIDDEN_LAYER_PREFIXES`, `poiDeclutter(layer)`.
- `assets/map/hatch.js` — create: `hatchImageData(size, gap, rgba)` → `{width,height,data}` for `map.addImage`.
- `assets/map/panel.js` — create: `renderState(el, state)`, `STATE_BADGES`, `renderDisclosure(...)`, list/detail renderers moved from map.js.
- `assets/evidence.js` — create: `explain(codes, lang)` from `data/evidence-codes.json`.
- `data/evidence-codes.json` — create: copy of the linker's evidence dictionary (26 codes, 7 decisions).
- `assets/map.css` — create: all map-page CSS (from the inline blocks of map.html/plain.html, re-tokenised).
- `assets/map.js` — modify: entry module; imports the map/* modules; basemap switch; in-place language; hash with `b/c/s`; parcel styling; keeps `_map`, `_integrity`, `DB_CONFIG_URL`.
- `map.html`, `plain.html` — rewrite as thin identical shells (only `data-basemap` default, title/meta/canonical/ld+json differ), keep `assets/map.js?v=N`.
- `assets/explore-charts.js` — create: pure SVG builders `shareBar`, `markerScale`, `logHistogram`, `stackedBar`, `dateDots`.
- `assets/atlas.js` — modify: province landing, `explore.json` sections, tooltip fix, cycle from provenance, `format.js`/`i18n.js`, lazy search DB, table sorting, disclosure.
- `index.html` — modify: rail + reading-column structure, new section containers, no inline styles; `assets/atlas.js?v=N` kept.
- `assets/explore.css` — create: Explore CSS extracted from index.html.
- `data/i18n-af.json` — modify: new strings.
- `tests/format.test.mjs`, `tests/i18n.test.mjs`, `tests/motion.test.mjs`, `tests/hash.test.mjs`, `tests/style.test.mjs`, `tests/hatch.test.mjs`, `tests/evidence.test.mjs`, `tests/charts.test.mjs`, `tests/fonts.test.mjs`, `tests/fixtures/liberty.json` (vendored copy of the style for tests only), `tests/check-i18n.mjs`.
- `tests/browser/test-basemap-switch.js`, `test-af-labels.js`, `test-lang-switch.js`, `test-panel-states.js`, `test-panel-errors.js`, `test-mobile-map.js`, `test-explore.js`, `test-explore-degrade.js`, `test-explore-mobile.js`, `perf-*.js` (same scenarios as the baseline).
- `templates/shell.html` — modify: fonts + tokens + sentence-case nav for the generated static pages.
- `DATA_CONTRACT.md` — modify: §14/§15 updated, new §16 "One map page", `explore.json` section (added with the export), §11 pre-warm timing note.

Data repo (`~/projects/western-cape-property-valuations`):
- `extract/geo/simplify_geo.py` — create: writes `data/geo/za-outline.geojson` (≤ 12 KB), simplified `wc-districts.geojson`, `wc-municipalities.geojson`, `wc-wards.geojson` (Douglas–Peucker via shapely, tolerance chosen by a size budget, topology preserved by simplifying shared boundaries with `shapely.simplify(preserve_topology=True)` per feature and a visual check).
- `extract/export_explore.py` — created by the export step (Task 0 dependency).
- `extract/export_pages.py` — modify only if `templates/shell.html` needs new placeholders; regenerate `m/`, `d/`, `af/`, `sitemap.xml` at the end.

---

### Task 0: Inputs from the parallel tracks (gate)

**Files:** none created here.

- [ ] **Step 1:** Confirm `data/explore.json` exists in the worktree (from the export step) and validate: `python3 -c "import json;d=json.load(open('data/explore.json'));print(d['version'],len(d['rolls']),list(d.keys()))"` → 25 rolls and the blocks `meta,rolls,pct,loghist,groups,land,conc,places,findings,dates,queries`.
- [ ] **Step 2:** Confirm the linker's `evidence-codes.json` has 26 codes and 7 decisions; copy it to `data/evidence-codes.json`.
- [ ] **Step 3:** Vendor the style for tests: `curl -s https://tiles.openfreemap.org/styles/liberty -o tests/fixtures/liberty.json` (43 KB; used ONLY by unit tests; the site still fetches the live style).
- [ ] **Step 4:** Commit: `git add data/evidence-codes.json tests/fixtures/liberty.json && git commit -m "Design refresh: test fixtures (Liberty style snapshot) and evidence dictionary"`.

---

### Task 1: Fonts — self-hosted subsets

**Files:**
- Create: `assets/fonts/*.woff2`, `assets/fonts/OFL-IBMPlexSans.txt`, `assets/fonts/OFL-SourceSerif4.txt`
- Modify: `assets/tokens.css` (top: `@font-face` block; `--font-ui`, `--font-display`)
- Test: `tests/fonts.test.mjs`

**Interfaces:**
- Produces: CSS families `"IBM Plex Sans"` (400/500/600) and `"Source Serif 4"` (600, italic 400); tokens `--font-ui: "IBM Plex Sans", system-ui, sans-serif;` `--font-display: "Source Serif 4", Georgia, serif;`

- [ ] **Step 1: Write the failing test**

```js
// tests/fonts.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const dir = new URL('../assets/fonts/', import.meta.url);
const NEEDED = ['IBMPlexSans-Regular-latin.woff2','IBMPlexSans-Regular-latin-ext.woff2','IBMPlexSans-Medium-latin.woff2','IBMPlexSans-Medium-latin-ext.woff2','IBMPlexSans-SemiBold-latin.woff2','IBMPlexSans-SemiBold-latin-ext.woff2','SourceSerif4-SemiBold-latin.woff2','SourceSerif4-SemiBold-latin-ext.woff2','SourceSerif4-Italic-latin.woff2','SourceSerif4-Italic-latin-ext.woff2','OFL-IBMPlexSans.txt','OFL-SourceSerif4.txt'];
test('font files exist, are woff2 and total ≤ 120 KB', () => {
  let total = 0;
  for (const f of NEEDED) {
    const p = new URL(f, dir); assert.ok(fs.existsSync(p), f + ' missing');
    if (f.endsWith('.woff2')) { const b = fs.readFileSync(p); assert.equal(b.subarray(0, 4).toString('latin1'), 'wOF2', f + ' not woff2'); total += b.length; }
  }
  assert.ok(total <= 120 * 1024, 'fonts total ' + total);
});
test('tokens.css declares the faces with swap and unicode ranges', () => {
  const css = fs.readFileSync(new URL('../assets/tokens.css', import.meta.url), 'utf8');
  assert.equal((css.match(/@font-face/g) || []).length, 10);
  assert.ok(/font-display:\s*swap/.test(css));
  assert.ok(/unicode-range:\s*U\+0100-024F/.test(css), 'latin-ext range for Afrikaans diacritics');
});
```

- [ ] **Step 2: Run** `node --test tests/fonts.test.mjs` → FAIL (files missing).
- [ ] **Step 3: Fetch the subsets.** Google Fonts serves per-script WOFF2 subsets when asked with a modern UA:

```bash
cd assets/fonts
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
curl -s -A "$UA" 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=Source+Serif+4:ital,wght@0,600;1,400&display=swap' -o /tmp/gf.css
# /tmp/gf.css lists @font-face blocks per subset; the comment before each block names it (/* latin */, /* latin-ext */).
python3 - <<'PY'
import re,urllib.request,os
css=open('/tmp/gf.css').read()
blocks=re.findall(r'/\* (\w[\w-]*) \*/\s*@font-face \{(.*?)\}',css,re.S)
names={('IBM Plex Sans','400','normal'):'IBMPlexSans-Regular',('IBM Plex Sans','500','normal'):'IBMPlexSans-Medium',('IBM Plex Sans','600','normal'):'IBMPlexSans-SemiBold',('Source Serif 4','600','normal'):'SourceSerif4-SemiBold',('Source Serif 4','400','italic'):'SourceSerif4-Italic'}
for subset,body in blocks:
    if subset not in ('latin','latin-ext'): continue
    fam=re.search(r"font-family: '([^']+)'",body).group(1); w=re.search(r'font-weight: (\d+)',body).group(1); st=re.search(r'font-style: (\w+)',body).group(1)
    url=re.search(r'url\((https://[^)]+\.woff2)\)',body).group(1); rng=re.search(r'unicode-range: ([^;]+);',body).group(1)
    out=f"{names[(fam,w,st)]}-{subset}.woff2"; urllib.request.urlretrieve(url,out); print(out,os.path.getsize(out),rng[:40])
PY
curl -sL https://raw.githubusercontent.com/IBM/plex/master/LICENSE.txt -o OFL-IBMPlexSans.txt
curl -sL https://raw.githubusercontent.com/adobe-fonts/source-serif/release/LICENSE.md -o OFL-SourceSerif4.txt
```

- [ ] **Step 4: Declare the faces** at the top of `assets/tokens.css` (ten blocks; example for one):

```css
@font-face{font-family:"IBM Plex Sans";font-style:normal;font-weight:400;font-display:swap;
  src:url("fonts/IBMPlexSans-Regular-latin.woff2") format("woff2");
  unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:"IBM Plex Sans";font-style:normal;font-weight:400;font-display:swap;
  src:url("fonts/IBMPlexSans-Regular-latin-ext.woff2") format("woff2");
  unicode-range:U+0100-02AF,U+0304,U+0308,U+0329,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF}
```
(use the exact `unicode-range` values printed in Step 3 for each subset). Then set `--font-ui:"IBM Plex Sans",system-ui,-apple-system,sans-serif;` and add `--font-display:"Source Serif 4",Georgia,"Times New Roman",serif;`. Keep `--font-map` (system) for SVG map labels.
- [ ] **Step 5: Run** `node --test tests/fonts.test.mjs` → PASS. Remove the Google Fonts `<link>` tags (3 pages + `templates/shell.html`) and the `preconnect` to `fonts.googleapis.com`/`fonts.gstatic.com`.
- [ ] **Step 6: Commit** `git add assets/fonts assets/tokens.css index.html map.html plain.html templates/shell.html tests/fonts.test.mjs && git commit -m "Fonts: self-hosted IBM Plex Sans + Source Serif 4 subsets (latin, latin-ext), swap, OFL"`.

---

### Task 2: Tokens — scale, status, accent, dark block

**Files:**
- Modify: `assets/tokens.css`
- Test: `tests/tokens.test.mjs`

**Interfaces (produces):** `--t-11 --t-12 --t-13 --t-14 --t-16 --t-20 --t-26 --t-34` (rem), `--s-1..--s-7` = 4,8,12,16,24,32,48 px, `--st-ok-ink --st-ok-bg --st-warn-ink --st-warn-bg --st-neutral-ink --st-neutral-bg --st-none-ink --st-none-bg --st-bad-ink --st-bad-bg`, `--accent:#1f4e8c`, `--paper:#fbfaf7`, `--paper-2:#f3f2ee`, `--rule:#d9d6cf`; existing tokens keep their names (`--bg`, `--ink`, `--ramp-*`, `--map-*`).

- [ ] **Step 1: Failing test**

```js
// tests/tokens.test.mjs
import { test } from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
const css = fs.readFileSync(new URL('../assets/tokens.css', import.meta.url), 'utf8');
test('scale, spacing, status and accent tokens exist once in :root', () => {
  for (const t of ['--t-11','--t-12','--t-13','--t-14','--t-16','--t-20','--t-26','--t-34','--s-1','--s-4','--s-7','--st-ok-ink','--st-warn-ink','--st-neutral-ink','--st-none-ink','--st-bad-ink','--paper','--rule'])
    assert.ok(new RegExp(`${t}\\s*:`).test(css), t);
  assert.ok(/--accent:\s*#1f4e8c/i.test(css));
  assert.equal((css.match(/--t-16:\s*1rem/g) || []).length, 1);
});
test('dark theme is declared once (no duplicated block)', () => {
  const darkDecls = css.match(/--bg:\s*#[0-9a-f]{3,6}/gi) || [];
  assert.ok(darkDecls.length <= 2, 'light + dark only, found ' + darkDecls.length);
});
```

- [ ] **Step 2: Run** `node --test tests/tokens.test.mjs` → FAIL.
- [ ] **Step 3: Implement.** In `:root` add the scale (`--t-11:.6875rem;--t-12:.75rem;--t-13:.8125rem;--t-14:.875rem;--t-16:1rem;--t-20:1.25rem;--t-26:1.625rem;--t-34:2.125rem;`), spacing (`--s-1:4px;--s-2:8px;--s-3:12px;--s-4:16px;--s-5:24px;--s-6:32px;--s-7:48px;`), surfaces (`--paper:#fbfaf7;--paper-2:#f3f2ee;--rule:#d9d6cf;`), status pairs (`--st-ok-ink:#1f6b3a;--st-ok-bg:#e6f2ea;--st-warn-ink:#8a5a00;--st-warn-bg:#f7efdc;--st-neutral-ink:#5c6570;--st-neutral-bg:#eceef1;--st-none-ink:#6b6f76;--st-none-bg:#f0f0f2;--st-bad-ink:#a12a2a;--st-bad-bg:#f8e6e6;`), `--accent:#1f4e8c`. Move the dark declarations into ONE `@media (prefers-color-scheme:dark)` block plus a shared selector list `:root:not([data-theme="light"]),:root[data-theme="dark"]` using CSS nesting-free duplication of the selector, not of the declarations (write the dark block once under `@media`, and for the explicit pin use `:root[data-theme="dark"]{…}` containing only the six `--map-*` tokens, as today). Dark status inks: `--st-ok-ink:#6fcf97;--st-warn-ink:#e3b341;--st-neutral-ink:#aab2bd;--st-none-ink:#9aa0a6;--st-bad-ink:#f28b82;` with tints at 18% alpha. Remove `--warn`.
- [ ] **Step 4: Run** the test → PASS. Open `http://127.0.0.1:8766/index.html` and `map.html` in WebKit (Playwright) to confirm nothing is visually broken by the accent change (screenshot to `.playwright-mcp/perf/tokens-check.png`).
- [ ] **Step 5: Commit** `git add assets/tokens.css tests/tokens.test.mjs && git commit -m "Tokens: rem type scale, spacing, status pairs, cadastral accent, single dark block"`.

---

### Task 3: Shared `format.js`, `i18n.js`, `motion.js`

**Files:**
- Create: `assets/format.js`, `assets/i18n.js`, `assets/motion.js`
- Test: `tests/format.test.mjs`, `tests/i18n.test.mjs`, `tests/motion.test.mjs`

**Interfaces (produces):**
```js
// format.js
export function fmtR(value, lang = 'en', opts = {}) // → 'R850 000' | 'R1,25 m' (af) | 'R2.66 tn' ; opts.short=true → 'R850 k'
export function fmtN(n, lang = 'en')               // grouped with thin spaces, af decimal comma
export function fmtPct(x, lang = 'en', digits = 1) // 0.647 → '64.7%' / '64,7%'
export function fmtM2(n, lang = 'en')              // 358 → '358 m²'
// i18n.js
export const I18N = { lang: 'en', strings: {}, names: {}, blocks: {} };
export async function loadCatalog(lang, url = 'data/i18n-af.json')  // idempotent; en = identity
export function t(s), tf(s, vars), tn(name)
export function applyDom(root = document)          // [data-i18n], [data-i18n-ph], [data-i18n-aria]; EN restores the key text
export async function setLang(lang)                // stores localStorage wcv-lang, loads, applies, sets <html lang>, notifies listeners; NO reload
export function onLangChange(fn)                   // fn(lang)
export function currentLang()
// motion.js
export function reducedMotion()                    // matchMedia('(prefers-reduced-motion: reduce)').matches (false outside a browser)
export function dur(ms)                            // 0 when reduced, else ms
```

- [ ] **Step 1: Failing tests**

```js
// tests/format.test.mjs
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { fmtR, fmtN, fmtPct, fmtM2 } from '../assets/format.js';
test('rand formatting matches the panel convention in EN', () => {
  assert.equal(fmtR(850000), 'R850 000');
  assert.equal(fmtR(1250000), 'R1.25 m');
  assert.equal(fmtR(2660416645748), 'R2.66 tn');
  assert.equal(fmtR(38400000), 'R38.4 m');
  assert.equal(fmtR(null), '—');
});
test('Afrikaans uses the decimal comma and number words', () => {
  assert.equal(fmtR(1250000, 'af'), 'R1,25 mn.');
  assert.equal(fmtR(2660416645748, 'af'), 'R2,66 bilj.');
  assert.equal(fmtR(17640000000, 'af'), 'R17,64 mjd.');
});
test('short form for tiles', () => { assert.equal(fmtR(915000, 'en', { short: true }), 'R915 k'); assert.equal(fmtR(915000, 'af', { short: true }), 'R915 k'); });
test('numbers, percentages, m²', () => {
  assert.equal(fmtN(1459474), '1 459 474'); assert.equal(fmtPct(0.647), '64.7%'); assert.equal(fmtPct(0.647, 'af'), '64,7%'); assert.equal(fmtM2(358), '358 m²');
});
```
```js
// tests/i18n.test.mjs  (runs in Node with a tiny DOM shim)
import { test } from 'node:test'; import assert from 'node:assert/strict';
globalThis.localStorage = { _s: {}, getItem(k) { return this._s[k] ?? null; }, setItem(k, v) { this._s[k] = String(v); } };
globalThis.document = { documentElement: { lang: 'en' }, querySelectorAll: () => [] };
const { I18N, loadCatalog, t, tf, setLang, onLangChange, currentLang } = await import('../assets/i18n.js');
test('t() is identity in EN and looks up AF; tf interpolates', async () => {
  await loadCatalog('af', null, { strings: { 'Ward {n}': 'Wyk {n}', 'No valuation found': 'Geen waardasie gevind nie' }, names: { 'Western Cape': 'Wes-Kaap' } });
  I18N.lang = 'en'; assert.equal(t('No valuation found'), 'No valuation found');
  I18N.lang = 'af'; assert.equal(t('No valuation found'), 'Geen waardasie gevind nie'); assert.equal(tf('Ward {n}', { n: 8 }), 'Wyk 8');
});
test('setLang notifies listeners and persists without reload', async () => {
  let seen = null; onLangChange(l => { seen = l; });
  await setLang('en'); assert.equal(seen, 'en'); assert.equal(localStorage.getItem('wcv-lang'), 'en'); assert.equal(currentLang(), 'en');
});
```
```js
// tests/motion.test.mjs
import { test } from 'node:test'; import assert from 'node:assert/strict';
const { dur, reducedMotion } = await import('../assets/motion.js');
test('dur is 0 under reduced motion, else the value', () => {
  globalThis.matchMedia = () => ({ matches: true }); assert.equal(reducedMotion(), true); assert.equal(dur(900), 0);
  globalThis.matchMedia = () => ({ matches: false }); assert.equal(dur(900), 900);
});
```

- [ ] **Step 2: Run** `node --test tests/format.test.mjs tests/i18n.test.mjs tests/motion.test.mjs` → FAIL (modules missing).
- [ ] **Step 3: Implement `format.js`** (port of `atlas.js` `R()` words + `map.js` spacing rule; one place):

```js
const WORDS = { en: { k: ' k', m: ' m', bn: ' bn', tn: ' tn' }, af: { k: ' k', m: ' mn.', bn: ' mjd.', tn: ' bilj.' } };
const dec = (s, lang) => lang === 'af' ? s.replace('.', ',') : s;
export function fmtN(n, lang = 'en') { if (n == null || Number.isNaN(+n)) return '—'; return dec(Number(n).toLocaleString('en-ZA').replace(/,/g, ' '), lang); }
export function fmtR(v, lang = 'en', opts = {}) {
  if (v == null || Number.isNaN(+v)) return '—';
  const w = WORDS[lang] || WORDS.en, a = Math.abs(v), sign = v < 0 ? '-' : '';
  const f = (x, d) => dec(x.toFixed(d).replace(/\.?0+$/, m => m.includes('.') ? '' : m), lang);
  if (a >= 1e12) return `${sign}R${f(a / 1e12, 2)}${w.tn}`;
  if (a >= 1e9) return `${sign}R${f(a / 1e9, 2)}${w.bn}`;
  if (a >= 1e6) return `${sign}R${f(a / 1e6, 2)}${w.m}`;
  if (opts.short && a >= 1e3) return `${sign}R${f(a / 1e3, 0)}${w.k}`;
  return `${sign}R${fmtN(Math.round(a), lang)}`;
}
export function fmtPct(x, lang = 'en', digits = 1) { return x == null ? '—' : dec((x * 100).toFixed(digits), lang) + '%'; }
export function fmtM2(n, lang = 'en') { return n == null ? '—' : `${fmtN(Math.round(n), lang)} m²`; }
```
(`f()` must print `R1.25 m`, `R38.4 m`, `R2.66 tn`, `R17.64 mjd.`; trailing zeros trimmed: 38.40 → 38.4, 2.00 → 2.)

- [ ] **Step 4: Implement `i18n.js`** — module-level `I18N`; `loadCatalog(lang, url, preloaded)` fetches the JSON once (or takes `preloaded` for tests), keeps it cached; `applyDom(root)` walks `[data-i18n]` (textContent = t(key)), `[data-i18n-ph]` (placeholder + aria-label), `[data-i18n-aria]`; in EN the key is the text so switching back restores English; `setLang` writes `localStorage`, sets `document.documentElement.lang`, calls `applyDom`, then every `onLangChange` listener. Export `currentLang()`; read the initial language exactly as today (`wcv-lang`, then `navigator.language` startsWith 'af').
- [ ] **Step 5: Implement `motion.js`** (4 lines as in the interface).
- [ ] **Step 6: Run** the three tests → PASS. Commit `git add assets/format.js assets/i18n.js assets/motion.js tests/format.test.mjs tests/i18n.test.mjs tests/motion.test.mjs && git commit -m "Shared modules: format (EN/AF money), i18n (in-place switch), motion (reduced-motion durations)"`.

---

### Task 4: Map hash — `parseMapHash` / `buildMapHash`

**Files:**
- Create: `assets/map/hash.js`
- Test: `tests/hash.test.mjs`

**Interfaces (produces):**
```js
export function parseMapHash(hash, defaults = { b: 'map' })
// '#p/tSTELLENBOSCH&b=sat&c=18.861,-33.9366,17&s=W024C067002200001942000000'
// → { place: 'tSTELLENBOSCH', b: 'sat', c: { lng: 18.861, lat: -33.9366, z: 17 }, s: 'W024C0672…' }
export function buildMapHash(state)   // inverse; omits undefined parts; legacy '#p/<place>' stays first
```
Legacy `#p/<place>` (no `&`) → `{ place, b: defaults.b }`. `#m/<slug>` (from Explore) → `{ muni: slug, b }`.

- [ ] **Step 1: Failing test**

```js
// tests/hash.test.mjs
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { parseMapHash, buildMapHash } from '../assets/map/hash.js';
test('legacy place hash keeps working', () => { assert.deepEqual(parseMapHash('#p/tSTELLENBOSCH'), { place: 'tSTELLENBOSCH', b: 'map' }); });
test('full hash round-trips', () => {
  const s = { place: 'tSTELLENBOSCH', b: 'sat', c: { lng: 18.861, lat: -33.9366, z: 17 }, s: 'W024C067002200001942000000' };
  assert.equal(buildMapHash(s), '#p/tSTELLENBOSCH&b=sat&c=18.861,-33.9366,17&s=W024C067002200001942000000');
  assert.deepEqual(parseMapHash(buildMapHash(s)), s);
});
test('municipality hash from Explore and defaults', () => {
  assert.deepEqual(parseMapHash('#m/mossel-bay', { b: 'sat' }), { muni: 'mossel-bay', b: 'sat' });
  assert.deepEqual(parseMapHash('', { b: 'map' }), { b: 'map' });
  assert.deepEqual(parseMapHash('#p/x&b=nonsense'), { place: 'x', b: 'map' });
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (split on `&`, first token `p/…` or `m/…`, then `k=v` pairs; `b` ∈ {map, sat} else default; `c` = three floats; `s` = a PRCL_KEY `[A-Z0-9]+`). **Step 4: Run** → PASS. **Step 5: Commit** `git add assets/map/hash.js tests/hash.test.mjs && git commit -m "Map hash: basemap, camera and selection in the URL, legacy forms preserved"`.

---

### Task 5: Style module — `transformStyle`

**Files:**
- Create: `assets/map/style.js`
- Test: `tests/style.test.mjs` (uses `tests/fixtures/liberty.json`)

**Interfaces (produces):**
```js
export const ESRI_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
export const ESRI_ATTRIB = 'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community';
export function nameExpression(original, lang, overrides = [])
// overrides: [{ id: 302117011, cls: 'town', current: ['Robert Sobukwe Town'], en: 'Graaff-Reinet', af: 'Graaff-Reinet' }]
// → ['case', ['all', ['==', ['id'], 302117011], ['==', ['get','class'], 'town'], ['in', ['get','name'], ['literal', [...current]]]], '<en|af>', …, langExpr]
// langExpr (af) = ['coalesce', ['get','name:af'], original]; (en) = original
export function transformStyle(style, { lang = 'en', basemap = 'map', overrides = [] } = {})
// returns a NEW style object: esri source+layer added after 'background' (layout.visibility by basemap),
// text-field rewritten on every symbol layer whose text-field mentions "name", poi declutter applied,
// satellite: layers whose id starts with one of SAT_HIDDEN_LAYER_PREFIXES get visibility 'none'; symbol layers get halo paint for sat
export const SAT_HIDDEN_LAYER_PREFIXES = ['landcover', 'landuse', 'park', 'water', 'building', 'aeroway', 'highway', 'road', 'railway', 'bridge', 'tunnel', 'ferry', 'ne2_shaded', 'boundary_3'];
export function applyBasemap(map, basemap)   // toggles visibility + halo paint on an existing map (no setStyle)
export function applyLanguage(map, lang, overrides) // setLayoutProperty text-field on the symbol layers
export const LABEL_LAYER_IDS = (style) => style.layers.filter(l => l.type === 'symbol' && JSON.stringify(l.layout?.['text-field'] || '').includes('name')).map(l => l.id);
```

- [ ] **Step 1: Failing tests**

```js
// tests/style.test.mjs
import { test } from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
import { transformStyle, nameExpression, LABEL_LAYER_IDS, SAT_HIDDEN_LAYER_PREFIXES } from '../assets/map/style.js';
const liberty = JSON.parse(fs.readFileSync(new URL('./fixtures/liberty.json', import.meta.url), 'utf8'));
const GR = { id: 302117011, cls: 'town', current: ['Robert Sobukwe Town', 'Robert Sobukwe'], en: 'Graaff-Reinet', af: 'Graaff-Reinet' };
test('every name-bearing symbol layer is rewritten; others untouched', () => {
  const out = transformStyle(liberty, { lang: 'af' });
  const ids = LABEL_LAYER_IDS(liberty); assert.equal(ids.length, 23);
  for (const l of out.layers) if (ids.includes(l.id)) { assert.equal(l.layout['text-field'][0], 'case'); assert.ok(JSON.stringify(l.layout['text-field']).includes('"name:af"')); }
  const shield = out.layers.find(l => l.id === 'highway-shield-non-us'); assert.deepEqual(shield.layout['text-field'], ['to-string', ['get', 'ref']]);
  assert.notEqual(out, liberty);
});
test('af-fallback: the AF expression falls back to the original when name:af is absent', () => {
  const orig = ['coalesce', ['get', 'name_en'], ['get', 'name']];
  const e = nameExpression(orig, 'af'); assert.deepEqual(e, ['coalesce', ['get', 'name:af'], orig]);
  assert.deepEqual(nameExpression(orig, 'en'), orig);
});
test('override is keyed on id + class + current name, never a global replace', () => {
  const e = nameExpression(['get', 'name'], 'en', [GR]);
  assert.equal(e[0], 'case'); assert.deepEqual(e[1], ['all', ['==', ['id'], 302117011], ['==', ['get', 'class'], 'town'], ['in', ['get', 'name'], ['literal', GR.current]]]); assert.equal(e[2], 'Graaff-Reinet');
});
test('satellite: esri raster after background, fills hidden, symbols keep a dark halo', () => {
  const out = transformStyle(liberty, { basemap: 'sat' });
  assert.equal(out.layers[1].id, 'esri-world-imagery'); assert.equal(out.layers[1].layout.visibility, 'visible');
  assert.equal(out.layers.find(l => l.id === 'landcover_grass').layout.visibility, 'none');
  const town = out.layers.find(l => l.id === 'label_town'); assert.equal(town.layout.visibility ?? 'visible', 'visible'); assert.equal(town.paint['text-halo-color'], '#0f1418');
  const map = transformStyle(liberty, { basemap: 'map' }); assert.equal(map.layers[1].layout.visibility, 'none');
});
test('poi declutter: parking hidden, poi_r20 from z18', () => {
  const out = transformStyle(liberty, {}); const r20 = out.layers.find(l => l.id === 'poi_r20'); assert.equal(r20.minzoom, 18);
  assert.ok(JSON.stringify(out.layers.find(l => l.id === 'poi_r7').filter).includes('parking'));
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** `style.js`: deep-clone with `structuredClone`; insert `{ id:'esri-world-imagery', type:'raster', source:'esri', layout:{visibility: basemap==='sat'?'visible':'none'} }` after the `background` layer and `sources.esri = { type:'raster', tiles:[ESRI_TILES], tileSize:256, maxzoom:19, attribution: ESRI_ATTRIB }`; for symbol layers with a name text-field set `layout['text-field'] = nameExpression(original, lang, overrides)`; for sat, hide layers whose id starts with any prefix and set on symbol layers `paint['text-halo-color']='#0f1418'`, `paint['text-halo-width']=1.4`, `paint['text-color']='#ffffff'` (store the originals in `layer.metadata.wcv_paint` so `applyBasemap` can restore them); poi declutter: `poi_r20.minzoom = 18`, and add `['!=', ['get','class'], 'parking']` to the filters of `poi_r7`, `poi_r20` (wrap an existing filter with `['all', existing, …]`). `applyBasemap(map, b)` mirrors these with `setLayoutProperty`/`setPaintProperty`; `applyLanguage` re-sets `text-field` per label layer (needs the original expressions: keep them in `layer.metadata.wcv_name_expr` at transform time).
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `git add assets/map/style.js tests/style.test.mjs && git commit -m "Map style: pure transform (AF labels with fallback, keyed overrides, satellite layer sets, POI declutter)"`.

---

### Task 6: Hatch pattern and parcel styling

**Files:**
- Create: `assets/map/hatch.js`
- Test: `tests/hatch.test.mjs`
- Modify: `assets/map.js` (parcel layers section, `:263-275` today)

**Interfaces:** `export function hatchImageData(size = 12, gap = 4, rgba = [31,78,140,255], density = 'dense'|'sparse')` → `{ width, height, data: Uint8ClampedArray }`; `map.addImage('hatch-dense', img, { pixelRatio: 2 })`.

- [ ] **Step 1: Failing test**
```js
// tests/hatch.test.mjs
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { hatchImageData } from '../assets/map/hatch.js';
test('hatch tile is square RGBA with a 45° stroke and transparent gaps', () => {
  const im = hatchImageData(12, 4, [31, 78, 140, 255], 'dense');
  assert.equal(im.width, 12); assert.equal(im.height, 12); assert.equal(im.data.length, 12 * 12 * 4);
  const px = (x, y) => im.data[(y * 12 + x) * 4 + 3];
  assert.equal(px(0, 0), 255); assert.equal(px(11, 11), 255);   // on the diagonal
  assert.equal(px(0, 6), 0);                                      // off the stroke (gap)
  const sparse = hatchImageData(12, 4, [31, 78, 140, 255], 'sparse');
  assert.ok(sparse.data.filter((v, i) => i % 4 === 3 && v > 0).length < im.data.filter((v, i) => i % 4 === 3 && v > 0).length);
});
```
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** with a pure loop (no canvas): a pixel is on the stroke when `((x - y) mod period) < 2` (dense period = gap + 2, sparse period = 2 × that); wrap-around keeps the tile seamless.
- [ ] **Step 4:** In `map.js` add three layers after `parcels-fill`: `parcels-sel-hatch` (fill, `fill-pattern` by feature-state is not supported, so use a filter on the selected id: `setFilter('parcels-sel-hatch', ['==', ['id'], selId])`, `fill-pattern` = `['case', ['boolean', ['feature-state','verified'], false], 'hatch-dense', 'hatch-sparse']`), `parcels-sel-line` (line, `line-dasharray` by state: solid for verified, `[2,2]` possible/several, `[1,2]` none), and keep `parcels-line` pale (`--map-outline` at 0.6 alpha, width 0.8). `pickParcel` sets `map.setFeatureState(..., { sel: true, verified: false })` immediately and `panel.js` updates `verified` when the decision is known (Task 8).
- [ ] **Step 5: Run** unit test → PASS; visual check in WebKit (Playwright) (click Stellenbosch erf 1942 → sparse hatch + dashed; Drakenstein erf 97 → dense hatch + solid); screenshot `.playwright-mcp/perf/hatch-check.png`. **Step 6: Commit** `git add assets/map/hatch.js tests/hatch.test.mjs assets/map.js && git commit -m "Map: hatched selected erf with status-driven pattern and outline"`.

---

### Task 7: One map page — shells, `map.css`, basemap switch, camera/selection in URL

**Files:**
- Create: `assets/map.css`; `tests/browser/test-basemap-switch.js`
- Modify: `map.html`, `plain.html` (thin shells), `assets/map.js` (boot, switch, hash), `DATA_CONTRACT.md` §15/§16

**Interfaces:** `map.js` exposes (module-internal) `setBasemap(b)` → `applyBasemap(window._map, b)` + hash update + chip state; `window._integrity` unchanged; the switcher markup: `<div class="viewseg" id="viewsegWrap"><a href="index.html" data-i18n="Explore">Explore</a><button type="button" data-basemap="map" aria-pressed="true" data-i18n="Map">Map</button><button type="button" data-basemap="sat" aria-pressed="false" data-i18n="Satellite">Satellite</button></div>` plus `<div class="langseg"><button data-lang="en" aria-pressed="true">EN</button><button data-lang="af">AF</button></div>`.

- [ ] **Step 1: Write the browser test** (source in `tests/browser/test-basemap-switch.js`; copy to the data repo's `.playwright-mcp/scen/` folder to run):
```js
async (page) => {
  const BASE = 'http://127.0.0.1:8766/', DB = 'https://nxeasppmwvzcqbbgrdvf.supabase.co/storage/v1/object/public/valuations/b-2b502178f94f/config.json';
  const ctx = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage();
  const reqs = []; p.on('request', r => reqs.push(r.url()));
  await p.goto(BASE + 'plain.html?db=' + encodeURIComponent(DB) + '#p/tSTELLENBOSCH&c=18.861,-33.9366,17', { waitUntil: 'load' });
  await p.waitForFunction(() => window._map && window._map.isStyleLoaded()); await p.waitForTimeout(1500);
  const out = {};
  out.esriBefore = reqs.filter(u => u.includes('World_Imagery')).length;                 // must be 0 in map mode
  await p.waitForFunction(() => window._map.queryRenderedFeatures({ layers: ['parcels-fill'] }).length > 0, null, { timeout: 30000 });
  await p.evaluate(() => { const m = window._map; const pp = m.project([18.861, -33.9366]); m.fire('click', { point: pp, lngLat: m.unproject(pp), originalEvent: {} }); });
  await p.click('button[data-basemap="sat"]');                                          // switch WHILE looking up
  await p.waitForTimeout(2500);
  out.instances = await p.evaluate(() => document.querySelectorAll('.maplibregl-canvas').length);   // 1
  out.satVisible = await p.evaluate(() => window._map.getLayoutProperty('esri-world-imagery', 'visibility'));
  out.hash = await p.evaluate(() => location.hash);
  out.center = await p.evaluate(() => window._map.getCenter().toArray().map(v => +v.toFixed(3)));
  out.panel = (await p.evaluate(() => document.getElementById('pbody').innerText)).replace(/\s+/g, ' ').slice(0, 80);
  out.selKept = await p.evaluate(() => !!window._map.getFilter('parcels-sel-hatch'));
  out.esriAfter = reqs.filter(u => u.includes('World_Imagery')).length;                 // > 0 only after the switch
  await p.click('button[data-basemap="map"]'); await p.waitForTimeout(800);
  out.backVisible = await p.evaluate(() => window._map.getLayoutProperty('esri-world-imagery', 'visibility'));
  out.verdict = (out.esriBefore === 0 && out.instances === 1 && out.satVisible === 'visible' && /b=sat/.test(out.hash) && out.center[0] === 18.861 && /Erf 1942/.test(out.panel) && out.selKept && out.esriAfter > 0 && out.backVisible === 'none') ? 'PASS' : 'FAIL';
  await ctx.close(); return out;
}
```
- [ ] **Step 2: Run** it in WebKit (Playwright) → FAIL (buttons don't exist yet).
- [ ] **Step 3: Implement.** (a) Move every inline CSS rule of `map.html` into `assets/map.css`, re-tokenised (`--t-*`, `--s-*`, `--font-ui`, `--paper`), panel opaque (`background: var(--bg)`, no `backdrop-filter` when `(max-width: 640px)` or `[data-basemap="sat"]`), attribution as `#attribBtn` (ⓘ) toggling `#attrib` popover, chip row `#chips` with `Wards`, `Labels`, `Ward labels`. (b) Rewrite `map.html` and `plain.html` as identical shells: `<body data-basemap="sat">` (map.html) / `"map"` (plain.html), `<link rel="stylesheet" href="assets/tokens.css?v=5"><link rel="stylesheet" href="assets/map.css?v=1">`, the switcher above, `#map`, `#ppanel`/`#pbody`/`#pclose`, `#maphint`, `#mapfail`, `<script type="module" src="assets/map.js?v=36">`; MapLibre `<script defer src="https://cdn.jsdelivr.net/npm/maplibre-gl@5.x.y/dist/maplibre-gl.js" integrity="sha384-…" crossorigin="anonymous">` (compute the hash with `curl -s <url> | openssl dgst -sha384 -binary | openssl base64 -A`; boot waits for `window.maplibregl` via `DOMContentLoaded`). (c) In `map.js`: `const MODE0 = parseMapHash(location.hash, { b: document.body.dataset.basemap }).b`; fetch the Liberty JSON once (`fetch(PLAIN_STYLE).then(r => r.json())`, on failure show `#mapfail` with the existing string), `style = transformStyle(json, { lang: currentLang(), basemap: MODE0, overrides: [] })`, `new maplibregl.Map({ style, … })`; `setBasemap(b)` → `applyBasemap(map, b)`, `document.body.dataset.basemap = b`, chip `aria-pressed`, `replaceState(buildMapHash({...state, b}))`; on `moveend` write `c=` (debounced 300 ms) and on selection write `s=`; on load, if `s=` present, fetch parcels for the camera and select that key once loaded; `#p/` place and `#m/` muni behaviour unchanged (place search fits bounds). Remove the satellite-specific inline style object and the `MODE` constant branches. (d) DATA_CONTRACT: §15 now says plain.html and map.html are the same page with different defaults; new §16 documents `transformStyle`, `applyBasemap`, hash `b/c/s`.
- [ ] **Step 4: Run** the browser test → PASS; run `node --test tests/` → PASS; run the P0 tests `test-race.js`, `test-failopen.js` → PASS. **Step 5: Commit** `git add map.html plain.html assets/map.css assets/map.js DATA_CONTRACT.md tests/browser/test-basemap-switch.js && git commit -m "One map page: in-place Map/Satellite switch, camera and selection in the URL, map.css, thin shells"`.

---

### Task 8: In-place language switch (UI + basemap labels)

**Files:**
- Modify: `assets/map.js` (use `i18n.js`; `onLangChange` → `applyLanguage(map, lang)`, re-render the open panel from `lastRender`), `assets/atlas.js` (use `i18n.js`; `onLangChange` → `navigate(statePath, false)`)
- Create: `tests/browser/test-lang-switch.js`, `tests/browser/test-af-labels.js`

- [ ] **Step 1: Browser tests.** `test-af-labels.js`: load `plain.html#p/tMOSSEL BAY&c=22.13,-34.18,11`, click `button[data-lang="af"]`, wait 1 s, assert no navigation happened (`performance.getEntriesByType('navigation').length === 1` and a `window.__marker = 1` set before the click still exists), assert `document.documentElement.lang === 'af'`, assert `getLayoutProperty('label_town','text-field')` JSON contains `"name:af"`, and that `queryRenderedFeatures({layers:['label_town']})` contains a feature whose `properties['name:af'] === 'Mosselbaai'`; then jump to `[24.53,-32.25]` z9 and assert a rendered `label_town` feature with `properties.name === 'Robert Sobukwe Town'` still exists (the override is NOT applied until the registry is approved — this test pins that). Switch back to EN and assert the expression no longer contains `name:af`. `test-lang-switch.js`: select Stellenbosch erf 1942 (as in Task 7), switch to AF, assert `#pbody` contains `Slaan waardasie na` never (no reload), contains the AF sub-line `moontlike passing` within 1 s, `window.__marker` survives, camera unchanged; switch to EN, assert `possible match`.
- [ ] **Step 2: Run** → FAIL (reload happens today). **Step 3: Implement:** replace the page-local `t/tf/tn/initI18n/wireLangToggle` in both files with imports from `i18n.js`; `map.js` keeps `lastRender = { fn, args }` in `panel.js` (Task 9 adds it; here store the `showValuation` props+token and re-call `renderFromCache()`), toggles call `setLang(lang)`; `atlas.js` re-runs `navigate(statePath, false)` and `applyDom`. Keep the `<html lang>` and `<title>` translation. Delete `location.reload()` calls.
- [ ] **Step 4: Run** both browser tests + unit tests → PASS. **Step 5: Commit** `git add assets/map.js assets/atlas.js tests/browser/test-lang-switch.js tests/browser/test-af-labels.js && git commit -m "Language switch in place on both pages; Afrikaans basemap labels with fallback"`.

---

### Task 9: Result panel — states, badges, evidence disclosure

**Files:**
- Create: `assets/map/panel.js`, `assets/evidence.js`, `tests/evidence.test.mjs`, `tests/browser/test-panel-states.js`, `tests/browser/test-panel-errors.js`
- Modify: `assets/map.js` (move `renderDetail/renderList/renderUnverified/renderSchemeList/renderSchemeChooser/renderSchemeSum/rejectedNote/maybeInjectChooser/renderParcelChooser` into `panel.js`; `showValuation` calls `panel.render(state)`), `data/i18n-af.json` (badge labels, disclosure strings)

**Interfaces (produces):**
```js
// evidence.js
export async function loadEvidence(url = 'data/evidence-codes.json')
export function explain(reasonsCsv, lang)   // 'TOWN_A,CONTRA_GROUPS:3,AREA_OK' → [{ code, text }] (unknown codes → { code, text: null })
export function decisionSummary(decision, lang)
// panel.js
export const STATE_BADGES = {
  accepted_high: { glyph: '✓', label: 'Verified', tone: 'ok' },
  accepted_group: { glyph: '✓', label: 'Verified property group · sectional scheme', tone: 'ok' },
  review: { glyph: '?', label: 'Possible match', tone: 'warn' },
  ambiguous: { glyph: '≡', label: 'Several entries fit', tone: 'neutral' },
  not_in_roll: { glyph: '⊘', label: 'No valuation found', tone: 'none' },
  abstain: { glyph: '⚠', label: 'Could not link', tone: 'warn' },
  missing: { glyph: '⊘', label: 'Not in this data build', tone: 'none' },
  unavailable: { glyph: '⚠', label: 'Valuation data unavailable', tone: 'bad' },
  integrity: { glyph: '⚠', label: 'Data build could not be verified', tone: 'bad' },
  loading: { glyph: '…', label: 'Looking up valuation…', tone: 'neutral' },
};
export function badgeHtml(state)                 // <span class="badge badge-ok"><span aria-hidden="true">✓</span> Verified</span>
export function renderState(el, model)           // model = { state, props, link?, rows?, cands?, sum?, note?, why?: reasonsCsv, overlap?: parcelCands }
export function renderDisclosure(reasonsCsv, decision)  // <details class="why"><summary>Why this result?</summary><p>…plain…</p><code>TOWN_A · …</code></details>
export function lastRender()                     // { model } for re-render on language change
```
Badge label strings are i18n keys (AF: `Geverifieer`, `Geverifieerde eiendomsgroep · deeltitelskema`, `Moontlike passing`, `Verskeie inskrywings pas`, `Geen waardasie gevind nie`, `Kon nie koppel nie`, `Nie in hierdie datastel nie`, `Waardasiedata nie beskikbaar nie`, `Datastel kon nie geverifieer word nie`, `Slaan waardasie na…`). The verbatim smoke substrings stay in the heading/sub exactly as today.

- [ ] **Step 1: Unit test**
```js
// tests/evidence.test.mjs
import { test } from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
const dict = JSON.parse(fs.readFileSync(new URL('../data/evidence-codes.json', import.meta.url), 'utf8'));
const { loadEvidence, explain, decisionSummary } = await import('../assets/evidence.js');
await loadEvidence(null, dict);
test('every code has EN and AF text; parameterised codes interpolate', () => {
  for (const [c, v] of Object.entries(dict.codes)) { assert.ok(v.en && v.af, c); }
  const r = explain('TOWN_A,CONTRA_GROUPS:3,AREA_OK', 'en'); assert.equal(r.length, 3); assert.ok(r[1].text.includes('3'));
  assert.equal(explain('NOPE_CODE', 'af')[0].text, null);
  for (const d of ['accepted_high','accepted_group','review','ambiguous','not_in_roll','abstain','missing']) assert.ok(decisionSummary(d, 'af'));
});
```
- [ ] **Step 2: Browser test `test-panel-states.js`:** for each fixture parcel (from `extract/match/reports/smoke-final-b-2b502178f94f/smoke.json`, one per decision: use the first `ok` case per decision), jump/load/click and assert: badge text per `STATE_BADGES`, the smoke substrings from `EXPECT`, a `<details class="why">` whose `<summary>` reads "Why this result?" and, when opened, a `<code>` containing the raw codes and a `<p>` without underscores; for `accepted_group` the sum line only when the fixture's `complete` flag is 1 (read `window._integrity.lookupLink(key)`); `#ppanel` has `role="dialog"` and the status line `aria-live="polite"`; Escape closes and focus returns to `#map`. `test-panel-errors.js`: (a) route-abort the config → "Valuation data unavailable" badge; (b) route the manifest to return `{build_id:"bogus"}` → "Data build could not be verified" badge and `Not in this data build`; (c) loading state: assert the "…" badge appears within 100 ms of the click.
- [ ] **Step 3: Run** → FAIL. **Step 4: Implement** `panel.js` by moving the existing renderers verbatim first (behaviour-preserving), then: prepend `badgeHtml(state)`; replace the raw `Evidence: …` line with `renderDisclosure`; render `renderUnverified` kicker/title once (B5 fix); grammar `1 valuation` via `tf('{n} valuations')` → `tf(n === 1 ? 'Erf {erf} — 1 valuation' : 'Erf {erf} — {n} valuations')` (add the AF entry `Erf {erf} — 1 waardasie`); `role="dialog" aria-labelledby="pTitle"`; `#pstatus[aria-live="polite"]` receives the badge label; `openPanel()` focuses `#pclose`; `closePanel()` returns focus to `#map`; Escape handler; `setFeatureState({verified: state==='accepted_high'||state==='accepted_group'})`. Note `map.js:589` sets `missing`. Keep `maybeInjectChooser` single-insertion (idempotent by id `#overlapBar`).
- [ ] **Step 5: Run** the unit + both browser tests + `test-race.js` + `test-failopen.js` → PASS. **Step 6: Commit** `git add assets/map/panel.js assets/evidence.js assets/map.js data/i18n-af.json tests/evidence.test.mjs tests/browser/test-panel-states.js tests/browser/test-panel-errors.js && git commit -m "Result panel: text+glyph status badges, plain-language why with raw codes, dialog semantics"`.

---

### Task 10: Explore — charts module, `explore.json` sections, province landing

**Files:**
- Create: `assets/explore-charts.js`, `assets/explore.css`, `tests/charts.test.mjs`, `tests/browser/test-explore.js`, `tests/browser/test-explore-degrade.js`
- Modify: `index.html`, `assets/atlas.js`, `data/i18n-af.json`

**Interfaces (produces):** all builders return an SVG string, take plain data and `{ width, lang }`, no d3:
```js
export function shareBar(share, { width = 120 })                       // 0–1 → <svg role="img" aria-label="64.7%">…</svg>
export function markerScale(value, { min, max, width = 140, lang })     // median marker on a log scale shared by all rows
export function logHistogram(bins, { p10, p50, p90, q1, q3, width = 820, height = 140, lang }) // bins: [{lo,hi,n}]
export function stackedBar(groups, { width = 820, lang })               // [{key,n,value}] → one bar + <ul> legend
export function dateDots(rolls, { from = 2018, to = 2026, width = 820, lang }) // [{name, slug, valued_as_at}]
export function scaleLog(min, max, width)                                // helper, exported for tests
```
`atlas.js` gains `loadExplore()` (fetch `data/explore.json?v=…`, `null` on failure), `renderSections(scope)` writing `#secValue`, `#secSpread`, `#secMix`, `#secDates`, `#secFindings`, each with `<h2>`, one `<p class="lede">`, the chart, `<details class="how"><summary>How this is computed</summary><pre>` + `explore.queries[id]`. Level 0 removed: `navigate([wcCrumb()])` when there is no hash; the SA outline draws from `data/geo/za-outline.geojson` (Task 12) as a 120×90 locator with `aria-hidden`.

- [ ] **Step 1: Unit test**
```js
// tests/charts.test.mjs
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { shareBar, markerScale, logHistogram, stackedBar, dateDots, scaleLog } from '../assets/explore-charts.js';
test('shareBar and markerScale are labelled SVG with no external refs', () => {
  const s = shareBar(0.647, { width: 120 }); assert.ok(s.startsWith('<svg')); assert.ok(s.includes('aria-label="64.7%"')); assert.ok(s.includes('width="77.6"'));
  const m = markerScale(915000, { min: 42000, max: 26500000, width: 140, lang: 'en' }); assert.ok(/aria-label="R915 000"/.test(m)); assert.ok(!/http/.test(m));
});
test('log scale maps min→0 and max→width', () => { const f = scaleLog(1e4, 1e8, 400); assert.equal(f(1e4), 0); assert.equal(f(1e8), 400); assert.equal(Math.round(f(1e6)), 200); });
test('histogram draws one rect per bin and three percentile lines', () => {
  const bins = Array.from({ length: 22 }, (_, i) => ({ lo: 1e4 * 10 ** (i / 4), hi: 1e4 * 10 ** ((i + 1) / 4), n: i + 1 }));
  const h = logHistogram(bins, { p10: 2e5, p50: 9e5, p90: 4e6, q1: 3e5, q3: 2e6, width: 820, height: 140, lang: 'en' });
  assert.equal((h.match(/<rect class="bin"/g) || []).length, 22); assert.equal((h.match(/<line class="pct"/g) || []).length, 3); assert.ok(h.includes('class="band"'));
});
test('stackedBar keeps group order and dateDots one dot per roll', () => {
  const sb = stackedBar([{ key: 'residential', n: 10, value: 5 }, { key: 'vacant', n: 2, value: 1 }], { width: 820, lang: 'en' }); assert.ok(sb.indexOf('residential') < sb.indexOf('vacant'));
  const dd = dateDots([{ name: 'Hessequa', slug: 'hessequa', valued_as_at: '2020-07-01' }, { name: 'Kannaland', slug: 'kannaland', valued_as_at: '2025-09-01' }, { name: 'Laingsburg', slug: 'laingsburg', valued_as_at: null }], { width: 820, lang: 'en' });
  assert.equal((dd.match(/<circle/g) || []).length, 2); assert.ok(dd.includes('Laingsburg'));
});
```
- [ ] **Step 2: Browser tests.** `test-explore.js` (desktop 1440): load `index.html`, assert `#loading` hidden ≤ 2 s, `#statTotal` text non-empty WITHOUT any click, `#secValue table tbody tr` count ≥ 8 and the header button sorts (`click th[data-sort="median"]` → first row changes), `#secSpread svg rect.bin` = 22, `#secDates circle` ≥ 20, `details.how` opens and shows `SELECT`, the province → municipality drill via `#m/stellenbosch` renders the same sections with towns, mousemove over a municipality shows `#tip` with text (B3 fixed), the property dialog shows the municipality's cycle (not "2024 / 25") for `#m/witzenberg`; assert no console errors; `document.fonts.check('16px "IBM Plex Sans"')` true after load. `test-explore-degrade.js`: route-abort `explore.json` → headline figures still present, `#secSpread` hidden, no console error.
- [ ] **Step 3: Run** → FAIL. **Step 4: Implement** `explore-charts.js` (pure string builders; numbers formatted with `format.js`; `role="img"` + `aria-label`; the histogram band = `q1..q3` as a translucent rect, three percentile lines with `<text>` labels), `explore.css` (rail/reading-column grid `grid-template-columns: 460px minmax(0, 72ch)`; ledger table: `border-top: 1px solid var(--rule)` rows, `font-variant-numeric: tabular-nums`, right-aligned figures; sentence-case headings `font: 600 var(--t-26)/1.15 var(--font-ui)`; findings `p` in `var(--font-display)`; the reveal animation gated by `dur()`), rewrite `index.html` sections (no inline styles; ids listed above; keep `#loading`, `#statTotal/#statMedian/#statAvg/#statParcels`, `#map`, `#search`, `#results`, `#panel`, `#viewsegWrap`, `#siteFooter` with the `m/index.html` link), `atlas.js` (province landing, `loadExplore`, `renderSections`, table sort by `data-sort` columns, tooltip fix `const tipEl = $("tip")`, cycle label from `stats` provenance instead of `YEAR`, `format.js` for all money, `i18n.js`, DB pre-warm moved to `requestIdleCallback(ensureDB, { timeout: 4000 })` + on search focus).
- [ ] **Step 5: Run** unit + browser tests → PASS. **Step 6: Commit** `git add assets/explore-charts.js assets/explore.css assets/atlas.js index.html data/i18n-af.json tests/charts.test.mjs tests/browser/test-explore.js tests/browser/test-explore-degrade.js && git commit -m "Explore: province landing, editorial sections from explore.json, ledger table, inline SVG charts"`.

---

### Task 11: Mobile — Explore stacking and the map bottom sheet

**Files:**
- Modify: `assets/explore.css`, `assets/map.css`, `assets/map.js` (sheet peek/expand, pan selection into the upper half), `index.html` (compact bar + menu)
- Create: `tests/browser/test-explore-mobile.js`, `tests/browser/test-mobile-map.js`

- [ ] **Step 1: Browser tests** (mobile context 390×844, DPR 3, touch): Explore: no horizontal overflow (`document.documentElement.scrollWidth === 390`), the brand text is not truncated (`#brandTitle.scrollWidth <= clientWidth`), `#statTotal` visible without scrolling ≤ 1 screen, sections render as `details` cards with the first two open, the menu button opens the view switcher. Map: controls' bounding boxes cover ≤ 25% of the viewport height before a click; after clicking the fixture parcel the sheet `#ppanel` has `data-sheet="peek"` with badge + address + value visible, `#attribBtn` bottom is above the sheet top, the selected parcel centroid projects into the upper half (`y < 422`), dragging/`click #pgrab` expands (`data-sheet="open"`), swipe-down closes, no overflow.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** with CSS (`@media (max-width: 640px)`): Explore single column, `#viewsegWrap` inside `#menu` (a `<details>`), compact sticky bar; map sheet: `#ppanel { position: fixed; inset: auto 0 0 0; max-height: 40vh }` for peek, `85vh` when `data-sheet="open"`, `#pgrab` handle button (`aria-label="Expand"`), touch handlers (`touchstart/touchmove/touchend` deltas > 40 px), `map.panTo` so the selected feature's centroid lands at 30% height (`dur(300)`), `#attribBtn` positioned `bottom: calc(var(--sheet-h) + 12px)`.
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `git add assets/explore.css assets/map.css assets/map.js index.html tests/browser/test-explore-mobile.js tests/browser/test-mobile-map.js && git commit -m "Mobile: stacked Explore with compact bar; map bottom sheet with peek and expanded states"`.

---

### Task 12: Performance — deferred scripts, idle pre-warm, simplified geo, lazy imagery

**Files:**
- Create (data repo): `extract/geo/simplify_geo.py`; outputs `data/geo/za-outline.geojson`, `data/geo/wc-districts.geojson`, `data/geo/wc-municipalities.geojson`, `data/geo/wc-wards.geojson` in the worktree
- Modify: `index.html` (`defer` + SRI on d3 pinned `7.9.0`, drop `za-provinces.geojson`), `assets/atlas.js` (idle pre-warm), `assets/map.js` (idle pre-warm after `map.once('idle')`; parcel refetch skips when the new viewport is inside the last fetched bbox), `DATA_CONTRACT.md` §11 (timing note), `tests/browser/perf-*.js` (copies of the baseline scenario sources with BASE = 8766)

- [ ] **Step 1: Write `simplify_geo.py`** (shapely `simplify(tolerance, preserve_topology=True)` per feature; choose the largest tolerance from `[0.0005, 0.001, 0.002, 0.004]` that keeps each output under its budget: outline 12 KB, districts 60 KB, munis 90 KB, wards 120 KB; coordinates rounded to 4 dp; a `--check` mode prints per-file sizes and vertex counts). Run it; verify visually in WebKit (Playwright) that the Explore choropleth has no slivers or gaps (screenshot).
- [ ] **Step 2: Deferred loading.** `<script defer src="https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js" integrity="sha384-…" crossorigin="anonymous">`; `atlas.js` waits for `DOMContentLoaded`; the DB pre-warm becomes `const idle = window.requestIdleCallback || (f => setTimeout(f, 1500)); idle(() => ensureDB().catch(() => {}), { timeout: 4000 })` and also on `#search` focus; in `map.js` the same after `map.once('idle')`. Keep `ensureDB`'s warm-up queries (DATA_CONTRACT §11) unchanged.
- [ ] **Step 3: Measure** with the same nine baseline scenarios (sources under `tests/browser/perf-*.js`, BASE `http://127.0.0.1:8766/`), cold contexts, and write `docs/design-2026-09/05-perf-after.md` with a before/after table (transferred KB, requests, load, usable, FCP, parcels interactive, click→panel, basemap switch ms, language switch ms). Targets from the spec §8 must be met or the shortfall explained.
- [ ] **Step 4: Commit** (data repo: `git add extract/geo/simplify_geo.py && git commit -m "Geo: simplified GeoJSON export for the site"`; worktree: `git add data/geo index.html assets/atlas.js assets/map.js DATA_CONTRACT.md tests/browser/perf-*.js docs/design-2026-09/05-perf-after.md && git commit -m "Performance: deferred vendor scripts with SRI, idle DB pre-warm, simplified GeoJSON, lazy imagery; before/after report"`).

---

### Task 13: Static pages, templates, i18n completeness, screenshots, delivery report

**Files:**
- Modify: `templates/shell.html` (fonts/tokens, sentence-case nav, `viewseg` from one CSS file), regenerate `m/`, `d/`, `af/`, `sitemap.xml` with `extract/export_pages.py`
- Create: `tests/check-i18n.mjs` (fails if any `t('…')`/`tf('…')`/`data-i18n` literal in `assets/*.js`, `assets/map/*.js`, `index.html`, `map.html`, `plain.html`, `templates/*.html` lacks an `af` entry), `docs/design-2026-09/06-delivery.md`

- [ ] **Step 1:** Write `tests/check-i18n.mjs` (regex-extract keys, compare with `data/i18n-af.json` strings/names; print missing; exit 1). Run → fix any missing entries → PASS.
- [ ] **Step 2:** Update `templates/shell.html`; run `python3 extract/export_pages.py --site ~/projects/western-cape-valuations-design` (check its CLI first); verify `af/m/mossel-bay.html` renders with the new fonts in WebKit (Playwright).
- [ ] **Step 3:** Screenshots via one Playwright scenario: `index.html`, `plain.html#p/tSTELLENBOSCH&c=18.861,-33.9366,17&s=…`, `map.html…&b=sat`, each at 1440×900 and 390×844, EN and AF → `docs/design-2026-09/screenshots/*.png` (12 files, PNG ≤ 400 KB each).
- [ ] **Step 4:** Run everything: `node --test tests/`, every `tests/browser/*.js` in WebKit (Playwright), the P0 tests, and the smoke matrix against `http://127.0.0.1:8766` (`python3 extract/match/smoke_matrix.py --site http://127.0.0.1:8766 --db <prod config> --out reports/smoke-design-2026-09 --private`).
- [ ] **Step 5:** Write `06-delivery.md`: rationale, file/change summary (`git diff --stat main...design-2026-09`), before/after perf, browser results (WebKit automated; Chrome/Firefox opened for manual check via `open -a "Google Chrome" http://127.0.0.1:8766/` and `open -a Firefox …` — clicked through by hand), smoke results, known limitations (AF label coverage from tiles: towns ≈ 90%, suburbs ≈ 30%, streets/POIs ≈ 0%; registry pending), exact deployment (`git checkout main && git merge --no-ff design-2026-09 && git push`) and rollback (`git revert -m 1 <merge-sha> && git push`; DB untouched).
- [ ] **Step 6: Commit.** Deploy only after sign-off.

---

### Task 14 (separate plan, after registry approval): renamed-places overrides
Not part of this plan's execution. When `data/geo/renamed-places/registry.v1.json` is approved: load it once in `map.js`, build `overrides` for `transformStyle`/`applyLanguage` (id + class + current names, en/af), add former names as aliases in place search with the official name in the result detail line, add the attribution note "The map shows selected established place names" (EN/AF), and extend `test-af-labels.js` with one representative entry per province in both languages and both basemaps at z7–z12 (no duplicate labels, no other feature renamed).
