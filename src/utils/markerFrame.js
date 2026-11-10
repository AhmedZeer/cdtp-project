import { centre } from './playgroundGeometry.js';

// Projected local marker axes, from canonical corner ordering. Image +Y is down.
export function markerFrame(corners, length = 70) {
  const origin = centre(corners);
  function endpoint(corner) {
    const dx = corner.x - corners[0].x, dy = corner.y - corners[0].y;
    const norm = Math.hypot(dx, dy);
    return norm ? { x: origin.x + dx / norm * length, y: origin.y + dy / norm * length } : null;
  }
  const x = endpoint(corners[1]), y = endpoint(corners[3]);
  return x && y ? { origin, x, y } : null;
}
