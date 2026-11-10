import test from 'node:test';
import assert from 'node:assert/strict';
import { refineCorners } from '../src/utils/cornerRefine.js';

/** Greyscale image of a dark quadrilateral on white, 4×4 supersampled and sRGB-encoded like a render. */
function render(quad, width = 200, height = 200) {
  const inside = (x, y) => quad.every((a, i) => {
    const b = quad[(i + 1) % 4];
    return (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) >= 0;
  });
  const data = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let dark = 0;
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) dark += inside(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4) ? 1 : 0;
    // Blend in linear light, then sRGB-encode, as a renderer or phone camera does.
    const lin = (0.87 * (16 - dark) + 0.01 * dark) / 16;
    data[y * width + x] = Math.round(255 * (lin <= 0.0031308 ? 12.92 * lin : 1.055 * lin ** (1 / 2.4) - 0.055));
  }
  return { width, height, data };
}

test('refined corners land on the true outline although the coarse corners are pulled 3 px inside', () => {
  const c = { x: 100, y: 100 }, half = 35, rot = 0.37;
  // Clockwise in image coordinates, like the detector's output.
  const truth = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => ({
    x: c.x + half * (u * Math.cos(rot) - v * Math.sin(rot)), y: c.y + half * (u * Math.sin(rot) + v * Math.cos(rot)),
  }));
  const grey = render(truth);
  const coarse = truth.map((p) => { const dx = c.x - p.x, dy = c.y - p.y, n = Math.hypot(dx, dy); return { x: Math.round(p.x + (dx / n) * 3), y: Math.round(p.y + (dy / n) * 3) }; });
  const refined = refineCorners(grey, coarse);
  refined.forEach((p, i) => assert.ok(Math.hypot(p.x - truth[i].x, p.y - truth[i].y) < 0.2, `corner ${i}: ${JSON.stringify(p)} vs ${JSON.stringify(truth[i])}`));
});

test('too-small or off-image markers are returned unchanged', () => {
  const grey = render([{ x: 10, y: 10 }, { x: 18, y: 10 }, { x: 18, y: 18 }, { x: 10, y: 18 }], 40, 40);
  const tiny = [{ x: 10, y: 10 }, { x: 18, y: 10 }, { x: 18, y: 18 }, { x: 10, y: 18 }];
  assert.deepEqual(refineCorners(grey, tiny), tiny);
});
