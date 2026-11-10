import { PLANE_SIZE } from './playgroundGeometry.js';

// Visual destination guide; it cannot establish balance, box retention or charging.
export function taskGoal(task, robot, station, heading = { x: 1, y: 0 }) {
  if (!robot) return null;
  if (task.id === 'static-balance') return { point: robot, centre: robot, inner: 0, outer: 10, label: 'Balance here' };
  if (!Number.isFinite(task.pixelsPerMetre) || task.pixelsPerMetre <= 0) return null;
  if (task.id === 'charging') {
    if (!station) return null;
    const radius = task.approachM * task.pixelsPerMetre;
    const angles = [Math.atan2(robot.y - station.y, robot.x - station.x), 0, Math.PI / 2, Math.PI, -Math.PI / 2];
    const starRadius = Math.max(0, radius - 10);
    const points = angles.map((a) => ({ x: station.x + Math.cos(a) * starRadius, y: station.y + Math.sin(a) * starRadius }));
    const point = points.find((p) => p.x >= 100 && p.x <= PLANE_SIZE - 100 && p.y >= 100 && p.y <= PLANE_SIZE - 100 && Math.max(Math.abs(p.x - station.x), Math.abs(p.y - station.y)) >= 165);
    return point ? { point, centre: station, inner: 0, outer: radius, label: task.simulation ? 'Station proximity target' : 'Approach only; docking still required' } : null;
  }
  if (!heading) return null;
  const norm = Math.hypot(heading.x, heading.y);
  if (!norm) return null;
  const sign = task.direction === 'backward' ? -1 : 1;
  const point = { x: robot.x + sign * heading.x / norm * task.targetM * task.pixelsPerMetre,
    y: robot.y + sign * heading.y / norm * task.targetM * task.pixelsPerMetre };
  return { point, centre: robot, inner: task.minM * task.pixelsPerMetre, outer: task.maxM * task.pixelsPerMetre,
    label: task.id === 'integrated' ? `Deliver here; wait 5 s; then ${task.simulation ? 'station' : 'dock'}` : '1 m destination' };
}
