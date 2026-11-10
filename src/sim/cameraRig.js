// Places a three.js camera at a phone preset and reports the matching pinhole intrinsics.
// No DOM access, so tests can project points exactly as the renderer does.
import * as THREE from 'three';
import { CAMERA_PRESETS, RENDER_WIDTH, RENDER_HEIGHT } from './simConfig.js';

export function applyCameraPreset(camera, name) {
  const p = CAMERA_PRESETS[name] ?? CAMERA_PRESETS.tripod;
  camera.fov = p.fov;
  camera.aspect = RENDER_WIDTH / RENDER_HEIGHT;
  camera.position.set(...p.position);
  camera.up.set(...(p.up ?? [0, 1, 0]));
  camera.lookAt(...p.target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return camera;
}

export function createPresetCamera(name) {
  return applyCameraPreset(new THREE.PerspectiveCamera(50, RENDER_WIDTH / RENDER_HEIGHT, 0.05, 30), name);
}

/** Pinhole intrinsics (pixels) of a preset; the simulator's stand-in for a phone's factory calibration. */
export function presetIntrinsics(name) {
  const p = CAMERA_PRESETS[name] ?? CAMERA_PRESETS.tripod;
  const f = (RENDER_HEIGHT / 2) / Math.tan((p.fov * Math.PI) / 360);
  return { fx: f, fy: f, cx: RENDER_WIDTH / 2, cy: RENDER_HEIGHT / 2 };
}

/** World point (metres, x east, y north, h up) to image pixels, or null if behind the camera. */
export function projectWorldPoint(camera, x, y, h) {
  const v = new THREE.Vector3(x, h, -y);
  if (v.clone().applyMatrix4(camera.matrixWorldInverse).z >= 0) return null;
  v.project(camera);
  return { x: ((v.x + 1) / 2) * RENDER_WIDTH, y: ((1 - v.y) / 2) * RENDER_HEIGHT };
}

/** The simulated phone accelerometer: world "up" in camera coordinates (x right, y down, z forward). */
export function upInCamera(camera) {
  const up = new THREE.Vector3(0, 1, 0).transformDirection(camera.matrixWorldInverse);
  return [up.x, -up.y, -up.z]; // three.js camera: y up, looks down −z
}
