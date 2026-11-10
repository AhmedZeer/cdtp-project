import { useEffect, useMemo, useRef, useState } from 'react';
import { createSimScene, CAMERA_PRESETS, RENDER_WIDTH, RENDER_HEIGHT } from '../sim/scene3d';
import { advance, telemetryPacket, dockGeometry, toStationFrame, inApproachRegion, APPROACH_RADIUS, wrapAngle } from '../sim/world';
import { presetIntrinsics, upInCamera } from '../sim/cameraRig';
import { createSimController } from '../sim/simController';
import { ARENA, ROBOT, STATION, MARKERS, MARKER_MOUNTS, MARKER_FAMILY, PHYSICS_HZ, TELEMETRY_HZ, DETECTION_HZ } from '../sim/simConfig';
import { createStationCalibrator } from '../utils/stationCalibrator';
import { metricScene } from '../utils/metricScene';
import { centre } from '../utils/playgroundGeometry';
import { markerFrame } from '../utils/markerFrame';
import MarkerAxes from './MarkerAxes';

const ROLE_BY_ID = Object.fromEntries(Object.entries(MARKERS).map(([role, m]) => [m.id, role]));
const ROLE_COLOURS = { robot: '#10b981', medicine: '#f43f5e', station: '#38bdf8' };
const ROLE_LABELS = { robot: 'Robot', medicine: 'Medicine box', station: 'Station' };
const deg = (rad) => (rad * 180) / Math.PI;
const GEOMETRY = {
  ids: { robot: MARKERS.robot.id, medicine: MARKERS.medicine.id }, mounts: MARKER_MOUNTS,
  stationDepth: STATION.depth, robotDepth: ROBOT.body.depth, inApproachRegion, boxTolerance: 0.05,
};
const IMU_NOISE_DEG = 0.3; // simulated phone accelerometer error when reading the camera tilt

/** Phone "up" vector with a small random tilt error, like a real accelerometer reading. */
function noisyUp(camera) {
  const up = upInCamera(camera);
  const r = [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5];
  const d = r[0] * up[0] + r[1] * up[1] + r[2] * up[2];
  const perp = r.map((v, i) => v - d * up[i]), n = Math.hypot(...perp) || 1, a = (IMU_NOISE_DEG * Math.PI) / 180;
  return up.map((v, i) => v * Math.cos(a) + (perp[i] / n) * Math.sin(a));
}

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
  const viewRef = useRef(null);
  const unit = useImagePixelsPerScreenPixel(viewRef);
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
  const [calibrator] = useState(() => createStationCalibrator({ id: MARKERS.station.id, size: MARKERS.station.size, height: MARKER_MOUNTS.station.height }));
  const [calibration, setCalibration] = useState(calibrator.status);
  const [calSettings, setCalSettingsState] = useState({ useGravity: true, estimateFocal: false });
  const calSettingsRef = useRef({ ...calSettings, preset });
  const setCalSettings = (patch) => {
    calSettingsRef.current = { ...calSettingsRef.current, ...patch };
    setCalSettingsState((prev) => ({ ...prev, ...patch }));
    staleBeforeRef.current = postedSeqRef.current;
    setCalibration(calibrator.reset());
  };
  const recalibrate = () => { staleBeforeRef.current = postedSeqRef.current; setCalibration(calibrator.reset()); };
  // Detections already in flight when the view or settings change must not feed the new calibration.
  const postedSeqRef = useRef(0), staleBeforeRef = useRef(0);

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
      if (data.seq <= staleBeforeRef.current) return;
      const settings = calSettingsRef.current;
      setCalibration(calibrator.push(data.markers, {
        getIntrinsics: () => presetIntrinsics(settings.preset), // stands in for the phone's factory calibration
        getUp: () => (settings.useGravity ? noisyUp(sim.camera) : null),
        estimateFocal: settings.estimateFocal,
      }));
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
        postedSeqRef.current = ++seq;
        worker.postMessage({ image, family: MARKER_FAMILY, minPerimeterFraction: 0.03, simTime: world.time, seq }, [image.data.buffer]);
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
  const metric = useMemo(() => (calibration.cal && calibration.state === 'ready' ? metricScene(calibration.cal, vision.markers, GEOMETRY) : null), [calibration, vision.markers]);
  const truthStation = useMemo(() => {
    const local = toStationFrame(truth.station, truth.x, truth.y);
    return { u: local.u, w: local.w, heading: wrapAngle((truth.heading * Math.PI) / 180 - truth.station.heading) };
  }, [truth]);
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
          <div ref={viewRef} className="relative w-full overflow-hidden rounded-lg border border-slate-800 bg-black" style={{ aspectRatio: `${RENDER_WIDTH} / ${RENDER_HEIGHT}` }}>
            <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-label="Simulated phone camera view" />
            <DetectionOverlay markers={vision.markers} unit={unit} />
            {error && <p className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-red-300">{error}</p>}
          </div>

          <Controls mode={mode} command={controller.command} driveLabel={driveLabel} />
        </section>

        <aside className="flex w-full flex-col gap-3 text-xs xl:w-96">
          <Panel title="Setup">
            <label className="mb-2 block">Phone camera
              <select className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" value={preset}
                onChange={(e) => { setPreset(e.target.value); setCalSettings({ preset: e.target.value }); e.target.blur(); }}>
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
            <p className="mt-2 text-slate-500">DICT_5X5_100 · image pixels; metric values are in the calibration panel.</p>
          </Panel>

          <CalibrationPanel calibration={calibration} settings={calSettings} onSettings={setCalSettings} onRecalibrate={recalibrate}
            metric={metric} truthStation={truthStation} />

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
            <MiniMap truth={truth} measured={metric?.robot ?? null} />
          </Panel>
        </aside>
      </div>
    </main>
  );
}

/** Image pixels per on-screen pixel of the camera view, so overlay text keeps a fixed on-screen size. */
function useImagePixelsPerScreenPixel(ref) {
  const [unit, setUnit] = useState(2);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const update = () => { if (el.clientWidth > 0) setUnit(RENDER_WIDTH / el.clientWidth); };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return unit;
}

// On-screen sizes (CSS px) of the overlay; multiplied by `unit` to get image pixels.
const OVERLAY = { axis: 11, minAxis: 18, maxAxis: 60 };

/** Outlines (coloured by role) and +X/+Y frames for the detected markers, in image pixels. */
function DetectionOverlay({ markers, unit }) {
  const items = markers.map((m, i) => {
    const c = m.corners;
    const side = c.reduce((sum, p, k) => sum + Math.hypot(c[(k + 1) % 4].x - p.x, c[(k + 1) % 4].y - p.y), 0) / 4;
    // Axes scale with the marker so neighbouring markers' frames do not run into each other.
    return { m, key: `${m.id}-${i}`, axisLength: Math.max(OVERLAY.minAxis * unit, Math.min(OVERLAY.maxAxis * unit, side * 0.8)) };
  });

  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${RENDER_WIDTH} ${RENDER_HEIGHT}`} aria-hidden="true">
      <defs>
        <marker id="marker-x-arrow" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4 z" fill="#dc2626" /></marker>
        <marker id="marker-y-arrow" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4 z" fill="#16a34a" /></marker>
      </defs>
      {items.map(({ m, key, axisLength }) => (
        <g key={key}>
          <polygon points={m.corners.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={ROLE_COLOURS[m.role] ?? '#facc15'} strokeWidth={2 * unit} strokeLinejoin="round" />
          <MarkerAxes corners={m.corners} length={axisLength} unit={unit} fontSize={OVERLAY.axis} strokeWidth={2.5} />
        </g>
      ))}
    </svg>
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

const STATE_TEXT = {
  waiting: ['Waiting for the station marker…', 'text-amber-400'],
  collecting: ['Hold the phone still — calibrating…', 'text-cyan-400'],
  ready: ['Calibrated', 'text-emerald-400'],
  moved: ['Station marker moved since calibration — recalibrate', 'text-amber-400'],
  failed: ['Calibration failed', 'text-red-400'],
};

/** Metric calibration status/settings plus the camera's metric measurements in the station frame. */
function CalibrationPanel({ calibration, settings, onSettings, onRecalibrate, metric, truthStation }) {
  const { state, cal } = calibration;
  const [text, tone] = STATE_TEXT[state];
  const robot = metric?.robot, medicine = metric?.medicine;
  const posErr = robot ? Math.hypot(robot.u - truthStation.u, robot.w - truthStation.w) : null;
  const headErr = robot ? Math.abs(wrapAngle(robot.heading - truthStation.heading)) : null;
  return (
    <Panel title="Metric calibration (station marker)">
      <p className={`mb-2 font-semibold ${tone}`}>
        {text}{state === 'collecting' && ` ${Math.round(calibration.progress * 100)}%`}
        {state === 'failed' && <span className="block font-normal text-red-300">{calibration.reason}</span>}
      </p>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <label><input type="checkbox" checked={settings.useGravity} onChange={(e) => onSettings({ useGravity: e.target.checked })} /> Phone tilt from accelerometer</label>
        <label><input type="checkbox" checked={settings.estimateFocal} onChange={(e) => onSettings({ estimateFocal: e.target.checked })} /> Estimate focal length</label>
        <button className="rounded bg-slate-700 px-2 py-1 font-semibold hover:bg-slate-600" onClick={(e) => { onRecalibrate(); e.currentTarget.blur(); }}>Recalibrate</button>
      </div>
      {!settings.useGravity && <p className="mb-2 text-amber-300">Without the accelerometer the camera tilt comes from one small marker and can be off by tens of centimetres.</p>}
      {cal && <dl className="mb-2 grid grid-cols-3 gap-2">
        <Stat label="Camera height" value={`${fmt(cal.cameraHeight)} m`} />
        <Stat label="Camera tilt" value={`${fmt(cal.depressionDeg, 1)}° down`} />
        <Stat label="Reprojection" value={`${fmt(cal.reprojectionPx, 2)} px`} />
        <Stat label="Focal length" value={`${fmt(cal.K.fx, 0)} px`} />
        <Stat label="Focal source" value={calibration.focalSource} />
        <Stat label="Tilt source" value={calibration.usedGravity ? `IMU (±${IMU_NOISE_DEG}°)` : 'marker'} />
      </dl>}
      {cal && <>
        <h3 className="mb-1 mt-3 font-semibold text-slate-300">Robot, from the camera (station frame)</h3>
        {robot ? <dl className="grid grid-cols-3 gap-2">
          <Stat label="u, w" value={`${fmt(robot.u)}, ${fmt(robot.w)} m`} />
          <Stat label="Heading" value={`${fmt(deg(robot.heading), 1)}°`} />
          <Stat label="To contact face" value={`${fmt(robot.faceDistance)} m`} />
          <Stat label="Front gap" value={`${fmt(robot.frontGap * 100, 1)} cm`} />
          <Stat label="Lateral / angle" value={`${fmt(robot.w * 100, 0)} cm / ${fmt(deg(robot.headingError), 0)}°`} />
          <Stat label={`Approach region (${fmt(APPROACH_RADIUS)} m)`} value={robot.inApproach ? 'inside' : 'outside'} tone={robot.inApproach ? 'text-emerald-400' : ''} />
          <Stat label="Medicine box" value={medicine ? (medicine.onRobot === null ? 'seen' : medicine.onRobot ? 'on robot' : 'off robot') : 'not seen'}
            tone={medicine?.onRobot === false ? 'text-red-400' : ''} />
          <Stat label="Error vs truth" value={`${fmt(posErr * 100, 1)} cm / ${fmt(deg(headErr), 1)}°`} tone={posErr > 0.05 ? 'text-amber-400' : 'text-slate-400'} />
        </dl> : <p className="text-amber-400">Robot marker not detected.</p>}
      </>}
      <p className="mt-2 text-slate-500">Station frame: origin at the station centre, u out of the contact face, w to its left. The robot marker is measured on the plane {fmt(MARKER_MOUNTS.robot.height)} m above the floor.</p>
    </Panel>
  );
}

/** Top-down debug map of the true world state (metres); a dashed outline shows the camera's measurement. */
function MiniMap({ truth, measured }) {
  const scale = 70, w = ARENA.width * scale, h = ARENA.depth * scale;
  const px = (x) => (x + ARENA.width / 2) * scale, py = (y) => (ARENA.depth / 2 - y) * scale;
  const s = truth.station, sh = (s.heading * 180) / Math.PI;
  const rh = truth.heading;
  return (
    <svg className="mt-3 w-full rounded bg-slate-200" viewBox={`0 0 ${w} ${h}`} aria-label="Top-down map">
      <g transform={`translate(${px(s.x)} ${py(s.y)}) rotate(${-sh})`}>
        <path d={`M0 0 L${APPROACH_RADIUS * scale * Math.SQRT1_2} ${-APPROACH_RADIUS * scale * Math.SQRT1_2} A${APPROACH_RADIUS * scale} ${APPROACH_RADIUS * scale} 0 0 1 ${APPROACH_RADIUS * scale * Math.SQRT1_2} ${APPROACH_RADIUS * scale * Math.SQRT1_2} Z`} fill="#38bdf8" opacity="0.25" />
        <rect x={STATION.depth / 2 * scale} y={-STATION.pad.width / 2 * scale} width={STATION.pad.length * scale} height={STATION.pad.width * scale} fill="#475569" />
        <rect x={-STATION.depth / 2 * scale} y={-STATION.width / 2 * scale} width={STATION.depth * scale} height={STATION.width * scale} fill={truth.charging ? '#22c55e' : '#0284c7'} />
      </g>
      <g transform={`translate(${px(truth.x)} ${py(truth.y)}) rotate(${-rh})`}>
        <rect x={-ROBOT.body.depth / 2 * scale} y={-(ROBOT.track / 2 + ROBOT.wheelWidth / 2) * scale} width={ROBOT.body.depth * scale} height={(ROBOT.track + ROBOT.wheelWidth) * scale} fill="#10b981" />
        <rect x={(ROBOT.body.depth / 2 + ROBOT.medicine.gap) * scale} y={-ROBOT.medicine.width / 2 * scale} width={ROBOT.medicine.depth * scale} height={ROBOT.medicine.width * scale} fill="#f43f5e" />
        <line x1="0" y1="0" x2={0.3 * scale} y2="0" stroke="#020617" strokeWidth="2" />
      </g>
      {measured && (() => {
        const c = Math.cos(s.heading), si = Math.sin(s.heading);
        const mx = s.x + measured.u * c - measured.w * si, my = s.y + measured.u * si + measured.w * c;
        return <g transform={`translate(${px(mx)} ${py(my)}) rotate(${-deg(s.heading + measured.heading)})`} aria-label="Camera-measured robot pose">
          <rect x={-ROBOT.body.depth / 2 * scale} y={-(ROBOT.track / 2 + ROBOT.wheelWidth / 2) * scale} width={ROBOT.body.depth * scale} height={(ROBOT.track + ROBOT.wheelWidth) * scale} fill="none" stroke="#7c3aed" strokeWidth="2" strokeDasharray="4 3" />
          <line x1="0" y1="0" x2={0.3 * scale} y2="0" stroke="#7c3aed" strokeWidth="2" strokeDasharray="4 3" />
        </g>;
      })()}
    </svg>
  );
}
