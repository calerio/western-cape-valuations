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
