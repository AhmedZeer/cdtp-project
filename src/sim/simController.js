// Owns the world and the operator's input outside React. Keyboard, touch buttons and
// (later) a real glove adapter all go through `command`.
import { createWorld, requestTurn } from './world.js';

const idle = () => ({ held: { forward: false, backward: false }, latched: 0 });

export function createSimController() {
  let input = idle();
  const listeners = new Set();
  const controller = {
    /** Called with (name) on every command press: the operator-command log for evaluation. */
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** Operator input is moving the robot right now: a held/latched drive or a turn it requested. */
    operatorActive() { return controller.drive() !== 0 || controller.world.robot.turnTarget !== null; },
    world: createWorld(),
    mode: 'hold', // hold = drive while pressed; latched = glove-style, drive until Stop
    setMode(mode) { controller.mode = mode; input = idle(); },
    reset() { controller.world = createWorld(); input = idle(); },
    releaseAll() { input.held = { forward: false, backward: false }; },
    /** name: forward | backward | left | right | stop; pressed: key/pointer down (true) or up (false). */
    command(name, pressed) {
      if (pressed) listeners.forEach((fn) => fn(name));
      if (name === 'left' || name === 'right') { if (pressed) requestTurn(controller.world, name); return; }
      if (name === 'stop') { if (pressed) input = idle(); return; }
      if (controller.mode === 'latched') { if (pressed) input.latched = name === 'forward' ? 1 : -1; }
      else input.held[name] = pressed;
    },
    drive() {
      if (controller.mode === 'latched') {
        if (controller.world.robot.blocked) input.latched = 0;
        return input.latched;
      }
      return (input.held.forward ? 1 : 0) - (input.held.backward ? 1 : 0);
    },
  };
  return controller;
}
