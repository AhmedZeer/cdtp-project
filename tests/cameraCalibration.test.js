import test from 'node:test';
import assert from 'node:assert/strict';
import { createPresetCamera, presetIntrinsics, projectWorldPoint, upInCamera } from '../src/sim/cameraRig.js';
import { MARKERS, MARKER_MOUNTS, INITIAL_POSES, CAMERA_PRESETS } from '../src/sim/simConfig.js';
import { toStationFrame } from '../src/sim/world.js';
import { calibrateFromMarker, measureMarker, focalFromHomography, homography, markerCornerModel, applyHomography } from '../src/utils/cameraCalibration.js';

const station = INITIAL_POSES.station;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// Deterministic ±amp px noise, standing in for the detector's integer contour corners.
const jitter = (seed, amp) => (k) => amp * Math.sin(seed * 12.9898 + k * 78.233);

/** Pixel corners of a level marker whose centre is `forward` ahead of (x, y) along `heading`. */
function markerPixels(camera, role, x, y, heading, noise = () => 0, round = false) {
  const { forward, height } = MARKER_MOUNTS[role];
  const mx = x + forward * Math.cos(heading), my = y + forward * Math.sin(heading);
  return markerCornerModel(MARKERS[role].size).map((p, i) => {
    const wx = mx + p.x * Math.cos(heading) - p.y * Math.sin(heading), wy = my + p.x * Math.sin(heading) + p.y * Math.cos(heading);
    const q = projectWorldPoint(camera, wx, wy, height);
    const r = round ? Math.round : (v) => v;
    return { x: r(q.x + noise(2 * i)), y: r(q.y + noise(2 * i + 1)) };
  });
}

/** Ground truth in the calibration frame F (origin below the station marker, +X out of the contact face). */
function truthInF(x, y, heading) {
  const s = toStationFrame(station, x, y);
  return { x: s.u - MARKER_MOUNTS.station.forward, y: s.w, heading: wrap(heading - station.heading) };
}

test('homography reproduces its own correspondences', () => {
  const src = markerCornerModel(0.15), dst = [{ x: 100, y: 80 }, { x: 190, y: 85 }, { x: 185, y: 170 }, { x: 95, y: 160 }];
  const H = homography(src, dst);
  src.forEach((p, i) => { const q = applyHomography(H, p); assert.ok(Math.hypot(q.x - dst[i].x, q.y - dst[i].y) < 1e-6); });
});

for (const preset of Object.keys(CAMERA_PRESETS)) {
  test(`${preset}: robot and medicine positions recovered to within 2 cm / 2° from the station marker`, () => {
    const camera = createPresetCamera(preset), K = presetIntrinsics(preset);
    const cal = calibrateFromMarker(markerPixels(camera, 'station', station.x, station.y, station.heading, jitter(1, 0.3)),
      { markerSize: MARKERS.station.size, markerHeight: MARKER_MOUNTS.station.height, K, upInCamera: upInCamera(camera) });
    assert.ok(cal.ok, cal.reason);
    assert.ok(cal.reprojectionPx < 1, `reprojection ${cal.reprojectionPx}`);
    const cam = CAMERA_PRESETS[preset].position;
    assert.ok(Math.abs(cal.cameraHeight - cam[1]) < 0.05, `camera height ${cal.cameraHeight} vs ${cam[1]}`);
    const poses = [[-0.9, -0.3, 0], [0.2, 0.4, Math.PI / 2], [0.5, 0.55, Math.PI], [-0.4, 0.6, -2.3], [0.9, -0.8, 0.7]];
    poses.forEach(([x, y, h], k) => {
      for (const role of ['robot', 'medicine']) {
        const m = measureMarker(cal, markerPixels(camera, role, x, y, h, jitter(k + 2, 0.5)), MARKER_MOUNTS[role]);
        const t = truthInF(x, y, h);
        const err = Math.hypot(m.x - t.x, m.y - t.y);
        assert.ok(err < 0.02, `${role} at ${x},${y}: ${(err * 100).toFixed(1)} cm`);
        assert.ok(Math.abs(wrap(m.heading - t.heading)) < (2 * Math.PI) / 180, `${role} heading`);
      }
    });
  });
}

test('focal length is estimated from an oblique view and refused for a face-on one', () => {
  for (const preset of ['tripod', 'corner']) {
    const camera = createPresetCamera(preset), K = presetIntrinsics(preset);
    const H = homography(markerCornerModel(MARKERS.station.size), markerPixels(camera, 'station', station.x, station.y, station.heading));
    const est = focalFromHomography(H, K.cx, K.cy, MARKERS.station.size);
    assert.ok(est.ok, est.reason);
    assert.ok(Math.abs(est.f / K.fx - 1) < 0.01, `${preset}: f ${est.f} vs ${K.fx}`);
  }
  const camera = createPresetCamera('overhead'), K = presetIntrinsics('overhead');
  const H = homography(markerCornerModel(MARKERS.station.size), markerPixels(camera, 'station', 0, 0, 0));
  assert.equal(focalFromHomography(H, K.cx, K.cy, MARKERS.station.size).ok, false);
});

test('integer detector corners: a 1 m drive measures 1 m ± 3 cm from every camera preset', () => {
  for (const preset of Object.keys(CAMERA_PRESETS)) {
    const camera = createPresetCamera(preset), K = presetIntrinsics(preset);
    const cal = calibrateFromMarker(markerPixels(camera, 'station', station.x, station.y, station.heading, jitter(7, 0.4), true),
      { markerSize: MARKERS.station.size, markerHeight: MARKER_MOUNTS.station.height, K, upInCamera: upInCamera(camera) });
    assert.ok(cal.ok, cal.reason);
    const at = (x, k) => measureMarker(cal, markerPixels(camera, 'robot', x, -0.3, 0, jitter(k, 0.4), true), MARKER_MOUNTS.robot);
    const a = at(-0.9, 3), b = at(0.1, 4);
    const moved = Math.hypot(b.x - a.x, b.y - a.y);
    assert.ok(Math.abs(moved - 1) < 0.03, `${preset}: measured ${moved.toFixed(3)} m`);
  }
});
