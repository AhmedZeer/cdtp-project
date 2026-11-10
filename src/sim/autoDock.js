// Autonomous docking controller (§4.3, rubric C3.1–C3.2). It uses only what a real robot has:
// IR readings (irSensors.js), its own gyro heading, wheel odometry, a front bumper and the voltage
// sense on its charging contacts. It never reads the true robot or station pose.
//
//   search  → spin until the front receivers see the emitter
//   face    → turn until the emitter is straight ahead, then check which beam(s) the robot is in
//   turn    → off the centre line: turn 90° (gyro) towards it
//   cross   → drive across until both beams are heard (the centre line), stop, face again
//   approach→ drive in, keeping the emitter ahead and nudging back towards the centre line
//   settle  → touching: wait for contact voltage (charging contacts aligned)
//   backoff → contact without voltage (misaligned): reverse 25 cm and try again
//   docked  → motors stopped on the dock
import { IR } from './irSensors.js';

const DEG = Math.PI / 180;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const DOCK = {
  searchRate: 0.9, // rad/s
  faceTolerance: 4 * DEG,
  faceGain: 2.5, // 1/s
  crossSpeed: 0.12, // m/s
  crossLimit: 1.6, // m: give up crossing (and search again) after this far
  approachFar: 0.12, approachNear: 0.05, nearRange: 0.35, // m/s, m/s, m
  sideBias: 12 * DEG, // aim this far off the emitter when only one beam is heard
  steerGain: 2.5, maxSteer: 0.6, // 1/s, rad/s
  steerLimit: 15 * DEG, // stop and turn in place when further off than this
  lostTimeout: 1.0, // s without the emitter before searching again
  settleTimeout: 1.0, // s of contact without voltage = misaligned
  backoffDistance: 0.25, // m
  maxAttempts: 4,
  timeout: 90, // s
};

export const DOCK_STATE_LABELS = {
  idle: 'Manual (glove)', search: 'Searching for the IR beam', face: 'Facing the station', turn: 'Turning towards the centre line',
  cross: 'Crossing to the centre line', approach: 'Approaching', settle: 'Touching — checking contacts', backoff: 'Misaligned — backing off',
  docked: 'Docked', failed: 'Docking failed',
};

export function createAutoDock() {
  let state = 'idle', t = 0, since = 0, lostSince = null, heardAt = 0, target = null, startOdo = 0, attempts = 0, faced = 0, lastCode = null, engagedAt = 0;
  const go = (next) => { state = next; since = t; faced = 0; };
  const stop = { v: 0, omega: 0 };
  const dock = {
    get state() { return state; },
    get attempts() { return attempts; },
    get engaged() { return !['idle', 'docked', 'failed'].includes(state); },
    engage(now) { t = now; engagedAt = now; attempts = 1; lostSince = null; go('search'); },
    release() { go('idle'); },
    /**
     * One control update. ir: readIr() output; s: { heading, odometer, bumper, contactVoltage }.
     * Returns { v, omega } to hold until the next update, or null when not in control.
     */
    update(now, ir, s) {
      t = now;
      if (state === 'idle' || state === 'failed') return null;
      if (state === 'docked') { if (!s.contactVoltage) go('idle'); return state === 'idle' ? null : stop; }
      if (t - engagedAt > DOCK.timeout) { go('failed'); return null; }
      const code = ir.omni.L && ir.omni.R ? 'both' : ir.omni.L ? 'L' : ir.omni.R ? 'R' : null;
      if (code) { lastCode = code; heardAt = t; }
      const f = ir.front;
      if (f.visible) lostSince = null; else lostSince ??= t;
      const lost = lostSince !== null && t - lostSince > DOCK.lostTimeout;

      switch (state) {
        case 'search':
          if (f.visible) { go('face'); return stop; }
          return { v: 0, omega: DOCK.searchRate };
        case 'face': {
          if (lost) { go('search'); return stop; }
          if (!f.visible) return stop;
          if (Math.abs(f.bearing) > DOCK.faceTolerance) { faced = 0; return { v: 0, omega: clamp(DOCK.faceGain * f.bearing, -0.8, 0.8) }; }
          if (++faced < 3 || !code) return stop; // hold still: three agreeing readings and a beam code
          if (code === 'both') { go('approach'); return stop; }
          // Left beam only: the robot is on the station's left; the centre line is to its left
          // while it faces the station, so turn left 90° (and vice versa).
          target = wrap(s.heading + (code === 'L' ? 1 : -1) * (Math.PI / 2));
          go('turn');
          return stop;
        }
        case 'turn': {
          const err = wrap(target - s.heading);
          if (Math.abs(err) < 2 * DEG) { startOdo = s.odometer; go('cross'); return stop; }
          return { v: 0, omega: clamp(3 * err, -1.2, 1.2) };
        }
        case 'cross':
          if (code === 'both') { go('face'); return stop; }
          // Single readings drop out now and then; only a beam silent for half a second means it is lost.
          if (s.bumper || s.odometer - startOdo > DOCK.crossLimit || t - heardAt > 0.5) { go('search'); return stop; }
          return { v: DOCK.crossSpeed, omega: clamp(3 * wrap(target - s.heading), -0.5, 0.5) };
        case 'approach': {
          if (s.bumper) { go('settle'); return stop; }
          if (lost) { go('search'); return stop; }
          if (!f.visible) return { v: DOCK.approachNear * 0.5, omega: 0 }; // brief dropout: creep on
          const aim = lastCode === 'L' ? -DOCK.sideBias : lastCode === 'R' ? DOCK.sideBias : 0;
          const err = f.bearing - aim;
          const omega = clamp(DOCK.steerGain * err, -DOCK.maxSteer, DOCK.maxSteer);
          if (Math.abs(err) > DOCK.steerLimit) return { v: 0, omega };
          return { v: f.range > DOCK.nearRange ? DOCK.approachFar : DOCK.approachNear, omega };
        }
        case 'settle':
          if (s.contactVoltage) { go('docked'); return stop; }
          if (t - since > DOCK.settleTimeout) {
            if (++attempts > DOCK.maxAttempts) { go('failed'); return null; }
            startOdo = s.odometer; go('backoff');
          }
          return { v: DOCK.approachNear * 0.4, omega: 0 }; // keep light pressure on the contacts
        case 'backoff':
          if (s.odometer - startOdo >= DOCK.backoffDistance) { go('face'); return stop; }
          return { v: -DOCK.crossSpeed, omega: 0 };
        default:
          return stop;
      }
    },
  };
  return dock;
}

export { IR };
