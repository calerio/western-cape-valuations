async (page) => {
  // Task 8: Afrikaans basemap labels switch in place (label_town reads name:af with fallback), and the
  // renamed-places override is NOT applied yet: Graaff-Reinet's township still reads
  // "Robert Sobukwe Town" until the registry is approved. Switching back restores the EN expression.
  const BASE = 'http://127.0.0.1:8766/';
  const ctx = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 120)));
  await p.goto(BASE + 'plain.html#p/tMOSSEL BAY&c=22.13,-34.18,11', { waitUntil: 'load' });
  await p.waitForFunction(() => window._map && window._map.isStyleLoaded());
  await p.evaluate(() => new Promise(r => window._map.once('idle', r)));
  const out = { errs };
  const tf = () => p.evaluate(() => JSON.stringify(window._map.getLayoutProperty('label_town', 'text-field')));
  out.exprEnBefore = (await tf()).includes('"name:af"');                                  // false in EN
  await p.evaluate(() => { window.__marker = 1; });
  await p.click('button[data-lang="af"]');
  await p.waitForTimeout(1000);
  out.navEntries = await p.evaluate(() => performance.getEntriesByType('navigation').length);
  out.marker = await p.evaluate(() => window.__marker === 1);
  out.htmlLang = await p.evaluate(() => document.documentElement.lang);
  out.exprAf = (await tf()).includes('"name:af"');
  await p.evaluate(() => new Promise(r => { const m = window._map; if (m.loaded()) r(); else m.once('idle', r); }));
  out.mosselbaai = await p.evaluate(() => window._map.queryRenderedFeatures({ layers: ['label_town'] })
    .some(f => f.properties['name:af'] === 'Mosselbaai'));
  await p.evaluate(() => new Promise(r => { const m = window._map; m.once('idle', r); m.jumpTo({ center: [24.53, -32.25], zoom: 9 }); }));
  out.sobukwe = await p.evaluate(() => window._map.queryRenderedFeatures({ layers: ['label_town'] })
    .some(f => f.properties.name === 'Robert Sobukwe Town'));
  out.townsHere = await p.evaluate(() => window._map.queryRenderedFeatures({ layers: ['label_town'] })
    .map(f => f.properties.name).slice(0, 12));
  await p.click('button[data-lang="en"]');
  await p.waitForTimeout(500);
  out.exprEnAfter = (await tf()).includes('"name:af"');
  out.htmlLangBack = await p.evaluate(() => document.documentElement.lang);
  out.markerBack = await p.evaluate(() => window.__marker === 1);
  out.verdict = (!out.exprEnBefore && out.navEntries === 1 && out.marker && out.htmlLang === 'af' && out.exprAf &&
    out.mosselbaai && out.sobukwe && !out.exprEnAfter && out.htmlLangBack === 'en' && out.markerBack && !errs.length) ? 'PASS' : 'FAIL';
  await ctx.close(); return out;
}
