async (page) => {
  // Task 13 delivery screenshots: 3 pages × EN/AF × desktop 1440×900 / phone 390×844 = 12 PNGs in
  // docs/design-2026-09/screenshots/<page>-<lang>-<viewport>.png, viewport only. Budget 400 KB each:
  // a phone shot is taken at deviceScaleFactor 3 and retaken at 2 if it is over; any shot still over
  // is retaken at scale 'css' (1 px per CSS px) and flagged. Returns every file with its bytes and
  // the scale used. Needs the site on BASE (python3 -m http.server 8766 in the worktree).
  const BASE = 'http://127.0.0.1:8766/';
  const OUT = '/Users/valeriocosta/projects/western-cape-valuations-design/docs/design-2026-09/screenshots/';
  const BUDGET = 400 * 1024;
  const STELL = '#p/tSTELLENBOSCH&c=18.861,-33.9366,17&s=W024C067002200001942000000';
  const PAGES = [
    { name: 'index', url: 'index.html', kind: 'explore' },
    { name: 'plain', url: 'plain.html' + STELL, kind: 'map' },
    { name: 'map', url: 'map.html' + STELL + '&b=sat', kind: 'map' },
  ];
  const PHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
  const VIEWS = [
    { name: 'desktop', opts: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
    { name: 'phone', opts: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: PHONE_UA } },
  ];
  const browser = page.context().browser();
  const results = [];

  async function ready(p, kind) {
    if (kind === 'explore') {
      await p.waitForFunction(() => { const e = document.getElementById('loading'); return !!e && getComputedStyle(e).display === 'none'; }, null, { timeout: 60000 });
      await p.evaluate(async () => { if (document.fonts) await document.fonts.ready; });
      await p.waitForTimeout(1500);                                      // first-paint reveal + charts
      return true;
    }
    await p.waitForFunction(() => window._map && window._map.isStyleLoaded(), null, { timeout: 60000 });
    let parcels = true;
    try {
      await p.waitForFunction(() => { try { return window._map.queryRenderedFeatures({ layers: ['parcels-fill'] }).length > 0; } catch (_) { return false; } }, null, { timeout: 45000 });
    } catch (_) { parcels = false; }
    // the deep-linked s= opens the panel once its lookup lands; give it time, then wait for idle tiles
    try { await p.waitForFunction(() => { const b = document.getElementById('pbody'); return !!b && b.innerText.trim().length > 25 && !/Looking up|Soek/i.test(b.innerText); }, null, { timeout: 30000 }); } catch (_) {}
    await p.evaluate(() => new Promise(r => { const m = window._map; if (m.loaded()) r(); else { m.once('idle', r); setTimeout(r, 15000); } }));
    await p.waitForTimeout(1200);
    return parcels;
  }

  async function shoot(pg, lang, view, dsf) {
    const ctx = await browser.newContext({ ...view.opts, deviceScaleFactor: dsf, locale: lang === 'af' ? 'af-ZA' : 'en-ZA' });
    await ctx.addInitScript(l => { try { localStorage.setItem('wcv-lang', l); } catch (_) {} }, lang);
    const p = await ctx.newPage();
    const errors = []; p.on('pageerror', e => errors.push(String(e).slice(0, 160)));
    let ok = true, parcels = null;
    try {
      await p.goto(BASE + pg.url, { waitUntil: 'load', timeout: 90000 });
      parcels = await ready(p, pg.kind);
    } catch (e) { ok = false; errors.push('ready: ' + String(e.message || e).slice(0, 160)); }
    const htmlLang = await p.evaluate(() => document.documentElement.lang).catch(() => null);
    const file = OUT + `${pg.name}-${lang}-${view.name}.png`;
    let buf = await p.screenshot({ path: file, type: 'png', fullPage: false });
    let scale = 'dsf' + dsf;
    if (buf.length > BUDGET && dsf === 1) {                              // desktop: 1× already; nothing smaller in PNG
      scale = 'dsf1 (over budget)';
    }
    await ctx.close();
    return { file, bytes: buf.length, scale, ok, parcels, htmlLang, errors };
  }

  for (const pg of PAGES) for (const lang of ['en', 'af']) for (const view of VIEWS) {
    let r = await shoot(pg, lang, view, view.opts.deviceScaleFactor);
    if (r.bytes > BUDGET && view.opts.deviceScaleFactor > 2) r = await shoot(pg, lang, view, 2);
    if (r.bytes > BUDGET && view.opts.deviceScaleFactor > 1) r = await shoot(pg, lang, view, 1);
    results.push({ ...r, name: `${pg.name}-${lang}-${view.name}.png`, overBudget: r.bytes > BUDGET });
  }
  return {
    files: results.map(r => ({ name: r.name, bytes: r.bytes, kb: Math.round(r.bytes / 1024), scale: r.scale, overBudget: r.overBudget,
      ready: r.ok, parcels: r.parcels, htmlLang: r.htmlLang, errors: r.errors })),
    overBudget: results.filter(r => r.overBudget).map(r => r.name),
    allReady: results.every(r => r.ok),
  };
}
