import MarkerAxes from './MarkerAxes';
import { ROLE_COLOURS, ROLE_LABELS } from '../utils/markerRoles';

// On-screen sizes (CSS px) of the overlay; multiplied by `unit` to get image pixels.
const OVERLAY = { axis: 11, minAxis: 18, maxAxis: 60 };

/** Outlines (coloured by role) and +X/+Y frames for the detected markers, in image pixels. */
export default function DetectionOverlay({ markers, unit, width, height }) {
  const items = markers.map((m, i) => {
    const c = m.corners;
    const side = c.reduce((sum, p, k) => sum + Math.hypot(c[(k + 1) % 4].x - p.x, c[(k + 1) % 4].y - p.y), 0) / 4;
    // Axes scale with the marker so neighbouring markers' frames do not run into each other.
    return { m, key: `${m.id}-${i}`, axisLength: Math.max(OVERLAY.minAxis * unit, Math.min(OVERLAY.maxAxis * unit, side * 0.8)) };
  });

  return (
    <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <defs>
        <marker id="marker-x-arrow" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4 z" fill="#dc2626" /></marker>
        <marker id="marker-y-arrow" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4 z" fill="#16a34a" /></marker>
      </defs>
      {items.map(({ m, key, axisLength }) => (
        <g key={key}>
          <polygon points={m.corners.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={ROLE_COLOURS[m.role] ?? '#facc15'} strokeWidth={2 * unit} strokeLinejoin="round" />
          <text x={m.centre.x} y={Math.min(...m.corners.map((p) => p.y)) - 8 * unit} textAnchor="middle" fill={ROLE_COLOURS[m.role] ?? '#facc15'} fontSize={12 * unit} stroke="#020617" strokeWidth={3 * unit} paintOrder="stroke">{m.role ? ROLE_LABELS[m.role] : 'Marker'} #{m.id}</text>
          <MarkerAxes corners={m.corners} length={axisLength} unit={unit} fontSize={OVERLAY.axis} strokeWidth={2.5} />
        </g>
      ))}
    </svg>
  );
}
