import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, stepWorld, requestTurn, telemetryPacket, dockGeometry, toStationFrame, inApproachRegion, wrapAngle } from '../src/sim/world.js';
import { INITIAL_POSES } from '../src/sim/simConfig.js';
import { createRunRecorder } from '../src/eval/runRecorder.js';
import { evaluateRun } from '../src/eval/evaluateRun.js';
import { sealRun, verifySealed } from '../src/eval/seal.js';

const station = INITIAL_POSES.station;
let seed = 1;
const noise = (amp) => { seed = (seed * 16807) % 2147483647; return ((seed / 2147483647) * 2 - 1) * amp; };

/** What the calibrated camera would report for the current world (±1 cm, ±0.4° noise). */
function observe(world) {
  const r = world.robot, s = toStationFrame(world.station, r.x, r.y), g = dockGeometry(world);
  const u = s.u + noise(0.01), w = s.w + noise(0.01);
  return {
    robot: { u, w, heading: wrapAngle(r.heading - world.station.heading + noise(0.007)), frontGap: g.frontGap + noise(0.01), headingError: g.headingError, inApproach: inApproachRegion(u, w) },
    medicine: { onRobot: true },
  };
}

/**
 * Run a script against the physics and record it like the app does.
 * steps: [{ drive, s }] holds a drive value for s seconds; { turn: 'left' } turns 90° and waits for it;
 * { cmd } only logs an operator command. Every drive/turn step logs its command too.
 */
function run(taskId, steps, { pose = INITIAL_POSES.robot, direction, dropLinkAt = null, dropBoxAt = null, untilAutoEnd = true } = {}) {
  const world = createWorld({ robot: pose, station });
  const rec = createRunRecorder({ task: { id: taskId, direction }, startT: 0 });
  const dt = 1 / 120;
  let nextFrame = 0, nextPacket = 0, ended = null;
  const tick = (drive) => {
    stepWorld(world, drive, dt);
    const operator = drive !== 0 || world.robot.turnTarget !== null;
    const t = world.time;
    if (t >= nextFrame) {
      nextFrame += 0.1;
      const o = observe(world);
      if (dropBoxAt !== null && t >= dropBoxAt) o.medicine.onRobot = false;
      rec.addFrame(t, o.robot, o.medicine, operator);
    }
    if (t >= nextPacket) { nextPacket += 1; if (dropLinkAt === null || t < dropLinkAt || t > dropLinkAt + 3) rec.addPacket(t, telemetryPacket(world)); }
    if (untilAutoEnd && !ended) ended = rec.autoEnd(t);
  };
  for (const step of steps) {
    if (ended) break;
    if (step.cmd) { rec.addCommand(world.time, step.cmd); continue; }
    if (step.turn) {
      rec.addCommand(world.time, step.turn);
      requestTurn(world, step.turn);
      while (world.robot.turnTarget !== null && !ended) tick(0);
      continue;
    }
    if (step.drive) rec.addCommand(world.time, step.drive > 0 ? 'forward' : 'backward');
    const until = world.time + step.s;
    while (world.time < until && !ended) tick(step.drive ?? 0);
  }
  return { record: rec.finish(world.time, ended ?? 'user', 'test'), ended };
}

const byName = (result, name) => result.checks.find((c) => c.name === name);

test('static balance: 30 s in place passes and ends itself at 30 s', () => {
  const { record, ended } = run('static-balance', [{ s: 40 }]);
  const r = evaluateRun(record);
  assert.equal(ended, 'completed');
  assert.ok(Math.abs(record.durationS - 30) < 0.05);
  assert.equal(r.status, 'passed', JSON.stringify(r.checks));
});

test('static balance: ending at 20 s fails the duration check; driving away fails "stayed in place"', () => {
  assert.equal(byName(evaluateRun(run('static-balance', [{ s: 20 }], { untilAutoEnd: false }).record), 'Duration').status, 'failed');
  const moved = evaluateRun(run('static-balance', [{ s: 5 }, { drive: 1, s: 1 }, { s: 30 }]).record);
  assert.equal(byName(moved, 'Stayed in place').status, 'failed');
});

test('guidance: ~1 m forward then a 3 s stop passes; ends itself after the stop', () => {
  // 0.35 m/s top speed: about 3 s of driving covers ~1 m including acceleration and braking.
  const { record, ended } = run('robot-guidance', [{ s: 1 }, { drive: 1, s: 3.05 }, { s: 6 }], { direction: 'forward' });
  const r = evaluateRun(record);
  assert.equal(ended, 'completed');
  assert.equal(r.status, 'passed', JSON.stringify(r.checks));
  assert.ok(r.metrics.displacementM > 0.9 && r.metrics.displacementM < 1.1, `${r.metrics.displacementM}`);
});

test('guidance: too short, wrong direction and a lost link each fail', () => {
  assert.equal(byName(evaluateRun(run('robot-guidance', [{ drive: 1, s: 1.5 }, { s: 6 }], { direction: 'forward' }).record), 'Distance travelled').status, 'failed');
  const back = evaluateRun(run('robot-guidance', [{ drive: -1, s: 3.05 }, { s: 6 }], { direction: 'forward' }).record);
  assert.equal(byName(back, 'Direction').status, 'failed');
  const link = evaluateRun(run('robot-guidance', [{ s: 1 }, { drive: 1, s: 3.05 }, { s: 6 }], { direction: 'forward', dropLinkAt: 1.5 }).record);
  assert.equal(byName(link, 'Telemetry link').status, 'failed');
});

// Start inside the approach region, facing the station's contact face.
const approachPose = { x: station.x - 0.43, y: station.y, heading: 0 };

test('charging: docking with no operator input, charging within 5 s passes', () => {
  // Stand-in for the robot's own docking controller: driving here is NOT logged as a command.
  const world = createWorld({ robot: approachPose, station });
  const rec = createRunRecorder({ task: { id: 'charging' }, startT: 0 });
  let nextFrame = 0, nextPacket = 0, ended = null;
  while (!ended && world.time < 15) {
    stepWorld(world, world.time < 2 && !world.robot.blocked ? 1 : 0, 1 / 120);
    if (world.time >= nextFrame) { nextFrame += 0.1; const o = observe(world); rec.addFrame(world.time, o.robot, o.medicine, false); }
    if (world.time >= nextPacket) { nextPacket += 1; rec.addPacket(world.time, telemetryPacket(world)); }
    ended = rec.autoEnd(world.time);
  }
  const r = evaluateRun(rec.finish(world.time, ended ?? 'user', 'test'));
  assert.equal(ended, 'completed');
  assert.equal(r.status, 'passed', JSON.stringify(r.checks));
  assert.ok(r.metrics.chargingDelayS <= 5);
});

test('charging: driving the robot in by hand fails the autonomy check', () => {
  const { record } = run('charging', [{ drive: 1, s: 1.5 }, { s: 6 }], { pose: approachPose });
  const r = evaluateRun(record);
  assert.equal(byName(r, 'Docking').status, 'passed');
  assert.equal(byName(r, 'Autonomous docking').status, 'failed');
  assert.equal(r.status, 'failed');
});

test('a dropped medicine box fails the run', () => {
  const r = evaluateRun(run('static-balance', [{ s: 40 }], { dropBoxAt: 10 }).record);
  assert.equal(byName(r, 'Medicine box retained').status, 'failed');
});

test('integrated: wait 5 s, ~1 m with a turn, wait 5 s, then approach and dock (here by hand)', () => {
  // From (0.12, 0.25): forward ~0.55 m east, turn left, forward ~0.25 m north, wait 5 s, then drive into the dock.
  const pose = { x: station.x - 1.45, y: station.y - 0.3, heading: 0 };
  const { record } = run('integrated', [
    { s: 5.5 }, { drive: 1, s: 1.9 }, { s: 1 }, { turn: 'left' }, { drive: 1, s: 0.95 }, { s: 1 }, { turn: 'right' }, { s: 6 },
    { drive: 1, s: 4 }, { s: 6 },
  ], { pose });
  const r = evaluateRun(record);
  for (const name of ['Initial 5 s balance', 'Delivery leg', 'Changed direction', '5 s wait at delivery point', 'Reached approach region', 'Docking', 'Charging start'])
    assert.equal(byName(r, name)?.status, 'passed', `${name}: ${JSON.stringify(byName(r, name))} ${JSON.stringify(r.metrics)}`);
  // The forward command was issued before the approach region, but its latched drive carried the
  // robot into the dock: still human guidance.
  assert.equal(byName(r, 'Autonomous docking').status, 'failed');
});

test('sealed runs verify, and editing the data or the verdict is detected', async () => {
  const sealed = await sealRun(run('static-balance', [{ s: 40 }]).record);
  const copy = () => JSON.parse(JSON.stringify(sealed));
  assert.equal((await verifySealed(copy())).intact, true);
  const flipped = copy(); flipped.result.status = flipped.result.status === 'passed' ? 'failed' : 'passed';
  assert.equal((await verifySealed(flipped)).intact, false);
  const edited = copy(); edited.record.frames[5].robot.u += 0.5;
  assert.equal((await verifySealed(edited)).intact, false);
  const both = copy(); both.record.durationS = 20; both.result = evaluateRun(both.record);
  const v = await verifySealed(both);
  assert.equal(v.resultMatches, true);
  assert.equal(v.digestMatches, false);
});

// --- End to end through the simulator controller (autonomous docking, operator lockout) -------
import { createSimController } from '../src/sim/simController.js';

/** Record a run through the controller. Script steps: { press }, { release }, { wait }, { act }. */
function runController(taskId, script, { setup = () => {}, rngSeed = 7, limit = 120 } = {}) {
  let s = rngSeed;
  const c = createSimController({ rng: () => { s = (s * 16807) % 2147483647; return s / 2147483647; } });
  setup(c);
  const rec = createRunRecorder({ task: { id: taskId }, startT: c.world.time });
  c.subscribe((name, meta) => rec.addCommand(c.world.time, name, meta.ignored));
  let nextFrame = c.world.time, nextPacket = c.world.time, ended = null;
  const tick = () => {
    c.step(1 / 120);
    const t = c.world.time;
    if (t >= nextFrame) { nextFrame += 0.1; const o = observe(c.world); rec.addFrame(t, o.robot, o.medicine, c.operatorActive()); }
    if (t >= nextPacket) { nextPacket += 1; rec.addPacket(t, telemetryPacket(c.world)); }
    ended ??= rec.autoEnd(t);
  };
  for (const step of script) {
    if (ended) break;
    if (step.press) c.command(step.press, true);
    if (step.release) c.command(step.release, false);
    if (step.act) c[step.act]();
    const until = c.world.time + (step.wait ?? 0);
    while (c.world.time < until && !ended) tick();
  }
  while (!ended && c.world.time < limit) tick(); // let the robot finish on its own
  return { record: rec.finish(c.world.time, ended ?? 'user', 'test'), ended, controller: c };
}

test('charging: placed in the approach region, the robot docks itself and the run passes', () => {
  const { record, ended } = runController('charging', [], { setup: (c) => { c.placeInApproachRegion(); c.step(1 / 120); } });
  const r = evaluateRun(record);
  assert.equal(ended, 'completed');
  assert.equal(r.status, 'passed', JSON.stringify(r.checks.filter((x) => x.status !== 'passed')));
});

test('charging: pressing keys while it docks is logged as ignored and still passes', () => {
  const { record } = runController('charging', [{ wait: 1 }, { press: 'backward', wait: 0.5 }, { release: 'backward' }, { press: 'left' }],
    { setup: (c) => { c.placeInApproachRegion(); c.step(1 / 120); } });
  assert.ok(record.commands.length === 2 && record.commands.every((cmd) => cmd.ignored));
  assert.equal(evaluateRun(record).status, 'passed');
});

test('charging indicator (C3.4): pull away → off within 2 s, put back → on within 5 s', () => {
  const { record, ended } = runController('charging-indicator', [{ wait: 2 }, { act: 'pullAway', wait: 4 }, { act: 'putBack' }], {
    setup: (c) => { c.placeInApproachRegion(); while (!c.world.charging) c.step(1 / 120); },
  });
  const r = evaluateRun(record);
  assert.equal(ended, 'completed');
  assert.equal(r.status, 'passed', JSON.stringify(r.checks.filter((x) => x.status !== 'passed')));
});

test('integrated: glove delivery with a turn, 5 s wait, then the robot docks itself — every check passes', () => {
  const s0 = INITIAL_POSES.station;
  const { record, ended } = runController('integrated', [
    { wait: 5.5 }, { press: 'forward', wait: 1.9 }, { release: 'forward', wait: 1 }, { press: 'left', wait: 1.2 },
    { press: 'forward', wait: 0.95 }, { release: 'forward', wait: 1 }, { press: 'right', wait: 1.2 }, { wait: 6 },
    { press: 'forward', wait: 3 }, { release: 'forward' }, // head for the dock; the robot takes over in the region
  ], { setup: (c) => c.reset({ robot: { x: s0.x - 1.45, y: s0.y - 0.3, heading: 0 }, station: s0 }) });
  const r = evaluateRun(record);
  assert.equal(ended, 'completed');
  assert.equal(r.status, 'passed', JSON.stringify(r.checks.filter((x) => x.status !== 'passed')));
});
