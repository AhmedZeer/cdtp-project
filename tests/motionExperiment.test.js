import test from 'node:test';
import assert from 'node:assert/strict';
import { createMotionTracker, nextReplayFrame } from '../src/utils/motionExperiment.js';

test('return trip accumulates path while displacement returns to zero', () => {
  const tracker = createMotionTracker(), station = { x: 500, y: 0 };
  tracker.observe(0, { x: 0, y: 0 }, station);
  const outbound = tracker.observe(1000, { x: 100, y: 0 }, station);
  assert.equal(outbound.motion, 'Moving');
  assert.equal(outbound.approach, 'Approaching');
  assert.equal(outbound.speed, 100);
  const returning = tracker.observe(2000, { x: 0, y: 0 }, station);
  assert.equal(returning.path, 200);
  assert.equal(returning.displacement, 0);
  assert.equal(returning.approach, 'Leaving');
  assert.equal(tracker.observe(3000, { x: 0, y: 0 }, station).motion, 'Stationary');
});

test('missing detections break the trail and never bridge unseen distance', () => {
  const tracker = createMotionTracker();
  tracker.observe(0, { x: 0, y: 0 }, null);
  tracker.observe(100, { x: 10, y: 0 }, null);
  const lost = tracker.observe(200, null, null);
  assert.equal(lost.motion, 'Unknown');
  assert.equal(lost.displacement, null);
  assert.equal(lost.trail.at(-1), null);
  const found = tracker.observe(300, { x: 1000, y: 0 }, null);
  assert.equal(found.path, 10);
  assert.equal(found.gaps, 1);
  assert.equal(found.motion, 'Unknown');
  assert.equal(found.speed, null);
});

test('sub-deadband jitter is not accumulated as travel', () => {
  const tracker = createMotionTracker();
  tracker.observe(0, { x: 0, y: 0 }, null);
  tracker.observe(100, { x: 1, y: 0 }, null);
  assert.equal(tracker.observe(200, { x: 0, y: 0 }, null).path, 0);
});

test('station movement alone is not classified as robot approach', () => {
  const tracker = createMotionTracker();
  tracker.observe(0, { x: 0, y: 0 }, { x: 500, y: 0 });
  const result = tracker.observe(100, { x: 0, y: 0 }, { x: 250, y: 0 });
  assert.equal(result.motion, 'Stationary');
  assert.equal(result.approach, 'Unchanged');
});

test('replay uses saved times and processes frames sequentially even when late', () => {
  const frames = [0, 100, 300].map((t) => ({ t, robot: { x: t, y: 0 } }));
  const original = createMotionTracker();
  const expected = frames.map(({ t, robot }) => original.observe(t, robot, null));
  assert.equal(nextReplayFrame(frames, 1, 50), null);
  const replayed = createMotionTracker();
  for (let cursor = 0; cursor < frames.length; cursor++) {
    const frame = nextReplayFrame(frames, cursor, 1000);
    assert.deepEqual(replayed.observe(frame.t, frame.robot, null), expected[cursor]);
  }
  assert.equal(nextReplayFrame(frames, frames.length, 1000), null);
});
