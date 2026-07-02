import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

/* ============================ config / tokens ============================ */
const W = 1000, H = 760, MAXK = 46;
const RAMP = ["#dbe5c6", "#a8cdb2", "#5fa286", "#2f7d6b", "#15514a"];   // deeper steps = clearer on small screens
const ACCENT = "#1f6f63";
const LAND = "#e6e0d3", NODATA = "#d9d2c2";
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
let curK = 1, statePath = [];
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
  navigate([], false);
  wireSearch(); $("reset").onclick = () => { $("search").value = ""; navigate([], true); };
  $("scrollcue").onclick = () => statePath.length && scrollTo({ top: innerHeight * 0.96, behavior: "smooth" });
  $("mback").onclick = () => { if (statePath.length) { navigate(statePath.slice(0, -1)); scrollTo({ top: 0, behavior: "smooth" }); } };
  let rzT; addEventListener("resize", () => { clearTimeout(rzT); rzT = setTimeout(() => { if (statePath.length) renderDash(statePath); }, 200); });

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
  DISTF.features.forEach(f => { DISTRICTS[name(f)] = { feature: f, munis: [] }; });
  MUNIF.features.forEach(f => {
    muniByName[name(f)] = f;
    const d = f.properties.district;
    if (DISTRICTS[d]) DISTRICTS[d].munis.push(name(f));
  });
  Object.values(DISTRICTS).forEach(d => d.munis.sort());
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
    .attr("stroke", d => name(d) === "Western Cape" ? "#1a1714" : "none")
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
    .attr("stroke", "#fbf9f3").attr("stroke-width", 1.1).attr("vector-effect", "non-scaling-stroke")
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
    .attr("stroke", "#fbf9f3").attr("stroke-width", 1).attr("vector-effect", "non-scaling-stroke")
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
    .attr("stroke", "#fbf9f3").attr("stroke-opacity", .6)
    .attr("stroke-width", 0.8).attr("vector-effect", "non-scaling-stroke")
    .attr("stroke-dasharray", `${4 / k} ${3 / k}`);
  gWard.selectAll("text").data(feats, f => f.properties.ward_id).join("text")
    .attr("x", f => path.centroid(f)[0]).attr("y", f => path.centroid(f)[1])
    .attr("text-anchor", "middle").attr("dy", ".32em")
    .attr("fill", "#fbf9f3").attr("fill-opacity", .8)
    .attr("stroke", "rgba(26,23,20,.55)").attr("stroke-width", 2.5 / k).attr("paint-order", "stroke")
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
function zoom(feats, animate) {
  let b = null; feats.forEach(f => { const bb = path.bounds(f); b = b ? [[Math.min(b[0][0], bb[0][0]), Math.min(b[0][1], bb[0][1])], [Math.max(b[1][0], bb[1][0]), Math.max(b[1][1], bb[1][1])]] : bb; });
  const dx = b[1][0] - b[0][0], dy = b[1][1] - b[0][1], cx = (b[0][0] + b[1][0]) / 2, cy = (b[0][1] + b[1][1]) / 2;
  let k = Math.max(1, Math.min(MAXK, 0.84 / Math.max(dx / W, dy / H)));
  curK = k;
  gNode.style.transition = animate ? "transform .95s cubic-bezier(.4,0,.2,1)" : "none";
  gNode.style.transform = `translate(${W / 2 - k * cx}px,${H / 2 - k * cy}px) scale(${k})`;
}

/* ============================ labels ============================ */
function labels(len, p) {
  gLabel.selectAll("*").remove();
  let items = [];
  if (len === 0) { const c = path.centroid(PROV.features.find(f => name(f) === "Western Cape")); items = [{ t: "WESTERN CAPE", x: c[0], y: c[1], wc: true }]; }
  else if (len === 1) items = DISTF.features.map(f => { const c = path.centroid(f); return { t: name(f), x: c[0], y: c[1] }; });
  else if (len === 2) items = DISTRICTS[p[1].name].munis.map(m => muniByName[m]).filter(Boolean).map(f => { const c = path.centroid(f); return { t: name(f), x: c[0], y: c[1] }; });
  else { const f = muniByName[p[2].name]; if (f) { const c = path.centroid(f); items = [{ t: name(f), x: c[0], y: c[1] }]; } }
  const k = curK, fs = (len === 0 ? 13 : 11) / k;
  gLabel.selectAll("text").data(items).join("text")
    .attr("x", d => d.x).attr("y", d => d.y).attr("text-anchor", "middle").attr("dy", ".32em")
    .attr("fill", d => d.wc ? "#1a1714" : "#231f1a")
    .attr("stroke", "#f6f2e9").attr("stroke-width", 3 / k).attr("paint-order", "stroke")
    .attr("letter-spacing", d => d.wc ? (2 / k) + "px" : null)
    .style("font-weight", d => d.wc ? 700 : 600).style("font-size", fs + "px")
    .style("opacity", d => d.wc ? .9 : .85).text(d => d.t);
}

/* ============================ tooltip ============================ */
function tip(e, nm, st, drill) { if (innerWidth <= 720) return;   // phones: tap drills in, no off-screen tooltip
  const t = $("tip");
  t.innerHTML = `<div style="font-family:'Newsreader',serif;font-size:16px;margin-bottom:7px">${nm}</div>` +
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
  document.body.style.overflowY = len ? "auto" : "hidden";
  $("scrollcue").style.display = len ? "flex" : "none";
  $("dash").hidden = !len;
  if (!len) scrollTo({ top: 0 });
  hideResults();
  renderChrome(p);
}

/* ============================ chrome + dashboard ============================ */
function renderChrome(p) {
  const len = p.length;
  $("headline").textContent = len === 0 ? "South Africa" : len === 1 ? "Western Cape" : p[len - 1].name;
  $("subline").textContent = len === 0 ? "Tap the Western Cape to begin"
    : len === 1 ? "Five districts and a metro" : len === 2 ? "Local municipalities" : "Municipal valuation roll";

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
    if (i) { const sep = document.createElement("span"); sep.textContent = "›"; sep.style.cssText = "font-size:13px;color:#bdb6a8"; $("crumbs").appendChild(sep); }
    const a = document.createElement("span"); a.textContent = s.label; a.className = "o-clickable";
    a.style.cssText = "font-size:13px;font-weight:500;color:#1a1714;cursor:pointer"; a.onclick = s.go; $("crumbs").appendChild(a);
  });

  // legend (extent of currently displayed set)
  let e, lt;
  if (len >= 2) { e = ext(DISTRICTS[p[1].name].munis.map(m => med(muniStat(m)))); lt = "MEDIAN VALUE · MUNICIPALITY"; }
  else { e = ext(Object.keys(DISTRICTS).map(d => med(distStat(d)))); lt = "MEDIAN VALUE · DISTRICT"; }
  $("legendTitle").textContent = lt; $("legendMin").textContent = R(e[0]); $("legendMax").textContent = R(e[1]);

  if (len >= 1) renderDash(p);
}

function renderDash(p) {
  const len = p.length, isMuni = len >= 3;
  let scope, children = [], kindP, scopeName, kicker;
  if (len === 1) { scope = provStat(); scopeName = "Western Cape"; kicker = "WESTERN CAPE PROVINCE"; kindP = "Districts";
    children = DISTF.features.map(f => ({ name: name(f), s: distStat(name(f)), go: () => navigate([wcCrumb(), { type: "district", name: name(f) }]) })); }
  else if (len === 2) { const dl = p[1].name; scope = distStat(dl); scopeName = dl; kicker = dl.toUpperCase() + " DISTRICT"; kindP = "Municipalities";
    children = DISTRICTS[dl].munis.map(m => ({ name: m, s: muniStat(m), go: () => navigate([wcCrumb(), { type: "district", name: dl }, { type: "municipality", name: m }]) })); }
  else { const m = p[2].name; scope = muniStat(m); scopeName = m; kicker = m.toUpperCase() + " · " + p[1].name.toUpperCase(); }

  $("dashKicker").textContent = kicker;
  $("scopeLabel").textContent = scopeName;
  $("scopeSub").textContent = !scope ? "No public valuation roll"
    : isMuni ? "Valuation roll · " + (scope.cycle || YEAR)
    : children.filter(c => c.s).length + " " + kindP.toLowerCase() + " · current valuation rolls";
  $("statMedian").textContent = scope ? R(scope.median) : "—";
  $("statAvg").textContent = scope ? R(scope.mean ?? scope.avg) : "—";
  $("statTotal").textContent = scope ? R(scope.total) : "—";
  $("statParcels").textContent = scope ? N(scope.properties || scope.valued) : "—";

  renderHist(scope && scope.hist, scope ? (scope.properties || scope.valued) : 0);
  renderCloser(scope);

  const rk = $("ranked"); rk.innerHTML = "";
  if (!isMuni && scope) {
    $("rankTitle").textContent = kindP + " ranked"; $("rankSub").textContent = "by median value";
    const sorted = children.filter(c => c.s && c.s.median != null).sort((a, b) => b.s.median - a.s.median);
    const maxMed = sorted.length ? sorted[0].s.median : 1, minMed = sorted.length ? sorted[sorted.length - 1].s.median : 0;
    sorted.forEach(c => {
      const row = document.createElement("div"); row.className = "o-clickable";
      row.style.cssText = "padding:13px 0;border-bottom:1px solid rgba(26,23,20,.09);cursor:pointer";
      row.innerHTML = `<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px">
          <span style="font-size:15px">${c.name}</span><span style="font-size:14px;font-variant-numeric:tabular-nums">${R(c.s.median)}</span></div>
        <div style="height:5px;background:rgba(26,23,20,.07);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${Math.max(8, Math.round(c.s.median / maxMed * 100))}%;background:${color(c.s.median, [minMed, maxMed])};border-radius:3px"></div></div>`;
      row.onclick = () => { c.go(); scrollTo({ top: 0, behavior: "smooth" }); };
      rk.appendChild(row);
    });
  } else {
    $("rankTitle").textContent = "Valuation spread"; $("rankSub").textContent = scope ? (scope.cycle || "") : "";
    if (scope) [["Lower quartile (Q1)", R(scope.q1)], ["Median", R(scope.median)], ["Upper quartile (Q3)", R(scope.q3)],
      ["Average residential", R(scope.residential_avg)]]
      .forEach(([k, v]) => { const d = document.createElement("div");
        d.style.cssText = "display:flex;justify-content:space-between;padding:13px 0;border-bottom:1px solid rgba(26,23,20,.09);font-size:15px";
        d.innerHTML = `<span>${k}</span><span style="font-variant-numeric:tabular-nums">${v}</span>`; rk.appendChild(d); });
    else rk.innerHTML = `<div style="color:#9a9286;font-size:14px;padding-top:6px">City of Cape Town publishes valuations only via per-property online search.</div>`;
  }

  fillProp("hi", scope && scope.hi);
  fillProp("lo", scope && scope.lo);
  tlEnabled = !!scope;
  ["hiCard", "loCard"].forEach(id => { const el = $(id); if (el) { el.style.cursor = scope ? "pointer" : "default"; el.style.pointerEvents = scope ? "auto" : "none"; } });
  $("hiHint").style.display = scope ? "block" : "none";
  $("loHint").style.display = scope ? "block" : "none";
  $("dashNote").textContent = !scope
    ? "The City of Cape Town does not publish a downloadable valuation roll — values are available only through its per-property online search, so it can't be aggregated here."
    : isMuni
    ? "Municipality is the finest level with public valuation stats. The dashed lines on the map are the municipality's WARD boundaries (Municipal Demarcation Board) — shown for orientation; suburb/town borders aren't published as open data."
    : "Figures are recomputed live from each area's most recent published valuation roll. Cycles differ by municipality.";
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
const CATCOL = { res: "#2f7d6b", com: "#c0852f", agri: "#88b39a", state: "#8a8475", vacant: "#cdbb91", other: "#ddd6c6" };
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
  tiles.push(["Value inequality · Gini", s.gini.toFixed(2), s.gini >= .6 ? "very concentrated" : s.gini >= .45 ? "concentrated" : "relatively even"]);
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
  el.innerHTML = `<div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#9a9286;margin-bottom:14px">Property mix</div>` +
    `<div class="cmrow"><div class="cmlab">Share of parcels</div><div class="cmbar">${seg("count", totC)}</div></div>` +
    `<div class="cmrow"><div class="cmlab">Share of value</div><div class="cmbar">${seg("value", totV)}</div></div>` +
    `<div class="cmleg">${legend}</div>`;
}

function renderHist(hist, total) {
  const el = $("distChart"); el.innerHTML = "";
  if (!hist) { el.innerHTML = `<div style="color:#9a9286;font-size:14px;padding:24px 0">No distribution data for this area.</div>`; return; }
  const labels = STATS.buckets, n = hist.length, max = Math.max(...hist, 1);

  if (innerWidth <= 720) {   // mobile: horizontal bars read top-to-bottom — no x-label crowding
    el.innerHTML = hist.map((cnt, i) => {
      const w = Math.max(cnt ? 3 : 0, Math.round(cnt / max * 100));
      const col = d3.interpolateRgbBasis(RAMP)(n > 1 ? i / (n - 1) : .5);
      return `<div style="display:flex;align-items:center;gap:11px;padding:5px 0">
        <div style="flex:0 0 84px;font-size:12px;color:#6f685c;text-align:right;font-variant-numeric:tabular-nums">${esc(labels[i])}</div>
        <div style="flex:1;height:22px;background:rgba(26,23,20,.05);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${w}%;background:${col};border-radius:3px"></div></div>
        <div style="flex:0 0 50px;font-size:12px;color:#1a1714;text-align:right;font-variant-numeric:tabular-nums">${N(cnt)}</div>
      </div>`;
    }).join("");
    return;
  }

  const VW = 1000, VH = 230, padL = 6, padR = 6, padT = 22, padB = 46, gap = 9;
  const chartW = VW - padL - padR, chartH = VH - padT - padB, bw = chartW / n - gap;
  const compact = v => v >= 1e6 ? (v / 1e6).toFixed(1).replace(/\.0$/, "") + "m" : v >= 1e3 ? Math.round(v / 1e3) + "k" : "" + v;
  const s = d3.select(el).append("svg").attr("viewBox", `0 0 ${VW} ${VH}`).attr("preserveAspectRatio", "xMidYMid meet").style("width", "100%").style("display", "block");
  s.append("line").attr("x1", padL).attr("x2", VW - padR).attr("y1", padT + chartH).attr("y2", padT + chartH).attr("stroke", "rgba(26,23,20,.18)");
  hist.forEach((cnt, i) => {
    const x = padL + i * (bw + gap) + gap / 2, bh = cnt / max * chartH, y = padT + chartH - bh;
    const g = s.append("g");
    g.append("rect").attr("x", x).attr("y", y).attr("width", bw).attr("height", Math.max(0, bh)).attr("rx", 1.5)
      .attr("fill", d3.interpolateRgbBasis(RAMP)(n > 1 ? i / (n - 1) : .5))
      .on("mouseenter mousemove", e => tipHist(e, labels[i], cnt, total)).on("mouseleave", tipHide);
    if (cnt) g.append("text").attr("x", x + bw / 2).attr("y", y - 6).attr("text-anchor", "middle")
      .style("font-size", "11px").style("font-variant-numeric", "tabular-nums").attr("fill", "#6f685c").text(compact(cnt));
    g.append("text").attr("x", x + bw / 2).attr("y", padT + chartH + 18).attr("text-anchor", "middle")
      .style("font-size", "10.5px").attr("fill", "#9a9286").text(labels[i]);
  });
}
function tipHist(e, label, cnt, total) {
  const t = $("tip"), pct = total ? (cnt / total * 100) : 0;
  t.innerHTML = `<div style="font-family:'Newsreader',serif;font-size:15px;margin-bottom:4px">${esc(label)}</div>` +
    `<div style="font-size:12px"><span style="opacity:.6">Parcels </span><span style="font-variant-numeric:tabular-nums">${N(cnt)}</span> · ${pct.toFixed(1)}%</div>`;
  t.style.opacity = 1; let x = e.clientX + 16, y = e.clientY + 16;
  if (x + 220 > innerWidth) x = e.clientX - 220; if (y + 80 > innerHeight) y = e.clientY - 80;
  t.style.left = x + "px"; t.style.top = y + "px";
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
    ? "All categories, ranked by municipal market value. Tags: RES home · AGRI farm · COM/BUS business · PSP/PSI state or institutional · VAC vacant."
    : "Residential only, excluding nominal/placeholder valuations under R100 000. Lowest market value first.";
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
  const body = $("tlBody"); body.innerHTML = `<div style="padding:34px 0;color:#9a9286;font-size:14px">Finding properties…</div>`;
  $("tlCount").textContent = "";
  const kind = tlKind, n = tlN, req = ++tlReq, sc = scopeFilter();
  let where = "value>0", args = [];
  if (sc.where) { where += " AND " + sc.where; args = [...sc.args]; }
  if (kind === "lo") where += " AND value>=100000 AND UPPER(category) LIKE '%RES%'";
  const sql = `SELECT muni,suburb,erf,address,extent,value,tenure,category FROM prop WHERE ${where} ORDER BY value ${kind === "hi" ? "DESC" : "ASC"} LIMIT ${n}`;
  let rows = null;
  for (let attempt = 0; attempt < 2 && rows === null; attempt++) {
    try { rows = await (await ensureDB()).db.query(sql, args); }
    catch (e) { resetDB(); if (attempt === 1) { if (req === tlReq) body.innerHTML = `<div style="padding:34px 0;color:#b8623c;font-size:14px">Couldn't load the list — please try again.</div>`; return; } }
  }
  if (req !== tlReq) return;   // a newer request superseded this one
  if (!rows.length) { body.innerHTML = `<div style="padding:34px 0;color:#9a9286;font-size:14px">No properties found for this area.</div>`; return; }
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
  d.style.cssText = "display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:12px 14px;border-bottom:1px solid rgba(26,23,20,.06);cursor:pointer";
  d.innerHTML = `<span style="font-size:14px;color:#1a1714">${esc(label)}</span><span style="font-size:10.5px;letter-spacing:.04em;color:#9a9286;text-transform:uppercase;white-space:nowrap">${esc(right || sub)}</span>`;
  d.onmousedown = e => { e.preventDefault(); go(); const inp = $(inId); if (inp) inp.value = ""; if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); hideResults(); };
  box.appendChild(d);
}
function searchNote(box, text) {
  const d = document.createElement("div"); d.dataset.note = "1";
  d.style.cssText = "padding:11px 14px;font-size:11.5px;color:#9a9286;border-bottom:1px solid rgba(26,23,20,.06)";
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
        "SELECT p.muni,p.suburb,p.address,p.erf,p.extent,p.value,p.category FROM psearch f " +
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
/* ============================ property detail + rates estimator ============================ */
const DEFAULT_RATE = 0.9;   // cents per Rand — typical WC residential rate-in-the-rand (editable)
const RZA = v => "R" + N(Math.round(v));   // full-precision Rand (no k/m abbreviation) for rates
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
    `<div style="font-size:12px;color:#9a9286;margin-bottom:14px">municipal market value · ${YEAR}</div>` +
    stats.map(([k, v]) => `<div class="pdStat"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join("") +
    `<div class="pdTax">
       <div style="font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#1f6f63;margin-bottom:12px">Estimated annual rates</div>
       <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
         <label for="pdRate" style="font-size:13px;color:#6f685c">Rate-in-the-rand (cents per R)</label>
         <input id="pdRate" type="number" step="0.01" min="0" inputmode="decimal" value="${DEFAULT_RATE}">
       </div>
       <div class="pdStat" style="margin-top:12px"><span class="k">≈ per year</span><span id="pdAnnual" class="v" style="font-family:'Newsreader',serif;font-size:21px"></span></div>
       <div class="pdStat" style="border-bottom:none"><span class="k">≈ per month</span><span id="pdMonthly" class="v"></span></div>
       <div style="font-size:11px;line-height:1.55;color:#9a9286;margin-top:10px">Estimate only. Annual rates = market value × the municipal rate-in-the-rand for the property's category, minus any rebate. The default is a typical Western Cape residential rate — enter ${esc(r.muni || "the municipality")}'s actual tariff (from its rates policy) for an exact figure.</div>
     </div>` +
    `<div id="pdGo" class="o-clickable">View ${esc(r.muni || "area")} on the map →</div>`;
  const calc = () => { const rate = parseFloat($("pdRate").value) || 0, ann = r.value * rate / 100;
    $("pdAnnual").textContent = RZA(ann); $("pdMonthly").textContent = RZA(ann / 12); };
  calc();
  $("pdRate").addEventListener("input", calc);
  $("pdGo").onclick = () => { const f = muniByName[r.muni]; closeProp();
    if (f) navigate([wcCrumb(), { type: "district", name: f.properties.district }, { type: "municipality", name: r.muni }]);
    scrollTo({ top: 0 }); };
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
    const DB_CONFIG = "https://nxeasppmwvzcqbbgrdvf.supabase.co/storage/v1/object/public/valuations/config.json";
    const w = await createDbWorker([{ from: "jsonconfig", configUrl: DB_CONFIG }],
      abs("assets/vendor/sqlite.worker.js"), abs("assets/vendor/sql-wasm.wasm"));
    await w.db.query("SELECT 1");   // cold-start can hand back an empty wasm buffer — verify before caching
    dbw = w; return w;
  })().catch(e => { dbwPromise = null; throw e; });   // never cache a broken worker; allow a clean retry
  return dbwPromise;
}
function resetDB() { dbw = null; dbwPromise = null; }
