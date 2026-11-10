// Owns the world and the operator's input outside React. Keyboard, touch buttons and
// (later) a real glove adapter all go through `command`.
import { createWorld, requestTurn } from './world.js';

const idle = () => ({ held: { forward: false, backward: false }, latched: 0 });

export function createSimController() {
  let input = idle();
  const controller = {
    world: createWorld(),
    mode: 'hold', // hold = drive while pressed; latched = glove-style, drive until Stop
    setMode(mode) { controller.mode = mode; input = idle(); },
    reset() { controller.world = createWorld(); input = idle(); },
    releaseAll() { input.held = { forward: false, backward: false }; },
    /** name: forward | backward | left | right | stop; pressed: key/pointer down (true) or up (false). */
    command(name, pressed) {
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
