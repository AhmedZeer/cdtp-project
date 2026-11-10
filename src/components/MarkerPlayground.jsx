import { useEffect, useRef, useState } from 'react';
import { createMarkerDetector } from '../utils/markerDetector';
import { centre, pairGeometry, moveOnPlane, PLANE_SIZE } from '../utils/playgroundGeometry';

import { createMotionTracker, nextReplayFrame } from '../utils/motionExperiment';
import { TASKS, DEFAULT_PIXELS_PER_METRE, evaluateTask, recordingDeadlineReached } from '../utils/taskEvaluation';
import { taskGoal } from '../utils/taskGoal';
import MarkerAxes from './MarkerAxes';

const roles = ['robot', 'station'];
const colours = { robot: '#059669', station: '#0284c7' };
const simulationDescriptions = {
  'static-balance': 'Evaluate 30 s (±2 s) of stationary marker position within 10 px. Active balancing and box retention are excluded.',
  'robot-guidance': 'Evaluate 0.8–1.2 m displacement and the selected direction from marker heading. Glove, balance and box checks are excluded.',
  charging: 'Evaluate finishing within 0.3 m of the station. Docking, autonomy and charging timing are excluded.',
  integrated: 'Evaluate delivery to the target, a 5 s wait, then arrival within 0.3 m of the station. Box, glove, docking and charging checks are excluded.',
};

function blankCanvas(size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  // Keep the tile margin transparent: invisible padding must not cover a nearby
  // marker's black border. The plane itself supplies the white background.
  return canvas;
}

const assets = ['marker1.png', 'marker2.png', 'marker3.png'];

async function loadMarker(name) {
  const original = new Image();
  await new Promise((resolve, reject) => {
    original.onload = resolve;
    original.onerror = () => reject(new Error(`Could not load ${name}.`));
    original.src = `/placeholder/${name}`;
  });
  // A white margin lets the detector find markers whose black border touches the file edge.
  const source = document.createElement('canvas');
  source.width = original.naturalWidth + 40;
  source.height = original.naturalHeight + 40;
  const ctx = source.getContext('2d');
  ctx.fillStyle = 'white'; ctx.fillRect(0, 0, source.width, source.height);
  ctx.drawImage(original, 20, 20);
  const markers = createMarkerDetector('catalog').detect(ctx.getImageData(0, 0, source.width, source.height));
  if (markers.length !== 1) throw new Error(`${name}: expected one supported marker, found ${markers.length}.`);
  const marker = markers[0];
  const xs = marker.corners.map((p) => p.x), ys = marker.corners.map((p) => p.y);
  const width = Math.max(...xs) - Math.min(...xs) + 1;
  const height = Math.max(...ys) - Math.min(...ys) + 1;
  const image = blankCanvas(200), target = image.getContext('2d');
  const scale = 160 / Math.max(width, height);
  target.drawImage(source, Math.min(...xs), Math.min(...ys), width, height,
    (200 - width * scale) / 2, (200 - height * scale) / 2, width * scale, height * scale);
  return { name, id: marker.id, family: marker.family, image };
}

function initialItems(catalog) {
  return [
    { ...catalog[0], role: 'robot', x: 285, y: 342, size: 200 },
    { ...catalog[1], role: 'station', x: 819, y: 744, size: 200 },
  ];
}

export default function MarkerPlayground() {
  const [items, setItems] = useState([]);
  const [observation, setObservation] = useState({ markers: [], truth: [], ms: 0 });
  const [error, setError] = useState('');
  const canvasRef = useRef(null);
  const itemsRef = useRef(items);
  const drag = useRef(null);
  const [catalog, setCatalog] = useState([]);
  const experiment = useRef({ mode: 'idle', frames: [], tracker: createMotionTracker() });
  const [session, setSession] = useState({ mode: 'idle', count: 0, elapsed: 0 });
  const [movement, setMovement] = useState(null);
  const [taskId, setTaskId] = useState(TASKS[0].id);
  const [result, setResult] = useState(null);
  const [goalReference, setGoalReference] = useState(null);
  const [pixelsPerMetre, setPixelsPerMetre] = useState(String(DEFAULT_PIXELS_PER_METRE));
  const [direction, setDirection] = useState('forward');
  const [simulation, setSimulation] = useState(true);
  const selectedTask = TASKS.find((task) => task.id === taskId);
  const scaleValid = Number.isFinite(Number(pixelsPerMetre)) && Number(pixelsPerMetre) > 0;
  const configuredTask = { ...selectedTask, simulation, pixelsPerMetre: Number(pixelsPerMetre), direction: selectedTask.id === 'robot-guidance' ? direction : 'forward' };


  useEffect(() => {
    let active = true;
    Promise.all(assets.map(loadMarker)).then((loaded) => {
      if (!active) return;
      setCatalog(loaded);
      setItems(initialItems(loaded));
    }).catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, []);

  useEffect(() => { itemsRef.current = items; }, [items]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const detector = createMarkerDetector('catalog');
    let frame;
    let lastDetection = -Infinity;
    function render(now) {
      const run = experiment.current;
      if (recordingDeadlineReached(run, now)) run.stopRequested = 'time-limit';
      const replay = run.mode === 'replaying'
        ? nextReplayFrame(run.frames, run.cursor, now - run.startedAt) : null;
      const current = replay ? replay.scene : run.mode === 'replaying' ? run.lastScene : itemsRef.current;
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, PLANE_SIZE, PLANE_SIZE);
      for (const item of current) {
        ctx.drawImage(item.image, item.x - item.size / 2, item.y - item.size / 2, item.size, item.size);
      }
      if (replay || run.stopRequested || (run.mode !== 'replaying' && ((run.mode === 'recording' && run.frames.length === 0) || now - lastDetection >= 100))) {
        lastDetection = now;
        const start = performance.now();
        // The detector sees pixels only. Labels/lines are drawn separately in SVG.
        const markers = detector.detect(ctx.getImageData(0, 0, PLANE_SIZE, PLANE_SIZE));
        const poses = Object.fromEntries(current.map((item) => {
          const found = markers.filter((m) => m.id === item.id && m.family === item.family);
          return [item.role, found.length === 1 ? centre(found[0].corners) : null];
        }));
        const robotItem = current.find((item) => item.role === 'robot');
        const robotMarker = markers.find((m) => m.id === robotItem?.id && m.family === robotItem?.family);
        const heading = robotMarker ? { x: robotMarker.corners[1].x - robotMarker.corners[0].x, y: robotMarker.corners[1].y - robotMarker.corners[0].y } : null;
        if (run.mode === 'recording' || replay) {
          run.startedAt ??= now;
          const t = replay ? replay.t : now - run.startedAt;
          if (run.mode === 'recording') {
            if (run.frames.length === 0) {
              if (run.task.id === 'integrated') run.task.deliveryGoal = taskGoal(run.task, poses.robot, poses.station, heading)?.point;
              run.goalReference = { task: run.task, robot: poses.robot, station: poses.station, heading };
              setGoalReference(run.goalReference);
            }
            // Snapshot scene inputs separately from the measured detections.
            run.frames.push({ t, scene: current.map((item) => ({ ...item })),
              robot: poses.robot ?? null, station: poses.station ?? null, heading });
          }
          setMovement(run.tracker.observe(t, poses.robot, poses.station));
          if (run.mode === 'recording' && run.stopRequested) {
            run.durationMs = t;
            run.stopReason = run.stopRequested;
            run.stopRequested = null;
            run.mode = 'idle';
            run.result = evaluateTask(run.task, run.frames, run.durationMs, run.stopReason);
            setResult(run.result);
            drag.current = null;
          }
          if (replay) {
            run.replayFrames.push({ t, robot: poses.robot ?? null, station: poses.station ?? null, heading });
            run.lastScene = current;
            run.cursor++;
            if (run.cursor === run.frames.length) {
              run.mode = 'idle';
              setResult(evaluateTask(run.task, run.replayFrames, run.durationMs, run.stopReason, 'replay'));
              itemsRef.current = current;
              setItems(current);
            }
          }
          setSession({ mode: run.mode, count: replay ? run.cursor : run.frames.length, elapsed: t });
        }
        setObservation({ markers, truth: current.map(({ role, id, family, x, y }) => ({ role, id, family, x, y })), ms: performance.now() - start });
      }
      frame = requestAnimationFrame(render);
    }
    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, []);

  function pointer(event) {
    const bounds = canvasRef.current.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) * PLANE_SIZE / bounds.width,
      y: (event.clientY - bounds.top) * PLANE_SIZE / bounds.height };
  }

  function grab(event) {
    if (event.button !== 0 || experiment.current.mode === 'replaying') return;
    const p = pointer(event);
    const item = [...items].reverse().find((i) => Math.abs(p.x - i.x) <= i.size / 2 && Math.abs(p.y - i.y) <= i.size / 2);
    if (!item || (experiment.current.mode === 'recording' && item.role === 'station')) return;
    if (experiment.current.mode === 'idle') setGoalReference(null);
    drag.current = { role: item.role, pointerId: event.pointerId, x: p.x - item.x, y: p.y - item.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function move(event) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const p = pointer(event);
    setItems((previous) => previous.map((item) => item.role === active.role ? moveOnPlane(item, p, active) : item));
  }

  function startRecording() {
    drag.current = null;
    experiment.current = { mode: 'recording', frames: [], tracker: createMotionTracker(), startedAt: performance.now(), task: { ...configuredTask } };
    setResult(null);
    setGoalReference(null);
    setMovement(null);
    setSession({ mode: 'recording', count: 0, elapsed: 0 });
  }

  function stop() {
    const run = experiment.current;
    if (run.mode === 'recording') {
      run.stopRequested = 'user';
      return;
    }
    if (run.mode === 'replaying') {
      setResult(run.result);
      itemsRef.current = run.lastScene;
      setItems(run.lastScene);
    }
    run.mode = 'idle';
    drag.current = null;
    setSession((previous) => ({ ...previous, mode: 'idle' }));
  }

  function replayRecording() {
    const saved = experiment.current;
    const frames = saved.frames;
    if (!frames.length) return;
    drag.current = null;
    experiment.current = { mode: 'replaying', frames, cursor: 0, startedAt: performance.now(),
      lastScene: frames[0].scene, tracker: createMotionTracker(), replayFrames: [],
      task: saved.task, durationMs: saved.durationMs, stopReason: saved.stopReason, result: saved.result };
    experiment.current.goalReference = saved.goalReference;
    setGoalReference(saved.goalReference);
    setResult(null);
    setMovement(null);
    setSession({ mode: 'replaying', count: 0, elapsed: 0 });
  }

  function selectMarker(role, name) {
    const asset = catalog.find((entry) => entry.name === name);
    if (!asset) return;
    setGoalReference(null);
    setItems((previous) => previous.map((item) => item.role === role ? { ...item, ...asset } : item));
  }

  const detected = Object.fromEntries(observation.truth.map((item) => {
    const matches = observation.markers.filter((marker) => marker.id === item.id && marker.family === item.family);
    return [item.role, matches.length === 1 ? centre(matches[0].corners) : null];
  }));
  const measured = detected.robot && detected.station ? pairGeometry(detected.robot, detected.station) : null;
  const truth = observation.truth.length === 2 ? pairGeometry(observation.truth[0], observation.truth[1]) : null;
  const robotItem = observation.truth.find((item) => item.role === 'robot');
  const robotMarker = observation.markers.find((m) => m.id === robotItem?.id && m.family === robotItem?.family);
  const previewHeading = robotMarker ? { x: robotMarker.corners[1].x - robotMarker.corners[0].x, y: robotMarker.corners[1].y - robotMarker.corners[0].y } : undefined;
  const goal = taskGoal(goalReference?.task ?? configuredTask,
    goalReference ? goalReference.robot : detected.robot,
    goalReference ? goalReference.station : detected.station, goalReference ? goalReference.heading : previewHeading);

  return <main className="min-h-screen bg-slate-950 p-4 text-slate-100 md:p-6">
    <div className="mx-auto max-w-6xl space-y-4">
      <h1 className="text-2xl font-bold">2D marker playground</h1>
      <p>Drag either marker. Green is the robot; blue is the station. Choose each marker from the local library.</p>
      <div className="flex flex-wrap items-center gap-4">
        {roles.map((role) => <label key={role} className="rounded border border-slate-600 p-2 capitalize">{role} marker
          <select className="ml-2 rounded bg-slate-800 p-2" disabled={!catalog.length || session.mode !== 'idle'} value={items.find((item) => item.role === role)?.name ?? ''} onChange={(e) => selectMarker(role, e.target.value)}>
            {!catalog.length && <option value="">Loading markers…</option>}
            {catalog.map((asset) => <option key={asset.name} value={asset.name} disabled={items.some((item) => item.role !== role && item.name === asset.name)}>{asset.name} · ID {asset.id} ({asset.family})</option>)}
          </select>
        </label>)}
        <button disabled={!catalog.length || session.mode !== 'idle'} className="rounded bg-slate-700 px-4 py-2" onClick={() => { drag.current = null; setGoalReference(null); setItems(initialItems(catalog)); }}>Reset scene</button>
      </div>
      <div className="rounded border border-slate-700 p-4 space-y-2">
        <label className="flex items-center gap-3 font-bold">
          <input type="checkbox" role="switch" checked={simulation} disabled={session.mode !== 'idle'} onChange={(e) => { setGoalReference(null); setSimulation(e.target.checked); }} />
          Simulation
        </label>
        <label className="flex flex-wrap items-center gap-3">Evaluation task
          <select className="rounded bg-slate-800 p-2" value={taskId} disabled={session.mode !== 'idle'} onChange={(e) => { setGoalReference(null); setTaskId(e.target.value); }}>
            {TASKS.map((task) => <option key={task.id} value={task.id}>{task.name}</option>)}
          </select>
        </label>
        <p>Module {selectedTask.module}: {selectedTask.description}</p>
        <p className="text-amber-300">{simulation ? `Simulation checks: ${simulationDescriptions[selectedTask.id]}` : 'Full-task checks enabled. Missing required hardware or box evidence produces an inconclusive result.'}</p>
        <label className="flex flex-wrap items-center gap-3">Simulation scale (px per metre)
          <input type="number" min="1" className="w-28 rounded bg-slate-800 p-2" value={pixelsPerMetre} disabled={session.mode !== 'idle'} onChange={(e) => { setGoalReference(null); setPixelsPerMetre(e.target.value); }} />
        </label>
        {selectedTask.id === 'robot-guidance' && <label className="flex items-center gap-3">Command
          <select className="rounded bg-slate-800 p-2" value={direction} disabled={session.mode !== 'idle'} onChange={(e) => { setGoalReference(null); setDirection(e.target.value); }}>
            <option value="forward">Forward</option><option value="backward">Backward</option>
          </select>
        </label>}
        <p className="text-sm text-slate-400">Tasks match project specification §5.2. The scale is a simulation setting, not physical camera calibration. Forward follows the marker’s +X axis. Evaluation mode is frozen during recording and retained for replay.</p>
        <p className="text-sm text-slate-400">Recording cap: {selectedTask.limitMs / 1000} s. For guidance, charging and integrated tests this is a playground limit, not a requirement from the specification. Charging’s 5 s clock starts after docking.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className="rounded bg-emerald-800 px-4 py-2 disabled:opacity-40" disabled={items.length !== 2 || !scaleValid || session.mode !== 'idle'} onClick={startRecording}>Start task recording</button>
        <button className="rounded bg-slate-700 px-4 py-2 disabled:opacity-40" disabled={session.mode === 'idle'} onClick={stop}>Stop</button>
        <button className="rounded bg-sky-800 px-4 py-2 disabled:opacity-40" disabled={session.count === 0 || session.mode !== 'idle'} onClick={replayRecording}>Replay recording</button>
        <span role="status">{session.mode} · {(session.elapsed / 1000).toFixed(1)} s · {session.count} samples{session.mode === 'recording' ? ` · limit ${selectedTask.limitMs / 1000} s` : ''}</span>
      </div>
      <p className="text-sm text-slate-400">Choose a task, start recording, then drag the robot; the station is fixed. Recording ends at the time limit or when you press Stop. Starting again replaces the recording. Recordings stay in this tab until refresh. Replay processes every saved sample; slow detection can extend playback time.</p>
      {result && <section role="status" className={`rounded border p-4 space-y-2 ${result.status === 'passed' ? 'border-emerald-500' : result.status === 'failed' ? 'border-red-500' : 'border-amber-500'}`}>
        <h2 className="text-xl font-bold capitalize">{result.status}: {result.task.name}</h2>
        <p>{result.scope} · scale {result.task.pixelsPerMetre} px/m</p>
        <p>{result.reasons.join(' ')}</p>
        <p>{(result.durationMs / 1000).toFixed(2)} s · {result.metrics.samples} samples · stopped by {result.stopReason === 'time-limit' ? 'time limit' : 'user'} · {result.source}</p>
        <p>Displacement: {result.metrics.displacement?.toFixed(1) ?? '—'} px · Path: {result.metrics.path?.toFixed(1) ?? '—'} px · Maximum excursion: {result.metrics.maxExcursion?.toFixed(1) ?? '—'} px</p>
        {result.metrics.displacementM != null && <p>Simulation displacement: {result.metrics.displacementM.toFixed(3)} m · path: {result.metrics.pathM.toFixed(3)} m</p>}
        {result.metrics.finalStationDistanceM != null && <p>Final station distance: {result.metrics.finalStationDistanceM.toFixed(4)} m</p>}
        {result.metrics.missingRobotSamples != null && <p>Unavailable samples: robot {result.metrics.missingRobotSamples}, station {result.metrics.missingStationSamples}</p>}
        <ul className="space-y-1 text-sm">{result.checks.map((check) => <li key={check.name}><strong>{check.name}: {check.status}</strong> — {check.detail}</li>)}</ul>
      </section>}
      {error && <p role="alert" className="text-red-300">{error}</p>}
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_240px]">
        <div className="relative aspect-square bg-white">
          <canvas ref={canvasRef} width={PLANE_SIZE} height={PLANE_SIZE} className="block h-full w-full touch-none cursor-grab active:cursor-grabbing" aria-label="Draggable robot and station marker plane" onPointerDown={grab} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }} />
          <svg viewBox={`0 0 ${PLANE_SIZE} ${PLANE_SIZE}`} className="pointer-events-none absolute inset-0 h-full w-full" aria-label="Vision measurements">
            <defs>
              <marker id="marker-x-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L8,4 L0,8 Z" fill="#dc2626" /></marker>
              <marker id="marker-y-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L8,4 L0,8 Z" fill="#16a34a" /></marker>
            </defs>
            {goal && <g aria-label="Task goal">
              <circle cx={goal.centre.x} cy={goal.centre.y} r={goal.outer} fill="none" stroke="#d97706" strokeWidth="2" strokeDasharray="8 6" />
              {goal.inner > 0 && <circle cx={goal.centre.x} cy={goal.centre.y} r={goal.inner} fill="none" stroke="#d97706" strokeWidth="2" strokeDasharray="8 6" />}
              <g transform={`translate(${goal.point.x} ${goal.point.y})`}>
                <polygon points="0,-24 7,-8 24,-7 11,5 15,23 0,14 -15,23 -11,5 -24,-7 -7,-8" fill="#facc15" stroke="#92400e" strokeWidth="3" />
                <text x="0" y="-34" textAnchor="middle" fontSize="22" fill="#92400e" stroke="white" strokeWidth="4" paintOrder="stroke">{goal.label}</text>
              </g>
            </g>}
            {movement && <path d={movement.trail.map((point, index, points) => point ? `${index === 0 || points[index - 1] === null ? 'M' : 'L'} ${point.x} ${point.y}` : '').join(' ')} fill="none" stroke="#10b981" strokeWidth="3" opacity="0.6" />}
            {measured && <line x1={detected.robot.x} y1={detected.robot.y} x2={detected.station.x} y2={detected.station.y} stroke="#64748b" strokeWidth="3" strokeDasharray="10 6" />}
            {observation.markers.map((marker) => {
              const role = observation.truth.find((item) => item.id === marker.id && item.family === marker.family)?.role;
              const p = centre(marker.corners);
              return <g key={`${marker.family}-${marker.id}`} stroke={colours[role] ?? '#f59e0b'}>
                <polygon points={marker.corners.map((c) => `${c.x},${c.y}`).join(' ')} strokeWidth="4" fill="none" />
                <circle cx={p.x} cy={p.y} r="5" fill={colours[role] ?? '#f59e0b'} />
                <MarkerAxes corners={marker.corners} />
                <text x={Math.max(5, Math.min(...marker.corners.map((c) => c.x)))} y={Math.max(24, Math.min(...marker.corners.map((c) => c.y)) - 8)} fontSize="23" fill={colours[role] ?? '#f59e0b'} stroke="white" strokeWidth="4" paintOrder="stroke">{role} · ID {marker.id}</text>
              </g>;
            })}
          </svg>
        </div>
        <aside className="space-y-4 rounded border border-slate-700 p-4">
          <h2 className="font-bold">Detected measurements</h2>
          <p className="text-sm"><span className="text-red-400">Red +X</span> · <span className="text-green-400">Green +Y</span> · white origin at marker centre. These are projected 2D marker frames, not 3D pose axes.</p>
          <p className="text-sm text-amber-300">★ Goal guide · the station circle marks 0.3 m proximity. Simulation evaluates this geometry; full-task mode additionally requires docking and charging evidence.</p>
          {roles.map((role) => <p key={role} className="capitalize">{role}: {detected[role] ? `(${detected[role].x.toFixed(1)}, ${detected[role].y.toFixed(1)}) px` : 'tracking unavailable'}</p>)}
          <p>Distance: <strong>{measured ? `${measured.distance.toFixed(1)} px` : 'unavailable'}</strong></p>
          <p>Station offset: {measured ? `x ${measured.dx.toFixed(1)}, y ${measured.dy.toFixed(1)} px` : 'unavailable'}</p>
          <hr className="border-slate-700" />
          <h2 className="font-bold">Recorded movement</h2>
          <p>State: {movement?.motion ?? 'Not recording'}</p>
          <p>Relative to station: {movement?.approach ?? '—'}</p>
          <p>Path length: {movement ? `${movement.path.toFixed(1)} px` : '—'}</p>
          <p>Displacement: {movement?.displacement != null ? `${movement.displacement.toFixed(1)} px` : 'unavailable'}</p>
          <p>Speed: {movement?.speed != null ? `${movement.speed.toFixed(1)} px/s` : 'unavailable'}</p>
          <p>Tracking gaps: {movement?.gaps ?? 0}</p>
          <p className="text-sm text-slate-400">2 px deadband. Path excludes unseen movement across gaps and may underestimate fast curved motion between samples. Stopping freezes these measurements.</p>
          <hr className="border-slate-700" />
          <h2 className="font-bold">Scene reference</h2>
          <p>Tile-centre distance: {truth ? `${truth.distance.toFixed(1)} px` : '—'}</p>
          <p>Distance difference: {measured && truth ? `${Math.abs(measured.distance - truth.distance).toFixed(2)} px` : '—'}</p>
          <p className="text-sm text-slate-400">Reference uses tile positions, separately from detection. Image crops may introduce a centre offset.</p>
          <p className="text-sm text-slate-400">{PLANE_SIZE} × {PLANE_SIZE} image pixels. Positive x is right; positive y is down. Metres use the configured simulation scale. Heading comes from ordered marker corners; its mounting alignment must be defined before physical tests.</p>
          <p className="text-sm text-slate-400">Detection: {observation.ms.toFixed(1)} ms; sampled up to 10 times/sec. Overlapping markers may become unreadable.</p>
        </aside>
      </div>
    </div>
  </main>;
}
