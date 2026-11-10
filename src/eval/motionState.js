// Live motion state from camera observations plus telemetry tilt (§5.2: "moving, turning,
// static balance, recovery/rebalancing" and the direction forward/backward/left/right).
// Robot poses are in the station frame (metres, heading in radians, counter-clockwise).
import { ENGINEERING } from './spec.js';

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export const MOTION_LABELS = {
  'not-tracked': 'Not tracked', fallen: 'Fallen', recovering: 'Recovering balance',
  turning: 'Turning', moving: 'Moving', balancing: 'Static balance',
};

/**
 * observe(t, robot | null, tiltDeg | null) → { state, direction, speed, yawRate }.
 * Velocity and yaw rate are averaged over `window` seconds so ~1 cm / 0.4° measurement noise
 * does not flicker the state.
 */
export function createMotionEstimator({ window = 0.6, limits = ENGINEERING } = {}) {
  let history = [];
  const turnRate = (limits.turnRateDeg * Math.PI) / 180;
  return {
    reset() { history = []; },
    observe(t, robot, tiltDeg) {
      if (robot) history.push({ t, ...robot });
      history = history.filter((h) => t - h.t <= window);
      const fallen = tiltDeg !== null && Math.abs(tiltDeg) >= limits.fallenTiltDeg;
      if (!robot && !history.length) return { state: fallen ? 'fallen' : 'not-tracked', direction: null, speed: null, yawRate: null };

      let speed = 0, along = 0, yawRate = 0;
      if (history.length >= 2) {
        const a = history[0], b = history.at(-1), dt = b.t - a.t;
        if (dt > 0.15) {
          const du = b.u - a.u, dw = b.w - a.w;
          speed = Math.hypot(du, dw) / dt;
          along = (du * Math.cos(b.heading) + dw * Math.sin(b.heading)) / dt;
          yawRate = wrap(b.heading - a.heading) / dt;
        }
      }
      let state, direction = null;
      if (fallen) state = 'fallen';
      else if (Math.abs(yawRate) >= turnRate) { state = 'turning'; direction = yawRate > 0 ? 'left' : 'right'; }
      else if (speed >= limits.moveSpeed) { state = 'moving'; direction = along >= 0 ? 'forward' : 'backward'; }
      else if (tiltDeg !== null && Math.abs(tiltDeg) >= limits.recoveringTiltDeg) state = 'recovering';
      else state = 'balancing';
      return { state, direction, speed, yawRate };
    },
  };
}
