// Records one test run as it happens: camera frames, telemetry packets and operator commands,
// all on the caller's clock (seconds), stored relative to Start Test. Also decides when a task
// has reached its completion condition so the run can end itself (§5.2).
import { SPEC, ENGINEERING } from './spec.js';

const r4 = (v) => (Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : v);
const r3 = (v) => Math.round(v * 1e3) / 1e3;

/** Rounded copy so the record serialises identically after a JSON round trip. */
const robotFields = (r) => r && {
  u: r4(r.u), w: r4(r.w), heading: r4(r.heading), frontGap: r4(r.frontGap), headingError: r4(r.headingError), inApproach: r.inApproach,
};

/**
 * task: { id, direction? }. startT: caller-clock time of Start Test. commandsAvailable: whether
 * operator commands will be reported (simulator: yes). meta: free-form context stored in the record.
 */
export function createRunRecorder({ task, startT, commandsAvailable = true, meta = {} }) {
  const frames = [], packets = [], commands = commandsAvailable ? [] : null;
  const rel = (t) => r3(t - startT);
  let startPose = null, stillSince = null, stillAt = null, dockedSeen = false, chargingAt = null;
  let chargedOnce = false, offAfterCharge = false, rechargedAt = null; // C3.4 off → on cycle

  const recorder = {
    task,
    elapsed: (now) => now - startT,
    /** operatorActive: operator input is driving the robot right now (true/false), or undefined if unknown. */
    addFrame(t, robot, medicine, operatorActive) {
      const f = { t: rel(t), robot: robotFields(robot), medicine: medicine ? { onRobot: medicine.onRobot } : null };
      if (typeof operatorActive === 'boolean') f.operator = operatorActive;
      if (frames.length && f.t <= frames.at(-1).t) return; // keep time strictly increasing
      frames.push(f);
      if (f.robot) {
        startPose ??= f.robot;
        if (!stillAt || Math.hypot(f.robot.u - stillAt.u, f.robot.w - stillAt.w) > ENGINEERING.stationaryM) { stillAt = f.robot; stillSince = f.t; }
        if (Math.abs(f.robot.frontGap) <= ENGINEERING.dock.frontGapM && Math.abs(f.robot.w) <= ENGINEERING.dock.lateralM) dockedSeen = true;
      }
    },
    addPacket(t, p) {
      const packet = { t: rel(t), tilt: p.tilt, charging: Boolean(p.charging), battery: p.battery };
      packets.push(packet);
      if (packet.charging && dockedSeen && chargingAt === null) chargingAt = packet.t;
      if (packet.charging) { if (offAfterCharge && rechargedAt === null) rechargedAt = packet.t; chargedOnce = true; } else if (chargedOnce) offAfterCharge = true;
    },
    /** ignored: the robot was docking itself and did not act on the command. */
    addCommand(t, name, ignored = false) { commands?.push(ignored ? { t: rel(t), name, ignored: true } : { t: rel(t), name }); },
    /** Live progress for the UI. */
    progress(now) {
      const last = frames.findLast((f) => f.robot);
      return {
        elapsedS: now - startT,
        displacementM: startPose && last ? Math.hypot(last.robot.u - startPose.u, last.robot.w - startPose.w) : null,
        stillForS: stillSince === null ? null : now - startT - stillSince,
        docked: dockedSeen, chargingAtS: chargingAt,
      };
    },
    /** 'completed' | 'time-limit' | null. */
    autoEnd(now) {
      const t = now - startT;
      if (task.id === 'static-balance') return t >= SPEC.staticBalanceS ? 'completed' : null;
      if (t >= ENGINEERING.timeLimitS) return 'time-limit';
      const p = recorder.progress(now);
      if (task.id === 'robot-guidance') return p.displacementM >= ENGINEERING.minTurnLegM && p.stillForS >= SPEC.guidanceStopS ? 'completed' : null;
      if (task.id === 'charging-indicator') return rechargedAt !== null && t >= rechargedAt + 1 ? 'completed' : null;
      // Charging / integrated: end shortly after charging is first reported at the dock.
      return chargingAt !== null && t >= chargingAt + 1 ? 'completed' : null;
    },
    finish(now, endReason, wallClock = new Date().toISOString()) {
      return { version: 1, task: { ...task }, wallClock, durationS: r3(now - startT), endReason, frames, packets, commands, meta };
    },
  };
  return recorder;
}
