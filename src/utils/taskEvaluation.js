import { createMotionTracker } from './motionExperiment.js';

// project-doc.pdf §5.2 task menu, §4.3 charging, §8 C5 integrated sequence.
// Limits other than Static Balance are playground recording caps, not rubric limits.
export const TASKS = [
  { id: 'static-balance', name: 'Static Balance', module: 'A', limitMs: 30000, stationaryTolerancePx: 10,
    description: 'Remain balanced for 30 s (±2 s timing tolerance), with the medication box retained.' },
  { id: 'robot-guidance', name: 'Robot Guidance', module: 'B', limitMs: 120000, minM: 0.8, maxM: 1.2, targetM: 1,
    description: 'Travel 0.8–1.2 m in the commanded direction using the glove, maintaining balance and retaining the box.' },
  { id: 'charging', name: 'Charging', module: 'C', limitMs: 120000, chargingDelayMs: 5000, approachM: 0.3,
    description: 'Autonomously dock and confirm charging starts within 5 s after docking. Proximity alone is insufficient.' },
  { id: 'integrated', name: 'Integrated Task', module: 'E', limitMs: 120000, minM: 0.8, maxM: 1.2, targetM: 1, deliveryWaitMs: 5000, chargingDelayMs: 5000, approachM: 0.3,
    description: 'Deliver the box to the target using the glove; wait 5 s without losing it; autonomously dock and start charging. C5 repeats this independently four times.' },
];

export const DEFAULT_PIXELS_PER_METRE = 600;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const MAX_GAP_MS = 500; // Engineering evidence threshold; not a project requirement.
export const SIMULATION_PROXIMITY_TOLERANCE_PX = 2; // Pixel/corner quantization only.

export function recordingDeadlineReached(run, now) {
  return run.mode === 'recording' && now - run.startedAt >= run.task.limitMs;
}

export function evaluateTask(task, frames, durationMs, stopReason, source = 'recording') {
  const simulation = task.simulation === true;
  const report = { task: { ...task }, durationMs, stopReason, source, scope: simulation ? 'Simulation — visual checks only' : 'Full-task evaluation — 2D inputs',
    status: 'inconclusive', reasons: [], checks: [], metrics: { samples: frames.length } };
  const add = (name, status, detail) => report.checks.push({ name, status, detail });
  const finish = () => {
    report.status = report.checks.some((c) => c.status === 'failed') ? 'failed'
      : report.checks.some((c) => c.status === 'unavailable') ? 'inconclusive' : 'passed';
    report.reasons = report.checks.filter((c) => c.status === 'failed' || c.status === 'unavailable').map((c) => c.detail);
    if (!report.reasons.length) report.reasons = [simulation ? 'All enabled visual checks passed. Hardware checks were excluded.' : 'All supplied task evidence meets the selected requirements.'];
    return report;
  };
  const unavailable = (detail) => { add('Observation coverage', 'unavailable', detail); return finish(); };
  if (!TASKS.some((entry) => entry.id === task.id)) return unavailable('Unsupported task.');
  if (!frames.length) return unavailable('No recorded observations.');
  const recordedFrames = frames;
  const missingRobotSamples = frames.filter((f) => !f.robot).length;
  const missingStationSamples = frames.filter((f) => !f.station).length;
  report.metrics = { ...report.metrics, missingRobotSamples, missingStationSamples };
  if (!simulation && missingRobotSamples) return unavailable('Robot tracking was unavailable during the test.');
  if (simulation && !frames.at(-1).robot) return unavailable('Robot was not detected in the final recorded frame.');
  if (simulation) frames = frames.filter((f) => f.robot);
  if (!frames.length) return unavailable('No usable robot observations.');
  const continuous = (observations) => !observations.some((f, i) => i > 0 && f.t - observations[i - 1].t > MAX_GAP_MS);
  const endpointOnly = simulation && task.id === 'charging';
  const stageBased = simulation && task.id === 'integrated';
  if (recordedFrames.some((f, i) => i > 0 && f.t <= recordedFrames[i - 1].t)) return unavailable('Observation timestamps are not increasing.');
  if (durationMs - frames.at(-1).t > MAX_GAP_MS
    || (!endpointOnly && frames[0].t > MAX_GAP_MS)
    || (!endpointOnly && !stageBased && !continuous(frames))) return unavailable('Required observations have gaps exceeding 0.5 s.');
  if (durationMs > task.limitMs + MAX_GAP_MS) return unavailable('Recording deadline was missed; final evidence may be late.');
  if (simulation && (missingRobotSamples || missingStationSamples || !continuous(frames))) {
    add('Partial tracking', 'warning', `${missingRobotSamples} robot and ${missingStationSamples} station samples were unavailable. Only observations required by this task are used; unseen travel is excluded from path length.`);
  }

  const first = frames[0], last = frames.at(-1);
  const tracker = createMotionTracker();
  let movement;
  for (const frame of recordedFrames) movement = tracker.observe(frame.t, frame.robot, frame.station);
  report.metrics = { ...report.metrics, path: movement.path, displacement: distance(first.robot, last.robot),
    maxExcursion: Math.max(...frames.map((frame) => distance(first.robot, frame.robot))) };
  const scale = task.pixelsPerMetre;
  if (Number.isFinite(scale) && scale > 0) {
    report.metrics.displacementM = report.metrics.displacement / scale;
    report.metrics.pathM = movement.path / scale;
  }
  // These fields are deliberately NOT inferred from a stationary 2D marker.
  // Future verified telemetry/vision adapters populate frame.evidence.
  const evidence = (name, key, observations = frames) => {
    if (simulation) { add(name, 'skipped', `${name} is excluded in simulation mode.`); return; }
    const values = observations.map((f) => f.evidence?.[key]);
    const status = values.includes(false) ? 'failed' : values.length && values.every((v) => v === true) ? 'passed' : 'unavailable';
    add(name, status, status === 'failed' ? `${name} was violated.` : status === 'unavailable' ? `${name} evidence is not available in this playground.` : `${name} verified.`);
  };
  const range = (value) => Number.isFinite(value) && value >= task.minM && value <= task.maxM;
  evidence('Medication-box retention', 'loadSecure');
  if (task.id === 'static-balance') {
    add('Duration', durationMs >= 28000 && durationMs <= 32000 ? 'passed' : 'failed', 'Static Balance requires 30 s with ±2 s timing tolerance.');
    evidence('Active balance', 'balanced');
    add('Stationary position', report.metrics.maxExcursion <= task.stationaryTolerancePx ? 'passed' : 'failed', `Simulation stationary-position tolerance: ${task.stationaryTolerancePx} px (engineering setting, not a rubric threshold).`);
    return finish();
  }
  if (task.id === 'robot-guidance') {
    add('Travel distance', report.metrics.displacementM == null ? 'unavailable' : range(report.metrics.displacementM) ? 'passed' : 'failed',
      report.metrics.displacementM == null ? 'A simulation scale or physical calibration is required.' : `Final displacement: ${report.metrics.displacementM.toFixed(3)} m; required 0.8–1.2 m.`);
    const heading = first.heading;
    if (!heading || !Number.isFinite(heading.x) || !Number.isFinite(heading.y) || Math.hypot(heading.x, heading.y) === 0) {
      add('Commanded direction', 'unavailable', 'Robot heading is unavailable.');
    } else {
      const sign = task.direction === 'backward' ? -1 : 1;
      const norm = Math.hypot(heading.x, heading.y);
      const projections = frames.slice(1).map((f, i) => ((f.robot.x - frames[i].robot.x) * heading.x + (f.robot.y - frames[i].robot.y) * heading.y) / norm * sign);
      const total = ((last.robot.x - first.robot.x) * heading.x + (last.robot.y - first.robot.y) * heading.y) / norm * sign;
      add('Commanded direction', total > 0 && projections.every((v) => v >= -2) ? 'passed' : 'failed', `Expected ${task.direction ?? 'forward'} relative to the initial marker heading (2 px noise tolerance).`);
    }
    evidence('Glove control', 'gloveControlled');
    evidence('Active balance', 'balanced');
    return finish();
  }

  let deliveryTime = null;
  if (task.id === 'integrated') {
    // The robot eventually returns to the station: final displacement is NOT delivery distance.
    if (!Number.isFinite(scale) || scale <= 0) add('Delivery and wait', 'unavailable', 'Delivery distance needs a simulation scale or physical calibration.');
    else if (!task.deliveryGoal) add('Delivery and wait', 'unavailable', 'A delivery target must be registered before the integrated task.');
    else {
      for (let end = 0; end < frames.length && deliveryTime === null; end++) {
        const start = frames.findLastIndex((f) => f.t <= frames[end].t - task.deliveryWaitMs);
        if (start >= 0 && start <= end && range(distance(first.robot, frames[start].robot) / scale)
          && distance(task.deliveryGoal, frames[start].robot) / scale <= 0.2
          && continuous(frames.slice(start, end + 1))
          && frames.slice(start, end + 1).every((f) => distance(f.robot, frames[start].robot) <= 10)) deliveryTime = frames[end].t;
      }
      add('Delivery and wait', deliveryTime === null ? (simulation && !continuous(frames) ? 'unavailable' : 'failed') : 'passed', deliveryTime === null
        ? 'No delivery at 0.8–1.2 m followed by a 5 s wait was observed (10 px simulation hold tolerance).'
        : 'Delivery and 5 s wait observed before docking.');
    }
    evidence('Glove control during delivery', 'gloveControlled', frames.filter((f) => deliveryTime === null || f.t <= deliveryTime));
  }

  if (simulation) {
    const stationAvailable = Boolean(last.station);
    if (!stationAvailable || !Number.isFinite(scale) || scale <= 0) {
      add('Station proximity', 'unavailable', 'Station tracking and a valid simulation scale are required.');
    } else {
      report.metrics.finalStationDistanceM = distance(last.robot, last.station) / scale;
      const near = (frame) => frame.station && distance(frame.robot, frame.station) <= task.approachM * scale + SIMULATION_PROXIMITY_TOLERANCE_PX;
      add('Station proximity', near(last) ? 'passed' : 'failed',
        `Final station distance: ${report.metrics.finalStationDistanceM.toFixed(4)} m; target ≤${task.approachM} m with ${SIMULATION_PROXIMITY_TOLERANCE_PX} px simulation measurement tolerance. This does not verify docking or charging.`);
      if (task.id === 'integrated' && deliveryTime !== null) {
        const approachedAfterWait = last.t > deliveryTime && near(last);
        add('Visual sequence order', approachedAfterWait ? 'passed' : 'failed', 'Reach the station region after completing delivery and the 5 s wait.');
      }
    }
    for (const name of ['Docking', 'Autonomous docking', 'Charging start']) add(name, 'skipped', `${name} is excluded in simulation mode.`);
    return finish();
  }

  const dockIndex = frames.findIndex((f, i) => i > 0 && frames[i - 1].evidence?.docked === false && f.evidence?.docked === true);
  if (dockIndex < 0) {
    const known = frames.every((f) => typeof f.evidence?.docked === 'boolean');
    add('Docking', known ? 'failed' : 'unavailable', known ? 'No docking transition was observed.' : 'Docking evidence is unavailable; marker proximity does not prove docking.');
    add('Charging start', 'unavailable', 'A docking timestamp and charging telemetry are required to check the 5 s deadline.');
  } else {
    const dock = frames[dockIndex];
    add('Docking', 'passed', `Docking observed at ${(dock.t / 1000).toFixed(2)} s.`);
    evidence('Autonomous docking', 'autonomousDocking', [dock]);
    if (task.id === 'integrated' && deliveryTime !== null) add('Sequence order', dock.t > deliveryTime ? 'passed' : 'failed', 'Delivery and the 5 s wait must precede docking.');
    const charged = frames.find((f, i) => i > 0 && frames[i - 1].evidence?.charging === false && f.evidence?.charging === true && f.t >= dock.t);
    if (charged) {
      report.metrics.chargingDelaySec = (charged.t - dock.t) / 1000;
      add('Charging start', charged.t - dock.t <= task.chargingDelayMs ? 'passed' : 'failed', `Charging started ${report.metrics.chargingDelaySec.toFixed(2)} s after docking; maximum 5 s.`);
    } else {
      const known = frames.slice(dockIndex).every((f) => typeof f.evidence?.charging === 'boolean');
      add('Charging start', known ? 'failed' : 'unavailable', known ? 'Charging did not start during the recorded task.' : 'Charging telemetry is unavailable.');
    }
  }
  return finish();
}
