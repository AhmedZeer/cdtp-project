import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultPhoneSetup, phoneSetupError, phoneGeometry, phoneIntrinsics, readPhysicalPacket } from '../src/utils/phoneVision.js';
import { createStationCalibrator } from '../src/utils/stationCalibrator.js';
import { markerCornerModel } from '../src/utils/cameraCalibration.js';
import { metricScene } from '../src/utils/metricScene.js';
import { createPresetCamera, presetIntrinsics, projectWorldPoint } from '../src/sim/cameraRig.js';
import { INITIAL_POSES, MARKERS } from '../src/sim/simConfig.js';
import { toStationFrame, inApproachRegion } from '../src/sim/world.js';
import { createRunRecorder } from '../src/eval/runRecorder.js';
import { evaluateRun } from '../src/eval/evaluateRun.js';
import { markerBits } from '../src/utils/markerDetector.js';

const camera = createPresetCamera('tripod'), station = INITIAL_POSES.station;
function detections(setup, robotX = -0.9, shift = 0) {
  return Object.entries(setup.ids).map(([role, id]) => {
    const { height, forward } = setup.mounts[role];
    const x = role === 'station' ? station.x : robotX, y = role === 'station' ? station.y : -0.3;
    const heading = role === 'station' ? station.heading : 0;
    const size = role === 'station' ? setup.stationSize : MARKERS[role].size;
    return { id, corners: markerCornerModel(size).map((p) => {
      const q = projectWorldPoint(camera, x + (p.x + forward) * Math.cos(heading) - p.y * Math.sin(heading),
        y + (p.x + forward) * Math.sin(heading) + p.y * Math.cos(heading), height);
      return { x: q.x + shift, y: q.y };
    }) };
  });
}

for (const width of [1920, 720]) test(`phone calibration and reassigned roles recover a 1 m move at ${width}px width`, () => {
  const setup = defaultPhoneSetup();
  setup.ids = { station: 42, robot: 17, medicine: 31 };
  const scale = width / 1920, height = width === 720 ? 1280 : 1080;
  const transform = (markers) => markers.map((m) => ({ ...m, corners: m.corners.map((p) => ({ x: p.x * scale, y: (p.y - 540) * scale + height / 2 })) }));
  const calibration = createStationCalibrator({ id: setup.ids.station, size: setup.stationSize, height: setup.mounts.station.height });
  const K = phoneIntrinsics(width, height, presetIntrinsics('tripod').fx * scale);
  for (let i = 0; i < 10; i++) calibration.push(transform(detections(setup)), { getIntrinsics: () => K, getUp: () => null, estimateFocal: true });
  assert.equal(calibration.status.state, 'ready', calibration.status.reason);
  const a = metricScene(calibration.status.cal, transform(detections(setup)), phoneGeometry(setup));
  const b = metricScene(calibration.status.cal, transform(detections(setup, 0.1)), phoneGeometry(setup));
  assert.ok(Math.abs(Math.hypot(a.robot.u - b.robot.u, a.robot.w - b.robot.w) - 1) < 0.01);
  const expected = toStationFrame(station, -0.9, -0.3);
  assert.ok(Math.hypot(a.robot.u - expected.u, a.robot.w - expected.w) < 0.01);
  assert.equal(a.medicine.onRobot, true);
  assert.equal(metricScene(calibration.status.cal, [], phoneGeometry(setup)).robot, null);
});

test('station drift invalidates calibration and role changes clear all prior samples', () => {
  const setup = defaultPhoneSetup();
  const c = createStationCalibrator({ id: 0, size: setup.stationSize, height: setup.mounts.station.height });
  const settings = { getIntrinsics: () => presetIntrinsics('tripod'), getUp: () => null, estimateFocal: false };
  for (let i = 0; i < 10; i++) c.push(detections(setup), settings);
  assert.equal(c.status.state, 'ready');
  assert.equal(c.push(detections(setup, -0.9, 8), settings).state, 'moved');
  c.configure({ id: 42, size: setup.stationSize, height: setup.mounts.station.height });
  assert.equal(c.push(detections(setup), settings).state, 'waiting');
  setup.ids.station = 42;
  assert.equal(c.push(detections(setup), settings).state, 'collecting');
});

test('phone setup rejects duplicate IDs, wrong dictionary ranges and invalid physical dimensions', () => {
  const setup = defaultPhoneSetup();
  assert.equal(phoneSetupError(setup), '');
  assert.match(phoneSetupError({ ...setup, ids: { station: 1, robot: 1, medicine: 2 } }), /different/);
  assert.match(phoneSetupError({ ...setup, ids: { station: 100, robot: 1, medicine: 2 } }), /0 to 99/);
  assert.match(phoneSetupError({ ...setup, stationSize: 0 }), /positive/);
  assert.match(phoneSetupError({ ...setup, focalPx: NaN }), /positive/);
  setup.mounts.robot.height = -1;
  assert.match(phoneSetupError(setup), /nonnegative/);
});

test('phone geometry uses the same approach rule as the simulator for matching body depths', () => {
  const geometry = phoneGeometry(defaultPhoneSetup());
  for (const u of [0, 0.18, 0.3, 0.45, 0.6]) for (const w of [0, 0.2, 0.4]) assert.equal(geometry.inApproachRegion(u, w), inApproachRegion(u, w));
});

test('physical telemetry never substitutes default balance or charging evidence', () => {
  for (const data of [null, {}, { tilt: 0, battery: 12 }, { tilt: NaN, battery: 12, charging: false }, { tilt: 0, battery: 12, charging: 'false' }]) assert.equal(readPhysicalPacket(data), null);
  const packet = readPhysicalPacket({ tilt: 0.2, battery: 12, charging: false, command: 'forward', commandsAvailable: true, operatorActive: true });
  assert.equal(packet.charging, false);
  assert.equal(packet.command, 'forward');
  assert.equal(packet.commandsAvailable, true);
  assert.equal(packet.operatorActive, true);
});

function physicalBalance(endReason = 'completed', packets = true) {
  const r = createRunRecorder({ task: { id: 'static-balance' }, startT: 500, commandsAvailable: false, meta: { source: 'phone' } });
  for (let i = 0; i <= 300; i++) {
    const t = 500 + i / 10;
    r.addFrame(t, { u: 1, w: 0, heading: 0, frontGap: 0.5, headingError: 0, inApproach: false }, { onRobot: true });
    if (packets && i % 10 === 0) r.addPacket(t, { tilt: 0.2, battery: 12, charging: false });
  }
  return r.finish(530, endReason);
}

test('physical runs pass with actual evidence; absent telemetry and camera changes cannot pass', () => {
  assert.equal(evaluateRun(physicalBalance()).status, 'passed');
  assert.notEqual(evaluateRun(physicalBalance('completed', false)).status, 'passed');
  for (const reason of ['camera-source-changed', 'camera-resolution-changed', 'configuration-changed', 'camera-moved']) {
    const result = evaluateRun(physicalBalance(reason));
    assert.equal(result.status, 'inconclusive');
    assert.equal(result.checks.find((c) => c.name === 'Continuous camera setup').status, 'unavailable');
  }
});

test('real detector worker switches dictionaries and detects source pixels with custom IDs', async () => {
  const messages = [];
  globalThis.self = { postMessage: (m) => messages.push(m) };
  try {
    await import('../src/sim/detector.worker.js');
    for (const [family, id] of [['5x5_100', 42], ['6x6_250', 98], ['5x5_100', 17]]) {
      const width = 400, height = 600, cell = 16, bits = markerBits(family, id), n = bits.length + 2;
      const data = new Uint8ClampedArray(width * height * 4).fill(255);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        if (y > 0 && x > 0 && y < n - 1 && x < n - 1 && bits[y - 1][x - 1]) continue;
        for (let dy = 0; dy < cell; dy++) for (let dx = 0; dx < cell; dx++) {
          const i = ((100 + y * cell + dy) * width + 100 + x * cell + dx) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
      }
      self.onmessage({ data: { image: { width, height, data }, family, minPerimeterFraction: 0.03, simTime: 123, seq: messages.length + 1 } });
      assert.deepEqual(messages.at(-1).markers.map((m) => m.id), [id]);
      assert.equal(messages.at(-1).simTime, 123);
    }
  } finally { delete globalThis.self; }
});

test('physical guidance requires command evidence and physical docking requires operator activity', () => {
  const make = (id, commandsAvailable) => createRunRecorder({ task: { id, direction: 'forward' }, startT: 0, commandsAvailable, meta: { source: 'phone' } });
  const guidance = make('robot-guidance', false);
  for (let i = 0; i <= 80; i++) {
    const t = i / 10;
    guidance.addFrame(t, { u: 1 + Math.min(1, t / 5), w: 0, heading: 0, frontGap: 1, headingError: 0, inApproach: false }, { onRobot: true });
    if (i % 10 === 0) guidance.addPacket(t, { tilt: 0.2, battery: 12, charging: false });
  }
  assert.equal(evaluateRun(guidance.finish(8, 'completed')).checks.find((c) => c.name === 'Glove commands').status, 'unavailable');
  for (const reported of [false, true]) {
    const docking = make('charging', true);
    for (let i = 0; i <= 100; i++) {
      const t = i / 10;
      docking.addFrame(t, { u: 0.3, w: 0, heading: Math.PI, frontGap: t < 3 ? 0.1 : 0, headingError: 0, inApproach: true }, { onRobot: true }, reported ? false : undefined);
      if (i % 10 === 0) docking.addPacket(t, { tilt: 0.2, battery: 12, charging: t >= 4 });
    }
    assert.equal(evaluateRun(docking.finish(10, 'completed')).checks.find((c) => c.name === 'Autonomous docking').status, reported ? 'passed' : 'unavailable');
  }
});
