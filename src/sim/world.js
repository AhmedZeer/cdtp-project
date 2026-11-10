// Pure simulation state and physics. No DOM or three.js here so it runs under `node --test`.
import { ROBOT, STATION, BATTERY, ARENA, INITIAL_POSES } from './simConfig.js';

export const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const approach = (value, target, step) => (value < target ? Math.min(target, value + step) : Math.max(target, value - step));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function createWorld(poses = INITIAL_POSES) {
  return {
    time: 0,
    robot: {
      x: poses.robot.x, y: poses.robot.y, heading: poses.robot.heading,
      v: 0, omega: 0, accel: 0,
      pitch: 0, pitchRate: 0, // body lean about the axle; positive = leaning forward
      turnTarget: null, // absolute heading of an in-progress 90° turn
      wheelLeft: 0, wheelRight: 0, // wheel rotation angles for rendering
      odometer: 0,
      blocked: false,
    },
    station: { ...poses.station },
    contactTime: 0, // s of continuous valid dock contact
    docked: false,
    charging: false,
    battery: BATTERY.start,
    command: 'stop', // last command applied: forward | backward | left | right | stop
  };
}

/** Request a 90° in-place turn. Ignored while another turn is running. */
export function requestTurn(world, direction) {
  const r = world.robot;
  if (r.turnTarget !== null) return false;
  const base = Math.round(r.heading / ROBOT.turnStep) * ROBOT.turnStep; // stay on the 90° grid if close
  const from = Math.abs(wrapAngle(r.heading - base)) < (5 * Math.PI) / 180 ? base : r.heading;
  r.turnTarget = wrapAngle(from + (direction === 'left' ? ROBOT.turnStep : -ROBOT.turnStep));
  world.command = direction;
  return true;
}

/** Station-local coordinates of a world point: u = out of the contact face, w = to the station's left. */
export function toStationFrame(station, x, y) {
  const dx = x - station.x, dy = y - station.y;
  const c = Math.cos(station.heading), s = Math.sin(station.heading);
  return { u: dx * c + dy * s, w: -dx * s + dy * c };
}

/** Distance from the robot body's front face to the station's contact face, and alignment errors. */
export function dockGeometry(world) {
  const { robot: r, station } = world;
  const local = toStationFrame(station, r.x, r.y);
  const faceToCentre = local.u - STATION.depth / 2; // robot centre in front of the contact face
  const headingError = wrapAngle(r.heading - (station.heading + Math.PI)); // 0 = facing the station
  return { faceToCentre, frontGap: faceToCentre - ROBOT.body.depth / 2, lateral: local.w, headingError };
}

function resolveCollisions(world) {
  const r = world.robot;
  let hit = false;
  // Station body vs robot body footprint (the medicine box overhangs above the station's height).
  const local = toStationFrame(world.station, r.x, r.y);
  const rel = r.heading - world.station.heading;
  const hd = ROBOT.body.depth / 2, hw = ROBOT.body.width / 2 + ROBOT.wheelWidth;
  const extentU = Math.abs(Math.cos(rel)) * hd + Math.abs(Math.sin(rel)) * hw;
  const extentW = Math.abs(Math.sin(rel)) * hd + Math.abs(Math.cos(rel)) * hw;
  const penU = STATION.depth / 2 + extentU - Math.abs(local.u);
  const penW = STATION.width / 2 + extentW - Math.abs(local.w);
  if (penU > 0 && penW > 0) {
    const c = Math.cos(world.station.heading), s = Math.sin(world.station.heading);
    if (penU < penW) { const d = Math.sign(local.u) * penU; r.x += d * c; r.y += d * s; }
    else { const d = Math.sign(local.w) * penW; r.x += -d * s; r.y += d * c; }
    hit = true;
  }
  // Arena walls.
  const margin = 0.16;
  const nx = clamp(r.x, -ARENA.width / 2 + margin, ARENA.width / 2 - margin);
  const ny = clamp(r.y, -ARENA.depth / 2 + margin, ARENA.depth / 2 - margin);
  if (nx !== r.x || ny !== r.y) { r.x = nx; r.y = ny; hit = true; }
  return hit;
}

/**
 * Advance the world by dt seconds.
 * drive: -1 backward, 0 none, +1 forward. Ignored while turning.
 */
export function stepWorld(world, drive, dt) {
  const r = world.robot;
  const prevV = r.v;
  const turning = r.turnTarget !== null;

  // Linear motion: no driving while a turn is executing.
  const targetV = turning ? 0 : clamp(drive, -1, 1) * ROBOT.maxSpeed;
  const speedingUp = Math.abs(targetV) > Math.abs(r.v) && targetV * r.v >= 0;
  const rate = speedingUp ? ROBOT.accel : ROBOT.brake;
  r.v = approach(r.v, targetV, rate * dt);

  // Rotation: rotate in place once stopped, decelerating into the target heading.
  if (turning && Math.abs(r.v) < 0.01) {
    const err = wrapAngle(r.turnTarget - r.heading);
    const stopping = Math.sqrt(2 * ROBOT.turnAccel * Math.abs(err)); // fastest rate that can still stop on target
    const desired = Math.sign(err) * Math.min(ROBOT.maxTurnRate, stopping);
    r.omega = approach(r.omega, desired, ROBOT.turnAccel * dt);
    if (Math.abs(err) < ROBOT.turnSettle || (Math.abs(r.omega * dt) >= Math.abs(err) && Math.sign(r.omega) === Math.sign(err))) {
      r.heading = r.turnTarget;
      r.omega = 0;
      r.turnTarget = null;
    }
  } else {
    r.omega = approach(r.omega, 0, ROBOT.turnAccel * dt);
  }

  r.heading = wrapAngle(r.heading + r.omega * dt);
  const dx = r.v * Math.cos(r.heading) * dt, dy = r.v * Math.sin(r.heading) * dt;
  r.x += dx; r.y += dy;
  r.blocked = resolveCollisions(world);
  if (r.blocked) r.v = 0;
  const moved = Math.hypot(dx, dy);
  r.odometer += moved;

  // Wheel spin for rendering (left wheel is on the +y side of the robot).
  const half = ROBOT.track / 2;
  r.wheelLeft += ((r.v - r.omega * half) / ROBOT.wheelRadius) * dt;
  r.wheelRight += ((r.v + r.omega * half) / ROBOT.wheelRadius) * dt;

  // Balancing lean: an inverted pendulum leans into acceleration; modelled as a damped spring
  // tracking atan(a/g). This is a visual/telemetry stand-in, not a balance controller.
  r.accel = (r.v - prevV) / dt;
  const leanTarget = Math.atan(r.accel / 9.81) * 1.6;
  const k = 60, c = 2 * 0.55 * Math.sqrt(k);
  r.pitchRate += (-k * (r.pitch - leanTarget) - c * r.pitchRate) * dt;
  r.pitch += r.pitchRate * dt;

  // Docking: body front against the contact face, centred on the pad, facing the station, stopped.
  const g = dockGeometry(world);
  const inContact = Math.abs(g.frontGap) <= STATION.dockDepthTolerance
    && Math.abs(g.lateral) <= STATION.dockLateralTolerance
    && Math.abs(g.headingError) <= STATION.dockHeadingTolerance
    && Math.abs(r.v) < 0.02 && r.turnTarget === null;
  world.contactTime = inContact ? world.contactTime + dt : 0;
  world.docked = inContact;
  world.charging = inContact && world.contactTime >= STATION.chargeDelay && world.battery < BATTERY.full;

  // Battery.
  world.battery += world.charging ? BATTERY.chargePerSec * dt : -(BATTERY.idleDrainPerSec * dt + BATTERY.drainPerMetre * moved);
  world.battery = clamp(world.battery, BATTERY.empty, BATTERY.full);

  if (r.turnTarget === null) world.command = drive > 0 ? 'forward' : drive < 0 ? 'backward' : 'stop';
  world.time += dt;
  return world;
}

/** Telemetry packet in the same shape the ESP32 / mock-esp32.js sends (see useTelemetry.js). */
export function telemetryPacket(world, noise = 0) {
  const tilt = (world.robot.pitch * 180) / Math.PI + noise;
  return { tilt: Number(tilt.toFixed(1)), battery: Number(world.battery.toFixed(2)), charging: world.charging };
}

/** Advance in fixed steps; returns the leftover time to carry into the next frame. */
export function advance(world, drive, elapsed, stepSeconds) {
  let left = elapsed;
  while (left >= stepSeconds) { stepWorld(world, drive, stepSeconds); left -= stepSeconds; }
  return left;
}

export { clamp };
