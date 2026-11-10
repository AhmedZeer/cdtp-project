import test from 'node:test';
import assert from 'node:assert/strict';
import { TASKS, DEFAULT_PIXELS_PER_METRE, evaluateTask, recordingDeadlineReached } from '../src/utils/taskEvaluation.js';
import { taskGoal } from '../src/utils/taskGoal.js';

const task = (id, overrides = {}) => ({ ...TASKS.find((entry) => entry.id === id), pixelsPerMetre: DEFAULT_PIXELS_PER_METRE, direction: 'forward', ...overrides });
const frames = (duration, position = () => 0, verified = false) => Array.from({ length: duration / 100 + 1 }, (_, i) => ({
  t: i * 100, robot: { x: position(i * 100), y: 0 }, station: { x: 900, y: 0 }, heading: { x: 1, y: 0 },
  evidence: verified ? { loadSecure: true, balanced: true, gloveControlled: true, docked: false, charging: false } : undefined,
}));

test('menu matches the four tasks in specification section 5.2', () => {
  assert.deepEqual(TASKS.map((t) => t.name), ['Static Balance', 'Robot Guidance', 'Charging', 'Integrated Task']);
});

test('static balance requires duration, active balance and load evidence', () => {
  assert.equal(evaluateTask(task('static-balance'), frames(30000), 30000, 'time-limit').status, 'inconclusive');
  assert.equal(evaluateTask(task('static-balance'), frames(30000, () => 0, true), 30000, 'time-limit').status, 'passed');
  assert.equal(evaluateTask(task('static-balance'), frames(28000, () => 0, true), 28000, 'user').status, 'passed');
  assert.equal(evaluateTask(task('static-balance'), frames(27000, () => 0, true), 27000, 'user').status, 'failed');
  const lostBalance = frames(30000, () => 0, true);
  lostBalance[10].evidence.balanced = false;
  assert.equal(evaluateTask(task('static-balance'), lostBalance, 30000, 'time-limit').status, 'failed');
});

test('guidance uses metre range, initial heading and command; no invented final hold', () => {
  const forward = frames(1000, (t) => t * 0.6, true);
  const report = evaluateTask(task('robot-guidance'), forward, 1000, 'user');
  assert.equal(report.status, 'passed');
  assert.equal(report.metrics.displacementM, 1);
  assert.equal(evaluateTask(task('robot-guidance', { direction: 'backward' }), forward, 1000, 'user').status, 'failed');
  assert.equal(evaluateTask(task('robot-guidance'), frames(1000, (t) => -t * 0.6, true), 1000, 'user').status, 'failed');
  for (const metres of [0.8, 1.2]) assert.equal(evaluateTask(task('robot-guidance'), frames(1000, (t) => t / 1000 * metres * 600, true), 1000, 'user').status, 'passed');
  assert.equal(evaluateTask(task('robot-guidance'), frames(1000, (t) => t * 0.6), 1000, 'user').status, 'inconclusive');
});

test('distance cannot be passed by accumulated path after returning to start', () => {
  const observations = frames(2000, (t) => t < 1000 ? t * 0.6 : 1200 - t * 0.6, true);
  const report = evaluateTask(task('robot-guidance'), observations, 2000, 'user');
  assert.ok(report.metrics.pathM > 1.9);
  assert.equal(report.status, 'failed');
});

test('charging clock starts after observed docking, not at recording start', () => {
  const observations = frames(15000, () => 0, true);
  for (const frame of observations) {
    frame.evidence.docked = frame.t >= 10000;
    frame.evidence.autonomousDocking = true;
    frame.evidence.charging = frame.t >= 15000;
  }
  const report = evaluateTask(task('charging'), observations, 15000, 'user');
  assert.equal(report.status, 'passed');
  assert.equal(report.metrics.chargingDelaySec, 5);
  const late = frames(15100, () => 0, true);
  for (const frame of late) Object.assign(frame.evidence, { docked: frame.t >= 10000, autonomousDocking: true, charging: frame.t >= 15100 });
  assert.equal(evaluateTask(task('charging'), late, 15100, 'user').status, 'failed');
  assert.equal(evaluateTask(task('charging'), frames(1000), 1000, 'user').status, 'inconclusive');
});

test('integrated evaluates delivery and wait before docking, not final distance', () => {
  const observations = frames(12000, (t) => t <= 2000 ? t * 0.3 : t <= 7000 ? 600 : Math.min(900, 600 + (t - 7000) * 0.3), true);
  for (const frame of observations) Object.assign(frame.evidence, { docked: frame.t >= 8000, autonomousDocking: true, charging: frame.t >= 12000 });
  const report = evaluateTask(task('integrated', { deliveryGoal: { x: 600, y: 0 } }), observations, 12000, 'user');
  assert.equal(report.status, 'passed');
  assert.equal(report.metrics.displacementM, 1.5);
  observations[5].evidence.loadSecure = false;
  assert.equal(evaluateTask(task('integrated', { deliveryGoal: { x: 600, y: 0 } }), observations, 12000, 'user').status, 'failed');
});

test('missing detections, sparse samples and missed recording caps are inconclusive', () => {
  const observations = frames(30000, () => 0, true);
  observations[10].robot = null;
  assert.equal(evaluateTask(task('static-balance'), observations, 30000, 'time-limit').status, 'inconclusive');
  assert.equal(evaluateTask(task('static-balance'), [frames(30000)[0], frames(30000).at(-1)], 30000, 'time-limit').status, 'inconclusive');
  assert.equal(evaluateTask(task('static-balance'), frames(31000), 31000, 'time-limit').status, 'inconclusive');
});

test('deadline uses frozen recording cap and replay never triggers recording timeout', () => {
  const run = { mode: 'recording', startedAt: 100, task: task('charging') };
  assert.equal(recordingDeadlineReached(run, 5100), false);
  assert.equal(recordingDeadlineReached(run, 120100), true);
  assert.equal(recordingDeadlineReached({ ...run, mode: 'replaying' }, 500000), false);
});

test('replay keeps original scale and task settings', () => {
  const observations = frames(1000, (t) => t * 0.6, true);
  const original = evaluateTask(task('robot-guidance'), observations, 1000, 'user');
  const replay = evaluateTask(task('robot-guidance'), observations, 1000, 'user', 'replay');
  assert.deepEqual({ ...replay, source: 'recording' }, original);
});

test('goal uses metre scale and commanded heading; proximity guide never means charging', () => {
  const robot = { x: 285, y: 342 }, station = { x: 819, y: 744 };
  const goal = taskGoal(task('robot-guidance'), robot, station, { x: 1, y: 0 });
  assert.equal(goal.point.x, 885);
  assert.equal(goal.inner, 480);
  assert.equal(goal.outer, 720);
  assert.match(taskGoal(task('charging'), robot, station).label, /docking still required/);
});

test('simulation can pass visual balance/guidance while full-task mode requires hardware', () => {
  const stationary = frames(30000);
  assert.equal(evaluateTask(task('static-balance', { simulation: true }), stationary, 30000, 'time-limit').status, 'passed');
  assert.equal(evaluateTask(task('static-balance'), stationary, 30000, 'time-limit').status, 'inconclusive');
  const moved = frames(1000, (t) => t * 0.6);
  const sim = evaluateTask(task('robot-guidance', { simulation: true }), moved, 1000, 'user');
  assert.equal(sim.status, 'passed');
  assert.equal(sim.checks.find((c) => c.name === 'Glove control').status, 'skipped');
  assert.equal(evaluateTask(task('robot-guidance'), moved, 1000, 'user').status, 'inconclusive');
  assert.equal(evaluateTask(task('robot-guidance', { simulation: true, direction: 'backward' }), moved, 1000, 'user').status, 'failed');
});

test('simulation charging checks proximity, never claims actual charging', () => {
  const near = frames(1000, (t) => t * 0.75);
  const report = evaluateTask(task('charging', { simulation: true }), near, 1000, 'user');
  assert.equal(report.status, 'passed');
  assert.equal(report.metrics.finalStationDistanceM, 0.25);
  assert.equal(report.checks.find((c) => c.name === 'Charging start').status, 'skipped');
  assert.match(report.scope, /visual checks only/);
  assert.equal(evaluateTask(task('charging', { simulation: true }), frames(1000), 1000, 'user').status, 'failed');
  near[5].station = null;
  assert.equal(evaluateTask(task('charging', { simulation: true }), near, 1000, 'user').status, 'passed');
  near.at(-1).station = null;
  assert.equal(evaluateTask(task('charging', { simulation: true }), near, 1000, 'user').status, 'inconclusive');
});

test('simulation integrated task requires delivery wait followed by station arrival', () => {
  const observations = frames(9000, (t) => t <= 2000 ? t * 0.3 : t <= 7000 ? 600 : Math.min(750, 600 + (t - 7000) * 0.15));
  const profile = task('integrated', { simulation: true, deliveryGoal: { x: 600, y: 0 } });
  const report = evaluateTask(profile, observations, 9000, 'user');
  assert.equal(report.status, 'passed');
  assert.equal(report.checks.find((c) => c.name === 'Visual sequence order').status, 'passed');
  assert.equal(evaluateTask(profile, frames(1000, (t) => t * 0.75), 1000, 'user').status, 'failed');
  const replay = evaluateTask({ ...profile }, observations, 9000, 'user', 'replay');
  assert.deepEqual({ ...replay, source: 'recording' }, report);
});

test('simulation tolerates brief tracking gaps but not long gaps in required hold evidence', () => {
  const observations = frames(30000);
  observations[5].robot = null;
  assert.equal(evaluateTask(task('static-balance', { simulation: true }), observations, 30000, 'time-limit').status, 'passed');
  for (let i = 10; i < 20; i++) observations[i].robot = null;
  assert.equal(evaluateTask(task('static-balance', { simulation: true }), observations, 30000, 'time-limit').status, 'inconclusive');
  const profile = task('static-balance', { simulation: true });
  const result = evaluateTask(profile, frames(30000), 30000, 'time-limit');
  profile.simulation = false;
  assert.equal(result.task.simulation, true);
  assert.equal(result.status, 'passed');
});

test('screenshot regression: recovered tracking and 180.1 px endpoint pass simulation proximity', () => {
  const observations = frames(11500, (t) => t * 0.07);
  for (let i = 20; i < 35; i++) observations[i].robot = null;
  observations[50].station = null;
  observations.at(-1).robot = { x: 813.5, y: 923.5 };
  observations.at(-1).station = { x: 818.5, y: 743.5 };
  const profile = task('charging', { simulation: true });
  const report = evaluateTask(profile, observations, 11500, 'user');
  assert.equal(report.status, 'passed');
  assert.equal(report.metrics.missingRobotSamples, 15);
  assert.ok(report.metrics.finalStationDistanceM > 0.3);
  assert.equal(report.checks.find((c) => c.name === 'Partial tracking').status, 'warning');
  assert.deepEqual({ ...evaluateTask(profile, observations, 11500, 'user', 'replay'), source: 'recording' }, report);
  observations.at(-1).robot = { x: 818.5, y: 926.5 };
  assert.equal(evaluateTask(profile, observations, 11500, 'user').status, 'failed');
  observations.at(-1).robot = null;
  assert.equal(evaluateTask(profile, observations, 11500, 'user').status, 'inconclusive');
});

test('integrated cannot claim a delivery hold hidden by a tracking gap', () => {
  const observations = frames(9000, (t) => t <= 2000 ? t * 0.3 : t <= 7000 ? 600 : Math.min(750, 600 + (t - 7000) * 0.15));
  for (let i = 30; i < 70; i++) observations[i].robot = null;
  const profile = task('integrated', { simulation: true, deliveryGoal: { x: 600, y: 0 } });
  assert.equal(evaluateTask(profile, observations, 9000, 'user').status, 'inconclusive');
});

test('station goal star lies inside the region instead of exactly on the threshold', () => {
  const station = { x: 819, y: 744 };
  const goal = taskGoal(task('charging', { simulation: true }), { x: 285, y: 342 }, station);
  assert.ok(Math.hypot(goal.point.x - station.x, goal.point.y - station.y) <= 171);
  assert.equal(goal.outer, 180);
});
