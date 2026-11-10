import { useState } from 'react';
import { createMarkerDetector } from '../utils/markerDetector';

// A single-frame detection experiment, independent of camera/telemetry/test scoring.
export default function PlaceholderVision() {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [robotId, setRobotId] = useState('');
  const [stationId, setStationId] = useState('');
  const [family, setFamily] = useState('6x6_250');
  const url = `/placeholder/2d_basic_v1.png?v=${revision}&family=${family}`;
  const ids = [...new Set(result?.markers.map((marker) => String(marker.id)) ?? [])];

  function detect(event) {
    try {
      const image = event.currentTarget;
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      const markers = createMarkerDetector(family).detect(ctx.getImageData(0, 0, canvas.width, canvas.height));
      setResult({ width: canvas.width, height: canvas.height, markers });
      setError('');
    } catch (err) {
      setResult(null);
      setError(`Detection failed: ${err.message}`);
    }
  }

  const roleName = (id) => String(id) === robotId ? 'Robot' : String(id) === stationId ? 'Station' : 'Unassigned';
  const colour = (id) => String(id) === robotId ? '#34d399' : String(id) === stationId ? '#38bdf8' : '#fbbf24';

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto max-w-5xl space-y-5">
        <h1 className="text-2xl font-bold">Placeholder marker detection</h1>
        <a className="text-sky-300 underline" href="?scene=playground">Open draggable 2D playground</a>
        <p>Assign the detected markers to the robot and charging station. Coordinates are image pixels.</p>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2">Marker family
            <select className="rounded border border-slate-600 bg-slate-900 p-2" value={family} onChange={(e) => { setResult(null); setRobotId(''); setStationId(''); setFamily(e.target.value); }}>
              <option value="6x6_250">OpenCV 6×6, IDs 0–249</option>
              <option value="legacy">Legacy js-aruco</option>
            </select>
          </label>
          {[
            { label: 'Robot', value: robotId, other: stationId, change: setRobotId },
            { label: 'Station', value: stationId, other: robotId, change: setStationId },
          ].map(({ label, value, other, change }) => (
            <label key={label} className="flex items-center gap-2">
              {label}
              <select className="rounded border border-slate-600 bg-slate-900 p-2" value={value} onChange={(e) => change(e.target.value)}>
                <option value="">Select marker</option>
                {ids.map((id) => <option key={id} value={id} disabled={id === other}>ID {id}</option>)}
                {value && !ids.includes(value) && <option value={value}>ID {value} (not detected)</option>}
              </select>
            </label>
          ))}
          <button className="rounded bg-slate-700 px-4 py-2" onClick={() => { setResult(null); setError(''); setRevision((v) => v + 1); }}>Reload scene</button>
        </div>
        {error && <p role="alert" className="text-red-300">{error}</p>}
        <div className="relative bg-black">
          <img key={url} src={url} alt="Placeholder scene with robot and station markers" className="block h-auto w-full" onLoad={detect} onError={() => { setResult(null); setError('Scene unavailable. Place the PNG at cdtp-project/static/placeholder/2d_basic_v1.png, then reload.'); }} />
          {result && <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${result.width} ${result.height}`} aria-label="Detected marker outlines">
            {result.markers.map((marker, index) => {
              const x = marker.corners.reduce((sum, p) => sum + p.x, 0) / 4;
              const y = marker.corners.reduce((sum, p) => sum + p.y, 0) / 4;
              return <g key={`${marker.id}-${index}`} stroke={colour(marker.id)}>
                <polygon points={marker.corners.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" strokeWidth="3" />
                <circle cx={x} cy={y} r="4" fill={colour(marker.id)} />
                <text x={Math.max(2, Math.min(...marker.corners.map((p) => p.x)))} y={Math.max(20, Math.min(...marker.corners.map((p) => p.y)) - 8)} fontSize="20" stroke="black" strokeWidth="4" paintOrder="stroke" fill={colour(marker.id)}>{roleName(marker.id)} · ID {marker.id}</text>
              </g>;
            })}
          </svg>}
        </div>
        {result && <>
          <p>{result.width} × {result.height} px · {result.markers.length} markers detected</p>
          {result.markers.length === 0 && <p className="text-amber-300">No markers detected. Check the selected marker family, contrast, resolution and a clear margin around each marker. The 6×6 baseline requires exact dictionary matches.</p>}
          {ids.length < result.markers.length && <p className="text-amber-300">Duplicate marker IDs detected. Use distinct IDs for each object.</p>}
          <ul className="space-y-1">
            {result.markers.map((marker, index) => <li key={`${marker.id}-${index}`}>
              {roleName(marker.id)} · ID {marker.id} · centre ({(marker.corners.reduce((s, p) => s + p.x, 0) / 4).toFixed(1)}, {(marker.corners.reduce((s, p) => s + p.y, 0) / 4).toFixed(1)}) px
            </li>)}
          </ul>
          <p>Robot: {robotId && ids.includes(robotId) ? 'detected' : 'not assigned or unavailable'} · Station: {stationId && ids.includes(stationId) ? 'detected' : 'not assigned or unavailable'}</p>
        </>}
        <p className="text-sm text-slate-400">Single-image detection only. Motion, physical distances and test scores are not inferred from this scene.</p>
      </div>
    </main>
  );
}
