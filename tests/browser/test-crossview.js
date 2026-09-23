async (page) => {
  // Explore ↔ Map context (spec §3): #m/<slug> frames the municipality on the map; the map's Explore
  // link carries the municipality under the centre; Explore's "Open the map" link carries its scope.
  const BASE = 'http://127.0.0.1:8766/';
  const ctx = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage();
  const errors = []; p.on('pageerror', e => errors.push(String(e)));
  const out = {};
  await p.goto(BASE + 'plain.html#m/stellenbosch', { waitUntil: 'load' });
  await p.waitForFunction(() => window._map && window._map.isStyleLoaded(), null, { timeout: 30000 });
  await p.waitForFunction(() => window._map.getZoom() > 8 && !window._map.isMoving(), null, { timeout: 15000 });
  await p.waitForTimeout(800);                                   // moveend debounce (300 ms) + hash write
  out.zoom = await p.evaluate(() => +window._map.getZoom().toFixed(2));
  out.containsCentroid = await p.evaluate(() => window._map.getBounds().contains([18.86, -33.93]));
  out.exploreHref = await p.evaluate(() => document.querySelector('#viewsegWrap a[data-i18n="Explore"]').getAttribute('href'));
  out.mapHash = await p.evaluate(() => location.hash);
  // pan to Swellendam's town centre: the Explore link follows the centre
  await p.evaluate(() => window._map.jumpTo({ center: [20.44, -34.02], zoom: 11 }));
  await p.waitForTimeout(800);
  out.exploreHrefAfterPan = await p.evaluate(() => document.querySelector('#viewsegWrap a[data-i18n="Explore"]').getAttribute('href'));
  await p.goto(BASE + 'index.html#m/swellendam', { waitUntil: 'load' });
  await p.waitForFunction(() => /#m\/swellendam$/.test(document.querySelector('a[data-maplink][data-i18n="Open the map"]').getAttribute('href') || ''), null, { timeout: 20000 }).catch(() => {});
  out.openMapHref = await p.evaluate(() => document.querySelector('a[data-maplink][data-i18n="Open the map"]').getAttribute('href'));
  out.errors = errors;
  out.verdict = (out.zoom > 8 && out.containsCentroid && /#m\/stellenbosch$/.test(out.exploreHref)
    && /#m\/swellendam$/.test(out.exploreHrefAfterPan) && out.openMapHref === 'plain.html#m/swellendam' && errors.length === 0) ? 'PASS' : 'FAIL';
  await ctx.close(); return out;
}
