// Simulated infrared docking sensors (§4.3: the robot "must detect the charging station using an
// IR transmitter-receiver sensor"). The layout follows common robot-vacuum docks:
//
// Station (emitters at the centre of the contact face):
//   L beam, R beam: wide cones (±BEAM_HALF) covering the station's left (+w) and right (−w)
//                   halves; they overlap only in a thin band (±CENTRE_BAND) around the centre line.
//   F field:        a short-range "force field" that covers exactly the §4.3 approach region.
// Robot:
//   omni receiver (on top, at the robot's centre): which codes it hears — L, R, F — no direction.
//   front receiver pair (at the body front): bearing to the emitter (from the two receivers'
//                   intensity difference) and a rough range (from intensity), within ±FRONT_FOV.
//
// The docking controller only ever sees these readings, never the true poses.
import { STATION, ROBOT } from './simConfig.js';
import { toStationFrame, inApproachRegion, wrapAngle } from './world.js';

export const IR = {
  beamHalf: (80 * Math.PI) / 180, // L/R beam cone half-angle: wide enough to cover the whole approach region as seen from the face (up to ~75°)
  beamRange: 1.8, // m
  centreBand: (2 * Math.PI) / 180, // L and R overlap within ±2° of the centre line
  frontFov: (60 * Math.PI) / 180, // front receiver pair sees the emitter within ±60° of the heading
  bearingNoise: (1.5 * Math.PI) / 180, // 1σ
  rangeNoise: 0.08, // 1σ, relative (intensity-based range is rough)
  dropout: 0.03, // chance that a reading is lost
  rateHz: 20,
};

const gauss = (rng) => Math.sqrt(-2 * Math.log(rng() || 1e-12)) * Math.cos(2 * Math.PI * rng());

/** Which beams cover a point in station coordinates (u out of the face, w to the left). */
function beamsAt(u, w) {
  const du = u - STATION.depth / 2, phi = Math.atan2(w, du), d = Math.hypot(du, w);
  const inCone = du > 0 && Math.abs(phi) <= IR.beamHalf && d <= IR.beamRange;
  return { L: inCone && phi >= -IR.centreBand, R: inCone && phi <= IR.centreBand };
}

/** One reading of every robot IR receiver. rng: () => [0, 1). */
export function readIr(world, rng = Math.random) {
  const r = world.robot, s = world.station;
  const centre = toStationFrame(s, r.x, r.y);
  const fx = r.x + (ROBOT.body.depth / 2) * Math.cos(r.heading), fy = r.y + (ROBOT.body.depth / 2) * Math.sin(r.heading);
  const front = toStationFrame(s, fx, fy);
  const lost = () => rng() < IR.dropout;

  const omniBeams = beamsAt(centre.u, centre.w);
  const omni = lost() ? { L: false, R: false, F: false }
    : { ...omniBeams, F: inApproachRegion(centre.u, centre.w) };

  // Emitter position relative to the front receivers.
  const ex = s.x + (STATION.depth / 2) * Math.cos(s.heading), ey = s.y + (STATION.depth / 2) * Math.sin(s.heading);
  const bearing = wrapAngle(Math.atan2(ey - fy, ex - fx) - r.heading);
  const range = Math.hypot(ex - fx, ey - fy);
  const frontBeams = beamsAt(front.u, front.w);
  const visible = (frontBeams.L || frontBeams.R) && Math.abs(bearing) <= IR.frontFov && !lost();
  return {
    omni,
    front: visible
      ? { visible: true, bearing: bearing + gauss(rng) * IR.bearingNoise, range: Math.max(0, range * (1 + gauss(rng) * IR.rangeNoise)) }
      : { visible: false, bearing: null, range: null },
  };
}
