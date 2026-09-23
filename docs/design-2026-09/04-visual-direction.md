# Visual direction (frontend-design pass, 2026-09-23)

Subject: the municipal valuation roll (a ruled ledger of erven, extents and rand amounts) and the
Surveyor-General's cadastral plans (ink line-work, the subject erf hatched). Audience: ratepayers, buyers,
journalists, officials, in English and Afrikaans, mostly on phones. Primary job: answer "what is this property's
official value, and can I trust that answer?" in one glance; second job: let people understand the province's
values without reading a report.

## Tokens
Colour (light; dark mode derives each):
- `--paper #fbfaf7` surface (barely warm, not cream), `--paper-2 #f3f2ee` reading column, `--ink #1b1d22`,
  `--rule #d9d6cf` ledger rules, `--cadastral #1f4e8c` (accent, links, selection ink; replaces the generic
  #0071e3 while keeping the blue ramp `--ramp-1…5` for the choropleth),
- status inks, each paired with a glyph and a light tint: verified `#1f6b3a`, possible `#8a5a00`,
  several/neutral `#5c6570`, none `#6b6f76`, error `#a12a2a`.
Type:
- IBM Plex Sans 400/500/600, latin + latin-ext, `font-variant-numeric: tabular-nums` everywhere a number sits in
  a column. Roles: all UI, headings (600, sentence case, tight tracking at 26–34 px), figures.
- Source Serif 4 (one weight, 600, plus italic 400) only for the editorial voice: finding sentences, the
  province lede, the "how this is computed" notes. Serif line-height 1.5, sans 1.4; line length ≤ 72 characters.
- Scale (rem, base 16): 0.6875 / 0.75 / 0.8125 / 0.875 / 1 / 1.25 / 1.625 / 2.125. Spacing: 4 / 8 / 12 / 16 /
  24 / 32 / 48 px tokens.
Layout: left-aligned throughout; Explore = a 460 px orientation rail + a 68–72-character reading column; the
map is full-bleed with a 380 px panel; on phones one column, the sheet from the bottom. Radius: 6 px controls,
10 px panel, 0 on rules and charts.

## The one memorable thing: the hatched erf
The selected parcel is drawn the way an SG diagram marks the subject property: a 45° hatch inside a solid ink
outline. Status changes the drawing, never just the colour: verified = solid outline + dense hatch; possible /
several = dashed outline + sparse hatch; no valuation / could not link = dotted outline, no hatch. The same hatch
motif returns as the province's "no data" fill and as the tiny status glyph in the panel badge. Everything else
on the map stays quiet: pale parcel lines, labels with a soft halo, ward labels off by default.

## Layout concept (Explore, desktop)
```
┌ bar: Western Cape municipal valuations | search ▭ | Explore Map Satellite | EN AF ┐
│ rail (sticky, 460)                │ reading column (≤ 72 ch)                       │
│ Western Cape                      │ Where the value sits                            │
│ 25 municipalities, 1 459 474      │ (ruled ledger table: name, properties, value ▮, │
│ valued properties                 │  median ┃ marker, date)                         │
│ R2,66 tn  R915 k  2020–2025       │ How values are spread  (histogram strip)        │
│ [Find my property] [Open the map] │ What the roll contains (one bar)                │
│ SA locator / WC choropleth        │ When each municipality valued (date dots)       │
│ coverage strip                    │ Findings — serif sentences with "query" links   │
└───────────────────────────────────┴─────────────────────────────────────────────────┘
```
The table is the hero of the column: ruled like a roll page, figures right-aligned and tabular, the share bar
and the median marker drawn inside the row. No cards around sections; rules and spacing carry the structure.

## Copy and chrome rules
Sentence case everywhere; no tracked-out capitals as eyebrow labels (section kickers are dropped; each section
has one heading and one plain sentence). No middle-dot meta strings: "Mbekweni, Drakenstein, ward 8" reads as a
sentence. No arrows appended to buttons; buttons say what happens ("Find my property", "Open the map"). Figures
in Afrikaans use the comma decimal and the site's number words. Errors say what happened and what to do.

## Motion
One reveal on Explore first paint (rail then column, 6 px, 60 ms stagger); the panel slides 160 ms; the hatch
appears with a 120 ms opacity ramp; everything answers an action. `prefers-reduced-motion` zeroes all of it,
including MapLibre easing.

## Self-review against generic defaults
- Cream paper + serif display + warm accent (the common AI default) → **changed**: the surface is near-white
  with a cool-neutral cast, the serif is confined to the editorial voice, and the accent is a cadastral blue
  tied to the existing ramp, not terracotta.
- Broadsheet hairlines everywhere → **kept only** in the ledger table and chart axes, where rules encode rows;
  panels keep their radius; no zero-radius chrome.
- Card kit with identical shadows → **removed**: Explore sections have no cards; the map panel is the single
  elevated surface.
- ALL-CAPS eyebrows, middle-dot strings, "→" on links, monospace data labels → **removed** from the wireframe
  vocabulary (the wireframes used them only as low-fi annotation).
- "Big number + small label + stats" hero → **replaced**: the rail's figures are set as a ledger line under a
  plain sentence; the choropleth and the ledger table carry the first impression.
- Numbered section markers → not used; the only numbers are ranks in the comparison table.
