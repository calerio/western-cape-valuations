async (page) => {
  // Renamed places: the map labels places by their former names (data/geo/renamed-places/overrides.json),
  // on both basemaps and in both languages, and the place search finds them by either name.
  // Label text is read by evaluating the layer's live text-field expression against the rendered feature
  // (queryRenderedFeatures), falling back to the loaded tile features (querySourceFeatures) when the
  // label lost a collision at that zoom; `via` records which one answered.
  const BASE = 'http://127.0.0.1:8766/';
  const ctx = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 120)));
  await p.goto(BASE + 'plain.html', { waitUntil: 'load' });
  await p.waitForFunction(() => window._map && window._map.isStyleLoaded());
  await p.evaluate(() => new Promise(r => { const m = window._map; if (m.loaded()) r(); else m.once('idle', r); }));
  const out = { errs };
  const idle = () => p.evaluate(() => new Promise(r => { const m = window._map; if (m.loaded()) r(); else m.once('idle', r); }));
  const jump = (lng, lat, z) => p.evaluate(([lng, lat, z]) => new Promise(r => { const m = window._map; m.once('idle', r); m.jumpTo({ center: [lng, lat], zoom: z }); }), [lng, lat, z]);
  // label of the feature with tile id `fid` on `layer`, plus every rendered label on that layer
  const label = (layer, fid) => p.evaluate(([layer, fid]) => {
    const m = window._map;
    const ev = (e, f) => {
      if (!Array.isArray(e)) return e;
      const a = e.slice(1), P = f.properties || {};
      switch (e[0]) {
        case 'case': for (let i = 0; i + 1 < a.length; i += 2) if (ev(a[i], f)) return ev(a[i + 1], f); return ev(a[a.length - 1], f);
        case 'coalesce': for (const x of a) { const v = ev(x, f); if (v != null) return v; } return null;
        case 'get': return P[a[0]] ?? null;
        case 'has': return a[0] in P;
        case 'id': return f.id ?? null;
        case 'all': return a.every(x => ev(x, f));
        case 'any': return a.some(x => ev(x, f));
        case '==': return ev(a[0], f) === ev(a[1], f);
        case '!=': return ev(a[0], f) !== ev(a[1], f);
        case 'in': { const h = ev(a[1], f); return Array.isArray(h) ? h.includes(ev(a[0], f)) : String(h).includes(ev(a[0], f)); }
        case 'literal': return a[0];
        case 'concat': return a.map(x => ev(x, f) ?? '').join('');
        case 'to-string': return String(ev(a[0], f) ?? '');
        default: return '?' + e[0];
      }
    };
    const tf = m.getLayoutProperty(layer, 'text-field');
    const rendered = m.queryRenderedFeatures({ layers: [layer] });
    let f = rendered.find(x => x.id === fid), via = 'rendered';
    if (!f) { via = 'source'; f = m.querySourceFeatures('openmaptiles', { sourceLayer: 'place' }).find(x => x.id === fid); }
    return { text: f ? ev(tf, f) : null, via: f ? via : 'none', tileName: f ? f.properties.name : null,
      all: rendered.map(x => ev(tf, x)) };
  }, [layer, fid]);
  const GR = 302117011, NB = 2627216491;

  // 1. province zoom, EN, Map basemap
  let z = await p.evaluate(() => window._map.getZoom());
  let gr = await label('label_town', GR);
  if (gr.via === 'none') { await jump(24.53, -32.25, 7); z = 7; gr = await label('label_town', GR); }
  out.zoom = +z.toFixed(2);
  out.enMap = gr.text; out.enMapVia = gr.via; out.tileName = gr.tileName;
  out.sobukweShown = gr.all.includes('Robert Sobukwe Town') || gr.all.includes('Robert Sobukwe');
  // 2. Afrikaans
  await p.click('button[data-lang="af"]');
  await p.waitForTimeout(800); await idle();
  out.afMap = (await label('label_town', GR)).text;
  // 3. Satellite
  await p.click('button[data-basemap="sat"]');
  await p.waitForTimeout(800); await idle();
  const s = await label('label_town', GR);
  out.afSat = s.text; out.sobukweSat = s.all.includes('Robert Sobukwe Town');
  await p.click('button[data-lang="en"]');
  await p.waitForTimeout(800); await idle();
  out.enSat = (await label('label_town', GR)).text;
  // 4. Nieu-Bethesda at zoom 11 (tiles say "Kwa Noheleni")
  await jump(24.5537, -31.8651, 11);
  const nb = await label('label_town', NB);
  out.nieuBethesda = nb.text; out.nieuBethesdaTile = nb.tileName; out.nieuBethesdaVia = nb.via;
  // a non-place label layer is never rewritten
  out.poiUntouched = await p.evaluate(() => !JSON.stringify(window._map.getLayoutProperty('poi_transit', 'text-field')).includes('Graaff-Reinet'));
  // credits line
  out.creditNote = await p.evaluate(() => { const a = document.querySelector('#attrib .attribNote a'); return a ? [a.textContent, a.getAttribute('href')] : null; });

  // 5. search
  const search = async (q) => {
    await p.fill('#placeSearch', '');
    await p.fill('#placeSearch', q);
    await p.waitForSelector('#placeResults .sRow', { timeout: 8000 });
    await p.waitForTimeout(300);
    return p.evaluate(() => [...document.querySelectorAll('#placeResults .sRow')].map(r => ({
      renamed: r.dataset.renamed === '1', name: r.querySelector('.sName').textContent, ctx: r.querySelector('.sCtx').textContent, title: r.title || '' })));
  };
  const cam = () => p.evaluate(() => { const m = window._map; return [...m.getCenter().toArray(), m.getZoom()].map(v => +v.toFixed(3)); });
  const rs = await search('Robert Sobukwe');
  const rs0 = rs.find(r => r.renamed);
  out.searchSobukwe = rs0;
  out.searchSobukweOk = !!rs0 && rs0.name === 'Graaff-Reinet' && /official: Robert Sobukwe/.test(rs0.ctx) && /Robert Sobukwe/.test(rs0.title);

  const gt = await search('Grahamstown');
  const gi = gt.findIndex(r => r.renamed && r.name === 'Grahamstown');
  out.searchGrahamstown = gt[gi];
  await p.evaluate((i) => { const el = document.querySelectorAll('#placeResults .sRow')[i]; el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); }, gi);
  await p.waitForTimeout(1500); await idle();
  out.camGrahamstown = await cam();
  out.flewGrahamstown = Math.abs(out.camGrahamstown[0] - 26.53) < 0.05 && Math.abs(out.camGrahamstown[1] + 33.31) < 0.05 && Math.abs(out.camGrahamstown[2] - 12) < 0.3;
  out.inputTitle = await p.evaluate(() => document.getElementById('placeSearch').title);

  const um = await search('Umhlanga Rocks');
  const ui = um.findIndex(r => r.renamed && r.name === 'Umhlanga Rocks');
  out.searchUmhlanga = um[ui];
  const before = await cam();
  await p.evaluate((i) => { const el = document.querySelectorAll('#placeResults .sRow')[i]; el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); }, ui);
  await p.waitForTimeout(1200);
  out.camUmhlanga = await cam();
  out.umhlangaStayed = JSON.stringify(before) === JSON.stringify(out.camUmhlanga);
  out.umhlangaNote = !!out.searchUmhlanga && /outside the map area/.test(out.searchUmhlanga.ctx);
  out.hint = await p.evaluate(() => { const h = document.getElementById('maphint'); return h && !h.hidden ? h.textContent : null; });

  out.verdict = (out.enMap === 'Graaff-Reinet' && !out.sobukweShown && out.afMap === 'Graaff-Reinet' && out.afSat === 'Graaff-Reinet' &&
    out.enSat === 'Graaff-Reinet' && !out.sobukweSat && out.nieuBethesda === 'Nieu-Bethesda' && out.poiUntouched && !!out.creditNote &&
    out.searchSobukweOk && out.flewGrahamstown && out.umhlangaNote && out.umhlangaStayed && !errs.length) ? 'PASS' : 'FAIL';
  await ctx.close(); return out;
}
