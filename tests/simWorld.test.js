import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, stepWorld, requestTurn, dockGeometry, telemetryPacket, wrapAngle } from '../src/sim/world.js';
import { ROBOT, STATION, PHYSICS_HZ } from '../src/sim/simConfig.js';

const dt = 1 / PHYSICS_HZ;
const run = (world, drive, seconds) => { for (let i = 0; i < Math.round(seconds * PHYSICS_HZ); i++) stepWorld(world, drive, dt); };
const open = () => createWorld({ robot: { x: -0.8, y: 0, heading: 0 }, station: { x: 5, y: 5, heading: Math.PI } });

test('left and right commands turn exactly 90 degrees in place', () => {
  const w = open();
  requestTurn(w, 'left');
  run(w, 0, 2);
  assert.equal(w.robot.turnTarget, null);
  assert.ok(Math.abs(wrapAngle(w.robot.heading - Math.PI / 2)) < 1e-9);
  assert.ok(Math.abs(w.robot.x + 0.8) < 1e-9 && Math.abs(w.robot.y) < 1e-9, 'turn is in place');
  requestTurn(w, 'right'); run(w, 0, 2);
  requestTurn(w, 'right'); run(w, 0, 2);
  assert.ok(Math.abs(wrapAngle(w.robot.heading + Math.PI / 2)) < 1e-9);
});

test('a turn takes about a second and ignores a second request mid-turn', () => {
  const w = open();
  assert.equal(requestTurn(w, 'left'), true);
  run(w, 0, 0.3);
  assert.equal(requestTurn(w, 'left'), false);
  run(w, 0, 1.2);
  assert.ok(Math.abs(wrapAngle(w.robot.heading - Math.PI / 2)) < 1e-9);
});

test('forward drives along the heading at the speed limit; release brakes to a stop', () => {
  const w = open();
  run(w, 1, 3);
  assert.ok(Math.abs(w.robot.v - ROBOT.maxSpeed) < 1e-9);
  assert.ok(w.robot.x > -0.8 + 0.8 && Math.abs(w.robot.y) < 1e-9);
  assert.equal(w.command, 'forward');
  run(w, 0, 1);
  assert.equal(w.robot.v, 0);
  assert.equal(w.command, 'stop');
  const x = w.robot.x;
  run(w, -1, 1);
  assert.ok(w.robot.x < x);
});

test('the body leans into acceleration and settles upright', () => {
  const w = open();
  run(w, 1, 0.2);
  assert.ok(w.robot.pitch > 0.01, 'leans forward while accelerating');
  run(w, 1, 3);
  assert.ok(Math.abs(w.robot.pitch) < 0.002);
  assert.ok(Math.abs(telemetryPacket(w).tilt) < 0.2);
});

test('the robot cannot drive through the station', () => {
  const w = createWorld({ robot: { x: 0, y: 0, heading: 0 }, station: { x: 1, y: 0, heading: Math.PI } });
  run(w, 1, 6);
  const g = dockGeometry(w);
  assert.ok(g.frontGap > -1e-6, `front gap ${g.frontGap}`);
  assert.ok(w.robot.x < 1);
});

test('docking head-on starts charging after the CHG delay; leaving stops it', () => {
  const w = createWorld({ robot: { x: 0, y: 0, heading: 0 }, station: { x: 1, y: 0, heading: Math.PI } });
  run(w, 1, 5);
  run(w, 0, 0.3);
  assert.equal(w.docked, true);
  run(w, 0, STATION.chargeDelay);
  assert.equal(w.charging, true);
  assert.equal(telemetryPacket(w).charging, true);
  const before = w.battery; run(w, 0, 2);
  assert.ok(w.battery > before);
  run(w, -1, 0.5);
  assert.equal(w.docked, false);
  assert.equal(w.charging, false);
});

test('approaching off-centre or at an angle does not dock', () => {
  const w = createWorld({ robot: { x: 0, y: 0.12, heading: 0 }, station: { x: 1, y: 0, heading: Math.PI } });
  run(w, 1, 5); run(w, 0, 2);
  assert.equal(w.charging, false);
  const angled = createWorld({ robot: { x: 0, y: 0, heading: 0.3 }, station: { x: 1, y: 0.25, heading: Math.PI } });
  run(angled, 1, 5); run(angled, 0, 2);
  assert.equal(angled.charging, false);
});
