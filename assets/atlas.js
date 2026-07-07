import { getRates, computeRates } from "./rates.js?v=1";

// d3 comes from the UMD bundle loaded in <head> — importing the jsdelivr +esm build
// as well would fetch the whole ~30-module d3 graph a second time (and trigger a wall
// of phantom /npm/* preload 404s against our own origin).
const d3 = window.d3;

/* ============================ config / tokens ============================ */
const W = 1000, H = 760, MAXK = 46;
// design tokens (assets/tokens.css) — read once at boot
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const RAMP = [1, 2, 3, 4, 5].map(i => cssVar(`--ramp-${i}`));
const ACCENT = cssVar("--accent");
const LAND = cssVar("--land"), NODATA = cssVar("--nodata");
const YEAR = "2024 / 25";
const $ = s => document.getElementById(s);

const R = v => { v = +v; if (!isFinite(v)) return "—";
  if (v >= 1e12) return "R" + (v / 1e12).toFixed(2) + "tn";
  if (v >= 1e9) return "R" + (v / 1e9).toFixed(v >= 1e10 ? 0 : 1) + "bn";
  if (v >= 1e6) return "R" + (v / 1e6).toFixed(2) + "m";
  if (v >= 1e3) return "R" + Math.round(v / 1e3) + "k";
  return "R" + Math.round(v); };
const N = v => v == null ? "—" : (+v).toLocaleString("en-ZA").replace(/,/g, " ");
const norm = s => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const clAddr = s => (s || "").replace(/\s+/g, " ").trim();                 // collapse OCR padding
const clSub = s => clAddr(s).replace(/(\s+\d{3,})+$/, "");                 // strip trailing data codes

/* ============================ state ============================ */
let STATS, TOWNS, PROV, DISTF, MUNIF;
let proj, path, gNode, gProv, gDist, gMuni, gWard, gLabel, defs, svg;
let DISTRICTS = {};            // name -> {feature, munis:[name]}
let muniByName = {};           // name -> feature
let muniSlugs = {}, distSlugs = {};   // url-slug -> name (deep-link lookup, built in buildHierarchy)
let curK = 1, statePath = [];
// slug rule shared with the static pages — keep in sync with export_pages.slugify (DATA_CONTRACT §13)
const slugOf = n => n.trim().toLowerCase().replace(/ /g, "-");
// Party colours for seat bars — keep in sync with extract/politics.py PARTY_COLOURS.
const PARTY_COLOURS = {DA:"#0071e3",ANC:"#00853f",EFF:"#e7261f","FF+":"#f39200",
  "VF Plus":"#f39200",ACDP:"#c8102e",PA:"#6a1b9a",GOOD:"#00a3a3",ASA:"#1565c0",
  Cope:"#e30613",IFP:"#e2001a","Al Jama-ah":"#2e7d32","Ind.":"#8a8f98",Independent:"#8a8f98"};
const partyColour = p => PARTY_COLOURS[p] || "#8a8f98";
let dbw = null, dbwPromise = null, areaIndex = null;

/* ============================ boot ============================ */
(async function () {
  try {
    [STATS, TOWNS, PROV, DISTF, MUNIF] = await Promise.all([
      fetch("data/stats.json").then(r => r.json()),
      fetch("data/towns.json").then(r => r.json()),
      fetch("data/geo/za-provinces.geojson").then(r => r.json()),
      fetch("data/geo/wc-districts.geojson").then(r => r.json()),
      fetch("data/geo/wc-municipalities.geojson").then(r => r.json()),
    ]);
  } catch (e) {
    $("loadingMsg").textContent = "Could not load the atlas data";
    return;
  }
  clipMainland(); toPlanar(); buildHierarchy(); initMap();
  $("loading").style.display = "none";
  navigate(parseHash(), false);                        // deep-link boot (#m/<slug> / #d/<slug>)
  addEventListener("hashchange", () => {               // manual address-bar edits; our own
    const p = parseHash();                             // replaceState updates never fire this
    if (JSON.stringify(p) !== JSON.stringify(statePath)) navigate(p);
  });
  wireSearch(); wireSheet();
  $("mback").onclick = () => { if (statePath.length) navigate(statePath.slice(0, -1)); };
  $("resetBtn").onclick = () => { if (statePath.length) navigate([]); };
  let rzT; addEventListener("resize", () => { clearTimeout(rzT); rzT = setTimeout(() => navigate(statePath, false), 200); });

  // top-N properties overlay
  const cardKey = id => id === "hiCard" ? "hi" : "lo";
  ["hiCard", "loCard"].forEach(id => {
    const el = $(id);
    el.onclick = () => openTop(cardKey(id));
    el.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openTop(cardKey(id)); } };
  });
  $("tlClose").onclick = closeTop;
  $("tlScrim").onclick = closeTop;
  $("tlSeg").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; tlN = +b.dataset.n; [...$("tlSeg").children].forEach(x => x.classList.toggle("on", x === b)); loadTop(); });
  $("pdClose").onclick = closeProp;
  $("pdScrim").onclick = closeProp;
  addEventListener("keydown", e => { if (e.key !== "Escape") return; if ($("propdetail").classList.contains("open")) closeProp(); else if ($("toplist").classList.contains("open")) closeTop(); });
  ensureDB().catch(() => {});   // pre-warm the SQLite worker so the first search / top-N is instant
})();

const name = f => f.properties.name;

function buildHierarchy() {
  DISTF.features.forEach(f => { DISTRICTS[name(f)] = { feature: f, munis: [] }; distSlugs[slugOf(name(f))] = name(f); });
  MUNIF.features.forEach(f => {
    muniByName[name(f)] = f;
    muniSlugs[slugOf(name(f))] = name(f);
    const d = f.properties.district;
    if (DISTRICTS[d]) DISTRICTS[d].munis.push(name(f));
  });
  Object.values(DISTRICTS).forEach(d => d.munis.sort());
}

/* Deep links: #m/<slug> (municipality) and #d/<slug> (district) — the contract the static
 * /m/ and /d/ pages link with. Unknown or malformed hashes fall back to the province view. */
function parseHash() {
  const m = /^#(m|d)\/(.+)$/.exec(decodeURIComponent(location.hash || ""));
  if (!m) return [];
  if (m[1] === "d") {
    const d = distSlugs[m[2]];
    return d ? [wcCrumb(), { type: "district", name: d }] : [];
  }
  const mu = muniSlugs[m[2]];
  const d = mu && muniByName[mu].properties.district;
  return DISTRICTS[d] ? [wcCrumb(), { type: "district", name: d }, { type: "municipality", name: mu }] : [];
}
function syncHash(p) {
  // replaceState, never pushState: navigate() also fires on resize/search/breadcrumbs, and
  // pushing would bury the back button under drill states. Views stay shareable regardless.
  const frag = p.length >= 3 ? "#m/" + slugOf(p[2].name) : p.length === 2 ? "#d/" + slugOf(p[1].name) : "";
  if (location.hash !== frag) history.replaceState(null, "", location.pathname + location.search + frag);
}

/* ============================ geometry fixes (per spec) ============================ */
function clipMainland() {
  const inM = p => p[0] >= 14 && p[0] <= 34 && p[1] <= -21 && p[1] >= -35.6;
  const keep = poly => poly[0].some(inM);
  const fix = fc => fc.features.forEach(f => { const g = f.geometry; if (!g) return;
    if (g.type === "MultiPolygon") { const k = g.coordinates.filter(keep);
      if (k.length) { if (k.length === 1) { g.type = "Polygon"; g.coordinates = k[0]; } else g.coordinates = k; } } });
  [PROV, DISTF, MUNIF].forEach(fix);
}
function planarize(fc) {   // lon/lat -> the Web-Mercator plane every layer renders in
  const conv = a => { if (typeof a[0] === "number") { const lng = a[0], lat = a[1];
      a[0] = lng * Math.PI / 180; a[1] = Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)); }
    else a.forEach(conv); };
  fc.features.forEach(f => f.geometry && conv(f.geometry.coordinates));
  return fc;
}
function toPlanar() { [PROV, DISTF, MUNIF].forEach(planarize); }
/* ============================ stats accessors (REAL data) ============================ */
const provStat = () => STATS.province;
const distStat = n => STATS.districts[n] || null;
function muniStat(n) { for (const d in STATS.districts) { const m = STATS.districts[d].municipalities[n]; if (m) return m; } return null; }
const townsOf = m => TOWNS[m] || [];
const med = s => s ? s.median : null;
const ext = arr => { const v = arr.filter(x => x != null); return v.length ? [Math.min(...v), Math.max(...v)] : [0, 1]; };
function color(v, e) { if (v == null) return NODATA; const [lo, hi] = e; const t = hi > lo ? (v - lo) / (hi - lo) : .5;
  return d3.interpolateRgbBasis(RAMP)(Math.max(0, Math.min(1, t))); }

/* ============================ map init ============================ */
function initMap() {
  proj = d3.geoIdentity().reflectY(true).fitExtent([[46, 40], [W - 46, H - 40]], PROV);
  path = d3.geoPath(proj);
  svg = d3.select("#map").append("svg").attr("viewBox", `0 0 ${W} ${H}`).attr("preserveAspectRatio", "xMidYMid meet");
  defs = svg.append("defs");
  const g = svg.append("g"); gNode = g.node();
  gNode.style.transformBox = "view-box"; gNode.style.transformOrigin = "0 0";
  gProv = g.append("g"); gDist = g.append("g"); gMuni = g.append("g"); gWard = g.append("g"); gLabel = g.append("g");
  gWard.style("pointer-events", "none");   // orientation only — hover/click stays on the municipality
  [gDist, gMuni].forEach(l => l.node().style.transition = "opacity .5s ease");

  const provExt = ext(Object.keys(DISTRICTS).map(d => med(distStat(d))));
  gProv.selectAll("path").data(PROV.features).join("path")
    .attr("d", path)
    .attr("fill", d => name(d) === "Western Cape" ? color(med(provStat()), provExt) : LAND)
    .attr("stroke", d => name(d) === "Western Cape" ? cssVar("--map-outline") : "none")
    .attr("stroke-width", 1.1).attr("vector-effect", "non-scaling-stroke")
    .attr("class", d => name(d) === "Western Cape" ? "o-clickable o-wc" : "o-other")
    .each(function (d) { if (name(d) === "Western Cape") d3.select(this)
      .on("click", () => navigate([wcCrumb()]))
      .on("mouseenter mousemove", e => tip(e, "Western Cape", provStat(), true))
      .on("mouseleave", tipHide); });
  $("legendBar").style.background = `linear-gradient(90deg,${RAMP.join(",")})`;
}
const wcCrumb = () => ({ type: "province", name: "Western Cape" });

/* ============================ draw layers ============================ */
let distDrawn = false, muniDistrict = null;

function drawDistricts() {
  if (distDrawn) return; distDrawn = true;
  const e = ext(Object.keys(DISTRICTS).map(d => med(distStat(d))));
  gDist.selectAll("path").data(DISTF.features).join("path")
    .attr("d", path)
    .attr("fill", d => color(med(distStat(name(d))), e))
    .attr("stroke", cssVar("--map-stroke")).attr("stroke-width", 1.1).attr("vector-effect", "non-scaling-stroke")
    .attr("class", "o-clickable")
    .on("click", (ev, d) => navigate([wcCrumb(), { type: "district", name: name(d) }]))
    .on("mouseenter mousemove", (ev, d) => tip(ev, name(d), distStat(name(d)), true))
    .on("mouseleave", tipHide);
}
function drawMunis(district) {
  if (muniDistrict === district) return; muniDistrict = district;
  const munis = DISTRICTS[district].munis;
  const e = ext(munis.map(m => med(muniStat(m))));
  gMuni.selectAll("path").data(munis.map(m => muniByName[m]).filter(Boolean), d => name(d)).join("path")
    .attr("d", path)
    .attr("fill", d => color(med(muniStat(name(d))), e))
    .attr("stroke", cssVar("--map-stroke")).attr("stroke-width", 1).attr("vector-effect", "non-scaling-stroke")
    .attr("class", "o-clickable")
    .on("click", (ev, d) => navigate([wcCrumb(), { type: "district", name: district }, { type: "municipality", name: name(d) }]))
    .on("mouseenter mousemove", (ev, d) => tip(ev, name(d), muniStat(name(d)), true))
    .on("mouseleave", tipHide);
}
/* Ward boundaries (Municipal Demarcation Board, current delimitation) — shown as an
 * orientation overlay when drilled into a municipality. The ~1 MB GeoJSON is fetched
 * lazily on the FIRST municipality drill and cached; fetch failure just means no
 * ward lines (degrade quietly, per the data contract). */
let wardsPromise = null;
const fetchWards = () => wardsPromise ||
  (wardsPromise = fetch("data/geo/wc-wards.geojson").then(r => r.json()).then(planarize)
    .catch(e => { console.warn("wards unavailable", e); return { features: [] }; }));

async function drawWards(muni) {
  const gj = await fetchWards();
  // a slow fetch may resolve after the user has drilled elsewhere — recheck state
  if (!(statePath.length === 3 && statePath[2].name === muni)) return;
  const feats = gj.features.filter(f => f.properties.muni === muni);
  const k = curK;
  // paper-white like the muni borders — the choropleth fill underneath can be
  // near-black green, so a dark stroke would vanish; dashing tells wards apart.
  gWard.selectAll("path").data(feats, f => f.properties.ward_id).join("path")
    .attr("d", path)
    .attr("fill", "none")
    .attr("stroke", cssVar("--map-stroke")).attr("stroke-opacity", .7)
    .attr("stroke-width", 0.8).attr("vector-effect", "non-scaling-stroke")
    .attr("stroke-dasharray", `${4 / k} ${3 / k}`);
  gWard.selectAll("text").data(feats, f => f.properties.ward_id).join("text")
    .attr("x", f => path.centroid(f)[0]).attr("y", f => path.centroid(f)[1])
    .attr("text-anchor", "middle").attr("dy", ".32em")
    .attr("fill", cssVar("--map-outline")).attr("fill-opacity", .8)
    .attr("stroke", cssVar("--map-halo")).attr("stroke-width", 2.5 / k).attr("paint-order", "stroke")
    .style("font-weight", 600).style("font-size", 9 / k + "px")
    .text(f => f.properties.ward);
}
const clearWards = () => gWard.selectAll("*").remove();

function setLayers(len) {
  gProv.style("opacity", len === 0 ? 1 : 0.5).style("pointer-events", len === 0 ? "auto" : "none");
  gProv.selectAll(".o-wc").attr("fill", len === 0 ? color(med(provStat()), ext(Object.keys(DISTRICTS).map(d => med(distStat(d))))) : "none");
  const set = (g, on, dim) => g.style("display", dim ? "block" : "none").style("opacity", on ? 1 : 0.16).style("pointer-events", on ? "auto" : "none");
  set(gDist, len === 1, len >= 1);
  if (muniDistrict) set(gMuni, len >= 2, len >= 2);   // municipalities clickable at district + terminal at municipality
}

/* ============================ zoom (CSS transform) ============================ */
// The left rail (desktop) covers part of the map, so features are fitted to and
// centred in the VISIBLE area right of it. Converts the rail's CSS px into
// viewBox units via the meet-scale factor.
function railVB() {
  if (innerWidth <= 720) return 0;
  const railPx = Math.min(432, innerWidth * 0.38);          // 16px gutter + 400px rail
  return railPx / Math.min(innerWidth / W, innerHeight / H);
}
function zoom(feats, animate) {
  let b = null; feats.forEach(f => { const bb = path.bounds(f); b = b ? [[Math.min(b[0][0], bb[0][0]), Math.min(b[0][1], bb[0][1])], [Math.max(b[1][0], bb[1][0]), Math.max(b[1][1], bb[1][1])]] : bb; });
  const dx = b[1][0] - b[0][0], dy = b[1][1] - b[0][1], cx = (b[0][0] + b[1][0]) / 2, cy = (b[0][1] + b[1][1]) / 2;
  const rv = railVB();
  const k = Math.min(MAXK, 0.84 / Math.max(dx / (W - rv), dy / H));
  curK = k;
  gNode.style.transition = animate ? "transform .95s cubic-bezier(.4,0,.2,1)" : "none";
  gNode.style.transform = `translate(${(W + rv) / 2 - k * cx}px,${H / 2 - k * cy}px) scale(${k})`;
}

/* ============================ label placement ============================ */
/* Pole of inaccessibility (adapted from Mapbox polylabel, ISC-licensed): the
 * interior point farthest from every edge. Used instead of the geometric centroid,
 * which drifts outside concave shapes — so "City of Cape Town" no longer floats over
 * the bay and district names sit in the visual centre rather than on a border.
 * Runs in projected pixel space (same units as path.centroid), once per navigation. */
function segDistSq(px, py, a, b) {
  let x = a[0], y = a[1], dx = b[0] - x, dy = b[1] - y;
  if (dx || dy) { const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x = b[0]; y = b[1]; } else if (t > 0) { x += dx * t; y += dy * t; } }
  dx = px - x; dy = py - y; return dx * dx + dy * dy;
}
// signed distance from (x,y) to the polygon (rings): positive inside, negative outside
function pointToPolyDist(x, y, rings) {
  let inside = false, minSq = Infinity;
  for (const ring of rings)
    for (let i = 0, len = ring.length, j = len - 1; i < len; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
      minSq = Math.min(minSq, segDistSq(x, y, a, b));
    }
  return (inside ? 1 : -1) * Math.sqrt(minSq);
}
function polyCell(x, y, h, rings) { const d = pointToPolyDist(x, y, rings); return { x, y, h, d, max: d + h * Math.SQRT2 }; }
function centroidCell(rings) {
  let area = 0, x = 0, y = 0, r = rings[0];
  for (let i = 0, len = r.length, j = len - 1; i < len; j = i++) {
    const a = r[i], b = r[j], f = a[0] * b[1] - b[0] * a[1]; x += (a[0] + b[0]) * f; y += (a[1] + b[1]) * f; area += f * 3;
  }
  return area ? polyCell(x / area, y / area, 0, rings) : polyCell(r[0][0], r[0][1], 0, rings);
}
function polylabel(rings, precision) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pt of rings[0]) { if (pt[0] < minX) minX = pt[0]; if (pt[1] < minY) minY = pt[1]; if (pt[0] > maxX) maxX = pt[0]; if (pt[1] > maxY) maxY = pt[1]; }
  const width = maxX - minX, height = maxY - minY, cellSize = Math.min(width, height);
  if (!cellSize) return [minX, minY];
  const h = cellSize / 2, heap = [];                      // binary max-heap keyed on cell.max
  const swap = (i, j) => { const t = heap[i]; heap[i] = heap[j]; heap[j] = t; };
  const push = c => { heap.push(c); let i = heap.length - 1; while (i > 0) { const par = (i - 1) >> 1; if (heap[par].max >= heap[i].max) break; swap(par, i); i = par; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let big = i; if (l < heap.length && heap[l].max > heap[big].max) big = l; if (r < heap.length && heap[r].max > heap[big].max) big = r; if (big === i) break; swap(big, i); i = big; } } return top; };
  for (let x = minX; x < maxX; x += cellSize) for (let y = minY; y < maxY; y += cellSize) push(polyCell(x + h, y + h, h, rings));
  let best = polyCell(minX + width / 2, minY + height / 2, 0, rings);
  const cen = centroidCell(rings); if (cen.d > best.d) best = cen;
  while (heap.length) {
    const c = pop();
    if (c.d > best.d) best = c;
    if (c.max - best.d <= precision) continue;
    const hh = c.h / 2;
    push(polyCell(c.x - hh, c.y - hh, hh, rings)); push(polyCell(c.x + hh, c.y - hh, hh, rings));
    push(polyCell(c.x - hh, c.y + hh, hh, rings)); push(polyCell(c.x + hh, c.y + hh, hh, rings));
  }
  return [best.x, best.y];
}
const ringAbsArea = r => { let a = 0; for (let i = 0, len = r.length, j = len - 1; i < len; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return Math.abs(a); };
// projected-pixel label anchor for a feature (largest ring of a MultiPolygon)
function labelPoint(f) {
  const g = f && f.geometry; if (!g) return path.centroid(f);
  const proj1 = ring => ring.map(pt => proj(pt));
  let poly;                                                // GeoJSON coords are pre-planarized; uniform proj preserves area order
  if (g.type === "Polygon") poly = g.coordinates;
  else if (g.type === "MultiPolygon") { let ba = -1; for (const pl of g.coordinates) { const a = ringAbsArea(pl[0]); if (a > ba) { ba = a; poly = pl; } } }
  if (!poly || !poly.length) return path.centroid(f);
  const rings = poly.map(proj1);
  if (!rings[0] || !rings[0].length) return path.centroid(f);
  try { return polylabel(rings, 0.6); } catch (_) { return path.centroid(f); }
}

/* ============================ labels ============================ */
function labels(len, p) {
  gLabel.selectAll("*").remove();
  let items = [];
  const mk = (t, f, extra) => { const c = labelPoint(f); return Object.assign({ t, x: c[0], y: c[1], f }, extra || {}); };
  if (len === 0) { const f = PROV.features.find(f => name(f) === "Western Cape"); items = [mk("WESTERN CAPE", f, { wc: true })]; }
  else if (len === 1) items = DISTF.features.map(f => mk(name(f), f));
  else if (len === 2) items = DISTRICTS[p[1].name].munis.map(m => muniByName[m]).filter(Boolean).map(f => mk(name(f), f));
  else { const f = muniByName[p[2].name]; if (f) items = [mk(name(f), f)]; }
  const k = curK, baseFs = (len === 0 ? 13.5 : 11.5) / k;
  // Apple-map cartographic type: SF Pro (via --font-map), lighter weights, a soft
  // white halo carrying legibility over the dark end of the choropleth.
  const sel = gLabel.selectAll("text").data(items).join("text")
    .attr("x", d => d.x).attr("y", d => d.y).attr("text-anchor", "middle").attr("dy", ".32em")
    .attr("fill", cssVar("--map-outline"))
    .attr("stroke", cssVar("--map-halo")).attr("stroke-width", 3.2 / k).attr("paint-order", "stroke")
    .attr("letter-spacing", d => d.wc ? (1.6 / k) + "px" : (0.1 / k) + "px")
    .style("font-weight", d => d.wc ? 600 : 500).style("font-size", baseFs + "px")
    .style("opacity", d => d.wc ? .92 : .88).text(d => d.t);
  // Fit-to-region: shrink any name wider than its own shape so it never spills across a
  // border (region width and text length are both in viewBox units → directly comparable).
  // Floored at 68% so a long name on a tiny metro stays legible rather than vanishing.
  sel.each(function (d) {
    const b = path.bounds(d.f), regionW = (b[1][0] - b[0][0]) * (d.wc ? 1 : 0.92), tl = this.getComputedTextLength();
    if (regionW > 0 && tl > regionW) this.style.fontSize = Math.max(baseFs * 0.68, baseFs * regionW / tl) + "px";
  });
}

/* ============================ tooltip ============================ */
function tip(e, nm, st, drill) { if (innerWidth <= 720) return;   // phones: tap drills in, no off-screen tooltip
  const t = $("tip");
  t.innerHTML = `<div style="font-family:var(--font-ui);font-size:16px;margin-bottom:7px">${nm}</div>` +
    (st ? `<div style="display:grid;grid-template-columns:auto auto;gap:2px 16px;font-size:12px">` +
      `<span style="opacity:.6">Median</span><span style="text-align:right;font-variant-numeric:tabular-nums">${R(st.median)}</span>` +
      `<span style="opacity:.6">Total roll</span><span style="text-align:right;font-variant-numeric:tabular-nums">${R(st.total)}</span>` +
      `<span style="opacity:.6">Parcels</span><span style="text-align:right;font-variant-numeric:tabular-nums">${N(st.parcels || st.valued)}</span></div>`
      : `<div style="font-size:12px;opacity:.7">No public roll (search-only)</div>`) +
    (drill && st ? `<div style="margin-top:8px;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:${ACCENT}">Click to explore →</div>` : "");
  t.style.opacity = 1;
  let x = e.clientX + 16, y = e.clientY + 16;
  if (x + 250 > innerWidth) x = e.clientX - 250; if (y + 130 > innerHeight) y = e.clientY - 130;
  t.style.left = x + "px"; t.style.top = y + "px";
}
const tipHide = () => $("tip").style.opacity = 0;

/* ============================ valuation-provenance popover ============================ */
// "How was this valued?" — a hover / focus / tap card on the municipality roll date, built
// entirely from scope.provenance (backbone facts from the roll + any authored note). When a
// municipality has no provenance the trigger isn't rendered, so this degrades to a plain date.
const KIND_LABEL = { general: "General valuation roll", supplementary: "Supplementary valuation roll", draft: "Draft valuation roll" };
let provTimer = null;
function provEl() {
  let el = $("provPop");
  if (!el) {
    el = document.createElement("div"); el.id = "provPop"; el.className = "platter"; el.setAttribute("role", "tooltip");
    el.addEventListener("mouseenter", () => clearTimeout(provTimer));   // hover-bridge: keep open while the pointer is on the card
    el.addEventListener("mouseleave", hideProv);
    document.body.appendChild(el);
    // tap / click outside closes it (mobile has no hover to close on)
    document.addEventListener("click", e => { if (!e.target.closest(".rollprov,#provPop")) el.classList.remove("on"); });
  }
  return el;
}
function provInner(p) {
  const rows = [];
  if (p.valued_as_at) rows.push(["Values as at", esc(p.valued_as_at)]);
  if (p.cycle) rows.push(["Rating cycle", esc(String(p.cycle).replace("-draft", " · draft"))]);
  if (p.properties != null) rows.push(["Properties valued", N(p.properties)]);
  if (p.coverage) rows.push(["Coverage", esc(p.coverage)]);
  return `<div class="ppTitle">${KIND_LABEL[p.kind] || "Valuation roll"}</div>` +
    `<div class="ppGrid">` + rows.map(([k, v]) => `<span class="ppK">${k}</span><span class="ppV">${v}</span>`).join("") + `</div>` +
    (p.note ? `<div class="ppNote">${esc(p.note)}</div>` : "") +
    // fixed caveat, every municipality: roll values are rating valuations, not sale prices
    `<div class="ppNote">Values are the municipal valuer's market value as at the date above, set for rates — a property can sell for more or less today.</div>` +
    (p.source_url ? `<div class="ppSrc"><a href="${esc(p.source_url)}" target="_blank" rel="noopener">Official source ↗</a></div>` : "");
}
function showProv(trigger, p) {
  clearTimeout(provTimer);
  const el = provEl(); el.innerHTML = provInner(p);
  const r = trigger.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;   // measurable while visibility:hidden
  const x = Math.min(Math.max(12, r.left), innerWidth - 12 - w);
  let y = r.bottom + 8; if (y + h > innerHeight - 12) y = r.top - 8 - h;                 // flip above if it would overflow
  el.style.left = Math.round(x) + "px"; el.style.top = Math.round(Math.max(12, y)) + "px";
  el.classList.add("on");
}
function hideProv() { clearTimeout(provTimer); provTimer = setTimeout(() => { const el = $("provPop"); if (el) el.classList.remove("on"); }, 90); }
const provOff = () => { const el = $("provPop"); if (el) el.classList.remove("on"); };
function wireProv(trigger, p) {
  trigger.addEventListener("mouseenter", () => showProv(trigger, p));
  trigger.addEventListener("mouseleave", hideProv);
  trigger.addEventListener("focus", () => showProv(trigger, p));
  trigger.addEventListener("blur", hideProv);
  trigger.addEventListener("click", e => { e.stopPropagation(); const el = $("provPop"); el && el.classList.contains("on") ? provOff() : showProv(trigger, p); });
  trigger.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); showProv(trigger, p); } else if (e.key === "Escape") provOff(); });
}

/* ============================ navigation ============================ */
function navigate(p, animate = true) {
  statePath = p; const len = p.length;
  if (len >= 2) drawMunis(p[1].name);
  drawDistricts();
  setLayers(len);
  let feats = len === 0 ? PROV.features : len === 1 ? [PROV.features.find(f => name(f) === "Western Cape")]
    : len === 2 ? [DISTRICTS[p[1].name].feature] : [muniByName[p[2].name]].filter(Boolean);
  if (!feats.length) feats = [PROV.features.find(f => name(f) === "Western Cape")];
  zoom(feats, animate);
  if (len === 3) drawWards(p[2].name); else clearWards();
  labels(len, p);
  updatePanel(len);
  hideResults();
  renderChrome(p);
  syncHash(p);
}

/* The place panel: desktop left rail is always up; the phone bottom sheet only
 * exists once an area is selected, and re-opens at its peek height per drill. */
let prevLen = -1;
function updatePanel(len) {
  const panel = $("panel"), phone = innerWidth <= 720;
  $("dash").hidden = !len;
  panel.hidden = phone && !len;
  if (phone && prevLen <= 0 && len > 0) panel.classList.remove("full");
  if (!phone) panel.classList.remove("full");
  $("pBody").scrollTop = 0;
  prevLen = len;
}

/* ---- phone bottom-sheet drag: peek <-> full, snap on release ---- */
function wireSheet() {
  const p = $("panel"), g = $("grab");
  let y0 = null, open0 = false, moved = false;
  g.addEventListener("pointerdown", e => { y0 = e.clientY; open0 = p.classList.contains("full");
    moved = false; p.classList.add("dragging");
    try { g.setPointerCapture(e.pointerId); } catch (_) {} });
  g.addEventListener("pointermove", e => { if (y0 == null) return;
    const dy = e.clientY - y0; if (Math.abs(dy) > 4) moved = true;
    const closedY = p.offsetHeight - 134;
    const ty = Math.max(0, Math.min(closedY, (open0 ? 0 : closedY) + dy));
    p.style.transform = `translateY(${ty}px)`; });
  const end = e => { if (y0 == null) return;
    const dy = e.clientY - y0; p.classList.remove("dragging"); p.style.transform = "";
    p.classList.toggle("full", moved ? (open0 ? dy < 60 : dy < -60) : !open0);
    y0 = null; };
  g.addEventListener("pointerup", end); g.addEventListener("pointercancel", end);
}

/* ============================ chrome + dashboard ============================ */
function renderChrome(p) {
  const len = p.length;

  // panel header: product kicker + intro at rest, breadcrumb once drilled
  $("panelKick").hidden = len !== 0;
  $("crumbs").hidden = len === 0;
  $("hint0").hidden = len !== 0;
  if (len === 0) {
    $("scopeLabel").textContent = "Western Cape";
    $("scopeSub").textContent = "Official municipal property valuations across 24 local municipalities — mapped, searchable, free.";
  }

  // reset-to-overview control (desktop): only meaningful once drilled in
  $("resetBtn").classList.toggle("on", len > 0);

  // mobile top bar — always shows where you are, with a back step up the hierarchy
  $("mloc").textContent = len === 0 ? "South Africa" : len === 1 ? "Western Cape" : p[len - 1].name;
  $("mkicker").textContent = len === 0 ? "Property valuations" : len === 1 ? "South Africa"
    : len === 2 ? "Western Cape" : p[1].name + " · Western Cape";
  $("mback").hidden = len === 0;

  // breadcrumb
  const steps = [{ label: "South Africa", go: () => navigate([]) }];
  if (len >= 1) steps.push({ label: "Western Cape", go: () => navigate([wcCrumb()]) });
  if (len >= 2) steps.push({ label: p[1].name, go: () => navigate([wcCrumb(), p[1]]) });
  if (len >= 3) steps.push({ label: p[2].name, go: () => navigate(p) });
  $("crumbs").innerHTML = "";
  steps.forEach((s, i) => {
    if (i) { const sep = document.createElement("span"); sep.textContent = "›"; sep.style.cssText = "font-size:13px;color:var(--label3)"; $("crumbs").appendChild(sep); }
    const a = document.createElement("span"); a.textContent = s.label; a.className = "o-clickable";
    a.style.cssText = "font-size:13px;font-weight:500;color:var(--ink);cursor:pointer"; a.onclick = s.go; $("crumbs").appendChild(a);
  });

  // The legend describes ONLY the value choropleth currently shaded on the map — nothing else:
  //   len 1 → the Western Cape's districts are shaded  → district scale
  //   len 2 → a district's municipalities are shaded   → municipality scale
  // len 0 (South Africa — WC not yet opened) and len 3 (a single municipality + ward outlines,
  // which carry no value shading) have no choropleth, so the legend is hidden entirely.
  let e = null, lt = null;
  if (len === 1) { e = ext(Object.keys(DISTRICTS).map(d => med(distStat(d)))); lt = "MEDIAN VALUE · DISTRICT"; }
  else if (len === 2) { e = ext(DISTRICTS[p[1].name].munis.map(m => med(muniStat(m)))); lt = "MEDIAN VALUE · MUNICIPALITY"; }
  const showLegend = !!e && innerWidth > 720;   // on phones the bottom sheet takes the legend's spot
  $("legendBox").style.display = showLegend ? "" : "none";
  if (showLegend) { $("legendTitle").textContent = lt; $("legendMin").textContent = R(e[0]); $("legendMax").textContent = R(e[1]); }

  if (len >= 1) renderDash(p);
}

function renderDash(p) {
  const len = p.length, isMuni = len >= 3;
  let scope, children = [], kindP, scopeName;
  if (len === 1) { scope = provStat(); scopeName = "Western Cape"; kindP = "Districts";
    children = DISTF.features.map(f => ({ name: name(f), s: distStat(name(f)), go: () => navigate([wcCrumb(), { type: "district", name: name(f) }]) })); }
  else if (len === 2) { const dl = p[1].name; scope = distStat(dl); scopeName = dl; kindP = "Municipalities";
    children = DISTRICTS[dl].munis.map(m => ({ name: m, s: muniStat(m), go: () => navigate([wcCrumb(), { type: "district", name: dl }, { type: "municipality", name: m }]) })); }
  else { const m = p[2].name; scope = muniStat(m); scopeName = m; }

  $("scopeLabel").textContent = scopeName;
  provOff();   // dismiss any open provenance popover from the previous view
  const sub = $("scopeSub");
  if (!scope) sub.textContent = "No public valuation roll";
  else if (isMuni) {
    const cyc = String(scope.cycle || YEAR).replace("-draft", " · draft");
    if (scope.provenance) {
      sub.innerHTML = `Valuation roll · <span class="rollprov" tabindex="0" role="button" aria-label="How this municipality's values were determined">${esc(cyc)}<span class="provi" aria-hidden="true">ⓘ</span></span>`;
      wireProv(sub.querySelector(".rollprov"), scope.provenance);
    } else sub.textContent = "Valuation roll · " + cyc;
  } else sub.textContent = children.filter(c => c.s).length + " " + kindP.toLowerCase() + " · current valuation rolls";
  $("statMedian").textContent = scope ? R(scope.median) : "—";
  $("statAvg").textContent = scope ? R(scope.mean ?? scope.avg) : "—";
  $("statTotal").textContent = scope ? R(scope.total) : "—";
  $("statParcels").textContent = scope ? N(scope.properties || scope.valued) : "—";

  renderHist(scope && scope.hist, scope ? (scope.properties || scope.valued) : 0);
  renderCloser(scope);

  const rk = $("ranked"); rk.innerHTML = "";
  if (!isMuni && scope) {
    $("rankTitle").textContent = kindP + " ranked";
    const sorted = children.filter(c => c.s && c.s.median != null).sort((a, b) => b.s.median - a.s.median);
    const maxMed = sorted.length ? sorted[0].s.median : 1, minMed = sorted.length ? sorted[sorted.length - 1].s.median : 0;
    sorted.forEach(c => {
      const row = document.createElement("div"); row.className = "o-clickable";
      row.style.cssText = "padding:13px 0;border-bottom:1px solid var(--sep);cursor:pointer";
      row.innerHTML = `<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px">
          <span style="font-size:15px">${c.name}</span><span style="font-size:14px;font-variant-numeric:tabular-nums">${R(c.s.median)}</span></div>
        <div style="height:5px;background:var(--bg3);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${Math.max(8, Math.round(c.s.median / maxMed * 100))}%;background:${color(c.s.median, [minMed, maxMed])};border-radius:3px"></div></div>`;
      row.onclick = c.go;
      rk.appendChild(row);
    });
  } else {
    $("rankTitle").textContent = "Valuation spread";
    if (scope) [["Lower quartile (Q1)", R(scope.q1)], ["Median", R(scope.median)], ["Upper quartile (Q3)", R(scope.q3)],
      ["Average residential", R(scope.residential_avg)]]
      .forEach(([k, v]) => { const d = document.createElement("div");
        d.style.cssText = "display:flex;justify-content:space-between;padding:13px 0;border-bottom:1px solid var(--sep);font-size:15px";
        d.innerHTML = `<span>${k}</span><span style="font-variant-numeric:tabular-nums">${v}</span>`; rk.appendChild(d); });
    else rk.innerHTML = `<div style="color:var(--label2);font-size:14px;padding-top:6px">City of Cape Town publishes valuations only via per-property online search.</div>`;
  }

  fillProp("hi", scope && scope.hi);
  fillProp("lo", scope && scope.lo);
  tlEnabled = !!scope;
  ["hiCard", "loCard"].forEach(id => { const el = $(id); if (el) { el.style.cursor = scope ? "pointer" : "default"; el.style.pointerEvents = scope ? "auto" : "none"; } });
  // roll ≠ market price: rolls state "market value" as at the valuation date, for rating purposes —
  // an area's values can sit well off today's sale prices. Said once, wherever values are shown.
  const CAVEAT = " Values are municipal valuations as at each roll's date — set for rates, not today's sale prices.";
  $("dashNote").textContent = !scope
    ? "Cape Town publishes no downloadable roll — values are search-only at the City, so it can't be aggregated here."
    : (isMuni
    ? "Dashed lines on the map are ward boundaries (Municipal Demarcation Board), for orientation."
    : "Recomputed from each area's latest published valuation roll.") + CAVEAT;

  // richer stat sections (each auto-hides when its data is absent)
  renderValueDist(scope);
  renderComposition(scope);
  renderStanding(p, scope, isMuni);
  renderGrowth(scope);
  renderAfford(scope);
  renderQuality(scope);
  renderAuthorities(scope);
  renderPolitics(scope);
}

function fillProp(id, pr) {
  if (!pr) { $(id + "Addr").textContent = "—"; $(id + "Sub").textContent = ""; $(id + "Val").textContent = ""; $(id + "Meta").textContent = ""; return; }
  $(id + "Addr").textContent = pr.address || "Unnamed erf";
  $(id + "Sub").textContent = [pr.suburb, pr.muni].filter(Boolean).join(" · ");
  $(id + "Val").textContent = R(pr.value);
  const ppm = pr.extent ? " · R" + N(Math.round(pr.value / pr.extent)) + "/m²" : "";
  $(id + "Meta").textContent = (pr.extent ? N(pr.extent) + " m²" : "extent n/a") + ppm;
}

/* ============================ "a closer look" — richer stats ============================ */
const CATCOL = { res: cssVar("--cat-res"), com: cssVar("--cat-com"), agri: cssVar("--cat-agri"), state: cssVar("--cat-state"), vacant: cssVar("--cat-vacant"), other: cssVar("--cat-other") };
const CATLAB = { res: "Residential", com: "Business", agri: "Agricultural", state: "State / municipal", vacant: "Vacant", other: "Other" };
const CATORDER = ["res", "com", "agri", "state", "vacant", "other"];
function renderCloser(s) {
  const sec = $("closer");
  if (!s || s.gini == null) { sec.style.display = "none"; return; }   // hide where the roll lacks the data
  sec.style.display = "block";
  const prov = STATS.province, tiles = [];
  if (s.q1 != null && s.q3 != null) tiles.push(["Typical home · middle 50%", R(s.q1) + " – " + R(s.q3), "the central half, ignoring extremes"]);
  if (s.median) { const mm = s.mean / s.median; tiles.push(["Average ÷ median", mm.toFixed(1) + "×", mm >= 1.3 ? "a few pricey properties lift the average" : "the average tracks the typical home"]); }
  if (s.std != null) tiles.push(["Standard deviation", R(s.std), s.cv ? "σ is " + s.cv.toFixed(1) + "× the average" : "spread of values"]);
  // Gini = concentration of ASSESSED VALUE across parcels (not household wealth). Prefer the
  // residential-only figure: the pooled one also absorbs the property-type mix (farms vs homes).
  const g = s.res_gini != null ? s.res_gini : s.gini;
  tiles.push([s.res_gini != null ? "Home-value concentration · Gini" : "Value concentration · Gini",
    g.toFixed(2), (g >= .6 ? "very concentrated" : g >= .45 ? "concentrated" : "relatively even")
    + (s.res_gini != null ? " · homes only, not household wealth" : " · all property types pooled")]);
  if (s.top1_share != null) tiles.push(["Top 1% of parcels hold", Math.round(s.top1_share * 100) + "%", "of the area's total value"]);
  if (s.ppm_median) tiles.push(["Median home · per m²", "R" + N(s.ppm_median) + "/m²", "value per square metre"]);
  if (s.erf_median) tiles.push(["Median home erf", N(s.erf_median) + " m²", "typical plot size"]);
  if (s.vacant_share != null) tiles.push(["Vacant parcels", Math.round(s.vacant_share * 100) + "%", "undeveloped land"]);
  if (s !== prov && s.median && prov.median) { const r = s.median / prov.median; tiles.push(["vs Western Cape median", r.toFixed(1) + "×", r >= 1 ? "pricier than the province" : "cheaper than the province"]); }
  $("statTiles").innerHTML = tiles.map(([l, v, n]) => `<div class="stile"><div class="stl">${esc(l)}</div><div class="stv">${esc(v)}</div><div class="stn">${esc(n)}</div></div>`).join("");
  renderCatMix(s);
}
function renderCatMix(s) {
  const el = $("catMix"), mix = s.cat_mix;
  if (!mix) { el.innerHTML = ""; return; }
  const totC = CATORDER.reduce((a, k) => a + (mix[k] ? mix[k].count : 0), 0);
  const totV = CATORDER.reduce((a, k) => a + (mix[k] ? mix[k].value : 0), 0);
  if (!totC) { el.innerHTML = ""; return; }
  const seg = (metric, tot) => CATORDER.filter(k => mix[k] && mix[k][metric] > 0)
    .map(k => `<div style="width:${(mix[k][metric] / tot * 100).toFixed(2)}%;background:${CATCOL[k]}" title="${CATLAB[k]}"></div>`).join("");
  const legend = CATORDER.filter(k => mix[k] && mix[k].count > 0).map(k =>
    `<div class="clg"><span class="csw" style="background:${CATCOL[k]}"></span>${CATLAB[k]} <span class="cpct">${totC ? Math.round(mix[k].count / totC * 100) : 0}% parcels · ${totV ? Math.round(mix[k].value / totV * 100) : 0}% value</span></div>`).join("");
  el.innerHTML = `<div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--label2);margin-bottom:14px">Property mix</div>` +
    `<div class="cmrow"><div class="cmlab">Share of parcels</div><div class="cmbar">${seg("count", totC)}</div></div>` +
    `<div class="cmrow"><div class="cmlab">Share of value</div><div class="cmbar">${seg("value", totV)}</div></div>` +
    `<div class="cmleg">${legend}</div>`;
}

function renderHist(hist, total) {
  const el = $("distChart"); el.innerHTML = "";
  if (!hist) { el.innerHTML = `<div style="color:var(--label2);font-size:14px;padding:24px 0">No distribution data for this area.</div>`; return; }
  const labels = STATS.buckets, n = hist.length, max = Math.max(...hist, 1);
  // horizontal bars read top-to-bottom — the natural fit for the narrow place panel
  el.innerHTML = hist.map((cnt, i) => {
    const w = Math.max(cnt ? 3 : 0, Math.round(cnt / max * 100));
    const col = d3.interpolateRgbBasis(RAMP)(n > 1 ? i / (n - 1) : .5);
    return `<div style="display:flex;align-items:center;gap:11px;padding:4px 0">
      <div style="flex:0 0 76px;font-size:11.5px;color:var(--ink2);text-align:right;font-variant-numeric:tabular-nums">${esc(labels[i])}</div>
      <div style="flex:1;height:20px;background:var(--bg3);border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${w}%;background:${col};border-radius:3px"></div></div>
      <div style="flex:0 0 48px;font-size:11.5px;color:var(--ink);text-align:right;font-variant-numeric:tabular-nums">${N(cnt)}</div>
    </div>`;
  }).join("");
}

/* ============================ richer place-panel sections (M5) ============================ */
// Each reuses the existing design system (.stile tiles, hairline rows, .kpinum hero, one accent)
// and auto-hides its whole .dsec wrapper when the data is absent — modelled on renderCloser.
function showSec(id, on) { const el = $(id); if (el) el.style.display = on ? "block" : "none"; return on; }
// value `v` is escaped, exactly like renderCloser's tiles (safe by default)
const tilesHTML = tiles => `<div class="statgrid">` + tiles.map(([l, v, n]) =>
  `<div class="stile"><div class="stl">${esc(l)}</div><div class="stv">${esc(v)}</div><div class="stn">${esc(n || "")}</div></div>`).join("") + `</div>`;
// hairline label→value row; `v` is raw HTML (caller escapes any user-derived text)
const hairRow = (l, v) => `<div style="display:flex;justify-content:space-between;gap:14px;padding:12px 0;border-bottom:1px solid var(--sep);font-size:14px">` +
  `<span style="color:var(--ink2)">${esc(l)}</span><span style="font-variant-numeric:tabular-nums;text-align:right">${v}</span></div>`;
// left-aligned label→value row for PROSE (authorities); label fixed-width, value wraps left
const aRow = (l, v) => `<div style="display:flex;gap:14px;padding:11px 0;border-bottom:1px solid var(--sep);font-size:14px">` +
  `<span style="flex:0 0 132px;color:var(--ink2)">${esc(l)}</span><span style="flex:1;min-width:0">${v}</span></div>`;

// Value distribution — P10–P90 spread hero + residential R/m² & land-size middle-50%
function renderValueDist(s) {
  if (!showSec("secValueDist", !!(s && s.p10 != null && s.p90 != null))) return;
  const ratio = s.p90_p10_ratio ? ` · the 90th percentile is ${s.p90_p10_ratio}× the 10th` : "";
  const hero = `<div style="margin-bottom:16px"><div class="kpinum" style="font-size:24px">${R(s.p10)} – ${R(s.p90)}</div>` +
    `<div style="font-size:12px;color:var(--label2);margin-top:8px;line-height:1.5">the middle 80% of valuations (10th–90th percentile)${ratio}</div></div>`;
  const tiles = [];
  if (s.ppm_q1 != null && s.ppm_q3 != null) tiles.push(["Home R/m² · middle 50%", "R" + N(s.ppm_q1) + " – R" + N(s.ppm_q3),
    s.ppm_p90 ? "top-decile homes ≈ R" + N(s.ppm_p90) + "/m²" : "residential price per m²"]);
  if (s.erf_q1 != null && s.erf_q3 != null) tiles.push(["Home erf · middle 50%", N(s.erf_q1) + " – " + N(s.erf_q3) + " m²", "typical residential plot range"]);
  $("secValueDistBody").innerHTML = hero + (tiles.length ? tilesHTML(tiles) : "");
}

// Composition — per-category medians, vacant-land value, outlier counts
function renderComposition(s) {
  const tiles = [], mix = s && s.cat_mix;
  if (mix) ["res", "com", "agri", "state"].forEach(k => {
    const c = mix[k]; if (c && c.count > 0 && c.median != null) tiles.push([CATLAB[k] + " · median", R(c.median), N(c.count) + " parcels"]);
  });
  if (s && s.vacant_median != null) tiles.push(["Vacant land · median", R(s.vacant_median),
    s.vacant_ppm_median ? "R" + N(s.vacant_ppm_median) + "/m² undeveloped" : "undeveloped stands"]);
  if (s && s.n_under_250k != null) tiles.push(["Parcels under R250k", N(s.n_under_250k), "lowest-value band"]);
  if (s && s.n_over_10m != null) tiles.push(["Parcels over R10m", N(s.n_over_10m), s.n_over_50m != null ? N(s.n_over_50m) + " over R50m" : "high-value band"]);
  if (!showSec("secComposition", tiles.length > 0)) return;
  $("secCompositionBody").innerHTML = tilesHTML(tiles);
}

// Standing — this municipality's rank within its district + biggest suburb / category by value
function renderStanding(p, s, isMuni) {
  if (!showSec("secStanding", !!(isMuni && s && p.length >= 3))) return;
  const muni = p[2].name, dist = p[1].name;
  const sibs = DISTRICTS[dist] ? DISTRICTS[dist].munis.map(muniStat).filter(Boolean) : [];
  // all WC municipalities with a stats node — the province-wide rank next to the district one
  const wc = Object.values(STATS.districts).flatMap(d => Object.values(d.municipalities || {}));
  const rankIn = (pool, key) => { const mine = s[key]; if (mine == null) return null;
    const vals = pool.map(x => x[key]).filter(v => v != null); if (vals.length < 2) return null;
    return "#" + (vals.filter(v => v > mine).length + 1) + " of " + vals.length; };
  const rankOf = key => { const d = rankIn(sibs, key); if (!d) return null;
    const w = rankIn(wc, key); return d + (w ? ` <span style="color:var(--label2)">· WC ${w}</span>` : ""); };
  const rows = [];
  const add = (l, key) => { const r = rankOf(key); if (r) rows.push([l, r]); };
  add("Median value", "median"); add("Total roll value", "total");
  if (s.ppm_median != null) add("Home price per m²", "ppm_median");
  if (s.vacant_share != null) add("Vacant-land share", "vacant_share");
  let topTown = null; townsOf(muni).forEach(t => { if (!topTown || t.total > topTown.total) topTown = t; });
  let topCat = null; if (s.cat_mix) CATORDER.forEach(k => { const c = s.cat_mix[k]; if (c && c.value > 0 && (!topCat || c.value > topCat.value)) topCat = { k, value: c.value }; });
  let html = `<div style="font-size:12px;color:var(--label2);margin-bottom:6px">Rank among the ${sibs.length} municipalities in ${esc(dist)} · then all ${wc.filter(x => x.median != null).length} in the Western Cape</div>`;
  html += rows.map(([l, v]) => hairRow(l, v)).join("");
  if (topTown) html += hairRow("Biggest suburb by value", esc(topTown.name) + " · " + R(topTown.total));
  if (topCat) html += hairRow("Largest category by value", CATLAB[topCat.k] + " · " + R(topCat.value));
  $("secStandingBody").innerHTML = html;
}

// Change over time — growth + CAGR vs the previous roll (absent until a 2nd roll exists → hidden)
function renderGrowth(s) {
  const on = !!(s && (s.median_growth != null || s.total_growth != null || s.res_median_growth != null || s.cagr != null));
  if (!showSec("secGrowth", on)) return;
  const pct = v => (v >= 0 ? "+" : "") + (v * 100).toFixed(1) + "%";
  const col = v => v >= 0 ? "var(--ok)" : "var(--bad)";
  const gt = (l, v, n) => v == null ? "" :
    `<div class="stile"><div class="stl">${esc(l)}</div><div class="stv" style="color:${col(v)}">${pct(v)}</div><div class="stn">${esc(n || "")}</div></div>`;
  const since = s.growth_from ? "since the " + s.growth_from + " roll" : "since the previous roll";
  $("secGrowthBody").innerHTML = `<div style="font-size:12px;color:var(--label2);margin-bottom:16px">${esc(since)}</div>` +
    `<div class="statgrid">` + gt("Median value", s.median_growth) + gt("Total roll value", s.total_growth) +
    gt("Residential median", s.res_median_growth) + gt("Annualised · CAGR", s.cagr, "compound, per year") + `</div>`;
}

// Affordability — estimated monthly bond + income needed for the median home (clearly an estimate)
function renderAfford(s) {
  const prime = RATESDATA && RATESDATA.prime_rate;
  const home = s && (s.res_median || s.median);
  if (!showSec("secAfford", !!(prime && prime.pct > 0 && home > 0))) return;
  const r = prime.pct / 100 / 12, n = 240;
  const monthly = home * r / (1 - Math.pow(1 + r, -n));   // 20-yr bond, full value, at prime
  const income = monthly / 0.30;                          // banks cap the bond at ~30% of gross income
  const src = prime.source ? ` · <a href="${esc(prime.source)}" target="_blank" rel="noopener">SARB ↗</a>` : "";
  $("secAffordBody").innerHTML =
    `<div style="font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);margin-bottom:10px">Illustrative estimate</div>` +
    `<div class="kpinum" style="font-size:26px">R${N(Math.round(monthly))}<span style="font-size:14px;font-weight:600;color:var(--label2)"> /mo</span></div>` +
    `<div style="font-size:12px;color:var(--label2);margin-top:8px;line-height:1.5">estimated bond on the median home of ${R(home)}</div>` +
    tilesHTML([["Gross income needed", "R" + N(Math.round(income)) + "/mo", "at 30% of income on the bond"],
               ["Key assumptions", "prime " + prime.pct + "%", "20-year bond, no deposit"]]) +
    `<div style="font-size:11px;line-height:1.55;color:var(--label2);margin-top:12px">A rough guide to the bond only — excludes transfer duty, bond registration and legal fees; your actual rate depends on credit, deposit and bank. Prime ${esc(String(prime.pct))}% eff. ${esc(prime.effective || prime.year || "")}${src}</div>`;
}

// Data quality — how complete this roll's fields are (straight counts from the parsed roll,
// so "how much can I trust these stats" is answerable on the page; hidden where dq_* is absent)
function renderQuality(s) {
  const on = !!(s && s.dq_no_value != null);
  if (!showSec("secQuality", on)) return;
  const pct = v => v == null ? "" : (v > 0 && v < .001 ? "<0.1" : (v * 100).toFixed(1)) + "% of parcels";
  const tiles = [];
  if (s.dq_no_value > 0) tiles.push(["No value recorded", N(s.dq_no_value), pct(s.dq_no_value_share)]);
  if (s.dq_nominal > 0) tiles.push(["Nominal values · ≤ R1 000", N(s.dq_nominal), "placeholder entries in the roll"]);
  if (s.dq_no_extent > 0) tiles.push(["No recorded size", N(s.dq_no_extent), pct(s.dq_no_extent_share)]);
  if (s.dq_no_cat > 0) tiles.push(["No category", N(s.dq_no_cat), pct(s.dq_no_cat_share)]);
  $("secQualityBody").innerHTML = tiles.length
    ? `<div style="font-size:12px;color:var(--label2);margin-bottom:16px">Gaps in the published roll itself — counted, not estimated. Affected parcels are excluded from the relevant stats.</div>` + tilesHTML(tiles)
    : `<div style="font-size:12px;color:var(--label2)">No gaps detected — every parcel in this roll carries a value, size and category.</div>`;
}

// Who sets & governs these values — the municipal valuer + who to contact (from authorities.py,
// attached to each muni node by export_site.py). Two-tier: valuer/dept/objections, then the quiet
// province/national role-players. Hidden for scopes with no primary data (districts, CoCT-absent).
function renderAuthorities(s) {
  const a = s && s.authorities, p = (a && a.primary) || {};
  const link = `<div style="margin-top:16px;font-size:12.5px"><a href="guide/how-valuations-work.html">How valuations work →</a></div>`;
  const rows = [];
  const valuer = p.valuer || p.valuer_note;
  if (valuer) rows.push(aRow("Municipal valuer", esc(valuer) + (p.cycle ? ` <span style="color:var(--label2)">· ${esc(p.cycle)}</span>` : "")));
  const d = p.dept || {};
  if (d.name) rows.push(aRow("Valuations office", esc(d.name)));
  const contact = [];
  if (d.phone) contact.push(esc(d.phone));
  if (d.email) contact.push(`<a href="mailto:${esc(d.email)}">${esc(d.email)}</a>`);
  if (contact.length) rows.push(aRow("Contact", contact.join(" · ")));
  if (d.address) rows.push(aRow("Address", esc(d.address)));
  if (d.url) rows.push(aRow("Official page", `<a href="${esc(d.url)}" target="_blank" rel="noopener">Valuations page ↗</a>`));
  const o = p.objections || {};
  if (o.to) rows.push(aRow("Lodge an objection with", esc(o.to)));
  if (o.mm) rows.push(aRow("Municipal manager", esc(o.mm)));
  if (o.how) rows.push(aRow("How to object", esc(o.how)));
  if (o.form_url) rows.push(aRow("Objection form", `<a href="${esc(o.form_url)}" target="_blank" rel="noopener">Get the form ↗</a>`));
  if (!showSec("secAuthorities", rows.length > 0)) return;
  const sh = (a && a.shared) || {};
  const one = x => x && x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)} ↗</a>` : (x ? esc(x.name) : "");
  const shared = (sh.appeal_board || sh.province || sh.national)
    ? `<div style="margin-top:14px;font-size:11.5px;line-height:1.6;color:var(--label2)">Other role-players: `
      + [sh.appeal_board, sh.province, sh.national].filter(Boolean).map(one).join(" · ")
      + `. Appeals against the valuer’s decision go to the Valuation Appeal Board.</div>`
    : "";
  $("secAuthoritiesBody").innerHTML = rows.join("") + shared + link;
}

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

/* ============================ top-N properties (live DB query) ============================ */
let tlKind = "hi", tlN = 10, tlEnabled = false, tlReq = 0;
function scopeFilter() {
  const p = statePath, len = p.length;
  if (len >= 3) return { where: "muni = ?", args: [p[2].name], name: p[2].name };
  if (len === 2) { const ms = DISTRICTS[p[1].name].munis; return { where: `muni IN (${ms.map(() => "?").join(",")})`, args: ms, name: p[1].name }; }
  return { where: "", args: [], name: "the Western Cape" };
}
function openTop(kind) {
  if (!tlEnabled) return;
  tlKind = kind; tlN = 10;
  const sc = scopeFilter();
  $("tlKicker").textContent = (kind === "hi" ? "Most valuable" : "Most affordable") + " · " + sc.name;
  $("tlTitle").textContent = kind === "hi" ? "Most valuable properties" : "Most affordable homes";
  $("tlNote").textContent = kind === "hi"
    ? "All categories, ranked by municipal market value."
    : "Residential only · nominal values under R100 000 excluded.";
  [...$("tlSeg").children].forEach(b => b.classList.toggle("on", +b.dataset.n === tlN));
  $("toplist").classList.add("open"); $("toplist").setAttribute("aria-hidden", "false");
  document.documentElement.style.overflow = "hidden";
  loadTop();
}
function closeTop() {
  $("toplist").classList.remove("open"); $("toplist").setAttribute("aria-hidden", "true");
  document.documentElement.style.overflow = "";
}
async function loadTop() {
  const body = $("tlBody"); body.innerHTML = `<div style="padding:34px 0;color:var(--label2);font-size:14px">Finding properties…</div>`;
  $("tlCount").textContent = "";
  const kind = tlKind, n = tlN, req = ++tlReq, sc = scopeFilter();
  let where = "value>0", args = [];
  if (sc.where) { where += " AND " + sc.where; args = [...sc.args]; }
  if (kind === "lo") where += " AND value>=100000 AND UPPER(category) LIKE '%RES%'";
  const sql = `SELECT muni,suburb,erf,address,extent,value,tenure,category FROM prop WHERE ${where} ORDER BY value ${kind === "hi" ? "DESC" : "ASC"} LIMIT ${n}`;
  let rows = null;
  for (let attempt = 0; attempt < 2 && rows === null; attempt++) {
    try { rows = await (await ensureDB()).db.query(sql, args); }
    catch (e) { resetDB(); if (attempt === 1) { if (req === tlReq) body.innerHTML = `<div style="padding:34px 0;color:var(--bad);font-size:14px">Couldn't load the list — please try again.</div>`; return; } }
  }
  if (req !== tlReq) return;   // a newer request superseded this one
  if (!rows.length) { body.innerHTML = `<div style="padding:34px 0;color:var(--label2);font-size:14px">No properties found for this area.</div>`; return; }
  const muniScope = statePath.length >= 3;
  body.innerHTML = rows.map((r, i) => {
    const addr = esc(clAddr(r.address) || "Unnamed erf");
    const sub = esc((muniScope ? [clSub(r.suburb)] : [clSub(r.suburb), r.muni]).filter(Boolean).join(" · "));
    const cat = r.category ? `<span class="tlCat">${esc(r.category)}</span>` : "";
    const meta = (r.extent ? N(Math.round(r.extent)) + " m²" : "extent n/a") + (r.extent ? " · R" + N(Math.round(r.value / r.extent)) + "/m²" : "");
    return `<div class="tlRow"><div class="tlRank">${i + 1}</div>` +
      `<div class="tlMain"><div class="tlAddr">${addr}${cat}</div><div class="tlSub">${sub}</div></div>` +
      `<div class="tlRight"><div class="tlVal">${R(r.value)}</div><div class="tlMeta">${meta}</div></div></div>`;
  }).join("");
  $("tlCount").textContent = "Top " + rows.length;
}

/* ============================ search (area names + addresses) ============================ */
function buildAreaIndex() {
  const out = [];
  for (const d in DISTRICTS) {
    out.push({ label: d, sub: "District", go: () => navigate([wcCrumb(), { type: "district", name: d }]) });
    DISTRICTS[d].munis.forEach(m => {
      out.push({ label: m, sub: d, go: () => navigate([wcCrumb(), { type: "district", name: d }, { type: "municipality", name: m }]) });
      townsOf(m).forEach(t => out.push({ label: t.name, sub: m, go: () => navigate([wcCrumb(), { type: "district", name: d }, { type: "municipality", name: m }]) }));
    });
  }
  return out;
}
const SEARCH_PAIRS = [["search", "results"], ["msearch", "mresults"]];
function wireSearch() {
  SEARCH_PAIRS.forEach(([inId, resId]) => {
    const inp = $(inId); if (!inp) return; let timer;
    inp.addEventListener("input", () => { clearTimeout(timer); const q = inp.value.trim(); if (q.length < 2) return hideResults(); timer = setTimeout(() => runSearch(q, inId, resId), 150); });
    inp.addEventListener("focus", () => { if (inp.value.trim().length >= 2) runSearch(inp.value.trim(), inId, resId); });
  });
  document.addEventListener("click", e => { if (!e.target.closest("#search,#results,#msearch,#mresults")) hideResults(); });
}
function hideResults() { ["results", "mresults"].forEach(id => { const r = $(id); if (r) { r.hidden = true; r.innerHTML = ""; } }); }
let searchSeq = 0;
const SEARCH_NOISE = new Set(["street", "st", "straat", "str", "road", "rd", "weg", "avenue", "ave",
  "av", "laan", "lane", "ln", "drive", "dr", "rylaan", "crescent", "cres", "close", "cl", "way",
  "singel", "boulevard", "blvd", "the", "erf", "no", "nr"]);
// build an FTS5 prefix-AND query from free text: tokens become prefix terms, noise words dropped
function ftsQuery(q) {
  const toks = q.toLowerCase().split(/[^a-z0-9]+/).filter(t => t && (t.length > 1 || /[0-9]/.test(t)) && !SEARCH_NOISE.has(t));
  return toks.length ? toks.map(t => t + "*").join(" ") : null;
}
function searchRow(box, inId, label, sub, go, right) {
  const d = document.createElement("div"); d.className = "o-clickable";
  d.style.cssText = "display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:12px 14px;border-bottom:1px solid var(--sep);cursor:pointer";
  d.innerHTML = `<span style="font-size:14px;color:var(--ink)">${esc(label)}</span><span style="font-size:10.5px;letter-spacing:.04em;color:var(--label2);text-transform:uppercase;white-space:nowrap">${esc(right || sub)}</span>`;
  d.onmousedown = e => { e.preventDefault(); go(); const inp = $(inId); if (inp) inp.value = ""; if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); hideResults(); };
  box.appendChild(d);
}
function searchNote(box, text) {
  const d = document.createElement("div"); d.dataset.note = "1";
  d.style.cssText = "padding:11px 14px;font-size:11.5px;color:var(--label2);border-bottom:1px solid var(--sep)";
  d.textContent = text; box.appendChild(d); return d;
}
async function runSearch(q, inId = "search", resId = "results") {
  if (!areaIndex) areaIndex = buildAreaIndex();
  const seq = ++searchSeq, nq = norm(q), box = $(resId);
  const areas = areaIndex.filter(x => norm(x.label).includes(nq)).slice(0, 6);
  // 1) render area-name matches INSTANTLY (no waiting on the property DB)
  box.innerHTML = "";
  areas.forEach(a => searchRow(box, inId, a.label, a.sub, a.go, a.sub));
  const ph = searchNote(box, "Searching addresses…");
  box.hidden = false;
  // 2) full-text property search (matches address/suburb/erf tokens in any order), with cold-start retry
  const fts = ftsQuery(q);
  let rows = fts ? null : [];
  for (let attempt = 0; attempt < 2 && rows === null; attempt++) {
    try {
      rows = await (await ensureDB()).db.query(
        "SELECT p.muni,p.suburb,p.address,p.erf,p.extent,p.value,p.tenure,p.category FROM psearch f " +
        "JOIN prop p ON p.id=f.rowid WHERE psearch MATCH ? AND p.value>0 ORDER BY p.value DESC LIMIT 8", [fts]);
    } catch (e) { resetDB(); }
  }
  if (seq !== searchSeq) return;            // a newer keystroke superseded this query
  if (ph.parentNode) ph.remove();
  if (rows === null) {                        // DB momentarily unavailable — keep area results, don't blank out
    if (!areas.length) searchNote(box, "Address search is still loading — try again in a moment.");
    return;
  }
  rows.forEach(r => searchRow(box, inId, clAddr(r.address) || "Unnamed erf",
    [clSub(r.suburb), r.muni].filter(Boolean).join(" · "), () => openProp(r), R(r.value)));
  if (!box.children.length) searchNote(box, "No matches");
}
/* ============================ property detail + verified rates ============================ */
const RZA = v => "R" + N(Math.round(v));   // full-precision Rand (no k/m abbreviation) for rates

/* Verified municipal rates (rates.js + data/rates.json). Rendered ONLY when the
 * municipality's official tariff is on file — otherwise the block is omitted
 * entirely: no figure beats a made-up one. */
let RATESDATA = null;
getRates().then(d => { RATESDATA = d; });
function ratesBlock(r) {
  const rr = computeRates(RATESDATA, r.muni, r.category, r.tenure, r.value);
  if (!rr) return "";
  const cents = (rr.rate * 100).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return `<div class="pdTax">
      <div style="font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);margin-bottom:12px">Municipal rates · ${esc(rr.year)}</div>
      <div class="pdStat"><span class="k">Per year</span><span class="v" style="font-family:var(--font-ui);font-weight:600;font-size:19px">${RZA(rr.annual)}</span></div>
      <div class="pdStat" style="border-bottom:none"><span class="k">Per month</span><span class="v">${RZA(rr.monthly)}</span></div>
      <div style="font-size:11px;line-height:1.55;color:var(--label2);margin-top:10px">${esc(cents)}c/R${rr.reduction ? " on value above " + RZA(rr.reduction) : ""}${rr.source ? ` · <a href="${esc(rr.source)}" target="_blank" rel="noopener">Official tariff ↗</a>` : ""}</div>
    </div>`;
}
function openProp(r) {
  $("pdKicker").textContent = [clSub(r.suburb), r.muni].filter(Boolean).join(" · ");
  $("pdAddr").textContent = clAddr(r.address) || "Unnamed erf";
  const ppm = r.extent ? "R" + N(Math.round(r.value / r.extent)) + " / m²" : "—";
  const stats = [
    ["Erf / unit", r.erf || "—"],
    ["Category", r.category || "—"],
    ["Extent", r.extent ? N(Math.round(r.extent)) + " m²" : "—"],
    ["Value per m²", ppm],
    ["Municipality", r.muni || "—"],
  ];
  $("pdBody").innerHTML =
    `<div class="pdVal">${R(r.value)}</div>` +
    `<div style="font-size:12px;color:var(--label2);margin-bottom:14px">municipal market value · ${YEAR}</div>` +
    stats.map(([k, v]) => `<div class="pdStat"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join("") +
    ratesBlock(r) +
    `<div id="pdGo" class="o-clickable">View ${esc(r.muni || "area")} on the map →</div>`;
  $("pdGo").onclick = () => { const f = muniByName[r.muni]; closeProp();
    if (f) navigate([wcCrumb(), { type: "district", name: f.properties.district }, { type: "municipality", name: r.muni }]); };
  $("propdetail").classList.add("open"); $("propdetail").setAttribute("aria-hidden", "false");
  document.documentElement.style.overflow = "hidden";
}
function closeProp() { $("propdetail").classList.remove("open"); $("propdetail").setAttribute("aria-hidden", "true"); document.documentElement.style.overflow = ""; }

async function ensureDB() {
  if (dbw) return dbw;
  if (!dbwPromise) dbwPromise = (async () => {
    const mod = await import("https://cdn.jsdelivr.net/npm/sql.js-httpvfs@0.8.12/+esm");
    const createDbWorker = mod.createDbWorker || mod.default.createDbWorker;
    const abs = p => new URL(p, location.href).href;
    // The search DB is served from Supabase Storage, NOT GitHub Pages. sql.js-httpvfs reads the
    // DB via HTTP Range requests; GitHub Pages (and jsDelivr) gzip responses and serve ranges
    // against the COMPRESSED bytes, so SQLite reads garbage and every search returns nothing.
    // Supabase Storage serves raw byte-ranges (no transfer compression) with CORS — verified.
    // config.json's urlPrefix ("search.db.") resolves the chunks relative to this configUrl.
    const DB_CONFIG = "https://nxeasppmwvzcqbbgrdvf.supabase.co/storage/v1/object/public/valuations/v3/config.json";
    const w = await createDbWorker([{ from: "jsonconfig", configUrl: DB_CONFIG }],
      abs("assets/vendor/sqlite.worker.js"), abs("assets/vendor/sql-wasm.wasm"));
    // Cold-start can hand back an empty wasm buffer — verify before caching. Then fault in the hot
    // pages the first real search / top-N will need, so they don't pay the whole cold B-tree descent
    // (the boot pre-warm ran only SELECT 1 before). Best-effort, in the background before any query.
    await w.db.query("SELECT 1");
    try {
      await w.db.query("SELECT rowid FROM psearch WHERE psearch MATCH ? LIMIT 1", ["a*"]);
      await w.db.query("SELECT value FROM prop WHERE value>0 ORDER BY value DESC LIMIT 1");
    } catch (_) { /* best-effort warm-up; an older-schema DB just stays cold */ }
    dbw = w; return w;
  })().catch(e => { dbwPromise = null; throw e; });   // never cache a broken worker; allow a clean retry
  return dbwPromise;
}
function resetDB() { dbw = null; dbwPromise = null; }
