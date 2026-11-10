// Pass/fail decision for one recorded test run. Pure function of the record, so a sealed record
// can be re-evaluated later to show its result was not edited.
//
// record = {
//   task: { id, direction? }, durationS, endReason,
//   frames:   [{ t, robot: { u, w, heading, frontGap, headingError, inApproach } | null, medicine: { onRobot } | null,
//               operator?: boolean }],   // operator input driving the robot at that moment (latched/held drive, turn)
//   packets:  [{ t, tilt, charging, battery }],      // robot telemetry as received
//   commands: [{ t, name, ignored? }] | null,        // operator commands (ignored = robot was docking itself); null = not reported
// }
// Times are seconds since Start Test. Positions are metres in the station frame
// (u out of the contact face, w to its left).
import { SPEC, ENGINEERING, taskById } from './spec.js';

const deg = (r) => (r * 180) / Math.PI;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const dist = (a, b) => Math.hypot(a.u - b.u, a.w - b.w);
const f2 = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');

/** Mean pose of the observations in [from, to]; heading by circular mean. */
function meanPose(seen, from, to) {
  const s = seen.filter((f) => f.t >= from && f.t <= to);
  if (!s.length) return null;
  const n = s.length;
  return {
    u: s.reduce((a, f) => a + f.robot.u, 0) / n, w: s.reduce((a, f) => a + f.robot.w, 0) / n,
    heading: Math.atan2(s.reduce((a, f) => a + Math.sin(f.robot.heading), 0), s.reduce((a, f) => a + Math.cos(f.robot.heading), 0)),
  };
}

/** Earliest time ≥ from at which the robot stays within `radius` for `hold` seconds; null if never. */
function firstHold(seen, from, hold, radius, maxGap) {
  for (let i = 0; i < seen.length; i++) {
    if (seen[i].t < from) continue;
    const anchor = seen[i];
    let ok = true, last = anchor;
    for (let j = i + 1; j < seen.length && seen[j].t <= anchor.t + hold; j++) {
      if (seen[j].t - last.t > maxGap || dist(seen[j].robot, anchor.robot) > radius) { ok = false; break; }
      last = seen[j];
    }
    if (ok && last.t >= anchor.t + hold - 0.15) return anchor.t;
  }
  return null;
}

/** Path length with a deadband so measurement noise does not add up into fake travel. */
function pathLength(seen, from, to, deadband = 0.03) {
  let anchor = null, path = 0;
  for (const f of seen) {
    if (f.t < from || f.t > to) continue;
    if (!anchor) { anchor = f.robot; continue; }
    const d = dist(f.robot, anchor);
    if (d >= deadband) { path += d; anchor = f.robot; }
  }
  return path;
}

const isDocked = (r) => r && Math.abs(r.frontGap) <= ENGINEERING.dock.frontGapM && Math.abs(r.w) <= ENGINEERING.dock.lateralM
  && Math.abs(deg(r.headingError)) <= ENGINEERING.dock.headingDeg;

/** Start of the first docked stretch lasting holdS (after `from`), or null. */
function dockTime(frames, from) {
  let start = null;
  for (const f of frames) {
    if (f.t < from || !f.robot) continue; // unseen frames neither start nor break a stretch
    if (isDocked(f.robot)) { start ??= f.t; if (f.t - start >= ENGINEERING.dock.holdS) return start; } else start = null;
  }
  return null;
}

export function evaluateRun(record) {
  const task = taskById(record.task.id);
  const checks = [];
  const metrics = {};
  const add = (name, status, detail, basis = 'spec') => checks.push({ name, status, detail, basis });
  const frames = record.frames;
  const seen = frames.filter((f) => f.robot);
  const T = record.durationS;
  const result = () => {
    const status = checks.some((c) => c.status === 'failed') ? 'failed' : checks.some((c) => c.status === 'unavailable') ? 'inconclusive' : 'passed';
    return { task: task?.id ?? record.task.id, status, points: status === 'passed' ? 5 : 0, checks, metrics };
  };
  if (!task) { add('Task', 'unavailable', `Unknown task "${record.task.id}".`); return result(); }

  // --- Evidence common to every task -------------------------------------------------------
  metrics.durationS = T;
  metrics.trackedFraction = frames.length ? seen.length / frames.length : 0;
  const gaps = [];
  let prev = 0;
  for (const f of seen) { gaps.push(f.t - prev); prev = f.t; }
  gaps.push(T - prev);
  metrics.maxTrackingGapS = Math.max(...gaps);
  const tracked = seen.length > 0 && metrics.maxTrackingGapS <= ENGINEERING.maxTrackingGapS;
  add('Camera tracking', tracked ? 'passed' : 'unavailable',
    tracked ? `Robot tracked in ${Math.round(metrics.trackedFraction * 100)}% of frames; longest gap ${f2(metrics.maxTrackingGapS)} s.`
      : `Robot not tracked for ${f2(metrics.maxTrackingGapS)} s (limit ${ENGINEERING.maxTrackingGapS} s); required observations are missing.`, 'engineering');

  const packets = record.packets;
  let linkGap = packets.length ? packets[0].t : T;
  for (let i = 1; i < packets.length; i++) linkGap = Math.max(linkGap, packets[i].t - packets[i - 1].t);
  if (packets.length) linkGap = Math.max(linkGap, T - packets.at(-1).t);
  metrics.maxLinkGapS = linkGap;
  metrics.telemetryHz = T > 0 ? packets.length / T : 0;
  add('Telemetry link', linkGap <= SPEC.linkMaxGapS + 0.05 ? 'passed' : 'failed',
    `${packets.length} packets (${f2(metrics.telemetryHz)} Hz); longest silence ${f2(linkGap)} s, limit ${SPEC.linkMaxGapS} s (§5.2).`);

  const maxTilt = packets.length ? Math.max(...packets.map((p) => Math.abs(p.tilt))) : null;
  metrics.maxTiltDeg = maxTilt;
  add('Balance', maxTilt === null ? 'unavailable' : maxTilt < ENGINEERING.fallenTiltDeg ? 'passed' : 'failed',
    maxTilt === null ? 'No tilt telemetry received.' : `Largest reported tilt ${f2(maxTilt, 1)}°; ${ENGINEERING.fallenTiltDeg}° or more counts as a fall.`, 'engineering');

  // Medicine box: dropped if seen off the robot continuously for boxLossS.
  let offSince = null, dropped = null, lastBox = null;
  for (const f of frames) {
    if (f.medicine?.onRobot === false) { offSince ??= f.t; if (f.t - offSince >= ENGINEERING.boxLossS) { dropped ??= offSince; } }
    else if (f.medicine?.onRobot === true) offSince = null;
    if (typeof f.medicine?.onRobot === 'boolean') lastBox = f;
  }
  add('Medicine box retained', dropped !== null ? 'failed' : lastBox?.medicine.onRobot ? 'passed' : 'unavailable',
    dropped !== null ? `Box seen off the robot from ${f2(dropped, 1)} s.` : lastBox ? `Box last confirmed on the robot at ${f2(lastBox.t, 1)} s.` : 'The box marker was never seen together with the robot marker.');

  if (!seen.length) return result();

  // --- Task-specific checks ----------------------------------------------------------------
  const head = (from, to) => meanPose(seen, from, to);
  const start = head(0, 0.5) ?? seen[0].robot, end = head(T - 0.5, T) ?? seen.at(-1).robot;

  if (task.id === 'static-balance') {
    const okTime = Math.abs(T - SPEC.staticBalanceS) <= SPEC.durationToleranceS;
    add('Duration', okTime ? 'passed' : 'failed', `Ran ${f2(T, 1)} s; required ${SPEC.staticBalanceS} ± ${SPEC.durationToleranceS} s (§5.2).`);
    const excursion = Math.max(...seen.map((f) => dist(f.robot, start)));
    metrics.maxExcursionM = excursion;
    add('Stayed in place', excursion <= ENGINEERING.stationaryM ? 'passed' : 'failed',
      `Largest drift from the start ${f2(excursion * 100, 1)} cm; limit ${ENGINEERING.stationaryM * 100} cm.`, 'engineering');
    return result();
  }

  if (task.id === 'robot-guidance') {
    const sign = record.task.direction === 'backward' ? -1 : 1;
    const du = end.u - start.u, dw = end.w - start.w;
    const travelled = Math.hypot(du, dw);
    const along = (du * Math.cos(start.heading) + dw * Math.sin(start.heading)) * sign;
    const offAxis = travelled > 0 ? deg(Math.acos(Math.max(-1, Math.min(1, along / travelled)))) : 180;
    Object.assign(metrics, { displacementM: travelled, alongM: along, offAxisDeg: offAxis });
    add('Distance travelled', travelled >= SPEC.guidanceMinM && travelled <= SPEC.guidanceMaxM ? 'passed' : 'failed',
      `Moved ${f2(travelled)} m start to end; required ${SPEC.guidanceMinM}–${SPEC.guidanceMaxM} m (§5.2).`);
    add('Direction', along > 0 && offAxis <= ENGINEERING.directionToleranceDeg ? 'passed' : 'failed',
      `Commanded ${record.task.direction ?? 'forward'}; motion was ${f2(offAxis, 0)}° off that axis (limit ${ENGINEERING.directionToleranceDeg}°)${along <= 0 ? ', in the opposite direction' : ''}.`, 'engineering');
    if (record.commands === null) add('Glove commands', 'skipped', 'The command source does not report commands to the app.');
    else {
      const wanted = record.task.direction === 'backward' ? 'backward' : 'forward';
      const used = record.commands.some((c) => c.name === wanted && !c.ignored);
      add('Glove commands', used ? 'passed' : 'failed', used ? `A ${wanted} command was issued.` : `No ${wanted} command was issued during the test.`);
    }
    return result();
  }

  // Docking and charging (Charging and Integrated).
  const dockCheck = (from, autonomyFrom, label) => {
    const dock = dockTime(frames, from);
    metrics.dockedAtS = dock;
    add('Docking', dock === null ? 'failed' : 'passed', dock === null ? `No docked position was observed${label}.`
      : `Docked at ${f2(dock, 1)} s (camera: front gap ≤ ${ENGINEERING.dock.frontGapM * 100} cm, lateral ≤ ${ENGINEERING.dock.lateralM * 100} cm, angle ≤ ${ENGINEERING.dock.headingDeg}°).`);
    if (dock === null) { add('Charging start', 'failed', 'Charging cannot start without docking.'); return; }
    // Human guidance = a command issued in the window, or operator input still driving the robot
    // (a latched or held drive started earlier counts too).
    // The robot gets a short handover after entering the region to notice it and take over.
    const windowStart = autonomyFrom + ENGINEERING.handoverS;
    const windowFrames = frames.filter((f) => f.t >= windowStart && f.t <= dock);
    const driven = windowFrames.filter((f) => f.operator === true);
    const known = windowFrames.some((f) => typeof f.operator === 'boolean');
    if (record.commands === null && !known) add('Autonomous docking', 'skipped', 'Neither commands nor operator activity are reported to the app.');
    else {
      // Commands the robot ignored because it was docking itself are not guidance.
      const guided = (record.commands ?? []).filter((c) => c.t >= windowStart && c.t <= dock && !c.ignored);
      const human = guided.length > 0 || driven.length > 0;
      add('Autonomous docking', human ? 'failed' : 'passed', human
        ? `Operator input drove the robot between ${f2(autonomyFrom, 1)} s and docking (${guided.length} new command(s), ${f2(driven.length * 0.1, 1)} s of active drive); docking must happen without human or glove guidance (§4.3).`
        : `No operator input from the approach region to docking (§4.3; ${ENGINEERING.handoverS} s handover allowed).`);
    }
    const charged = packets.find((p) => p.charging && p.t >= dock);
    metrics.chargingDelayS = charged ? charged.t - dock : null;
    add('Charging start', charged && charged.t - dock <= SPEC.chargeDeadlineS ? 'passed' : 'failed', charged
      ? `Charging reported ${f2(charged.t - dock, 1)} s after docking; limit ${SPEC.chargeDeadlineS} s (§4.3). Telemetry arrives at 1 Hz, so this includes up to 1 s of reporting delay.`
      : 'Charging was never reported after docking.');
  };

  if (task.id === 'charging-indicator') {
    // C3.4: charging on at the start → pulled off the dock → off within 2 s → put back → on within 5 s.
    const first = packets[0];
    add('Charging at start', first?.charging ? 'passed' : 'failed', first?.charging ? 'Charging was reported at the start.' : 'Start the test with the robot docked and charging.');
    const pulled = seen.find((f) => !isDocked(f.robot));
    metrics.pulledAtS = pulled?.t ?? null;
    if (!pulled) { add('Pulled away', 'failed', 'The camera never saw the robot leave the dock.'); return result(); }
    add('Pulled away', 'passed', `Robot left the dock at ${f2(pulled.t, 1)} s.`);
    const off = packets.find((p) => p.t >= pulled.t && !p.charging);
    metrics.offDelayS = off ? off.t - pulled.t : null;
    add('Indicator off', off && off.t - pulled.t <= SPEC.indicatorOffS ? 'passed' : 'failed', off
      ? `Charging reported off ${f2(off.t - pulled.t, 1)} s after leaving the dock; limit ${SPEC.indicatorOffS} s (§4.3). Includes up to 1 s of 1 Hz reporting delay.`
      : 'Charging was never reported off after the robot left the dock.');
    const back = dockTime(frames, pulled.t);
    metrics.returnedAtS = back;
    if (back === null) { add('Indicator on again', 'failed', 'The robot was not seen back on the dock.'); return result(); }
    const on = packets.find((p) => p.t >= back && p.charging);
    metrics.onDelayS = on ? on.t - back : null;
    add('Indicator on again', on && on.t - back <= SPEC.indicatorOnS ? 'passed' : 'failed', on
      ? `Back on the dock at ${f2(back, 1)} s; charging reported ${f2(on.t - back, 1)} s later; limit ${SPEC.indicatorOnS} s (§4.3).`
      : 'Charging was never reported after the robot was put back.');
    return result();
  }

  if (task.id === 'charging') {
    const first = seen[0];
    add('Starts in approach region', first.t <= 0.5 && first.robot.inApproach ? 'passed' : 'failed',
      first.robot.inApproach ? 'The robot started inside the 90° / 30 cm approach region (§4.3).' : 'The robot did not start inside the 90° / 30 cm approach region (§4.3).');
    if (packets[0]?.charging) add('Not charging at start', 'failed', 'Charging was already reported at the start of the test.');
    dockCheck(0, 0, '');
    return result();
  }

  // Integrated task (§5.3, §8 C5).
  const hold = (from, seconds) => firstHold(seen, from, seconds, ENGINEERING.stationaryM, ENGINEERING.maxTrackingGapS);
  const waited = hold(0, SPEC.initialBalanceS) === seen[0].t && seen[0].t <= 0.5;
  add('Initial 5 s balance', waited ? 'passed' : 'failed', waited ? 'Waited in place for 5 s before driving (§5.3).' : 'Started driving before waiting 5 s in place (§5.3).');

  // Delivery: the first 5 s stop after at least minTurnLegM of travel.
  const legStart = SPEC.initialBalanceS;
  let delivery = null;
  for (let from = legStart; from < T; ) {
    const t = hold(from, SPEC.deliveryWaitS);
    if (t === null) break;
    if (pathLength(seen, legStart, t) >= ENGINEERING.minTurnLegM) { delivery = t; break; }
    from = seen.find((f) => f.t > t)?.t ?? T; // keep looking after this stop
  }
  metrics.deliveryAtS = delivery;
  if (delivery === null) {
    add('Delivery leg', 'failed', `No ${SPEC.deliveryWaitS} s stop after at least ${ENGINEERING.minTurnLegM} m of travel was observed.`);
    add('Charging start', 'failed', 'Docking is only evaluated after the delivery and wait.');
    return result();
  }
  const leg = pathLength(seen, legStart, delivery);
  const legHeadings = seen.filter((f) => f.t >= legStart && f.t <= delivery).map((f) => f.robot.heading);
  const turned = legHeadings.length ? Math.max(...legHeadings.map((h) => Math.abs(deg(wrap(h - legHeadings[0]))))) : 0;
  Object.assign(metrics, { legPathM: leg, legTurnDeg: turned });
  add('Delivery leg', leg >= SPEC.guidanceMinM && leg <= SPEC.guidanceMaxM ? 'passed' : 'failed',
    `Drove ${f2(leg)} m before stopping at ${f2(delivery, 1)} s; required about 1 m (${SPEC.guidanceMinM}–${SPEC.guidanceMaxM} m, §5.3).`);
  add('Changed direction', turned >= ENGINEERING.turnChangeDeg ? 'passed' : 'failed',
    `Largest heading change during the leg ${f2(turned, 0)}°; at least ${ENGINEERING.turnChangeDeg}° required (§5.3 "changes direction").`, 'engineering');
  add('5 s wait at delivery point', 'passed', `Held position for ${SPEC.deliveryWaitS} s from ${f2(delivery, 1)} s (§8 C5).`);
  if (record.commands !== null) {
    const glove = record.commands.some((c) => c.t >= legStart && c.t <= delivery && c.name !== 'stop');
    add('Glove commands', glove ? 'passed' : 'failed', glove ? 'The delivery leg was driven by operator commands.' : 'No drive commands were issued during the delivery leg.');
  }
  const waitEnd = delivery + SPEC.deliveryWaitS;
  const approach = frames.find((f) => f.t >= waitEnd && f.robot?.inApproach);
  metrics.approachAtS = approach?.t ?? null;
  add('Reached approach region', approach ? 'passed' : 'failed',
    approach ? `Entered the approach region at ${f2(approach.t, 1)} s.` : 'Never entered the approach region after the delivery wait.');
  if (!approach) { add('Charging start', 'failed', 'Docking is only evaluated from the approach region.'); return result(); }
  dockCheck(approach.t, approach.t, ' after the approach region was reached');
  return result();
}
