import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimController } from '../src/sim/simController.js';
import { dockGeometry } from '../src/sim/world.js';

const seeded = (seed) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const DT = 1 / 120;

function runUntilCharging(c, limit = 90) {
  while (c.world.time < limit && !c.world.charging) c.step(DT);
  return c.world.time;
}

test('docks and starts charging from random poses anywhere in the approach region', () => {
  const times = [], failures = [];
  for (let k = 0; k < 200; k++) {
    const c = createSimController({ rng: seeded(k + 11) });
    c.placeInApproachRegion();
    const start = c.stationPose(), heading = c.world.robot.heading;
    const t = runUntilCharging(c);
    if (!c.world.charging) failures.push({ k, start, heading, state: c.dock.state, geom: dockGeometry(c.world) });
    else times.push(t);
  }
  assert.deepEqual(failures, []);
  times.sort((a, b) => a - b);
  console.log(`docking time: median ${times[100].toFixed(1)} s, worst ${times.at(-1).toFixed(1)} s`);
});

test('the region corners and a robot facing away still dock', () => {
  // Station-frame polar poses (distance from the station centre, angle off the axis, robot heading):
  // the two 45° corners at the outer edge, straight out at the edge, and close in at ±25°.
  for (const [rad, deg, h] of [[0.46, 43, 0], [0.46, -43, 1], [0.47, 0, 0], [0.37, 25, 2.5], [0.37, -25, -2.5]]) {
    const c = createSimController({ rng: seeded(5) });
    const s = c.world.station;
    const u = rad * Math.cos((deg * Math.PI) / 180), w = rad * Math.sin((deg * Math.PI) / 180);
    c.reset({ robot: { x: s.x + u * Math.cos(s.heading) - w * Math.sin(s.heading), y: s.y + u * Math.sin(s.heading) + w * Math.cos(s.heading), heading: h }, station: s });
    runUntilCharging(c);
    assert.ok(c.world.charging, `u=${u} w=${w}: ended in ${c.dock.state}`);
  }
});

test('operator commands are ignored (and reported as ignored) while the robot docks itself', () => {
  const c = createSimController({ rng: seeded(3) });
  const log = [];
  c.subscribe((name, meta) => log.push({ name, ...meta }));
  c.placeInApproachRegion();
  c.step(DT);
  assert.equal(c.dock.engaged, true);
  c.command('backward', true);
  assert.equal(c.drive(), 0);
  assert.equal(c.operatorActive(), false);
  assert.deepEqual(log, [{ name: 'backward', ignored: true }]);
  runUntilCharging(c);
  assert.ok(c.world.charging);
});

test('pull away turns charging off; putting it back turns it on again (C3.4)', () => {
  const c = createSimController({ rng: seeded(9) });
  c.placeInApproachRegion();
  runUntilCharging(c);
  c.pullAway();
  c.step(DT);
  assert.equal(c.world.charging, false);
  for (let i = 0; i < 240; i++) c.step(DT);
  assert.equal(c.world.charging, false, 'must not re-dock by itself after being pulled away');
  c.putBack();
  const t0 = c.world.time;
  runUntilCharging(c, t0 + 10);
  assert.ok(c.world.charging && c.world.time - t0 < 5);
});

test('with auto-dock off, entering the region does nothing', () => {
  const c = createSimController({ rng: seeded(4) });
  c.setAutoDock(false);
  c.placeInApproachRegion();
  for (let i = 0; i < 600; i++) c.step(DT);
  assert.equal(c.dock.state, 'idle');
  assert.equal(c.world.charging, false);
});
