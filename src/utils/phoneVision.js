// Physical setup for the streamed camera. Distances are metres; focal length is in
// source-video pixels. The station and object markers must lie on horizontal planes.
import { MARKERS, MARKER_MOUNTS, STATION, ROBOT } from '../sim/simConfig.js';

export function defaultPhoneSetup() {
  return {
    family: '5x5_100', ids: Object.fromEntries(Object.entries(MARKERS).map(([role, m]) => [role, m.id])),
    stationSize: MARKERS.station.size,
    mounts: structuredClone(MARKER_MOUNTS), stationDepth: STATION.depth, robotDepth: ROBOT.body.depth,
    estimateFocal: true, focalPx: 1200,
  };
}

export function phoneSetupError(setup) {
  if (!setup || !['5x5_100', '6x6_250', 'legacy'].includes(setup.family)) return 'Choose a supported marker dictionary.';
  if (!setup.ids || !setup.mounts || ['station', 'robot', 'medicine'].some((role) => !setup.mounts[role] || !Object.hasOwn(setup.ids, role))) return 'Assign all three marker roles and their physical mounts.';
  const max = setup.family === '5x5_100' ? 99 : setup.family === '6x6_250' ? 249 : 1023;
  const ids = Object.values(setup.ids);
  if (ids.some((id) => !Number.isInteger(id) || id < 0 || id > max)) return `Marker IDs must be integers from 0 to ${max}.`;
  if (new Set(ids).size !== ids.length) return 'Assign a different marker ID to each role.';
  if (![setup.stationSize, setup.stationDepth, setup.robotDepth, setup.focalPx].every((n) => Number.isFinite(n) && n > 0)) return 'Marker size, body depths and focal length must be positive.';
  if (Object.values(setup.mounts).some((m) => !m || !Number.isFinite(m.height) || m.height < 0 || !Number.isFinite(m.forward))) return 'Marker heights must be nonnegative; offsets must be finite.';
  return '';
}

export function phoneIntrinsics(width, height, focalPx) {
  return { fx: focalPx, fy: focalPx, cx: width / 2, cy: height / 2 };
}

export function phoneGeometry(setup) {
  return {
    ids: setup.ids, mounts: setup.mounts, stationDepth: setup.stationDepth, robotDepth: setup.robotDepth, boxTolerance: 0.05,
    inApproachRegion: (u, w) => {
      const fromFace = u - setup.stationDepth / 2;
      return fromFace > 0 && Math.hypot(u, w) <= 0.3 + setup.stationDepth / 2 && Math.abs(Math.atan2(w, u)) <= Math.PI / 4;
    },
  };
}

// Reject incomplete telemetry instead of manufacturing evidence for a physical test.
export function readPhysicalPacket(data) {
  if (!data || !Number.isFinite(data.tilt) || !Number.isFinite(data.battery) || typeof data.charging !== 'boolean') return null;
  return {
    tilt: data.tilt, battery: data.battery, charging: data.charging, mode: typeof data.mode === 'string' ? data.mode : null,
    commandsAvailable: data.commandsAvailable === true,
    ...(typeof data.operatorActive === 'boolean' ? { operatorActive: data.operatorActive } : {}),
    ...(['forward', 'backward', 'left', 'right', 'stop'].includes(data.command) ? { command: data.command, ignored: data.ignored === true } : {}),
  };
}
