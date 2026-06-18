import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const svg = d3.select("#map");
const tip = $("#tip");
const fmtR = n => {
  if (n == null) return "—";
  const a = Math.abs(n);
  if (a >= 1e9) return "R" + (n / 1e9).toFixed(2) + " bn";
  if (a >= 1e6) return "R" + (n / 1e6).toFixed(2) + " m";
  if (a >= 1e3) return "R" + Math.round(n / 1e3) + "k";
  return "R" + n;
};
const fmtFull = n => n == null ? "—" : "R" + Math.round(n).toLocaleString("en-ZA").replace(/,/g, " ");
const num = n => n == null ? "—" : n.toLocaleString("en-ZA").replace(/,/g, " ");

/* ---------- state ---------- */
let STATS, PROV, DIST, MUNI;        // stats.json + geojson feature collections
let path, projection, layers;
let level = 0, curScale = 1, sel = { district: null, muni: null };
let dbw = null;

const W = () => $("#stage").clientWidth, H = () => $("#stage").clientHeight;

/* ---------- boot ---------- */
(async function () {
  try {
    [STATS, PROV, DIST, MUNI] = await Promise.all([
      fetch("data/stats.json").then(r => r.json()),
      fetch("data/geo/za-provinces.geojson").then(r => r.json()),
      fetch("data/geo/wc-districts.geojson").then(r => r.json()),
      fetch("data/geo/wc-municipalities.geojson").then(r => r.json()),
    ]);
  } catch (e) {
    $("#loading").textContent = "Map data not found yet (boundaries still loading). " + e;
    return;
  }
  [PROV, DIST, MUNI].forEach(fixWinding);   // D3 needs clockwise exterior rings
  layers = svg.append("g").attr("id", "layers");
  setupProjection();
  drawNational();
  renderMeta();
  $("#loading").classList.add("gone");
  window.addEventListener("resize", debounce(() => { setupProjection(); redraw(); }, 200));
  $("#back").addEventListener("click", goUp);
  initSearch();
})();

/* GeoJSON from RFC-7946 sources is wound CCW; D3 reads that as the polygon's
   complement (fills the whole sphere). Detect via spherical area and reverse. */
function fixWinding(fc) {
  const rev = rings => rings.forEach(r => r.reverse());
  for (const f of fc.features) {
    if (d3.geoArea(f) > 2 * Math.PI) {
      const g = f.geometry;
      if (g.type === "Polygon") rev(g.coordinates);
      else if (g.type === "MultiPolygon") g.coordinates.forEach(rev);
    }
  }
}

function setupProjection() {
  projection = d3.geoMercator().fitExtent([[10, 10], [W() - 10, H() - 10]], PROV);
  path = d3.geoPath(projection);
}

/* ---------- colour ---------- */
function colorScale(features, statOf) {
  const vals = features.map(f => statOf(f)?.median).filter(v => v != null);
  const dom = vals.length ? [d3.min(vals), d3.max(vals)] : [0, 1];
  return d3.scaleSequential(dom, t => d3.interpolateRgb("#21305c", "#79d0ff")(Math.sqrt(t)));
}

/* ---------- statistics lookups ---------- */
const provStat = () => STATS.province;
const distStat = name => STATS.districts[name];
const muniStat = (name, district) => STATS.districts[district]?.municipalities[name];

/* ---------- NATIONAL ---------- */
function drawNational() {
  level = 0; sel = { district: null, muni: null };
  layers.selectAll("*").remove();
  layers.append("g").selectAll("path").data(PROV.features).join("path")
    .attr("class", d => "prov" + (isWC(d) ? " wc" : ""))
    .attr("d", path)
    .attr("vector-effect", "non-scaling-stroke")
    .on("click", (e, d) => { if (isWC(d)) enterProvince(); })
    .on("mousemove", (e, d) => { if (isWC(d)) showTip(e, "Western Cape", provStat()); })
    .on("mouseleave", hideTip);
  zoomReset();
  crumbs(); $("#back").hidden = true; $("#hint").classList.remove("gone");
  document.body.classList.remove("entered"); window.scrollTo(0, 0);
  renderPanel();           // panel exists but page not scrollable yet
}
const isWC = d => /western\s*cape/i.test(name(d));
const name = d => d.properties.name || d.properties.NAME || d.properties.PROVINCE || "";

/* ---------- PROVINCE (districts) ---------- */
function enterProvince() {
  level = 1; sel = { district: null, muni: null };
  $("#hint").classList.add("gone");
  document.body.classList.add("entered");
  $("#search").disabled = false;
  drawRegions(DIST.features, d => distStat(name(d)), enterDistrict, "district");
  zoomToFeatures(DIST.features);
  crumbs(); $("#back").hidden = false;
  renderPanel();
}

/* ---------- DISTRICT (municipalities) ---------- */
function enterDistrict(d) {
  sel = { district: name(d), muni: null }; level = 2;
  const feats = MUNI.features.filter(f => f.properties.district === sel.district);
  drawRegions(feats, f => muniStat(name(f), sel.district), enterMuni, "muni");
  zoomToFeatures(feats);
  crumbs(); renderPanel();
}

/* ---------- MUNICIPALITY ---------- */
function enterMuni(f) {
  sel.muni = name(f); level = 3;
  const feats = MUNI.features.filter(x => name(x) === sel.muni);
  drawRegions(feats, x => muniStat(name(x), sel.district), null, "muni");
  zoomToFeatures(feats);
  crumbs(); renderPanel();
}

/* ---------- region renderer ---------- */
function drawRegions(features, statOf, onClick, kind) {
  const col = colorScale(features, statOf);
  layers.selectAll("*").remove();
  const g = layers.append("g");
  g.selectAll("path").data(features, d => name(d)).join("path")
    .attr("class", "region")
    .attr("d", path)
    .attr("vector-effect", "non-scaling-stroke")
    .attr("fill", d => { const s = statOf(d); return s?.median != null ? col(s.median) : "#1a2140"; })
    .style("cursor", onClick ? "pointer" : "default")
    .on("click", (e, d) => onClick && onClick(d))
    .on("mousemove", (e, d) => showTip(e, name(d), statOf(d)))
    .on("mouseleave", hideTip);
  g.selectAll("text").data(features).join("text")
    .attr("class", "lbl")
    .attr("transform", d => `translate(${path.centroid(d)})`)
    .text(d => name(d));
  setTimeout(() => layers.selectAll(".lbl").classed("show", true), 250);
}

/* ---------- zoom (Apple-ish) ---------- */
function zoomToFeatures(features) {
  const fc = { type: "FeatureCollection", features };
  const [[x0, y0], [x1, y1]] = path.bounds(fc);
  const w = W(), h = H();
  const scale = Math.min(10, 0.86 / Math.max((x1 - x0) / w, (y1 - y0) / h));
  const tx = w / 2 - scale * (x0 + x1) / 2, ty = h / 2 - scale * (y0 + y1) / 2;
  applyTransform(tx, ty, scale);
}
function zoomReset() { applyTransform(0, 0, 1); }
function applyTransform(tx, ty, scale) {
  curScale = scale;
  layers.transition().duration(950).ease(d3.easeCubicInOut)
    .attr("transform", `translate(${tx},${ty}) scale(${scale})`)
    .on("end", () => layers.selectAll(".lbl").attr("font-size", (11 / scale) + "px"));
  layers.selectAll(".lbl").transition().duration(950).attr("font-size", (11 / scale) + "px");
}
function redraw() {
  layers.selectAll("path").attr("d", path);
  layers.selectAll(".lbl").attr("transform", d => `translate(${path.centroid(d)})`);
}

/* ---------- navigation ---------- */
function goUp() {
  if (level === 3) enterDistrict({ properties: { name: sel.district } });
  else if (level === 2) enterProvince();
  else if (level === 1) drawNational();
}
function crumbs() {
  const c = $("#crumbs"); c.innerHTML = "";
  const add = (label, fn, last) => {
    if (c.children.length) c.insertAdjacentHTML("beforeend", '<span class="sep">›</span>');
    const a = document.createElement(last ? "span" : "a"); a.textContent = label;
    if (!last) a.onclick = fn; c.appendChild(a);
  };
  if (level >= 1) add("Western Cape", drawNational, level === 1);
  if (level >= 2) add(sel.district, () => enterDistrict({ properties: { name: sel.district } }), level === 2);
  if (level >= 3) add(sel.muni, null, true);
}

/* ---------- tooltip ---------- */
function showTip(e, nm, s) {
  tip.hidden = false;
  tip.innerHTML = `<h4>${nm}</h4>` + (s ? `
    <div class="row"><span>Total</span><b>${fmtR(s.total)}</b></div>
    <div class="row"><span>Median</span><b>${fmtR(s.median)}</b></div>
    <div class="row"><span>Properties</span><b>${num(s.properties || s.valued)}</b></div>`
    : `<div class="row"><span>No public roll</span></div>`);
  tip.style.left = e.clientX + "px"; tip.style.top = e.clientY + "px";
}
function hideTip() { tip.hidden = true; }

/* ---------- scroll panel ---------- */
function renderPanel() {
  const p = $("#panel");
  let s, title, kids = [], kidStat;
  if (level <= 1) { s = provStat(); title = "Western Cape"; kids = Object.values(STATS.districts); kidStat = d => d; }
  else if (level === 2) { s = distStat(sel.district); title = sel.district + " District"; kids = Object.values(STATS.districts[sel.district].municipalities); kidStat = d => d; }
  else { s = muniStat(sel.muni, sel.district); title = sel.muni; }
  if (!s) { p.innerHTML = `<h2>${title}</h2><p style="color:var(--muted);margin-top:10px">No public valuation roll (City of Cape Town is search-only).</p>`; return; }
  const cell = (k, v, sub) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;
  let html = `<h2>${title}<small>${level <= 1 ? "Province" : level === 2 ? "District" : "Municipality"}</small></h2>
    <div class="statgrid">
      ${cell("Total value", fmtR(s.total))}
      ${cell("Properties", num(s.properties || s.valued))}
      ${cell("Median", fmtR(s.median))}
      ${cell("Average", fmtR(s.mean))}
      ${cell("Avg residential", fmtR(s.residential_avg), "≈ per house")}
      ${cell("Lowest – Highest", fmtR(s.min) + " – " + fmtR(s.max))}
      ${cell("Q1 – Q3", fmtR(s.q1) + " – " + fmtR(s.q3))}
      ${cell("Cycle", s.cycle || "—")}
    </div>`;
  if (kids.length) {
    const max = d3.max(kids, k => k.total) || 1;
    html += `<h2>By ${level <= 1 ? "district" : "municipality"}<small>total value</small></h2><div class="bars">` +
      kids.sort((a, b) => b.total - a.total).map(k => `
        <div class="bar" data-name="${k.name}"><span class="name">${k.name}</span>
        <span class="track"><span class="fill" style="width:${Math.max(2, 100 * k.total / max)}%"></span></span>
        <span class="amt">${fmtR(k.total)}</span></div>`).join("") + `</div>`;
  }
  p.innerHTML = html;
  p.querySelectorAll(".bar").forEach(b => b.onclick = () => {
    const nm = b.dataset.name;
    if (level <= 1) enterDistrict({ properties: { name: nm } });
    else if (level === 2) { const f = MUNI.features.find(x => name(x) === nm); if (f) enterMuni(f); }
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

function renderMeta() {
  const p = provStat();
  $("#meta").textContent = `${num(p.properties)} properties · ${fmtR(p.total)} · 24 municipalities`;
}

/* ---------- search (sql.js-httpvfs) ---------- */
async function initSearch() {
  const input = $("#search"), box = $("#results");
  let timer;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 3) { box.hidden = true; return; }
    timer = setTimeout(() => runSearch(q, box), 180);
  });
  document.addEventListener("click", e => { if (!$("#searchwrap").contains(e.target)) box.hidden = true; });
}
async function ensureDB() {
  if (dbw) return dbw;
  const mod = await import("https://cdn.jsdelivr.net/npm/sql.js-httpvfs@0.8.12/+esm");
  const createDbWorker = mod.createDbWorker || mod.default.createDbWorker;
  const abs = p => new URL(p, location.href).href;   // worker resolves URLs against itself
  dbw = await createDbWorker(
    [{ from: "jsonconfig", configUrl: abs("data/db/config.json") }],
    abs("assets/vendor/sqlite.worker.js"),
    abs("assets/vendor/sql-wasm.wasm")
  );
  return dbw;
}
async function runSearch(q, box) {
  let rows = [];
  try {
    const db = (await ensureDB()).db;
    rows = await db.query(
      "SELECT muni,suburb,erf,address,value FROM prop WHERE address LIKE ? COLLATE NOCASE AND value>0 ORDER BY value DESC LIMIT 25",
      [q + "%"]);
  } catch (e) { box.innerHTML = `<li>Search unavailable: ${e}</li>`; box.hidden = false; return; }
  if (!rows.length) { box.innerHTML = "<li>No matches</li>"; box.hidden = false; return; }
  box.innerHTML = rows.map(r => `<li data-muni="${r.muni}">
      <span class="v">${fmtR(r.value)}</span>
      <span class="a">${r.address || "Erf " + r.erf}</span><br>
      <span class="s">${[r.suburb, r.muni].filter(Boolean).join(" · ")}</span></li>`).join("");
  box.hidden = false;
  box.querySelectorAll("li").forEach(li => li.onclick = () => {
    const m = li.dataset.muni; box.hidden = true;
    const f = MUNI.features.find(x => name(x) === m);
    if (f) { sel.district = f.properties.district; if (!document.body.classList.contains("entered")) enterProvince(); enterMuni(f); }
  });
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
