import { useEffect, useRef, useState } from 'react';

const PREVIEW_WIDTH = 640;
const PREVIEW_HEIGHT = 360;
const PREVIEW_HZ = 10;

/** Mock receiver preview; its source is the simulator canvas, pending a phone video source. */
export default function PhoneCameraDebug({ sourceRef, sourceError }) {
  const canvasRef = useRef(null);
  const countRef = useRef(0);
  const [paused, setPaused] = useState(false);
  const [stats, setStats] = useState({ frames: 0, fps: 0, width: 0, height: 0 });

  useEffect(() => {
    if (paused || sourceError) return undefined;
    const context = canvasRef.current.getContext('2d');
    let frame, lastGrab = -Infinity, rateStart = performance.now(), rateFrames = 0, fps = 0;

    const sample = (now) => {
      const source = sourceRef.current;
      if (source?.width && source?.height && now - lastGrab >= 1000 / PREVIEW_HZ) {
        lastGrab = now;
        context.drawImage(source, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
        countRef.current += 1;
        rateFrames += 1;
        if (now - rateStart >= 1000) {
          fps = rateFrames / ((now - rateStart) / 1000);
          rateStart = now;
          rateFrames = 0;
        }
        setStats({ frames: countRef.current, fps, width: source.width, height: source.height });
      }
      frame = requestAnimationFrame(sample);
    };
    frame = requestAnimationFrame(sample);
    return () => cancelAnimationFrame(frame);
  }, [paused, sourceRef, sourceError]);

  const status = sourceError ? 'Unavailable' : paused ? 'Paused' : stats.frames ? 'Mock frames' : 'Waiting for frames';

  return (
    <section className="mt-4 rounded-lg border border-slate-700 bg-slate-900 p-3 text-xs" aria-labelledby="phone-camera-debug-title">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 id="phone-camera-debug-title" className="font-bold uppercase tracking-wide text-slate-300">Phone camera preview</h2>
        <span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 font-semibold text-amber-300">Mock · debug only</span>
      </div>
      <p className="mb-3 text-slate-400">Placeholder for incoming phone video. This preview copies the simulator’s camera frames.</p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative w-full overflow-hidden rounded border border-slate-800 bg-black sm:max-w-sm" style={{ aspectRatio: '16 / 9' }}>
          <canvas ref={canvasRef} width={PREVIEW_WIDTH} height={PREVIEW_HEIGHT} className="h-full w-full" aria-label="Mock phone camera preview from simulator frames" />
          <span className="absolute left-2 top-2 rounded bg-slate-950/90 px-2 py-1 font-mono text-cyan-300" role="status">{status}</span>
          {(paused || sourceError) && <p className="absolute inset-x-0 bottom-0 bg-slate-950/90 p-2 text-slate-300">
            {sourceError ? 'Simulator frames unavailable.' : 'Last frame held. Resume to refresh the preview.'}
          </p>}
        </div>
        <div className="min-w-0 flex-1">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 font-mono">
            <dt className="text-slate-500">Phone link</dt><dd className="text-slate-300">Not connected</dd>
            <dt className="text-slate-500">Frame source</dt><dd className="text-slate-300">Simulator</dd>
            <dt className="text-slate-500">Source size</dt><dd className="text-slate-300">{stats.width ? `${stats.width} × ${stats.height}` : '—'}</dd>
            <dt className="text-slate-500">Preview size</dt><dd className="text-slate-300">{PREVIEW_WIDTH} × {PREVIEW_HEIGHT}</dd>
            <dt className="text-slate-500">Preview rate</dt><dd className="text-slate-300">{paused || sourceError ? '0.0' : stats.fps.toFixed(1)} fps</dd>
            <dt className="text-slate-500">Copied frames</dt><dd className="text-slate-300" data-testid="phone-preview-frames">{stats.frames}</dd>
          </dl>
          <button type="button" disabled={Boolean(sourceError)} aria-pressed={paused}
            className="mt-3 min-h-11 rounded bg-slate-700 px-3 py-2 font-semibold text-slate-100 hover:bg-slate-600 disabled:opacity-50"
            onClick={() => setPaused((value) => !value)}>{paused ? 'Resume preview' : 'Pause preview'}</button>
        </div>
      </div>
    </section>
  );
}
