async (page) => {
  // Task 8: the EN/AF switch works IN PLACE on the map page — no reload, the open panel re-renders in
  // the new language (never passing through the "looking up" placeholder), the camera stays put.
  const BASE = 'http://127.0.0.1:8766/', DB = 'https://nxeasppmwvzcqbbgrdvf.supabase.co/storage/v1/object/public/valuations/b-2b502178f94f/config.json';
  const ctx = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 120)));
  await p.goto(BASE + 'plain.html?db=' + encodeURIComponent(DB) + '#p/tSTELLENBOSCH&c=18.861,-33.9366,17', { waitUntil: 'load' });
  await p.waitForFunction(() => window._map && window._map.isStyleLoaded()); await p.waitForTimeout(1500);
  await p.waitForFunction(() => window._map.queryRenderedFeatures({ layers: ['parcels-fill'] }).length > 0, null, { timeout: 30000 });
  await p.evaluate(() => { const m = window._map; const pp = m.project([18.861, -33.9366]); m.fire('click', { point: pp, lngLat: m.unproject(pp), originalEvent: {} }); });
  await p.waitForFunction(() => /possible match/.test(document.getElementById('pbody').innerText), null, { timeout: 30000 });
  const out = { errs };
  const panel = () => p.evaluate(() => document.getElementById('pbody').innerText.replace(/\s+/g, ' '));
  const cam = () => p.evaluate(() => { const m = window._map; return [...m.getCenter().toArray(), m.getZoom()].map(v => +v.toFixed(5)); });
  out.panelEn = (await panel()).slice(0, 100);
  out.camBefore = await cam();
  await p.evaluate(() => { window.__marker = 1; });
  // Sample the panel every 50 ms for 1 s after the click: the AF loading line must never show,
  // the AF sub-line must appear within that second.
  await p.click('button[data-lang="af"]');
  const t0 = Date.now(); out.sawLoading = false; out.afMs = null;
  while (Date.now() - t0 < 1000) {
    const txt = await panel();
    if (/Slaan waardasie na|Looking up valuation/.test(txt)) out.sawLoading = true;
    if (out.afMs == null && /moontlike ooreenkoms/.test(txt)) out.afMs = Date.now() - t0;
    await p.waitForTimeout(50);
  }
  out.panelAf = (await panel()).slice(0, 100);
  out.marker = await p.evaluate(() => window.__marker === 1);
  out.navEntries = await p.evaluate(() => performance.getEntriesByType('navigation').length);
  out.htmlLang = await p.evaluate(() => document.documentElement.lang);
  out.title = await p.evaluate(() => document.title);
  out.camAfter = await cam();
  out.camSame = JSON.stringify(out.camBefore) === JSON.stringify(out.camAfter);
  await p.click('button[data-lang="en"]');
  try { await p.waitForFunction(() => /possible match/.test(document.getElementById('pbody').innerText), null, { timeout: 3000 }); } catch (e) { }
  out.panelBack = (await panel()).slice(0, 100);
  out.backEn = /possible match/.test(out.panelBack) && !/moontlike ooreenkoms/.test(out.panelBack);
  out.htmlLangBack = await p.evaluate(() => document.documentElement.lang);
  out.markerBack = await p.evaluate(() => window.__marker === 1);
  out.verdict = (!out.sawLoading && out.afMs != null && out.marker && out.navEntries === 1 && out.htmlLang === 'af' &&
    out.camSame && out.backEn && out.htmlLangBack === 'en' && out.markerBack && !errs.length) ? 'PASS' : 'FAIL';
  await ctx.close(); return out;
}
