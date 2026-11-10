import { useEffect, useRef, useState } from 'react';
import { connectPhoneCamera, readCameraRoom } from '../utils/phoneCameraConnection';

const PREVIEW_WIDTH = 640;
const PREVIEW_HEIGHT = 360;
const PREVIEW_HZ = 10;
const LINK_STATUS = { signaling: 'Connecting…', waiting: 'Waiting for phone', connecting: 'Connecting video…',
  connected: 'Connected', reconnecting: 'Reconnecting…', error: 'Connection error' };

/** Receives phone video, falling back to simulator frames when no camera client is connected. */
export default function PhoneCameraDebug({ sourceRef, sourceError }) {
  const canvasRef = useRef(null), videoRef = useRef(null), countRef = useRef(0);
  const [room] = useState(() => readCameraRoom() ?? crypto.randomUUID().replaceAll('-', ''));
  const [phoneOrigin, setPhoneOrigin] = useState(window.location.origin);
  const [stream, setStream] = useState(null);
  const [linkStatus, setLinkStatus] = useState(window.RTCPeerConnection ? 'signaling' : 'error');
  const [linkError, setLinkError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [paused, setPaused] = useState(false);
  const [stats, setStats] = useState({ frames: 0, fps: null, width: 0, height: 0, source: 'mock' });

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('cameraRoom', room);
    window.history.replaceState(null, '', url);
    const controller = new AbortController();
    if (['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) {
      fetch('/camera-config', { signal: controller.signal }).then((response) => response.json()).then(({ origins }) => {
        if (origins?.length) setPhoneOrigin(new URL(origins[0]).origin);
      }).catch(() => {});
    }
    return () => controller.abort();
  }, [room]);

  useEffect(() => {
    if (!window.RTCPeerConnection) return undefined;
    return connectPhoneCamera({ role: 'receiver', room, onStatus: setLinkStatus, onStream: setStream, onError: setLinkError });
  }, [room]);

  useEffect(() => {
    const video = videoRef.current;
    video.srcObject = stream;
    if (stream) video.play().catch(() => setLinkError('Phone video playback was blocked. Resume the preview to try again.'));
    return () => { video.srcObject = null; };
  }, [stream]);

  useEffect(() => {
    if (paused) return undefined;
    const context = canvasRef.current.getContext('2d');
    let frame, lastGrab = -Infinity, rateStart = performance.now(), rateFrames = 0, fps = null;
    const sample = (now) => {
      const video = videoRef.current;
      const phoneReady = stream && video.readyState >= 2 && video.videoWidth > 0;
      const source = phoneReady ? video : sourceError ? null : sourceRef.current;
      const width = phoneReady ? video.videoWidth : source?.width;
      const height = phoneReady ? video.videoHeight : source?.height;
      if (width && height && now - lastGrab >= 1000 / PREVIEW_HZ) {
        lastGrab = now;
        const scale = Math.min(PREVIEW_WIDTH / width, PREVIEW_HEIGHT / height);
        context.fillStyle = '#000';
        context.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
        context.drawImage(source, (PREVIEW_WIDTH - width * scale) / 2, (PREVIEW_HEIGHT - height * scale) / 2, width * scale, height * scale);
        countRef.current += 1;
        rateFrames += 1;
        if (now - rateStart >= 1000) {
          fps = rateFrames / ((now - rateStart) / 1000);
          rateStart = now;
          rateFrames = 0;
        }
        setStats({ frames: countRef.current, fps, width, height, source: phoneReady ? 'phone' : 'mock' });
      }
      frame = requestAnimationFrame(sample);
    };
    frame = requestAnimationFrame(sample);
    return () => cancelAnimationFrame(frame);
  }, [paused, sourceRef, sourceError, stream]);

  const live = Boolean(stream) && linkStatus === 'connected';
  const unavailable = !live && Boolean(sourceError);
  const displayedPhone = stats.source === 'phone';
  const phoneUrl = new URL('/', phoneOrigin);
  phoneUrl.search = new URLSearchParams({ scene: 'phone', cameraRoom: room }).toString();
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(phoneUrl.href); setCopyStatus('Copied'); }
    catch { setCopyStatus('Select and copy the link above.'); }
  };
  const togglePaused = () => {
    if (paused && stream) videoRef.current.play().catch(() => setLinkError('Could not play phone video. Try reconnecting the phone.'));
    setPaused((value) => !value);
  };

  return (
    <section className="mt-4 rounded-lg border border-slate-700 bg-slate-900 p-3 text-xs" aria-labelledby="phone-camera-debug-title">
      <video ref={videoRef} autoPlay muted playsInline className="hidden" aria-hidden="true" />
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 id="phone-camera-debug-title" className="font-bold uppercase tracking-wide text-slate-300">Phone camera preview</h2>
        <span className={`rounded border px-2 py-1 font-semibold ${live ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-amber-500/40 bg-amber-500/10 text-amber-300'}`}>
          {live ? 'Phone connected' : 'Mock fallback'}
        </span>
      </div>
      <p className="mb-3 text-slate-400">Connect a phone to see its camera here. Without a connected camera, the preview uses simulator frames.</p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative w-full overflow-hidden rounded border border-slate-800 bg-black sm:max-w-sm" style={{ aspectRatio: '16 / 9' }}>
          <canvas ref={canvasRef} width={PREVIEW_WIDTH} height={PREVIEW_HEIGHT} className="h-full w-full" aria-label="Phone camera preview with simulator fallback" />
          <span className="absolute left-2 top-2 rounded bg-slate-950/90 px-2 py-1 font-mono text-cyan-300" role="status">
            {paused ? 'Paused' : unavailable ? 'Unavailable' : displayedPhone ? 'Live phone video' : 'Mock · simulator frames'}
          </span>
          {(paused || unavailable) && <p className="absolute inset-x-0 bottom-0 bg-slate-950/90 p-2 text-slate-300">
            {paused ? 'Last frame held. Resume to refresh the preview.' : 'Simulator frames unavailable. Connect a phone to preview its camera.'}
          </p>}
        </div>
        <div className="min-w-0 flex-1">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 font-mono">
            <dt className="text-slate-500">Phone link</dt><dd className="text-slate-300" data-testid="phone-link-status">{LINK_STATUS[linkStatus]}</dd>
            <dt className="text-slate-500">Frame source</dt><dd className="text-slate-300" data-testid="phone-frame-source">{displayedPhone ? 'Phone camera' : 'Simulator'}</dd>
            <dt className="text-slate-500">Source size</dt><dd className="text-slate-300">{stats.width ? `${stats.width} × ${stats.height}` : '—'}</dd>
            <dt className="text-slate-500">Preview size</dt><dd className="text-slate-300">{PREVIEW_WIDTH} × {PREVIEW_HEIGHT}</dd>
            <dt className="text-slate-500">Preview rate</dt><dd className="text-slate-300">{paused || unavailable ? '0.0 fps' : stats.fps === null ? 'Measuring…' : `${stats.fps.toFixed(1)} fps`}</dd>
            <dt className="text-slate-500">Copied frames</dt><dd className="text-slate-300" data-testid="phone-preview-frames">{stats.frames}</dd>
          </dl>
          <button type="button" aria-pressed={paused} className="mt-3 min-h-11 rounded bg-slate-700 px-3 py-2 font-semibold text-slate-100 hover:bg-slate-600"
            onClick={togglePaused}>{paused ? 'Resume preview' : 'Pause preview'}</button>
        </div>
      </div>
      <div className="mt-3 rounded border border-slate-800 bg-slate-950/50 p-3">
        <label htmlFor="phone-camera-link" className="mb-2 block font-semibold text-slate-300">Open this link on your phone, then tap Start camera</label>
        <div className="flex flex-wrap gap-2">
          <input id="phone-camera-link" readOnly value={phoneUrl.href} onFocus={(event) => event.target.select()}
            className="min-h-11 min-w-0 flex-1 select-text rounded border border-slate-700 bg-slate-950 px-2 font-mono text-cyan-300" />
          <button type="button" onClick={copyLink} className="min-h-11 rounded bg-slate-700 px-3 font-semibold hover:bg-slate-600">Copy phone link</button>
        </div>
        {copyStatus && <p className="mt-2 text-slate-400" role="status">{copyStatus}</p>}
        <p className="mt-2 text-slate-500">Use the same Wi-Fi and accept or trust the laptop’s HTTPS certificate on the phone. Preview only; scored evaluation still uses the simulator.</p>
      </div>
      {(!window.RTCPeerConnection || linkError) && <p role="alert" className="mt-2 text-amber-300">{linkError || 'This browser does not support phone video streaming.'} The mock fallback remains available.</p>}
    </section>
  );
}
