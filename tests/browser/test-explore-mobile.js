async (page) => {
  // Task 11: Explore on a phone (390×844, DPR 3, touch). One column; a compact sticky bar (brand + ☰) whose
  // brand is never truncated; the headline total on the first screen; the reading-column sections as
  // <details> cards with the first two open; ☰ (#menu, a <details>) opens the view switcher + EN/AF; a
  // card opens in place; no horizontal page scroll anywhere (landing, menu open, card open, drilled).
  // Serve the worktree on :8766 (python3 -m http.server 8766).
  const OUT = '/Users/valeriocosta/projects/western-cape-property-valuations/.playwright-mcp/perf/';
  const BASE = 'http://127.0.0.1:8766/';
  const ctx = await page.context().browser().newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'en-US' });
  await ctx.addInitScript(() => { try { localStorage.setItem('wcv-lang', 'en'); } catch (e) { } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e).slice(0, 160)));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)); });
  const out = { errs };
  const overflow = () => p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  const noOverflow = o => o.sw === 390 && o.cw === 390;

  await p.goto(BASE + 'index.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => { const l = document.getElementById('loading'); return l && getComputedStyle(l).display === 'none'; }, null, { timeout: 10000 });
  await p.waitForFunction(() => document.querySelectorAll('#secValue table tbody tr').length > 0, null, { timeout: 10000 });
  await p.waitForTimeout(300);

  // no horizontal overflow on landing
  out.overflow0 = await overflow();

  // brand: the short phone form, not truncated, on one row with ☰
  out.brand = await p.evaluate(() => {
    const b = document.getElementById('brandTitle'), s = document.querySelector('#menu > summary');
    const br = b.getBoundingClientRect(), sr = s.getBoundingClientRect();
    return { text: b.innerText.trim(), sw: b.scrollWidth, cw: b.clientWidth, sameRow: Math.abs((br.top + br.bottom) / 2 - (sr.top + sr.bottom) / 2) < 12,
      summaryW: Math.round(sr.width), summaryH: Math.round(sr.height) };
  });
  out.brandOk = out.brand.cw > 0 && out.brand.sw <= out.brand.cw && out.brand.text === 'Western Cape valuations' && out.brand.sameRow
    && out.brand.summaryW >= 44 && out.brand.summaryH >= 44;

  // headline total on the first screen, single column (the rail above the reading column)
  out.total = await p.evaluate(() => {
    const e = document.getElementById('statTotal'), r = e.getBoundingClientRect();
    const rail = document.getElementById('panel').getBoundingClientRect(), col = document.getElementById('column').getBoundingClientRect();
    return { text: e.textContent.trim(), top: Math.round(r.top), bottom: Math.round(r.bottom), scrollY: scrollY,
      oneCol: col.top >= rail.bottom - 1 && Math.abs(col.width - rail.width) < 2 };
  });
  out.totalOk = /^R/.test(out.total.text) && out.total.scrollY === 0 && out.total.top >= 0 && out.total.bottom <= 844 && out.total.oneCol;

  // sections as <details> cards: first two open, the rest collapsed; each summary carries h2 + key sentence
  out.cards = await p.evaluate(() => [...document.querySelectorAll('#column > section.sec:not([hidden]) > details.card')].map(d => ({
    id: d.parentElement.id, open: d.open, h2: !!d.querySelector(':scope > summary h2'), lede: !!d.querySelector(':scope > summary .lede') })));
  const ids = out.cards.map(c => c.id);
  out.cardsOk = out.cards.length >= 4 && ids[0] === 'secValue' && ids[1] === 'secSpread'
    && out.cards.every((c, i) => c.open === (i < 2) && c.h2 && c.lede);

  // the view switcher is behind ☰: hidden, then visible after a tap; an outside tap closes it
  out.menu0 = await p.evaluate(() => {
    const m = document.getElementById('menu'), w = document.getElementById('viewsegWrap');
    return { open: m.open, visible: (w.checkVisibility ? w.checkVisibility({ visibilityProperty: true }) : true) && w.getBoundingClientRect().height > 0 };
  });
  await p.tap('#menu > summary');
  await p.waitForTimeout(150);
  out.menu1 = await p.evaluate(() => {
    const m = document.getElementById('menu'), w = document.getElementById('viewsegWrap'), r = w.getBoundingClientRect();
    const links = [...w.querySelectorAll('.viewseg a, .viewseg button')].map(a => a.getBoundingClientRect());
    return { open: m.open, visible: (w.checkVisibility ? w.checkVisibility({ visibilityProperty: true }) : true) && r.height > 0, inView: r.left >= 0 && r.right <= 390,
      items: [...w.querySelectorAll('.viewseg a, .viewseg button')].map(a => a.textContent.trim()),
      minH: Math.round(Math.min(...links.map(l => l.height))) };
  });
  out.overflowMenu = await overflow();
  await p.screenshot({ path: OUT + 'explore-mobile-menu.png' });
  // outside tap in the content below the sticky bar, without scrolling (#statTotal is on the first screen)
  const href0 = p.url(), st = await p.locator('#statTotal').boundingBox();
  await p.touchscreen.tap(st.x + st.width / 2, st.y + st.height / 2);
  await p.waitForTimeout(150);
  out.menuClosed = await p.evaluate(() => !document.getElementById('menu').open) && p.url() === href0;
  out.menuOk = !out.menu0.open && !out.menu0.visible && out.menu1.open && out.menu1.visible && out.menu1.inView &&
    ['Explore', 'Map', 'Satellite', 'EN', 'AF'].every(x => out.menu1.items.includes(x)) && out.menu1.minH >= 44 && out.menuClosed;

  // sticky compact bar: after scrolling, the brand row stays at the top and the search row has scrolled away
  await p.evaluate(() => window.scrollTo(0, 900));
  await p.waitForTimeout(150);
  out.sticky = await p.evaluate(() => {
    const b = document.querySelector('.bar-id').getBoundingClientRect(), s = document.getElementById('pHead').getBoundingClientRect();
    return { barTop: Math.round(b.top), barH: Math.round(b.height), searchBottom: Math.round(s.bottom) };
  });
  out.stickyOk = out.sticky.barTop === 0 && out.sticky.barH <= 64 && out.sticky.searchBottom <= 0;
  await p.evaluate(() => window.scrollTo(0, 0));

  // a collapsed card opens in place; the chart then fits the column
  const third = out.cards[2] && out.cards[2].id;
  if (third) {
    await p.evaluate(id => document.querySelector('#' + id + ' > details.card > summary').scrollIntoView(), third);
    await p.tap('#' + third + ' > details.card > summary');
    await p.waitForTimeout(200);
    out.cardOpen = await p.evaluate(id => {
      const d = document.querySelector('#' + id + ' > details.card'), svg = d.querySelector('.chart svg');
      const r = svg ? svg.getBoundingClientRect() : null;
      return { open: d.open, chartW: r ? Math.round(r.width) : null, chartRight: r ? Math.round(r.right) : null };
    }, third);
  }
  out.cardOpenOk = !!out.cardOpen && out.cardOpen.open && (out.cardOpen.chartRight == null || out.cardOpen.chartRight <= 390);
  out.overflowCard = await overflow();
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.screenshot({ path: OUT + 'explore-mobile-landing.png' });

  // drill into a municipality: still cards, still no overflow
  await p.evaluate(() => { location.hash = '#m/stellenbosch'; });
  await p.waitForFunction(() => document.getElementById('scopeLabel').textContent === 'Stellenbosch', null, { timeout: 8000 });
  await p.waitForTimeout(400);
  out.overflowMuni = await overflow();
  out.muniCards = await p.evaluate(() => document.querySelectorAll('#column > section.sec:not([hidden]) > details.card').length);
  await p.screenshot({ path: OUT + 'explore-mobile-muni.png' });

  // Afrikaans: the short brand has its catalogue entry and still fits
  await p.tap('#menu > summary'); await p.waitForTimeout(100);
  await p.tap('#menu button[data-lang="af"]');
  await p.waitForFunction(() => document.documentElement.lang === 'af', null, { timeout: 5000 });
  await p.waitForTimeout(300);
  out.af = await p.evaluate(() => { const b = document.getElementById('brandTitle');
    return { text: b.innerText.trim(), sw: b.scrollWidth, cw: b.clientWidth, menuLabel: document.querySelector('#menu > summary').getAttribute('aria-label') }; });
  out.afOk = out.af.text === 'Wes-Kaapse waardasies' && out.af.sw <= out.af.cw && out.af.menuLabel === 'Kieslys';
  out.overflowAf = await overflow();

  out.overflowOk = [out.overflow0, out.overflowMenu, out.overflowCard, out.overflowMuni, out.overflowAf].every(noOverflow);
  out.verdict = (out.overflowOk && out.brandOk && out.totalOk && out.cardsOk && out.menuOk && out.stickyOk && out.cardOpenOk &&
    out.muniCards >= 2 && out.afOk && !errs.length) ? 'PASS' : 'FAIL';
  await ctx.close();
  return out;
}
