export const PLANE_SIZE = 1080;

export function centre(corners) {
  return { x: corners.reduce((s, p) => s + p.x, 0) / corners.length,
    y: corners.reduce((s, p) => s + p.y, 0) / corners.length };
}

export function pairGeometry(robot, station) {
  const dx = station.x - robot.x;
  const dy = station.y - robot.y;
  return { dx, dy, distance: Math.hypot(dx, dy) };
}

export function moveOnPlane(item, pointer, offset) {
  const half = item.size / 2;
  const clamp = (v) => Math.max(half, Math.min(PLANE_SIZE - half, v));
  return { ...item, x: clamp(pointer.x - offset.x), y: clamp(pointer.y - offset.y) };
}
