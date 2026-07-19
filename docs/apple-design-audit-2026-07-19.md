# Apple Design Audit — Western Cape Property Valuation Atlas

Scope: Atlas SPA (`index.html` + `assets/atlas.js`), Satellite + plain Map views
(`map.html`, `plain.html`, `assets/map.js`, `assets/places.js`), generated static pages
(`templates/*` → `m/ d/ guide/ af/**`), `404.html`, `assets/tokens.css`, all user-facing
EN strings (+ `data/i18n-af.json` key integrity). Platform: web.
Method: `apple-design` skill checklist (HIG foundations + components + Apple Style Guide),
with deterministic evidence — WCAG contrast computed for every ink/surface token pair in
both themes, and rendered hit-areas measured in a real browser. Findings below are marked
**Fixed** (applied same day) or **Deferred** (listed at the end).

## Summary

The site's bones are genuinely good: a real semantic token system with correct light/dark
values, one accent used with discipline, honest empty/loading states, and (in the newest
code, `places.js`) a fully accessible combobox. The two systemic gaps were **secondary-text
contrast** (the `--label2`/`--label3` grays failed WCAG AA in light mode everywhere they
were used) and **keyboard reachability** (most custom clickable `<div>`s — Atlas search
results, breadcrumbs, drill-down rows, parcel pickers, the ward toggle — were mouse-only).
Both are now fixed. A third, smaller theme: hard-coded dark-theme blues leaking onto
light-theme pages (hover tints, focus rings) — replaced with accent-tracking `color-mix()`.

## Blockers — all Fixed

1. **`--label2` failed 4.5:1 body-text contrast in light mode** (3.33–3.44:1) on every
   light surface — used by every kicker, table header, and secondary label site-wide.
   Fix: `tokens.css` light `--label2` α .6 → **.75** (now 4.92–5.16:1; dark already passed).
2. **`--label3` failed contrast everywhere** (1.72–2.48:1) and carried real reading text
   (`.pNote`, the 11px disclaimer on the map valuation panel). Fix: `.pNote` moved to
   `--label2`; `--label3` raised to α .45 and documented **decoration/disabled only**.
3. **Keyboard-unreachable controls** (mouse-only clickable divs): Atlas search dropdown
   (now a full ARIA combobox with Arrow/Enter/Escape, `role="option"` rows,
   `aria-activedescendant` — ported from `places.js`), breadcrumbs, ranked drill-down rows,
   `#wardchip` (tabindex + Enter/Space), every `.pPick` parcel/scheme picker row and
   `.pLink` action (new `wireAct()` helpers in both JS files), and the mobile sheet handle
   `#grab` (tabindex + Enter/Space toggle).
4. **`#placeClear` 20×20px** — below even the WCAG 24px floor. Fix: invisible `::after`
   expands the hit area to 44×44 (same treatment added to `#pclose`).
5. **Placeholder-only labels on the Atlas search inputs** (`#search`, `#msearch`) — no
   accessible name. Fix: `aria-label`s added (matching `#placeSearch`, which was correct).

## Major — Fixed

- **Wrong-theme hard-coded blues**: `rgba(10,132,255,…)` (dark accent) in `plain.html`'s
  hover tints and `index.html`'s focus rings — visibly the wrong blue on light-pinned
  pages. Fix: `color-mix(in srgb, var(--accent) N%, transparent)` everywhere.
- **No visible focus style on most controls; none at all on map pages.** Fix: global
  `:focus-visible { outline: 2px solid var(--accent) }` in `tokens.css` (+ mirrored in
  the generated-page shell); custom rings (e.g. `#search`) still win by specificity.
- **Combobox ARIA on the wrong element** (map search: role on the wrapper div, focus on
  the input). Fix: `role="combobox"`/`aria-expanded`/`aria-haspopup` moved onto the input.
- **Status text not announced**: `#maphint`, `#results`/`#mresults`, `#tlBody` now carry
  `role="status"`/`aria-live="polite"`.
- **Modal focus management**: top-list and property dialogs now move focus in on open,
  trap Tab, and restore focus on close. `#tlSeg` buttons are real `role="tab"` +
  `aria-selected`.
- **Sub-44px targets**: view-switcher links 31→~37px desktop / ~42px phones (padding),
  `#tlClose`/`#pdClose` 40→44px, `#resetBtn` min-height 44, MapLibre zoom buttons 29→44
  via CSS override, search platter now focuses the input from anywhere on the platter.
- **Type floor**: 20 sub-11px sizes (9–10.5px kickers, table headers, chips) raised
  to 11px across `index.html`, `atlas.js`, `templates/shell.html`.
- **Body reading size**: generated pages 15px → 16px (`templates/shell.html`).
- **Stale/incorrect empty-state copy**: the Atlas "no aggregated data" note still claimed
  Cape Town can't be aggregated (untrue since 2026-07-16) — replaced with a generic
  honest string.
- **Writing sweep** (Apple Style Guide): straight → curly apostrophes in 10 user-facing
  strings (JS + `export_pages.py` + `404.html`); "please try again" → "try again";
  "Could not load the atlas data" now names the next step; `⚠` glyphs removed from two
  alert strings; ALL-CAPS legend strings re-sourced as sentence case (CSS still
  uppercases); "Click an erf…" → "Tap or click an erf…" (touch devices); serial comma in
  the truncated district list (", and more"). **Every changed EN string's key was renamed
  in `data/i18n-af.json` in the same commit** (16 keys, af values preserved).
- **`prefers-reduced-motion` missing on generated pages** — block added to the shell.

## Minor — noted, mostly Deferred

- **Accent/`--ok` tint on non-interactive eyebrow labels** (7+ kickers) — deliberate
  brand styling; per the skill's own rule the brand wins, but flagged: tinted text that
  isn't tappable invites mis-taps. *Deferred (user call).*
- **Three font weights (400/600/800) per view** vs the HIG's two. *Deferred — the 800
  numerals are a deliberate Flighty-style choice recorded in the design specs.*
- **Off-grid spacing** (~56 odd-value paddings/gaps: 5/9/11/13px) and **one-off corner
  radii** (~35 literal radii alongside the 4 tokens). *Deferred — pure cosmetics, high
  churn, zero user impact; snap opportunistically when touching those rules.*
- **Un-tokenized repeated chip shadow** (5 copies of `0 1px 4px rgba(0,0,0,.18)`) and
  **heavy dark-mode shadows** (HIG prefers lighter surfaces over bigger shadows).
  *Deferred.*
- **950ms map fly-to / 500ms layer crossfade** exceed the 150–350ms guide — treated as a
  deliberate "camera move" exception (Apple Maps does the same). *Accepted, documented here.*
- **No `rem`-based sizing anywhere** — browser font-scaling preference has no effect.
  A real accessibility gap but a structural refactor across every file. *Deferred as the
  one big follow-up; new code should prefer `rem`.*
- Title case for buttons (Apple-platform convention) was **considered and rejected**: the
  site consistently uses sentence case, which matches Apple's own web style; consistency
  rule satisfied.
- `render_coct_page()` in `export_pages.py` contains outdated PAIA-era strings but is
  retired dead code (not rendered since 2026-07-16) — left untouched; delete when convenient.

## What's already right

Semantic light/dark token system with per-page theme pins; single accent with genuine
discipline (data colors kept separate); honest, layout-stable loading/empty states
everywhere; `tabular-nums` on every figure; 64ch prose measure on generated pages;
`prefers-reduced-motion` on all three SPA pages; correct `aria-current` navigation;
`type="search"` inputs; real `<button>`s with `aria-label` for icon-only closes; the
`places.js` combobox and the `hiCard`/`.rollprov` patterns were already model accessible
custom controls; no exclamation marks, no raw error codes, no inclusive-language issues;
consistent →/↗ link semantics; correct trademark casing throughout.

## Verification

`contrast_check` script re-run after fixes: every text-carrying pair ≥ 4.5:1 in both
themes (`--label3` remains sub-AA by design — decoration only, no text uses it).
Hit-areas re-measured in-browser; flows re-tested (Atlas drill + search by keyboard,
map search fly-to + highlight, parcel click → valuation, AF toggle, mobile 390px).
