import { useState } from 'react';
import PhoneVisionSetup from './PhoneVisionSetup';
import { phoneSetupError } from '../utils/phoneVision';
import { TASKS } from '../eval/spec';
import { ROLE_LABELS } from '../utils/markerRoles';

const fmt = (n, digits = 2) => Number.isFinite(n) ? n.toFixed(digits) : '—';
const box = 'rounded-xl border border-slate-700 bg-slate-900 p-3';
const input = 'mt-1 min-h-11 w-full rounded border border-slate-600 bg-slate-950 p-2';
const CALIBRATION_TEXT = { waiting: 'Waiting for station marker', collecting: 'Hold still — calibrating', ready: 'Calibrated', moved: 'Camera or station moved — recalibrate', failed: 'Calibration failed' };

export function PhoneCalibration({ dashboard, disabled, onControl }) {
  const { calibration: c, metric } = dashboard;
  const r = metric?.robot;
  return <section className={box}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-bold">Calibration</h2>
      <button className="min-h-11 rounded bg-slate-700 px-3 font-semibold disabled:opacity-40" disabled={disabled || Boolean(dashboard.run)} onClick={() => onControl({ action: 'recalibrate' })}>Recalibrate</button>
    </div>
    <p className={`my-2 text-sm ${c.state === 'ready' ? 'text-emerald-300' : 'text-amber-300'}`}>{CALIBRATION_TEXT[c.state]}{c.state === 'collecting' ? ` · ${Math.round(c.progress * 100)}%` : ''}</p>
    {c.state === 'collecting' && <progress className="mb-2 w-full" value={c.progress} max={1} aria-label="Calibration progress" />}
    {c.reason && <p className="mb-2 text-sm text-red-300">{c.reason}</p>}
    <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
      <Reading label="Camera height" value={`${fmt(c.cal?.cameraHeight)} m`} />
      <Reading label="Focal length" value={`${fmt(c.cal?.K?.fx, 0)} px`} />
      <Reading label="Reprojection error" value={`${fmt(c.cal?.reprojectionPx)} px`} />
      <Reading label="Robot u / w" value={r ? `${fmt(r.u)} / ${fmt(r.w)} m` : 'Not tracked'} />
      <Reading label="Robot heading" value={r ? `${fmt(r.heading * 180 / Math.PI, 1)}°` : '—'} />
      <Reading label="Front gap" value={r ? `${fmt(r.frontGap * 100, 1)} cm` : '—'} />
      <Reading label="Dock approach" value={r ? r.inApproach ? 'Inside' : 'Outside' : '—'} />
      <Reading label="Medicine box" value={metric?.medicine?.onRobot === true ? 'On robot' : metric?.medicine?.onRobot === false ? 'Off robot' : 'Not confirmed'} />
    </dl>
  </section>;
}

export function PhoneDetections({ markers }) {
  return <section className={box}>
    <h2 className="mb-2 font-bold">Detected markers</h2>
    {markers.length ? <div className="flex flex-wrap gap-2">{markers.map((m, i) => <span key={`${m.id}-${i}`} className="rounded border border-slate-600 bg-slate-800 px-3 py-2 text-sm">
      <strong>#{m.id}</strong> · {ROLE_LABELS[m.role] ?? 'Unassigned'}
    </span>)}</div> : <p className="text-sm text-amber-300">No markers detected. Match the dictionary to the printed marker, keep its full border visible and leave white space around it.</p>}
  </section>;
}

export function PhoneSetupEditor({ setup, revision, markers, disabled, locked, onControl }) {
  const [draft, setDraft] = useState(() => structuredClone(setup));
  const error = phoneSetupError(draft);
  return <div>
    <PhoneVisionSetup setup={draft} onChange={setDraft} locked={disabled || locked} markers={markers} error={error} />
    <button disabled={disabled || locked || Boolean(error)} className="mt-2 min-h-12 w-full rounded bg-cyan-700 px-4 font-semibold disabled:opacity-40"
      onClick={() => onControl({ action: 'setup', setup: draft, revision })}>Apply marker setup to both screens</button>
  </div>;
}

export function PhoneTestControls({ dashboard, disabled, onControl }) {
  const [task, setTask] = useState('static-balance'), [direction, setDirection] = useState('forward');
  const { run, runTask, lastResult } = dashboard;
  return <section className={box}>
    <h2 className="mb-2 font-bold">Evaluation</h2>
    {run ? <>
      <p className="mb-3 text-sm text-cyan-300">{TASKS.find((t) => t.id === runTask?.id)?.name ?? 'Test running'} · {fmt(run.elapsedS, 1)} s</p>
      <dl className="mb-3 grid grid-cols-2 gap-3 text-xs"><Reading label="From start" value={`${fmt(run.displacementM)} m`} /><Reading label="Still for" value={`${fmt(run.stillForS, 1)} s`} /></dl>
      <button disabled={disabled} className="min-h-12 w-full rounded bg-red-700 px-4 font-bold disabled:opacity-40" onClick={() => onControl({ action: 'end' })}>End Test</button>
    </> : <>
      <label className="mb-3 block text-sm">Task<select className={input} value={task} onChange={(e) => setTask(e.target.value)}>
        {TASKS.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select></label>
      {task === 'robot-guidance' && <label className="mb-3 block text-sm">Commanded direction<select className={input} value={direction} onChange={(e) => setDirection(e.target.value)}><option value="forward">Forward</option><option value="backward">Backward</option></select></label>}
      <button disabled={disabled || !dashboard.ready} className="min-h-12 w-full rounded bg-emerald-500 px-4 font-bold text-slate-950 disabled:bg-slate-700 disabled:text-slate-400"
        onClick={() => onControl({ action: 'start', task: { id: task, ...(task === 'robot-guidance' ? { direction } : {}) } })}>Start Test</button>
      {!dashboard.ready && <p className="mt-2 text-sm text-amber-300">{dashboard.notReadyReason}</p>}
    </>}
    <p className="mt-3 text-xs text-slate-400">Use the physical robot and glove. Tilt, charging and command evidence come from the robot’s telemetry. Keep the phone fixed during tests.</p>
    {lastResult && <div className="mt-3 border-t border-slate-700 pt-3">
      <p className={`font-bold ${lastResult.result.status === 'passed' ? 'text-emerald-300' : lastResult.result.status === 'failed' ? 'text-red-300' : 'text-amber-300'}`}>Latest result: {lastResult.result.status.toUpperCase()} · {lastResult.result.points}/5</p>
      <p className="mt-1 text-xs text-slate-400">{fmt(lastResult.durationS, 1)} s · {lastResult.frameCount} frames · {lastResult.packetCount} packets</p>
      <ul className="mt-2 space-y-2 text-xs">{lastResult.result.checks.map((c) => <li key={c.name}><strong>{c.name}</strong> · {c.status}<span className="block text-slate-400">{c.detail}</span></li>)}</ul>
      <p className="mt-2 text-xs text-slate-500">The sealed record and full run history are available on the laptop.</p>
    </div>}
  </section>;
}

function Reading({ label, value }) {
  return <div><dt className="text-slate-400">{label}</dt><dd className="mt-1 font-mono text-slate-100">{value}</dd></div>;
}
