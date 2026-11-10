// Detector observations only; scene positions are never inputs to this estimator.
export function createMotionTracker(deadband = 2) {
  let origin = null, previous = null, anchor = null, path = 0, gaps = 0;
  const trail = [];
  return {
    observe(t, robot, station) {
      let motion = 'Unknown', approach = 'Unknown', speed = null;
      if (!robot) {
        if (previous) gaps++;
        previous = null;
        anchor = null;
        if (trail.length && trail.at(-1) !== null) trail.push(null);
      } else {
        origin ??= robot;
        if (previous && t > previous.t) {
          const step = Math.hypot(robot.x - previous.robot.x, robot.y - previous.robot.y);
          motion = step >= deadband ? 'Moving' : 'Stationary';
          speed = step >= deadband ? step / ((t - previous.t) / 1000) : 0;
          if (station) {
            const delta = Math.hypot(robot.x - station.x, robot.y - station.y)
              - Math.hypot(previous.robot.x - station.x, previous.robot.y - station.y);
            approach = delta < -deadband ? 'Approaching' : delta > deadband ? 'Leaving' : 'Unchanged';
          }
        }
        if (anchor) {
          const step = Math.hypot(robot.x - anchor.x, robot.y - anchor.y);
          if (step >= deadband) { path += step; anchor = robot; }
        } else anchor = robot;
        previous = { t, robot };
        trail.push({ ...robot });
      }
      return { t, path, displacement: robot && origin ? Math.hypot(robot.x - origin.x, robot.y - origin.y) : null,
        motion, approach, speed, gaps, trail: [...trail] };
    },
  };
}

// One frame at a time: replay must not skip observations when rendering runs late.
export function nextReplayFrame(frames, cursor, elapsed) {
  return cursor < frames.length && frames[cursor].t <= elapsed ? frames[cursor] : null;
}
