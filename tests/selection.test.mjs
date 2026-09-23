import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSelectionGuard, createProbeGate, lookupPath } from '../assets/selection.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

test('selection guard: only the latest token is current', () => {
  const g = createSelectionGuard();
  const a = g.begin(), b = g.begin();
  assert.equal(g.isCurrent(a), false);
  assert.equal(g.isCurrent(b), true);
  assert.equal(g.current(), b);
});

test('stale-click race: parcel A resolving AFTER parcel B can never overwrite B', async () => {
  const g = createSelectionGuard();
  const panel = { text: '' };
  const lookup = async (name, ms) => { await sleep(ms); return `result ${name}`; };
  // the same shape as map.js showValuation: begin → await lookup → render only if still current
  const show = async (name, ms) => {
    const token = g.begin();
    const r = await lookup(name, ms);
    if (!g.isCurrent(token)) return 'dropped';
    panel.text = r; return 'rendered';
  };
  const pA = show('A', 60);   // slow
  const pB = show('B', 5);    // fast, selected second
  const [ra, rb] = await Promise.all([pA, pB]);
  assert.equal(rb, 'rendered');
  assert.equal(ra, 'dropped');
  assert.equal(panel.text, 'result B');
  await sleep(80);            // nothing late may land either
  assert.equal(panel.text, 'result B');
});

test('probe gate: a throwing probe yields error and is NOT cached', async () => {
  let calls = 0;
  const gate = createProbeGate(async () => { calls++; if (calls === 1) throw new Error('network'); return true; });
  assert.equal(await gate.state(), 'error');
  assert.equal(await gate.state(), 'present');   // retried, then cached
  assert.equal(await gate.state(), 'present');
  assert.equal(calls, 2);
});

test('probe gate: absent is a proven fact and is cached; reset() re-probes', async () => {
  let calls = 0;
  const gate = createProbeGate(async () => { calls++; return false; });
  assert.equal(await gate.state(), 'absent');
  assert.equal(await gate.state(), 'absent');
  assert.equal(calls, 1);
  gate.reset();
  assert.equal(await gate.state(), 'absent');
  assert.equal(calls, 2);
});

test('probe gate: concurrent callers share one in-flight probe', async () => {
  let calls = 0;
  const gate = createProbeGate(async () => { calls++; await sleep(10); return true; });
  const r = await Promise.all([gate.state(), gate.state(), gate.state()]);
  assert.deepEqual(r, ['present', 'present', 'present']);
  assert.equal(calls, 1);
});

test('lookupPath: an error or unknown gate state never enables the heuristic', () => {
  assert.equal(lookupPath('present', false), 'link');
  assert.equal(lookupPath('absent', false), 'heuristic');
  assert.equal(lookupPath('error', false), 'unavailable');
  assert.equal(lookupPath(undefined, false), 'unavailable');
  assert.equal(lookupPath('garbage', false), 'unavailable');
  assert.equal(lookupPath('error', true), 'heuristic');   // only ?nolink=1 may choose it
});
