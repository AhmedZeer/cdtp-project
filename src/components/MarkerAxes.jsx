import { markerFrame } from '../utils/markerFrame';

export default function MarkerAxes({ corners, length }) {
  const frame = markerFrame(corners, length);
  if (!frame) return null;
  const { origin, x, y } = frame;
  return <g aria-label="Marker coordinate frame">
    <line x1={origin.x} y1={origin.y} x2={x.x} y2={x.y} stroke="#dc2626" strokeWidth="4" markerEnd="url(#marker-x-arrow)" />
    <line x1={origin.x} y1={origin.y} x2={y.x} y2={y.y} stroke="#16a34a" strokeWidth="4" markerEnd="url(#marker-y-arrow)" />
    <circle cx={origin.x} cy={origin.y} r="5" fill="white" stroke="#334155" strokeWidth="2" />
    <text x={x.x + 9} y={x.y - 8} fontSize="22" fontWeight="bold" fill="#dc2626" stroke="white" strokeWidth="4" paintOrder="stroke">+X</text>
    <text x={y.x + 9} y={y.y + 20} fontSize="22" fontWeight="bold" fill="#16a34a" stroke="white" strokeWidth="4" paintOrder="stroke">+Y</text>
  </g>;
}
