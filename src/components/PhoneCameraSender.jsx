import { useEffect, useRef, useState } from 'react';
import { connectPhoneCamera, readCameraRoom } from '../utils/phoneCameraConnection';
import { DICTIONARY_LABELS, readPhoneDashboard } from '../utils/phoneDashboard';
import DetectionOverlay from './DetectionOverlay';
import { useImagePixelsPerScreenPixel } from '../hooks/useImageScale';
import { phoneSetupError } from '../utils/phoneVision';
import { LiveStatusBar } from './EvaluationPanel';
import { PhoneCalibration, PhoneDetections, PhoneSetupEditor, PhoneTestControls } from './PhoneDashboardPanels';

const STATUS = { idle: 'Camera off', requesting: 'Requesting camera access…', signaling: 'Connecting to laptop…',
  waiting: 'Camera ready · waiting for laptop', connecting: 'Connecting video…', connected: 'Streaming to laptop',
  reconnecting: 'Reconnecting to laptop…', error: 'Connection needs attention' };

export default function PhoneCameraSender() {
  const [room] = useState(readCameraRoom);
  const videoRef = useRef(null), streamRef = useRef(null), connectionRef = useRef(null);
  const requestRef = useRef(0), dashboardAtRef = useRef(-Infinity), pendingRef = useRef(null);
  const viewRef = useRef(null);
  const [dashboard, setDashboard] = useState(null);
  const [dataConnected, setDataConnected] = useState(false);
  const [dataAge, setDataAge] = useState(Infinity);
  const [showFrames, setShowFrames] = useState(true);
  const [pending, setPending] = useState(false), [controlNotice, setControlNotice] = useState('');
  const [cameraStats, setCameraStats] = useState({ width: 0, height: 0, frames: 0, fps: null });
  const unit = useImagePixelsPerScreenPixel(viewRef, dashboard?.size.width ?? 1920);
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const fresh = active && dataConnected && dashboard && dataAge < 2000;
  const frames = fresh && dashboard.trackingFresh ? dashboard.markers : [];
  const clearPending = () => {
    clearTimeout(pendingRef.current?.timer);
    pendingRef.current = null;
    setPending(false);
  };
  const onData = (message) => {
    const next = readPhoneDashboard(message);
    if (next) {
      dashboardAtRef.current = performance.now();
      setDashboard(next);
      setDataAge(0);
    } else if (message?.type === 'control-result' && message.id === pendingRef.current?.id) {
      clearPending();
      setControlNotice(message.ok ? 'Updated on the laptop.' : message.error || 'The laptop could not apply this change.');
    }
  };
  const onDashboardStatus = (connected) => {
    setDataConnected(connected);
    if (!connected) { dashboardAtRef.current = -Infinity; setDataAge(Infinity); }
  };
  const sendControl = (action) => {
    if (!fresh || pendingRef.current) return;
    if (action.action === 'setup' && phoneSetupError(action.setup)) { setControlNotice(phoneSetupError(action.setup)); return; }
    const id = crypto.randomUUID();
    if (!connectionRef.current?.sendData({ type: 'control', id, ...action })) {
      setControlNotice('Controls are disconnected. Wait for the laptop connection.');
      return;
    }
    setControlNotice('Waiting for the laptop…');
    setPending(true);
    pendingRef.current = { id, timer: setTimeout(() => {
      pendingRef.current = null;
      setPending(false);
      setControlNotice('The laptop did not confirm this action. Check its current state before trying again.');
    }, 5000) };
  };

  useEffect(() => {
    let previousFrames = 0, previousAt = performance.now();
    const timer = setInterval(() => {
      const now = performance.now(), video = videoRef.current;
      setDataAge(now - dashboardAtRef.current);
      if (!video?.videoWidth || !streamRef.current) return;
      const frames = video.getVideoPlaybackQuality?.().totalVideoFrames ?? 0;
      setCameraStats({ width: video.videoWidth, height: video.videoHeight, frames,
        fps: frames > previousFrames ? (frames - previousFrames) * 1000 / (now - previousAt) : null });
      previousFrames = frames; previousAt = now;
    }, 500);
    return () => clearInterval(timer);
  }, []);

  const stop = () => {
    requestRef.current += 1;
    connectionRef.current?.();
    connectionRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false);
    setStatus('idle');
    dashboardAtRef.current = -Infinity;
    setDashboard(null);
    clearPending();
    setControlNotice('');
  };

  useEffect(() => {
    const cleanup = () => {
      requestRef.current += 1;
      clearTimeout(pendingRef.current?.timer);
      pendingRef.current = null;
      connectionRef.current?.();
      connectionRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
    const hide = () => { cleanup(); setActive(false); setStatus('idle'); setDashboard(null); setPending(false); dashboardAtRef.current = -Infinity; };
    window.addEventListener('pagehide', hide);
    return () => { window.removeEventListener('pagehide', hide); cleanup(); };
  }, []);

  const start = async () => {
    if (!room) return;
    setError('');
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError('Open the phone link over HTTPS and accept or trust the laptop certificate to enable the camera.');
      return;
    }
    if (!window.RTCPeerConnection) { setError('This browser does not support video streaming.'); return; }
    const request = ++requestRef.current;
    setStatus('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 30 } } });
      if (request !== requestRef.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      streamRef.current = stream;
      setActive(true);
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      if (request !== requestRef.current) return;
      const track = stream.getVideoTracks()[0];
      track.onended = () => { stop(); setError('The camera stopped. Tap Start camera to try again.'); };
      connectionRef.current = connectPhoneCamera({ role: 'sender', room, stream, onStatus: setStatus, onError: setError, onData, onDataStatus: onDashboardStatus });
    } catch (cause) {
      if (request !== requestRef.current) return;
      stop();
      setError(cause.name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access in the browser, then try again.'
        : cause.name === 'NotFoundError' ? 'No camera was found on this device.' : `Could not start the camera: ${cause.message}`);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-3 bg-slate-950 p-3 pb-8 text-slate-100">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="text-xs font-semibold uppercase tracking-widest text-cyan-400">Phone + laptop</p><h1 className="text-xl font-bold">Camera evaluation</h1></div>
        <span className={`rounded-full border px-3 py-1 text-xs ${fresh ? 'border-emerald-700 text-emerald-300' : 'border-slate-600 text-slate-400'}`}>{fresh ? 'Analysis connected' : 'Waiting for laptop analysis'}</span>
      </header>
      <div ref={viewRef} className="relative isolate mx-auto w-full overflow-hidden rounded-xl border border-slate-700 bg-black"
        style={{ aspectRatio: `${cameraStats.width || 3} / ${cameraStats.height || 4}`, maxWidth: cameraStats.width ? `${70 * cameraStats.width / cameraStats.height}svh` : undefined }}>
        <video ref={videoRef} autoPlay muted playsInline className="absolute inset-0 z-0 h-full w-full object-contain" aria-label="Phone rear camera with marker frames" />
        {active && showFrames && <DetectionOverlay markers={frames} unit={unit} width={(dashboard?.size.width ?? cameraStats.width) || 1920} height={(dashboard?.size.height ?? cameraStats.height) || 1080} />}
        {!active && <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-slate-400">Start the rear camera to stream and inspect markers.</div>}
        <p className="absolute left-2 top-2 z-20 rounded bg-slate-950/90 px-2 py-1 text-xs font-semibold text-cyan-300" role="status">{STATUS[status]}</p>
        {active && <p className="absolute bottom-2 left-2 z-20 rounded bg-slate-950/90 px-2 py-1 text-xs">{fresh ? `${frames.length} markers · ${DICTIONARY_LABELS[dashboard.setup.family]}` : 'Camera live · analysis unavailable'}</p>}
      </div>
      {!room && <p className="rounded border border-amber-600/50 bg-amber-900/20 p-3 text-sm text-amber-200">Open the phone link shown on the laptop to pair with its evaluation session.</p>}
      {error && <p role="alert" className="rounded border border-red-700 bg-red-950/50 p-3 text-sm text-red-200">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" disabled={!room} onClick={active || status === 'requesting' ? stop : start}
          className="min-h-12 rounded-lg bg-cyan-700 px-5 py-3 font-semibold hover:bg-cyan-600 disabled:opacity-40">
          {status === 'requesting' ? 'Cancel camera request' : active ? 'Stop camera' : 'Start camera'}
        </button>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={showFrames} onChange={(e) => setShowFrames(e.target.checked)} /> Show marker frames</label>
      </div>
      {active && <p className="font-mono text-xs text-slate-400">{cameraStats.width || '—'} × {cameraStats.height || '—'} · {cameraStats.frames} camera frames · {cameraStats.fps === null ? '—' : cameraStats.fps.toFixed(1)} fps{fresh ? ` · detection ${dashboard.detectorMs.toFixed(0)} ms` : ''}</p>}
      {controlNotice && <p role="status" className="rounded bg-slate-800 p-3 text-sm text-cyan-200">{controlNotice}</p>}
      {dashboard && active ? <>
        {!fresh && <p className="rounded border border-amber-700 p-3 text-sm text-amber-300">Laptop analysis is disconnected or delayed. Marker frames are hidden and controls are locked until fresh measurements arrive.</p>}
        <fieldset disabled={!fresh || pending || Boolean(dashboard.run)} className="rounded-xl border border-slate-700 bg-slate-900 p-3 disabled:opacity-50">
          <label className="block text-sm font-semibold">Marker dictionary
            <select className="mt-2 min-h-12 w-full rounded border border-slate-600 bg-slate-950 p-2" value={dashboard.setup.family}
              onChange={(e) => sendControl({ action: 'setup', revision: dashboard.setupRevision, setup: { ...dashboard.setup, family: e.target.value } })}>
              {Object.entries(DICTIONARY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </fieldset>
        <PhoneDetections markers={frames} />
        <div className={!fresh ? 'opacity-50' : ''}>
          <LiveStatusBar motion={fresh ? dashboard.motion : { state: 'not-tracked' }} telemetry={fresh ? dashboard.telemetry : null} linkSilenceS={fresh ? dashboard.linkSilenceS : null} run={dashboard.run} />
        </div>
        <PhoneCalibration dashboard={dashboard} disabled={!fresh || pending} onControl={sendControl} />
        <details className="rounded-xl border border-slate-700 bg-slate-900 p-3">
          <summary className="min-h-8 cursor-pointer text-sm font-semibold">Marker roles and physical setup</summary>
          <div className="mt-3"><PhoneSetupEditor key={dashboard.setupRevision} setup={dashboard.setup} revision={dashboard.setupRevision} markers={frames} disabled={!fresh || pending} locked={Boolean(dashboard.run)} onControl={sendControl} /></div>
        </details>
        <PhoneTestControls dashboard={dashboard} disabled={!fresh || pending} onControl={sendControl} />
      </> : <p className="text-sm text-slate-400">Keep the laptop evaluation page open. Its marker frames, calibration, measurements and test controls will appear here when connected. Use the same Wi-Fi and keep this page visible.</p>}
      <p className="text-xs text-slate-500">The laptop analyzes the streamed frames. Stopping the camera ends an active test and resumes the simulator.</p>
    </main>
  );
}
