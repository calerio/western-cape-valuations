/* Verified municipal property rates (data/rates.json — see DATA_CONTRACT §10).
 *
 * rates.json is the site's ONE hand-curated data file: per-municipality
 * rate-in-the-rand figures transcribed from official 2025/26 tariff books /
 * Provincial Gazette promulgations, each entry carrying its year, source URL
 * and the exact quoted tariff line. A municipality (or category) absent from
 * the file means the UI shows NO rates figure — never a guess.
 *
 * Formula (MPRA): annual = max(0, market value − residential reduction) × rate;
 * the reduction (statutory R15,000 s17(1)(h) + any municipal extension) applies
 * to residential properties only. monthly = annual / 12.
 */
let ratesPromise = null;
export const getRates = () => ratesPromise ||
  (ratesPromise = fetch(new URL("../data/rates.json?v=2", import.meta.url))
    .then(r => (r.ok ? r.json() : null))
    .catch(() => null));

/* Category → broad class. MUST mirror extract/export_site.py classify()
 * (same keywords, same precedence) so the front-end buckets a property the
 * same way the site's own cat_mix stats do. */
export function classifyCat(cat, tenure) {
  const c = (cat || "").toUpperCase();
  if ((tenure || "") === "farm" || c.includes("AGR") || c.includes("FARM") ||
      c.includes("AGA") || c.includes("SMALLHOLD")) return "agri";
  if (c.includes("COM") || c.includes("BUS") || c.includes("INDUSTR") ||
      c.includes("SHOP") || c.includes("OFFICE") || c.includes("RETAIL")) return "com";
  if (c.includes("MUN") || c.includes("PSI") || c.includes("PSP") ||
      c.includes("INSTITUT") || c.includes("GOVERN") || c.includes("STATE") ||
      c.includes("PUBLIC") || c.includes("SCHOOL") || c.includes("CHURCH")) return "state";
  if (c.includes("VAC")) return "vacant";
  if (c.includes("RES") || c.includes("DWELL") || c.includes("HOME") ||
      c.includes("SECTIONAL")) return "res";
  return "other";
}

// broad class → rates.json category key (state/other are deliberately absent:
// government/PSI tariffs are inconsistently published, so we stay silent).
const CLS2KEY = { res: "res", com: "business", agri: "agricultural", vacant: "vacant" };

/* Returns {annual, monthly, rate, year, source, reduction} or null (⇒ hide). */
export function computeRates(data, muni, category, tenure, value) {
  if (!data || !data.munis || !value || value <= 0) return null;
  const m = data.munis[muni];
  if (!m || !m.rates) return null;
  const key = CLS2KEY[classifyCat(category, tenure)];
  const rate = key ? m.rates[key] : null;
  if (!rate || rate <= 0) return null;
  const reduction = key === "res" ? (m.residential_reduction || 15000) : 0;
  let annual = Math.max(0, value - reduction) * rate;
  if (key === "res") {
    // Optional municipal extras (DATA_CONTRACT §10): a % rebate on the
    // calculated amount, and a full exemption below a valuation threshold.
    if (m.residential_rebate_pct) annual *= 1 - m.residential_rebate_pct / 100;
    if (m.residential_exempt_below && value <= m.residential_exempt_below) annual = 0;
  }
  return { annual, monthly: annual / 12, rate, reduction,
           year: m.year || data.year, source: m.source || null };
}
