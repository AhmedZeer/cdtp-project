import test from 'node:test';
import assert from 'node:assert/strict';
import { markerFrame } from '../src/utils/markerFrame.js';

test('marker frame uses canonical +X/+Y directions and remains attached under rotation', () => {
  let corners = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }];
  for (let rotation = 0; rotation < 4; rotation++) {
    const frame = markerFrame(corners);
    assert.ok(frame);
    for (const [key, corner] of [['x', corners[1]], ['y', corners[3]]]) {
      const axis = { x: frame[key].x - frame.origin.x, y: frame[key].y - frame.origin.y };
      assert.ok(Math.abs(Math.hypot(axis.x, axis.y) - 70) < 1e-6);
      assert.ok(axis.x * (corner.x - corners[0].x) + axis.y * (corner.y - corners[0].y) > 0);
    }
    corners = corners.map(({ x, y }) => ({ x: -y, y: x }));
  }
});

test('degenerate corners do not produce invalid arrow coordinates', () => {
  assert.equal(markerFrame(Array.from({ length: 4 }, () => ({ x: 10, y: 10 }))), null);
});
