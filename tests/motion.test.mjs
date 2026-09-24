import { test } from 'node:test'; import assert from 'node:assert/strict';
const { dur, reducedMotion } = await import('../assets/motion.js');
test('dur is 0 under reduced motion, else the value', () => {
  globalThis.matchMedia = () => ({ matches: true }); assert.equal(reducedMotion(), true); assert.equal(dur(900), 0);
  globalThis.matchMedia = () => ({ matches: false }); assert.equal(dur(900), 900);
});
