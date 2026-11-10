import test from 'node:test';
import assert from 'node:assert/strict';
import { createMotionEstimator } from '../src/eval/motionState.js';

const feed = (fn, tilt = 0) => {
  const m = createMotionEstimator();
  let out;
  for (let k = 0; k <= 10; k++) out = m.observe(k * 0.1, fn(k * 0.1), tilt);
  return out;
};

test('classifies driving direction, turning and balance states', () => {
  assert.deepEqual(['moving', 'forward'], Object.values(feed((t) => ({ u: -1 + 0.3 * t, w: 0, heading: 0 }))).slice(0, 2));
  assert.deepEqual(['moving', 'backward'], Object.values(feed((t) => ({ u: -1 - 0.3 * t, w: 0, heading: 0 }))).slice(0, 2));
  assert.deepEqual(['turning', 'left'], Object.values(feed((t) => ({ u: 0, w: 0, heading: 1.5 * t }))).slice(0, 2));
  assert.deepEqual(['turning', 'right'], Object.values(feed((t) => ({ u: 0, w: 0, heading: -1.5 * t }))).slice(0, 2));
  assert.equal(feed(() => ({ u: 0.004, w: -0.003, heading: 0.002 })).state, 'balancing');
  assert.equal(feed(() => ({ u: 0, w: 0, heading: 0 }), 7).state, 'recovering');
  assert.equal(feed(() => ({ u: 0, w: 0, heading: 0 }), 60).state, 'fallen');
  assert.equal(createMotionEstimator().observe(0, null, 0).state, 'not-tracked');
});
