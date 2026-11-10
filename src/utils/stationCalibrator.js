// Collects station-marker detections while the phone is still, then calibrates once and keeps the
// result frozen (the station is fixed during evaluation, §4.3). Also notices when the station
// marker no longer sits where it was calibrated, which means the phone or station has moved.
import { averageCorners, calibrateFromMarker, focalFromHomography, homography, markerCornerModel } from './cameraCalibration.js';

export const CALIBRATION_SAMPLES = 10; // ≈1 s at 10 Hz detection
const MOVED_PX = 4; // mean corner drift that invalidates the calibration

const drift = (a, b) => a.reduce((s, p, i) => s + Math.hypot(p.x - b[i].x, p.y - b[i].y), 0) / a.length;

/**
 * station: { id, size, height }. Settings are read on every call so the UI can change them:
 * getIntrinsics() → { fx, fy, cx, cy } (factory calibration), getUp() → floor-up in camera coords or null,
 * estimateFocal: true = derive focal length from the station marker instead of getIntrinsics().
 */
export function createStationCalibrator(station) {
  let samples = [];
  let status = { state: 'waiting', progress: 0 };
  const calibrator = {
    get status() { return status; },
    reset() { samples = []; status = { state: 'waiting', progress: 0 }; return status; },
    /** Feed one frame's detections; returns the (possibly unchanged) status. */
    push(markers, { getIntrinsics, getUp, estimateFocal }) {
      const seen = markers.find((m) => m.id === station.id);
      if (status.state === 'ready' || status.state === 'moved') {
        if (seen) {
          const moved = drift(seen.corners, status.corners) > MOVED_PX;
          if (moved !== (status.state === 'moved')) status = { ...status, state: moved ? 'moved' : 'ready' };
        }
        return status;
      }
      if (!seen) return status;
      samples.push(seen.corners);
      if (samples.length < CALIBRATION_SAMPLES) { status = { state: 'collecting', progress: samples.length / CALIBRATION_SAMPLES }; return status; }

      const corners = averageCorners(samples);
      samples = [];
      let K = getIntrinsics();
      if (estimateFocal) {
        const focal = focalFromHomography(homography(markerCornerModel(station.size), corners), K.cx, K.cy, station.size);
        if (!focal.ok) { status = { state: 'failed', reason: focal.reason }; return status; }
        K = { ...K, fx: focal.f, fy: focal.f };
      }
      const up = getUp();
      const cal = calibrateFromMarker(corners, { markerSize: station.size, markerHeight: station.height, K, upInCamera: up });
      status = cal.ok
        ? { state: 'ready', cal, corners, usedGravity: Boolean(up), focalSource: estimateFocal ? 'estimated' : 'known' }
        : { state: 'failed', reason: cal.reason };
      return status;
    },
  };
  return calibrator;
}
