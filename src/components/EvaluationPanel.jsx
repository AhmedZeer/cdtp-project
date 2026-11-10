import { useState } from 'react';
import { TASKS, SPEC, taskById } from '../eval/spec';
import { MOTION_LABELS } from '../eval/motionState';
import { verifySealed } from '../eval/seal';

const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const STATUS_STYLE = {
  passed: 'border-emerald-600/60 bg-emerald-950/40 text-emerald-200',
  failed: 'border-red-600/60 bg-red-950/40 text-red-200',
  inconclusive: 'border-amber-600/60 bg-amber-950/40 text-amber-200',
};
const CHECK_ICON = { passed: ['✓', 'text-emerald-400'], failed: ['✗', 'text-red-400'], unavailable: ['?', 'text-amber-400'], skipped: ['–', 'text-slate-500'] };
const DIRECTION_ARROW = { forward: '↑ forward', backward: '↓ backward', left: '⟲ left', right: '⟳ right' };

/** §5.2: motion state, direction, tilt, charging and link shown live, plus the test timer. */
export function LiveStatusBar({ motion, telemetry, linkSilenceS, run }) {
  const lost = linkSilenceS > SPEC.linkMaxGapS;
  const item = 'flex flex-col rounded bg-slate-900 px-3 py-1.5';
  return (
    <div className="mt-2 grid grid-cols-2 gap-1 text-xs sm:grid-cols-5" aria-live="polite">
      <div className={item}><span className="text-slate-500">Motion (camera)</span>
        <span className="font-semibold">{MOTION_LABELS[motion.state] ?? '—'}{motion.direction && <span className="text-cyan-300"> · {DIRECTION_ARROW[motion.direction]}</span>}</span></div>
      <div className={item}><span className="text-slate-500">Tilt</span><span className="font-mono">{telemetry ? `${fmt(telemetry.tilt)}°` : '—'}</span></div>
      <div className={item}><span className="text-slate-500">Charging</span>
        <span className={telemetry?.charging ? 'font-semibold text-emerald-400' : ''}>{telemetry ? (telemetry.charging ? 'YES' : 'no') : '—'}</span></div>
      <div className={item}><span className="text-slate-500">Robot link</span>
        <span className={lost ? 'font-semibold text-red-400' : 'text-emerald-400'}>{linkSilenceS === null ? 'waiting' : lost ? `LOST ${fmt(linkSilenceS)} s` : 'connected'}</span></div>
      <div className={item}><span className="text-slate-500">Test timer</span>
        <span className={`font-mono ${run ? 'text-cyan-300' : 'text-slate-500'}`}>{run ? `${fmt(run.elapsedS)} s` : 'idle'}</span></div>
    </div>
  );
}

/** Task selection, Start/End Test, live progress, sealed results and the run history (C5 tally). */
export default function EvaluationPanel({ ready, notReadyReason, run, runTask, onStart, onEnd, results }) {
  const [taskId, setTaskId] = useState('static-balance');
  const [direction, setDirection] = useState('forward');
  const [openIndex, setOpenIndex] = useState(0);
  const [verification, setVerification] = useState(null);
  const task = taskById(taskId);
  const shown = results[openIndex] ?? null;
  const integrated = results.filter((r) => r.record.task.id === 'integrated');

  async function verifyFile(file) {
    try {
      const sealed = JSON.parse(await file.text());
      const v = await verifySealed(sealed);
      setVerification({ name: file.name, ...v, status: sealed.result?.status });
    } catch (err) {
      setVerification({ name: file.name, error: err.message });
    }
  }

  return (
    <section className="rounded-lg border border-cyan-900 bg-slate-900 p-3">
      <h2 className="mb-2 font-bold uppercase tracking-wide text-slate-300">Evaluation (§5.2)</h2>

      {!run ? <>
        <label className="mb-2 block">Task
          <select className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" value={taskId} onChange={(e) => { setTaskId(e.target.value); e.target.blur(); }}>
            {TASKS.map((t) => <option key={t.id} value={t.id}>Module {t.module}: {t.name} ({t.rubric})</option>)}
          </select>
        </label>
        {taskId === 'robot-guidance' && <label className="mb-2 block">Commanded direction
          <select className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" value={direction} onChange={(e) => { setDirection(e.target.value); e.target.blur(); }}>
            <option value="forward">Forward</option><option value="backward">Backward</option>
          </select>
        </label>}
        <p className="mb-2 text-slate-400">{task.summary}</p>
        {(taskId === 'charging' || taskId === 'integrated') && <p className="mb-2 text-amber-300">The simulator has no autonomous docking yet. Driving into the dock yourself fails “Autonomous docking”, as it would in the real test.</p>}
        <button disabled={!ready} className="w-full rounded-lg bg-emerald-500 px-3 py-2 font-bold text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          onClick={(e) => { onStart({ id: taskId, ...(taskId === 'robot-guidance' ? { direction } : {}) }); setOpenIndex(0); e.currentTarget.blur(); }}>
          ▶ Start Test
        </button>
        {!ready && <p className="mt-1 text-amber-400">{notReadyReason}</p>}
      </> : <>
        <p className="mb-1 font-semibold text-cyan-300">Running: {taskById(runTask.id).name}{runTask.direction ? ` (${runTask.direction})` : ''}</p>
        <dl className="mb-2 grid grid-cols-3 gap-2">
          <div><dt className="text-slate-500">Elapsed</dt><dd className="font-mono">{fmt(run.elapsedS)} s</dd></div>
          <div><dt className="text-slate-500">From start</dt><dd className="font-mono">{run.displacementM === null ? '—' : `${fmt(run.displacementM, 2)} m`}</dd></div>
          <div><dt className="text-slate-500">Still for</dt><dd className="font-mono">{run.stillForS === null ? '—' : `${fmt(run.stillForS)} s`}</dd></div>
        </dl>
        <p className="mb-2 text-slate-400">Ends by itself when the task's completion condition is met (or after the time limit).</p>
        <button className="w-full animate-pulse rounded-lg bg-red-600 px-3 py-2 font-bold text-white hover:bg-red-500" onClick={(e) => { onEnd(); e.currentTarget.blur(); }}>■ End Test</button>
      </>}

      {shown && <ResultCard sealed={shown} />}

      {results.length > 0 && <>
        <h3 className="mb-1 mt-3 font-semibold text-slate-300">Runs this session</h3>
        <table className="w-full">
          <thead className="text-slate-500"><tr><th className="text-left">#</th><th className="text-left">Task</th><th>Result</th><th>Points</th></tr></thead>
          <tbody>{results.map((r, i) => (
            <tr key={r.digest} className={`cursor-pointer ${i === openIndex ? 'bg-slate-800' : 'hover:bg-slate-800/60'}`} onClick={() => setOpenIndex(i)}>
              <td>{results.length - i}</td><td>{taskById(r.record.task.id).name}</td>
              <td className={`text-center ${r.result.status === 'passed' ? 'text-emerald-400' : r.result.status === 'failed' ? 'text-red-400' : 'text-amber-400'}`}>{r.result.status}</td>
              <td className="text-center">{r.result.points}</td>
            </tr>))}
          </tbody>
        </table>
        <p className="mt-2 text-slate-400">C5 integrated task (4 independent runs): {integrated.length} run{integrated.length === 1 ? '' : 's'},{' '}
          {integrated.slice(0, 4).filter((r) => r.result.status === 'passed').length * 5}/20 points from the latest {Math.min(4, integrated.length)}.</p>
      </>}

      <label className="mt-3 block text-slate-400">Verify a saved record
        <input type="file" accept="application/json,.json" className="mt-1 block w-full text-slate-300 file:mr-2 file:rounded file:border-0 file:bg-slate-700 file:px-2 file:py-1 file:text-slate-100"
          onChange={(e) => e.target.files[0] && verifyFile(e.target.files[0])} />
      </label>
      {verification && <p className={`mt-1 ${verification.intact ? 'text-emerald-400' : 'text-red-400'}`}>
        {verification.error ? `${verification.name}: not a valid record (${verification.error}).`
          : verification.intact ? `${verification.name}: intact. The digest matches and re-evaluation gives the same result (${verification.status}).`
            : `${verification.name}: ALTERED. ${verification.digestMatches ? '' : 'The digest does not match. '}${verification.resultMatches ? '' : 'The stored result differs from re-evaluating the data.'}`}
      </p>}
    </section>
  );
}

function ResultCard({ sealed }) {
  const { record, result, digest } = sealed;
  const task = taskById(record.task.id);
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(sealed, null, 1)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `run-${record.task.id}-${record.wallClock.replace(/[:.]/g, '-')}-${digest.slice(0, 8)}.json` });
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className={`mt-3 rounded-lg border p-3 ${STATUS_STYLE[result.status]}`}>
      <p className="text-sm font-bold">{result.status.toUpperCase()} · {result.points}/5 points</p>
      <p className="mb-2 text-slate-300">{task.name}{record.task.direction ? ` (${record.task.direction})` : ''} · {fmt(record.durationS)} s · ended {record.endReason === 'completed' ? 'automatically' : record.endReason === 'time-limit' ? 'at the time limit' : 'by the user'} · {record.frames.length} frames, {record.packets.length} packets</p>
      <ul className="space-y-1">
        {result.checks.map((c) => {
          const [icon, tone] = CHECK_ICON[c.status];
          return <li key={c.name} className="flex gap-2"><span className={`w-3 shrink-0 font-bold ${tone}`}>{icon}</span>
            <span><span className="font-semibold text-slate-100">{c.name}</span>{c.basis === 'engineering' && <span className="text-slate-500"> (app threshold)</span>}: <span className="text-slate-300">{c.detail}</span></span></li>;
        })}
      </ul>
      <p className="mt-2 text-slate-400">Recorded {record.wallClock} · SHA-256 <span className="break-all font-mono text-[10px] text-slate-300">{digest}</span></p>
      <button className="mt-2 rounded bg-slate-700 px-2 py-1 font-semibold text-slate-100 hover:bg-slate-600" onClick={download}>Download sealed record (.json)</button>
    </div>
  );
}
