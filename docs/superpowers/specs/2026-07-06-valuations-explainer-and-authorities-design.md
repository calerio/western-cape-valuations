# Design: valuations explainer + per-municipality authorities/role-players

Date: 2026-07-06 · Status: approved (brainstorming), pending spec review

## Goal

Add two things to the Western Cape Property Valuation Atlas:

1. **A plain-language explainer** of *how municipal valuations are determined and
   what they represent* — as a dedicated canonical page **and** a short inline
   summary + link on each municipality page and the Atlas click-panel.
2. **A per-municipality "who sets & governs these values" block** — the Municipal
   (General) Valuer plus the relevant authorities/role-players — shown on both the
   static municipality page and the Atlas click-panel. Most-complete set of
   role-players, but laid out so the directly-relevant parties stand out.

Both must obey the DATA CONTRACT: every field is optional and the UI degrades
gracefully (missing data → the row/section simply doesn't render).

Out of scope: sales/transfer data (explicitly not wanted); owner names (never
published — POPIA; see `legal/`).

## Two repos, one pipeline (context)

- **Data repo** `~/projects/western-cape-property-valuations` (not git): the
  municipality folders, `SOURCE.md` files, raw roll files, and `extract/*` build
  scripts. `extract/export_site.py` (`SITE = ~/projects/western-cape-valuations`)
  builds the JSON + calls `extract/export_pages.py` to emit static pages.
- **Website repo** `~/projects/western-cape-valuations` (git, GitHub Pages): the
  generated `m/*.html`, `d/*.html`, `sitemap.xml`, `assets/atlas.js`,
  `templates/shell.html`, `data/*.json`, `DATA_CONTRACT.md`.
- Regenerate with `python3 extract/build.py` then `python3 extract/export_site.py`.
- **Precedents this design copies:** `extract/provenance.py` (hand-authored,
  per-municipality, all-optional metadata → flows to `atlas.js` as
  `scope.provenance` and to pages via `source_section`), and `data/rates.json` +
  `assets/rates.js` (curated per-municipality data → `ratesBlock` in the panel and
  `rates_section` on pages). A "how was this valued?" provenance popover already
  exists in `atlas.js` (~L370) and already states values are "the municipal
  valuer's market value … set for rates."

## Feature 1 — the valuations explainer

### Content (accurate, MPRA-grounded)

Core message (answers the "is it a floor?" question — **no**):

> Municipal valuations estimate each property's **open-market value on a set past
> date** — "the amount the property would have realised if sold on the date of
> valuation in the open market by a willing seller to a willing buyer" (MPRA s46).
> They are produced by **mass appraisal** (physical inspection is optional; aerial
> imagery and computer-assisted mass appraisal are used — MPRA s45), not by
> valuing each home individually, and only every few years (a general valuation
> per cycle, with supplementary rolls between). Their purpose is to **charge rates**
> (value × the cent-in-the-rand tariff, minus rebates). They are **not a floor and
> not a live sale price**: in a rising market they usually sit *below* today's
> price, and could sit above it in a downturn. An owner who disagrees may **object**
> (MPRA s50). The roll is a **public record** (MPRA s49/s50).

Full page expands this into short sections: *What a municipal valuation is · How
it's worked out (mass appraisal + valuation date) · What it's for (rates) · What
it is NOT (floor / current sale price) · Objecting · Where the data comes from*.
Cite the Act; link to `legal/`-style sources where useful. Reuse the `.caveat` /
`.note` styles already in `templates/shell.html`.

### Delivery — "all of the above"

- **New generated page** `how-valuations-work.html` at the site root, produced by
  `export_pages.py` through `templates/shell.html` (same title/meta/canonical/
  jsonld placeholders as other pages). Added to `sitemap.xml`. Its own SEO URL.
- **Inline, on each muni page + district page:** a short explainer block (2–3
  sentences from the core message) with a "How valuations work →" link to the new
  page. Implemented as a new `explainer_link_section()` in `export_pages.py`.
- **Atlas panel:** extend the existing provenance popover copy and add the same
  "How valuations work →" link (to `how-valuations-work.html`). Minimal new UI.

## Feature 2 — per-municipality authorities / role-players

### Data model — `extract/authorities.py` (new; mirrors `provenance.py`)

Hand-authored, keyed by municipality name; **every field optional**. Shared
role-players authored once as module constants, not per municipality.

```python
# Per-municipality, primary (directly relevant) info:
AUTHORITIES = {
  "Oudtshoorn": {
    "valuer": "CDV MunVal (Pty) Ltd",                 # the "General Valuer"
    "valuer_note": "appointed municipal valuer, GV2022",  # optional context
    "dept": {                                          # valuations / rates office
      "name": "Valuations & Rates",
      "phone": "...", "email": "valuations@...",
      "address": "69 Voortrekker Rd, Oudtshoorn, 6620",
      "url": "https://www.oudtshoorn.gov.za/...valuations",
    },
    "objections": {                                    # the s50 route
      "to": "Municipal Manager / Municipal Valuer",
      "how": "lodge on the prescribed objection form during the inspection period",
      "url": "https://...objection-form.pdf",
    },
  },
  # ...one entry per municipality we have data for...
}

# Secondary role-players — the same for all WC municipalities, authored once:
APPEAL_BOARD = {"name": "Western Cape Valuation Appeal Board", "url": "...", "note": "..."}
PROVINCE     = {"name": "WC Dept of Local Government", "url": "...", "phone": "..."}
NATIONAL     = {"name": "CoGTA (national)", "url": "...", "note": "MPRA administrator"}
```

`export_site.py` serializes each municipality's block (plus the shared secondary
constants) into that municipality's Atlas node, exactly as `provenance` is done
today. `export_pages.py` gets a new `authorities_section(muni)` builder.

**Alternative considered:** `data/authorities.json` like `rates.json`. Rejected in
favour of a Python module because the content is prose-y contact data that benefits
from inline comments and per-field source citations, matching `provenance.py`.

### Layout — complete but quiet (two tiers)

Section heading e.g. **"Who sets & governs these values"**.

- **Primary (prominent — hairline rows / tiles, like the existing panel sections):**
  Municipal (General) Valuer · Valuations/Rates department (phone, email, address,
  official page) · How to object (the s50 route).
- **Secondary (de-emphasised — a small "Other role-players" line, or a
  collapsible):** WC Valuation Appeal Board · WC Dept of Local Government ·
  national CoGTA. Rendered smaller/greyed (`.note` / `.label2`) so it doesn't
  compete with the primary block.

Identical structure on the static muni page (`export_pages.py`) and the Atlas
click-panel (`atlas.js`). **District pages** are not a valuing authority, so they
show **only** the shared secondary role-players (appeal board / province /
national) plus the explainer link — no per-muni valuer or dept block.

## Data collection protocol (per user: "download everything even remotely relevant")

For **each** of the 25 local municipalities **+ City of Cape Town**:

1. **Find** the municipality's official valuations/rates presence: valuations
   department page, contact details, the appointed municipal valuer, the general
   valuation public notice (s49), objection forms, rates policy/tariffs, appeal
   board info — via the existing `SOURCE.md`, the municipality's `*.gov.za` site,
   and the provincial/appeal-board sites.
2. **Download every remotely-relevant artifact** (public notices, objection forms,
   valuer-appointment notices, valuations FAQ/brochures, rates policy PDFs, contact
   pages saved as PDF/HTML). **Official / `*.gov.za` sources only** (project rule).
3. **Keep the raw files** in that municipality's folder under a clear subfolder
   (e.g. `authorities/`), preserving **original filenames** (project rule). Respect
   repo-size caution (Phase 4) — note, don't commit, anything very large.
4. **Update that municipality's `SOURCE.md`** with a structured
   **"Authorities & role-players"** block (valuer, dept contact, objection route,
   source URLs + retrieval date) — this is the human-readable provenance that
   `authorities.py` is transcribed from. Keep facts grounded in what was
   downloaded; never guess.
5. Transcribe the vetted facts into `extract/authorities.py`.

Fan this out with **cheaper subagent models** (sonnet/haiku) — one municipality per
agent — per the standing rate-limit note. Each agent returns a structured summary;
the orchestrator writes `authorities.py`. Missing data is fine (fields hide).

## Rendering & contract

- `export_pages.py`: add `authorities_section()`, `explainer_link_section()`, and
  generation of `how-valuations-work.html`; add that URL to `sitemap.xml`.
- `export_site.py`: load `authorities.py`, attach per-muni + shared blocks to the
  Atlas nodes.
- `assets/atlas.js`: render the authorities block in the click-panel; add the
  explainer link. Bump the `?v=` on the atlas.js `<script>` tag (CDN cache).
- `DATA_CONTRACT.md`: document the new page, the authorities section, and their
  graceful-degradation rules (extend §13).
- Regenerate via `build.py` → `export_site.py`; never hand-edit generated files.

## Risks / open items

- **Coverage varies** by municipality; some sites are thin or down. Graceful
  degradation covers gaps; log which municipalities are incomplete.
- **Valuer changes per GV cycle** — record which cycle each valuer relates to; the
  value shown must match the roll cycle actually in the DB.
- **Appeal board / provincial contacts** may change; keep them in the shared
  constants so they're updated in one place.
- Repo size from raw downloads — keep large binaries local/uncommitted if needed.

## Regeneration checklist

1. Collect data → raw files + `SOURCE.md` updates + `extract/authorities.py`.
2. `python3 extract/build.py`
3. `python3 extract/export_site.py`
4. Verify `how-valuations-work.html`, muni pages, sitemap, and the Atlas panel.
5. Commit website-repo changes (author = user only; no AI authorship).
