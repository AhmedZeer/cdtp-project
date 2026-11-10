import { useEffect, useRef, useState } from 'react';
import { connectPhoneCamera, readCameraRoom } from '../utils/phoneCameraConnection';

const STATUS = { idle: 'Camera off', requesting: 'Requesting camera access…', signaling: 'Connecting to laptop…',
  waiting: 'Camera ready · waiting for laptop', connecting: 'Connecting video…', connected: 'Streaming to laptop',
  reconnecting: 'Reconnecting to laptop…', error: 'Connection needs attention' };

export default function PhoneCameraSender() {
  const [room] = useState(readCameraRoom);
  const videoRef = useRef(null), streamRef = useRef(null), connectionRef = useRef(null);
  const requestRef = useRef(0);
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [resolution, setResolution] = useState('');

  const stop = () => {
    requestRef.current += 1;
    connectionRef.current?.();
    connectionRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false);
    setStatus('idle');
    setResolution('');
  };

  useEffect(() => {
    const cleanup = () => {
      requestRef.current += 1;
      connectionRef.current?.();
      connectionRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
    const hide = () => { cleanup(); setActive(false); setStatus('idle'); setResolution(''); };
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
      const settings = track.getSettings();
      setResolution(`${settings.width} × ${settings.height}`);
      track.onended = () => { stop(); setError('The camera stopped. Tap Start camera to try again.'); };
      connectionRef.current = connectPhoneCamera({ role: 'sender', room, stream, onStatus: setStatus, onError: setError });
    } catch (cause) {
      if (request !== requestRef.current) return;
      stop();
      setError(cause.name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access in the browser, then try again.'
        : cause.name === 'NotFoundError' ? 'No camera was found on this device.' : `Could not start the camera: ${cause.message}`);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-4 p-4 text-slate-100">
      <header>
        <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-cyan-400">Phone → laptop</p>
        <h1 className="text-xl font-bold">Phone camera</h1>
        <p className="mt-2 text-sm text-slate-400">Point the rear camera at the robot and markers. Keep this page open while streaming.</p>
      </header>
      <div className="relative overflow-hidden rounded-xl border border-slate-700 bg-black" style={{ aspectRatio: '3 / 4' }}>
        <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-contain" aria-label="Phone rear camera" />
        {!active && <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-slate-400">Your camera preview will appear here.</div>}
        <p className="absolute left-3 top-3 rounded bg-slate-950/90 px-3 py-2 text-xs font-semibold text-cyan-300" role="status">{STATUS[status]}</p>
      </div>
      {!room && <p className="rounded border border-amber-600/50 bg-amber-900/20 p-3 text-sm text-amber-200">Open the phone link shown in the laptop’s simulator to pair with its preview.</p>}
      {error && <p role="alert" className="rounded border border-red-700 bg-red-950/50 p-3 text-sm text-red-200">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={!room} onClick={active || status === 'requesting' ? stop : start}
          className="min-h-12 rounded-lg bg-cyan-700 px-5 py-3 font-semibold hover:bg-cyan-600 disabled:opacity-40">
          {status === 'requesting' ? 'Cancel camera request' : active ? 'Stop camera' : 'Start camera'}
        </button>
        {resolution && <span className="font-mono text-xs text-slate-400">{resolution} · video only</span>}
      </div>
      <p className="text-xs text-slate-500">Both devices must be on the same network. Stopping the camera releases it and restores the mock preview on the laptop.</p>
    </main>
  );
}
