import { useEffect, useRef, useState } from 'react';
import { createSimScene, CAMERA_PRESETS, RENDER_WIDTH, RENDER_HEIGHT } from '../sim/scene3d';
import { advance, telemetryPacket, dockGeometry } from '../sim/world';
import { createSimController } from '../sim/simController';
import { ARENA, ROBOT, STATION, MARKERS, MARKER_FAMILY, PHYSICS_HZ, TELEMETRY_HZ, DETECTION_HZ } from '../sim/simConfig';
import { centre } from '../utils/playgroundGeometry';
import { markerFrame } from '../utils/markerFrame';
import MarkerAxes from './MarkerAxes';

const ROLE_BY_ID = Object.fromEntries(Object.entries(MARKERS).map(([role, m]) => [m.id, role]));
const ROLE_COLOURS = { robot: '#10b981', medicine: '#f43f5e', station: '#38bdf8' };
const ROLE_LABELS = { robot: 'Robot', medicine: 'Medicine box', station: 'Station' };
const deg = (rad) => (rad * 180) / Math.PI;
const fmt = (v, digits = 2) => (v === null || v === undefined || Number.isNaN(v) ? '—' : v.toFixed(digits));

const KEYMAP = {
  ArrowUp: 'forward', KeyW: 'forward', ArrowDown: 'backward', KeyS: 'backward',
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Space: 'stop', KeyX: 'stop',
};

function snapshot(controller) {
  const world = controller.world, r = world.robot;
  return {
    x: r.x, y: r.y, heading: deg(r.heading), v: r.v, tilt: deg(r.pitch), odometer: r.odometer,
    turning: r.turnTarget !== null, blocked: r.blocked, command: world.command,
    docked: world.docked, charging: world.charging, battery: world.battery, dock: dockGeometry(world),
    station: { ...world.station }, drive: controller.drive(), simTime: world.time, simSpeed: 1,
  };
}

/** Image-plane measurement from one detected marker (pixels, image +y down). */
function measure(marker) {
  const c = centre(marker.corners);
  const frame = markerFrame(marker.corners);
  const heading = frame ? deg(Math.atan2(-(frame.x.y - frame.origin.y), frame.x.x - frame.origin.x)) : null;
  return { id: marker.id, role: ROLE_BY_ID[marker.id], corners: marker.corners, centre: c, heading };
}

export default function Simulator3D() {
  const canvasRef = useRef(null);
  const [controller] = useState(createSimController);
  useEffect(() => { if (import.meta.env.DEV) window.__sim = controller; }, [controller]); // dev-only hook for scripted checks
  const sceneRef = useRef(null);
  const [mode, setModeState] = useState(controller.mode);
  const setMode = (next) => { controller.setMode(next); setModeState(next); };
  const [preset, setPreset] = useState('tripod');
  const [truth, setTruth] = useState(() => snapshot(controller));
  const [vision, setVision] = useState({ markers: [], ms: 0, at: 0 });
  const [telemetry, setTelemetry] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { sceneRef.current?.setCameraPreset(preset); }, [preset]);

  useEffect(() => {
    const isFormField = (el) => ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(el?.tagName);
    const down = (e) => {
      const name = KEYMAP[e.code];
      if (!name || isFormField(e.target)) return;
      e.preventDefault();
      if (!e.repeat) controller.command(name, true);
    };
    const up = (e) => { const name = KEYMAP[e.code]; if (name) controller.command(name, false); };
    const blur = () => controller.releaseAll();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, [controller]);

  useEffect(() => {
    let sim;
    try { sim = createSimScene(canvasRef.current); } catch (err) {
      queueMicrotask(() => setError(`WebGL unavailable: ${err.message}`));
      return undefined;
    }
    sceneRef.current = sim;
    sim.setCameraPreset(preset);
    const worker = new Worker(new URL('../sim/detector.worker.js', import.meta.url), { type: 'module' });
    let inFlight = false, seq = 0;
    worker.onmessage = ({ data }) => {
      inFlight = false;
      setVision({ markers: data.markers.map(measure), ms: data.ms, at: data.simTime });
    };
    worker.onerror = (e) => { inFlight = false; setError(`Detector failed: ${e.message}`); };
    const grab = document.createElement('canvas');
    grab.width = RENDER_WIDTH; grab.height = RENDER_HEIGHT;
    const grabCtx = grab.getContext('2d', { willReadFrequently: true });
    const stepSeconds = 1 / PHYSICS_HZ;
    let frame, last = performance.now(), carry = 0, lastDetect = -Infinity, lastHud = -Infinity, nextTelemetry = 0;
    let rate = { wall: performance.now(), sim: controller.world.time, value: 1 }; // simulated seconds per real second

    function loop(now) {
      const world = controller.world;
      const drive = controller.drive();
      const elapsed = Math.min(0.25, (now - last) / 1000); // clamp after tab switches / long stalls
      last = now;
      carry = advance(world, drive, elapsed + carry, stepSeconds);
      sim.sync(world);
      sim.render();

      // The detector sees only rendered pixels; overlays are drawn in SVG on top.
      // Detection runs in a worker; at most one frame is in flight, so a slow device detects less often.
      if (!inFlight && now - lastDetect >= 1000 / DETECTION_HZ) {
        lastDetect = now;
        inFlight = true;
        grabCtx.drawImage(sim.renderer.domElement, 0, 0);
        const image = grabCtx.getImageData(0, 0, RENDER_WIDTH, RENDER_HEIGHT);
        worker.postMessage({ image, family: MARKER_FAMILY, minPerimeterFraction: 0.03, simTime: world.time, seq: ++seq }, [image.data.buffer]);
      }
      if (world.time >= nextTelemetry || nextTelemetry - world.time > 1 / TELEMETRY_HZ) { // 1 Hz on the simulation clock (re-arms after reset)
        nextTelemetry = world.time + 1 / TELEMETRY_HZ;
        setTelemetry({ ...telemetryPacket(world, (Math.random() - 0.5) * 0.2), simTime: world.time });
      }
      if (now - rate.wall >= 1000) {
        rate = { wall: now, sim: world.time, value: Math.max(0, (world.time - rate.sim) / ((now - rate.wall) / 1000)) };
      }
      if (now - lastHud >= 100) { lastHud = now; setTruth({ ...snapshot(controller), simSpeed: rate.value }); }
      frame = requestAnimationFrame(loop);
    }
    frame = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(frame); worker.terminate(); sim.dispose(); sceneRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scene is created once; preset changes are applied separately
  }, []);

  const byRole = Object.fromEntries(vision.markers.filter((m) => m.role).map((m) => [m.role, m]));
  const driveLabel = truth.drive > 0 ? 'forward' : truth.drive < 0 ? 'backward' : 'stopped';

  return (
    <main className="min-h-dvh bg-slate-950 p-3 text-slate-100 md:p-5">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold">3D robot simulator</h1>
          <p className="text-xs text-slate-400">A virtual phone camera watches the arena; ArUco detection runs on the rendered pixels only.</p>
        </div>
        <nav className="flex gap-3 text-xs text-cyan-400">
          <a href="/">Live camera app</a><a href="/?scene=playground">2D playground</a>
        </nav>
      </header>

      <div className="flex flex-col gap-4 xl:flex-row">
        <section className="min-w-0 flex-1">
          <div className="relative w-full overflow-hidden rounded-lg border border-slate-800 bg-black" style={{ aspectRatio: `${RENDER_WIDTH} / ${RENDER_HEIGHT}` }}>
            <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-label="Simulated phone camera view" />
            <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${RENDER_WIDTH} ${RENDER_HEIGHT}`} aria-hidden="true">
              <defs>
                <marker id="marker-x-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#dc2626" /></marker>
                <marker id="marker-y-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#16a34a" /></marker>
              </defs>
              {vision.markers.map((m, i) => (
                <g key={`${m.id}-${i}`}>
                  <polygon points={m.corners.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={ROLE_COLOURS[m.role] ?? '#facc15'} strokeWidth="3" />
                  <MarkerAxes corners={m.corners} length={40} />
                  <text x={m.centre.x + 12} y={m.centre.y - 14} fontSize="18" fontWeight="bold" fill={ROLE_COLOURS[m.role] ?? '#facc15'} stroke="#020617" strokeWidth="4" paintOrder="stroke">
                    {ROLE_LABELS[m.role] ?? 'Unknown'} #{m.id}
                  </text>
                </g>
              ))}
            </svg>
            {error && <p className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-red-300">{error}</p>}
          </div>

          <Controls mode={mode} command={controller.command} driveLabel={driveLabel} />
        </section>

        <aside className="flex w-full flex-col gap-3 text-xs xl:w-96">
          <Panel title="Setup">
            <label className="mb-2 block">Phone camera
              <select className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" value={preset}
                onChange={(e) => { setPreset(e.target.value); e.target.blur(); }}>
                {Object.entries(CAMERA_PRESETS).map(([key, p]) => <option key={key} value={key}>{p.label}</option>)}
              </select>
            </label>
            <fieldset className="mb-2">
              <legend className="mb-1">Command mode</legend>
              <label className="mr-4"><input type="radio" checked={mode === 'hold'} onChange={() => setMode('hold')} /> Hold to drive</label>
              <label><input type="radio" checked={mode === 'latched'} onChange={() => setMode('latched')} /> Glove-style (latched until Stop)</label>
            </fieldset>
            <button className="rounded bg-slate-700 px-3 py-2 font-semibold hover:bg-slate-600" onClick={(e) => { controller.reset(); e.currentTarget.blur(); }}>Reset robot</button>
          </Panel>

          <Panel title={`Camera detections (${fmt(vision.ms, 0)} ms)`}>
            <table className="w-full">
              <thead className="text-slate-400"><tr><th className="text-left">Marker</th><th>ID</th><th>Centre px</th><th>Image heading</th></tr></thead>
              <tbody>
                {Object.keys(MARKERS).map((role) => {
                  const m = byRole[role];
                  return <tr key={role}>
                    <td style={{ color: ROLE_COLOURS[role] }}>{ROLE_LABELS[role]}</td>
                    <td className="text-center">{MARKERS[role].id}</td>
                    <td className="text-center">{m ? `${fmt(m.centre.x, 0)}, ${fmt(m.centre.y, 0)}` : <span className="text-amber-400">not detected</span>}</td>
                    <td className="text-center">{m ? `${fmt(m.heading, 0)}°` : '—'}</td>
                  </tr>;
                })}
              </tbody>
            </table>
            <p className="mt-2 text-slate-500">DICT_5X5_100 · image pixels only, no metric calibration yet.</p>
          </Panel>

          <Panel title="Robot telemetry (1 Hz, ESP32 packet format)">
            {telemetry ? <dl className="grid grid-cols-3 gap-2">
              <Stat label="Tilt" value={`${fmt(telemetry.tilt, 1)}°`} />
              <Stat label="Battery" value={`${fmt(telemetry.battery, 2)} V`} />
              <Stat label="Charging" value={telemetry.charging ? 'YES' : 'no'} tone={telemetry.charging ? 'text-emerald-400' : ''} />
            </dl> : <p className="text-slate-500">Waiting for first packet…</p>}
          </Panel>

          <Panel title="Ground truth (simulator only — not visible to the app)">
            <dl className="grid grid-cols-3 gap-2">
              <Stat label="x, y" value={`${fmt(truth.x)}, ${fmt(truth.y)} m`} />
              <Stat label="Heading" value={`${fmt(truth.heading, 1)}°`} />
              <Stat label="Speed" value={`${fmt(truth.v)} m/s`} />
              <Stat label="Command" value={truth.turning ? `turning ${truth.command}` : truth.command} />
              <Stat label="Odometer" value={`${fmt(truth.odometer)} m`} />
              <Stat label="Dock gap" value={`${fmt(truth.dock.frontGap * 100, 1)} cm`} />
              <Stat label="Docked" value={truth.docked ? 'yes' : 'no'} tone={truth.docked ? 'text-emerald-400' : ''} />
              <Stat label="Blocked" value={truth.blocked ? 'yes' : 'no'} tone={truth.blocked ? 'text-amber-400' : ''} />
              <Stat label="Lateral / angle" value={`${fmt(truth.dock.lateral * 100, 0)} cm / ${fmt(deg(truth.dock.headingError), 0)}°`} />
              <Stat label="Sim time" value={`${fmt(truth.simTime, 1)} s`} />
              <Stat label="Sim speed" value={`${fmt(truth.simSpeed, 2)}×`} tone={truth.simSpeed < 0.9 ? 'text-amber-400' : ''} />
            </dl>
            <MiniMap truth={truth} />
          </Panel>
        </aside>
      </div>
    </main>
  );
}

function Panel({ title, children }) {
  return <section className="rounded-lg border border-slate-800 bg-slate-900 p-3"><h2 className="mb-2 font-bold uppercase tracking-wide text-slate-300">{title}</h2>{children}</section>;
}

function Stat({ label, value, tone = '' }) {
  return <div><dt className="text-slate-500">{label}</dt><dd className={`font-mono text-slate-100 ${tone}`}>{value}</dd></div>;
}

function Controls({ mode, command, driveLabel }) {
  const hold = (name) => ({
    onPointerDown: (e) => { e.currentTarget.setPointerCapture(e.pointerId); command(name, true); },
    onPointerUp: () => command(name, false),
    onPointerCancel: () => command(name, false),
  });
  const tap = (name) => ({ onPointerDown: () => command(name, true) });
  const btn = 'min-h-11 rounded-lg bg-slate-800 px-3 font-semibold hover:bg-slate-700 active:bg-cyan-700 touch-none select-none';
  return (
    <div className="mt-3 flex flex-wrap items-center gap-4 text-xs">
      <div className="grid grid-cols-3 gap-1" style={{ width: 210 }}>
        <span /><button className={btn} {...hold('forward')}>▲ Fwd</button><span />
        <button className={btn} {...tap('left')}>⟲ 90°</button>
        <button className={`${btn} bg-red-900 hover:bg-red-800`} {...tap('stop')}>■ Stop</button>
        <button className={btn} {...tap('right')}>90° ⟳</button>
        <span /><button className={btn} {...hold('backward')}>▼ Back</button><span />
      </div>
      <div className="text-slate-400">
        <p><kbd>W</kbd>/<kbd>↑</kbd> forward · <kbd>S</kbd>/<kbd>↓</kbd> backward · <kbd>A</kbd>/<kbd>←</kbd> turn left 90° · <kbd>D</kbd>/<kbd>→</kbd> turn right 90° · <kbd>Space</kbd> stop</p>
        <p>{mode === 'hold' ? 'Hold a drive key to move; release to brake.' : `Glove-style: a drive command latches until Stop. Current: ${driveLabel}.`} Turns run in place and finish before driving resumes.</p>
      </div>
    </div>
  );
}

/** Top-down debug map of the true world state (metres). */
function MiniMap({ truth }) {
  const scale = 70, w = ARENA.width * scale, h = ARENA.depth * scale;
  const px = (x) => (x + ARENA.width / 2) * scale, py = (y) => (ARENA.depth / 2 - y) * scale;
  const s = truth.station, sh = (s.heading * 180) / Math.PI;
  const rh = truth.heading;
  return (
    <svg className="mt-3 w-full rounded bg-slate-200" viewBox={`0 0 ${w} ${h}`} aria-label="Top-down map">
      <g transform={`translate(${px(s.x)} ${py(s.y)}) rotate(${-sh})`}>
        <path d={`M0 0 L${(0.3 + STATION.depth / 2) * scale * Math.cos(Math.PI / 4)} ${-(0.3 + STATION.depth / 2) * scale * Math.sin(Math.PI / 4)} A${(0.3 + STATION.depth / 2) * scale} ${(0.3 + STATION.depth / 2) * scale} 0 0 1 ${(0.3 + STATION.depth / 2) * scale * Math.cos(Math.PI / 4)} ${(0.3 + STATION.depth / 2) * scale * Math.sin(Math.PI / 4)} Z`} fill="#38bdf8" opacity="0.25" />
        <rect x={STATION.depth / 2 * scale} y={-STATION.pad.width / 2 * scale} width={STATION.pad.length * scale} height={STATION.pad.width * scale} fill="#475569" />
        <rect x={-STATION.depth / 2 * scale} y={-STATION.width / 2 * scale} width={STATION.depth * scale} height={STATION.width * scale} fill={truth.charging ? '#22c55e' : '#0284c7'} />
      </g>
      <g transform={`translate(${px(truth.x)} ${py(truth.y)}) rotate(${-rh})`}>
        <rect x={-ROBOT.body.depth / 2 * scale} y={-(ROBOT.track / 2 + ROBOT.wheelWidth / 2) * scale} width={ROBOT.body.depth * scale} height={(ROBOT.track + ROBOT.wheelWidth) * scale} fill="#10b981" />
        <rect x={(ROBOT.body.depth / 2 + ROBOT.medicine.gap) * scale} y={-ROBOT.medicine.width / 2 * scale} width={ROBOT.medicine.depth * scale} height={ROBOT.medicine.width * scale} fill="#f43f5e" />
        <line x1="0" y1="0" x2={0.3 * scale} y2="0" stroke="#020617" strokeWidth="2" />
      </g>
    </svg>
  );
}
