// Turns calibrated marker detections into the station-frame quantities the evaluation needs.
// Station frame (metres): origin at the station centre, u = out of the contact face, w = to its left.
import { measureMarker } from './cameraCalibration.js';

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * geometry: { ids: { robot, medicine }, mounts: { station, robot, medicine } ({ height, forward }),
 *   stationDepth, robotDepth, inApproachRegion(u, w), boxTolerance (m) }.
 * Returns { robot, medicine } with null for anything not detected.
 */
export function metricScene(cal, markers, geometry) {
  const { ids, mounts } = geometry;
  // Calibration frame F has its origin below the station marker, which sits `forward` ahead of the station centre.
  const toStation = (p) => ({ u: p.x + mounts.station.forward, w: p.y });
  const find = (id) => markers.find((m) => m.id === id);

  let robot = null;
  const rm = find(ids.robot);
  const r = rm && measureMarker(cal, rm.corners, mounts.robot);
  if (r) {
    const { u, w } = toStation(r);
    const faceDistance = u - geometry.stationDepth / 2;
    robot = {
      u, w, heading: r.heading,
      faceDistance, frontGap: faceDistance - geometry.robotDepth / 2,
      headingError: wrap(r.heading - Math.PI), // 0 = facing the station
      inApproach: geometry.inApproachRegion(u, w),
    };
  }

  let medicine = null;
  const mm = find(ids.medicine);
  const b = mm && measureMarker(cal, mm.corners, { height: mounts.medicine.height });
  if (b) {
    const { u, w } = toStation(b);
    let offset = null;
    if (robot) { // where the box should be if it is still in the robot's tray
      const eu = robot.u + mounts.medicine.forward * Math.cos(robot.heading), ew = robot.w + mounts.medicine.forward * Math.sin(robot.heading);
      offset = Math.hypot(u - eu, w - ew);
    }
    medicine = { u, w, offset, onRobot: offset === null ? null : offset <= geometry.boxTolerance };
  }
  return { robot, medicine };
}
