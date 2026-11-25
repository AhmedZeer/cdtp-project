import { phoneSetupError } from './phoneVision.js';
import { TASKS } from '../eval/spec.js';

export const DASHBOARD_MAX_BYTES = 128 * 1024;
export const DICTIONARY_LABELS = { '5x5_100': 'OpenCV DICT_5X5_100', '6x6_250': 'OpenCV DICT_6X6_250', legacy: 'Original ArUco' };

export function summarizePhoneResult(sealed) {
  if (!sealed) return null;
  const { record, result, digest } = sealed;
  return { task: record.task, result, digest, durationS: record.durationS, wallClock: record.wallClock,
    endReason: record.endReason, frameCount: record.frames.length, packetCount: record.packets.length };
}

// Keep these messages small: video and sealed records never travel in dashboard snapshots.
export function readPhoneDashboard(message) {
  if (message?.type !== 'dashboard' || message.source !== 'phone') return null;
  const { width, height } = message.size ?? {};
  if (![width, height].every((n) => Number.isFinite(n) && n > 0 && n <= 16384)) return null;
  if (!Number.isInteger(message.setupRevision) || message.setupRevision < 0 || phoneSetupError(message.setup)) return null;
  if (!Number.isFinite(message.detectorMs) || message.detectorMs < 0 || typeof message.ready !== 'boolean' || typeof message.trackingFresh !== 'boolean' || typeof message.motion?.state !== 'string') return null;
  if (!Array.isArray(message.markers) || message.markers.length > 1024) return null;
  if (message.markers.some((m) => !m || !Number.isInteger(m.id) || !Number.isFinite(m.centre?.x) || !Number.isFinite(m.centre?.y) ||
    !Array.isArray(m.corners) || m.corners.length !== 4 || m.corners.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y)))) return null;
  if (!['waiting', 'collecting', 'ready', 'moved', 'failed'].includes(message.calibration?.state)) return null;
  if (message.run && (!Number.isFinite(message.run.elapsedS) || !TASKS.some((t) => t.id === message.runTask?.id))) return null;
  if (message.lastResult && (!Array.isArray(message.lastResult.result?.checks) || !['passed', 'failed', 'inconclusive'].includes(message.lastResult.result.status))) return null;
  return message;
}

export function readPhoneControl(message) {
  if (message?.type !== 'control' || typeof message.id !== 'string' || message.id.length > 64 || !message.id.length) return null;
  if (message.action === 'setup') {
    if (!Number.isInteger(message.revision) || message.revision < 0 || phoneSetupError(message.setup)) return null;
  } else if (message.action === 'start') {
    if (!TASKS.some((t) => t.id === message.task?.id)) return null;
    if (message.task.id === 'robot-guidance' && !['forward', 'backward'].includes(message.task.direction)) return null;
  } else if (!['end', 'recalibrate'].includes(message.action)) return null;
  return message;
}
