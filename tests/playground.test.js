import test from 'node:test';
import assert from 'node:assert/strict';
import dictionary from '../src/utils/aruco6x6_250.json' with { type: 'json' };
import dictionary5 from '../src/utils/aruco5x5_100.json' with { type: 'json' };
import { createMarkerDetector } from '../src/utils/markerDetector.js';
import { centre, pairGeometry, moveOnPlane } from '../src/utils/playgroundGeometry.js';

function scene(tiles) {
  const width = 1080;
  const data = new Uint8Array(width * width * 4).fill(255);
  for (const { id, x, y, family = '6x6_250' } of tiles) {
    const five = family === '5x5_100';
    const book = five ? dictionary5 : dictionary;
    const cells = five ? 7 : 8;
    const half = cells * 10;
    const bits = book[id].map((b, i) => b.toString(2).padStart(i === (five ? 3 : 4) ? (five ? 1 : 4) : 8, '0')).join('');
    for (let row = 0; row < cells; row++) for (let col = 0; col < cells; col++) {
      if (row > 0 && col > 0 && row < cells - 1 && col < cells - 1 && bits[(row - 1) * (cells - 2) + col - 1] === '1') continue;
      for (let yy = 0; yy < 20; yy++) for (let xx = 0; xx < 20; xx++) {
        const p = ((y - half + row * 20 + yy) * width + x - half + col * 20 + xx) * 4;
        data[p] = data[p + 1] = data[p + 2] = 0;
      }
    }
  }
  return { width, height: width, data };
}

test('drag preserves grab offset and clamps the whole tile to the plane', () => {
  const tile = { x: 200, y: 200, size: 200 };
  assert.deepEqual(moveOnPlane(tile, { x: 410, y: 420 }, { x: 10, y: 20 }), { x: 400, y: 400, size: 200 });
  assert.deepEqual(moveOnPlane(tile, { x: -900, y: 5000 }, { x: 0, y: 0 }), { x: 100, y: 980, size: 200 });
});

test('catalog detection distinguishes mixed marker families', () => {
  const image = scene([{ id: 23, x: 250, y: 250 }, { id: 66, family: '5x5_100', x: 800, y: 750 }]);
  const markers = createMarkerDetector('catalog').detect(image);
  assert.deepEqual(markers.map(({ id, family }) => ({ id, family })), [
    { id: 23, family: '6x6_250' }, { id: 66, family: '5x5_100' },
  ]);
});

test('distance and offsets use station minus robot coordinates', () => {
  assert.deepEqual(pairGeometry({ x: 100, y: 100 }, { x: 400, y: 500 }), { dx: 300, dy: 400, distance: 500 });
});

test('pixel detection follows robot movement and measures the rendered pair', () => {
  const detector = createMarkerDetector();
  for (const x of [200, 350, 500]) {
    const markers = detector.detect(scene([{ id: 23, x, y: 250 }, { id: 98, x: 800, y: 750 }]));
    assert.deepEqual(markers.map((m) => m.id).sort((a, b) => a - b), [23, 98]);
    const robot = centre(markers.find((m) => m.id === 23).corners);
    const station = centre(markers.find((m) => m.id === 98).corners);
    assert.ok(Math.abs(robot.x - x) <= 1);
    const measured = pairGeometry(robot, station);
    assert.ok(Math.abs(measured.distance - Math.hypot(800 - x, 500)) < 1);
  }
});

test('fully hidden robot is unavailable rather than measured from scene coordinates', () => {
  const markers = createMarkerDetector().detect(scene([{ id: 98, x: 800, y: 750 }]));
  assert.equal(markers.some((m) => m.id === 23), false);
  assert.equal(markers[0].id, 98);
});
