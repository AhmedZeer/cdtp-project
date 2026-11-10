import { markerFrame, axisLabelPositions } from '../utils/markerFrame';

/**
 * Projected +X/+Y marker axes. `unit` = image pixels per screen pixel, so strokes and text keep
 * the same on-screen size however large the overlay is drawn (1 = draw in image pixels as-is).
 */
export default function MarkerAxes({ corners, length, unit = 1, fontSize = 22, strokeWidth = 4 }) {
  const frame = markerFrame(corners, length);
  if (!frame) return null;
  const { origin, x, y } = frame;
  const font = fontSize * unit;
  const labels = axisLabelPositions(frame, font * 0.85);
  const text = { fontSize: font, fontWeight: 'bold', textAnchor: 'middle', dominantBaseline: 'central', stroke: 'white', strokeWidth: fontSize * 0.16 * unit, paintOrder: 'stroke' };
  return <g aria-label="Marker coordinate frame">
    <line x1={origin.x} y1={origin.y} x2={x.x} y2={x.y} stroke="#dc2626" strokeWidth={strokeWidth * unit} markerEnd="url(#marker-x-arrow)" />
    <line x1={origin.x} y1={origin.y} x2={y.x} y2={y.y} stroke="#16a34a" strokeWidth={strokeWidth * unit} markerEnd="url(#marker-y-arrow)" />
    <circle cx={origin.x} cy={origin.y} r={strokeWidth * 1.25 * unit} fill="white" stroke="#334155" strokeWidth={strokeWidth * 0.5 * unit} />
    <text x={labels.x.x} y={labels.x.y} fill="#dc2626" {...text}>+X</text>
    <text x={labels.y.x} y={labels.y.y} fill="#16a34a" {...text}>+Y</text>
  </g>;
}
