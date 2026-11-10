// Owns the world and the operator's input outside React. Keyboard, touch buttons and
// (later) a real glove adapter all go through `command`. Also runs the robot's onboard
// autonomous docking: when the robot enters the station's IR field (= the §4.3 approach
// region) it takes over, and operator commands are ignored until it has docked.
import { createWorld, requestTurn, stepWorld, toStationFrame } from './world.js';
import { readIr, IR } from './irSensors.js';
import { createAutoDock } from './autoDock.js';
import { STATION, ROBOT } from './simConfig.js';

const idle = () => ({ held: { forward: false, backward: false }, latched: 0 });

export function createSimController({ rng = Math.random } = {}) {
  let input = idle();
  let dock = createAutoDock();
  let control = null; // held onboard command between IR updates
  let nextIr = 0, fHistory = [], inField = false;
  const listeners = new Set();

  const controller = {
    world: createWorld(),
    mode: 'hold', // hold = drive while pressed; latched = glove-style, drive until Stop
    autoDock: true,
    ir: null, // latest IR reading (for display)
    get dock() { return dock; },
    /** Called with (name, { ignored }) on every command press: the operator-command log for evaluation. */
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** Operator input is moving the robot right now: a held/latched drive or a turn it requested. */
    operatorActive() { return !dock.engaged && (controller.drive() !== 0 || controller.world.robot.turnTarget !== null); },
    setMode(mode) { controller.mode = mode; input = idle(); },
    setAutoDock(on) { controller.autoDock = on; if (!on && dock.engaged) { dock.release(); control = null; } },
    reset(poses) { controller.world = createWorld(poses); input = idle(); dock = createAutoDock(); control = null; nextIr = 0; fHistory = []; inField = false; },
    releaseAll() { input.held = { forward: false, backward: false }; },
    /** name: forward | backward | left | right | stop; pressed: key/pointer down (true) or up (false). */
    command(name, pressed) {
      const ignored = dock.engaged; // the robot is docking itself: the glove has no effect
      if (pressed) listeners.forEach((fn) => fn(name, { ignored }));
      if (ignored) return;
      if (dock.state === 'docked' && pressed && name !== 'stop') { dock.release(); control = null; } // operator drives off the dock
      if (name === 'left' || name === 'right') { if (pressed) requestTurn(controller.world, name); return; }
      if (name === 'stop') { if (pressed) input = idle(); return; }
      if (controller.mode === 'latched') { if (pressed) input.latched = name === 'forward' ? 1 : -1; }
      else input.held[name] = pressed;
    },
    drive() {
      if (dock.engaged) return 0;
      if (controller.mode === 'latched') {
        if (controller.world.robot.blocked) input.latched = 0;
        return input.latched;
      }
      return (input.held.forward ? 1 : 0) - (input.held.backward ? 1 : 0);
    },

    /** One physics step, including the 20 Hz IR read and docking-controller update. */
    step(dt) {
      const world = controller.world;
      if (world.time >= nextIr) {
        nextIr = world.time + 1 / IR.rateHz;
        const ir = readIr(world, rng);
        controller.ir = ir;
        // Debounced field presence (readings drop out now and then); engage on entering it.
        fHistory = [...fHistory.slice(-4), ir.omni.F];
        const nowInField = fHistory.some(Boolean);
        if (nowInField && !inField && controller.autoDock && dock.state === 'idle') {
          dock.engage(world.time);
          input = idle();
          world.robot.turnTarget = null;
        }
        inField = nowInField;
        control = dock.update(world.time, ir, {
          heading: world.robot.heading, odometer: world.robot.odometer, bumper: world.robot.blocked, contactVoltage: world.docked,
        });
      }
      stepWorld(world, controller.drive(), dt, dock.state === 'idle' || dock.state === 'failed' ? null : control);
    },
    /** Advance in fixed steps; returns the leftover time to carry into the next frame. */
    advance(elapsed, stepSeconds) {
      let left = elapsed;
      while (left >= stepSeconds) { controller.step(stepSeconds); left -= stepSeconds; }
      return left;
    },

    // --- Hands-on actions for the charging tests (a person moving the robot) -----------------
    /** C3.4: pull the robot straight back off the dock by about 15 cm. */
    pullAway(distance = 0.15) {
      const r = controller.world.robot;
      r.x -= distance * Math.cos(r.heading); r.y -= distance * Math.sin(r.heading);
      Object.assign(r, { v: 0, omega: 0, turnTarget: null });
      input = idle();
    },
    /** C3.4: put the robot back on the dock by hand (front against the contacts, centred, square). */
    putBack() {
      const s = controller.world.station, r = controller.world.robot;
      const d = STATION.depth / 2 + ROBOT.body.depth / 2;
      Object.assign(r, { x: s.x + d * Math.cos(s.heading), y: s.y + d * Math.sin(s.heading), heading: s.heading + Math.PI, v: 0, omega: 0, turnTarget: null });
      input = idle();
    },
    /** C3.1: place the robot by hand at a random pose inside the approach region, facing anywhere. */
    placeInApproachRegion() {
      const s = controller.world.station, r = controller.world.robot;
      const face = STATION.depth / 2;
      let u, w;
      // Uniform over the whole region (as seen from the station centre: radius ≤ 30 cm + face, ±45°),
      // keeping the robot's centre at least its half-diagonal (16.3 cm) in front of the face.
      const clearance = Math.hypot(ROBOT.body.depth / 2, ROBOT.track / 2 + ROBOT.wheelWidth / 2) + 0.002;
      do {
        const rad = Math.sqrt(rng()) * (0.3 + face), ang = (rng() * 2 - 1) * (44 * Math.PI) / 180;
        u = rad * Math.cos(ang); w = rad * Math.sin(ang);
      } while (u - face < clearance);
      const c = Math.cos(s.heading), sn = Math.sin(s.heading);
      Object.assign(r, { x: s.x + u * c - w * sn, y: s.y + u * sn + w * c, heading: rng() * 2 * Math.PI - Math.PI, v: 0, omega: 0, turnTarget: null, pitch: 0, pitchRate: 0 });
      input = idle();
      dock = createAutoDock(); control = null; fHistory = []; inField = false; // fresh placement: engage on the next reading
    },
    /** Robot centre in station coordinates (for display/debug only; the controller never uses it). */
    stationPose() { const r = controller.world.robot; return toStationFrame(controller.world.station, r.x, r.y); },
  };
  return controller;
}
