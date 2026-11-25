import { DASHBOARD_MAX_BYTES } from './phoneDashboard.js';

export function readCameraRoom() {
  const room = new URLSearchParams(window.location.search).get('cameraRoom');
  return /^[a-f0-9]{32}$/.test(room ?? '') ? room : null;
}

/** One-way video, with sender-created offers and fresh peer connections after each reconnect. */
export function connectPhoneCamera({ role, room, stream = null, onStatus, onStream = () => {}, onError, onData = () => {}, onDataStatus = () => {} }) {
  let stopped = false, socket, channel = null, peer = null, session = null, candidates = [], remoteStream = null;
  let reconnectTimer, retryTimer, negotiationTimer, dashboardRelay = false;
  let backoff = 1000;
  const send = (message) => {
    if (!stopped && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ ...message, session }));
  };
  const bindChannel = (next) => {
    if (next.label !== 'evaluation') { next.close(); return; }
    channel = next;
    next.onopen = () => { if (!stopped && channel === next) onDataStatus(true); };
    next.onclose = next.onerror = () => { if (channel === next) onDataStatus(false); };
    next.onmessage = ({ data }) => {
      if (stopped || channel !== next || typeof data !== 'string' || data.length > DASHBOARD_MAX_BYTES) return;
      let message;
      try { message = JSON.parse(data); } catch { return; }
      onData(message);
    };
  };
  const resetPeer = () => {
    clearTimeout(retryTimer);
    clearTimeout(negotiationTimer);
    const previousChannel = channel;
    channel = null;
    dashboardRelay = false;
    onDataStatus(false);
    if (previousChannel) {
      previousChannel.onopen = previousChannel.onclose = previousChannel.onerror = previousChannel.onmessage = null;
      previousChannel.close();
    }
    const previous = peer;
    peer = null;
    previous?.close();
    candidates = [];
    remoteStream = null;
    onStream(null);
  };
  const retry = () => {
    clearTimeout(retryTimer);
    onStream(null);
    onStatus('reconnecting');
    // Only the phone requests retries, avoiding competing negotiations.
    if (role === 'sender') retryTimer = setTimeout(() => send({ type: 'retry' }), 1500);
  };
  const createPeer = (relay) => {
    resetPeer();
    dashboardRelay = relay;
    const current = new RTCPeerConnection({ iceServers: [] }); // Same LAN; no external signaling or relay.
    peer = current;
    if (!dashboardRelay) {
      if (role === 'sender') bindChannel(current.createDataChannel('evaluation', { ordered: true }));
      else current.ondatachannel = ({ channel: incoming }) => { if (peer === current) bindChannel(incoming); };
    }
    onError('');
    onStatus('connecting');
    current.onicecandidate = ({ candidate }) => {
      if (peer === current && candidate) send({ type: 'ice', candidate: candidate.toJSON() });
    };
    current.ontrack = ({ streams, track }) => {
      if (peer !== current) return;
      remoteStream = streams[0] ?? new MediaStream([track]);
      if (current.connectionState === 'connected') onStream(remoteStream);
    };
    current.onconnectionstatechange = () => {
      if (stopped || peer !== current) return;
      if (current.connectionState === 'connected') {
        clearTimeout(retryTimer);
        clearTimeout(negotiationTimer);
        onStatus('connected');
        if (remoteStream) onStream(remoteStream);
      } else if (['failed', 'disconnected'].includes(current.connectionState)) retry();
    };
    negotiationTimer = setTimeout(() => {
      if (peer !== current || current.connectionState === 'connected') return;
      onError('The phone video could not connect. Check both devices are on the same network; retrying.');
      retry();
    }, 15000);
    if (role === 'sender') for (const track of stream.getVideoTracks()) current.addTrack(track, stream);
    return current;
  };
  const handle = async (message) => {
    if (message.type === 'joined') { onStatus('waiting'); return; }
    if (message.type === 'peer-left') { session = null; resetPeer(); onError(''); onStatus('waiting'); return; }
    if (message.type === 'ready') {
      session = message.session;
      const current = createPeer(message.dashboardRelay === true);
      if (dashboardRelay) onDataStatus(true);
      if (role === 'sender') {
        await current.setLocalDescription(await current.createOffer());
        if (peer === current) send({ type: 'offer', description: current.localDescription.toJSON() });
      }
      return;
    }
    const current = peer;
    if (!current || message.session !== session) return;
    if (message.type === 'evaluation') {
      if (dashboardRelay) onData(message.data);
    } else if (message.type === 'ice') {
      if (current.remoteDescription) await current.addIceCandidate(message.candidate);
      else candidates.push(message.candidate);
    } else if (message.type === 'offer' || message.type === 'answer') {
      await current.setRemoteDescription(message.description);
      if (peer !== current) return;
      for (const candidate of candidates) await current.addIceCandidate(candidate);
      candidates = [];
      if (role === 'receiver' && message.type === 'offer') {
        await current.setLocalDescription(await current.createAnswer());
        if (peer === current) send({ type: 'answer', description: current.localDescription.toJSON() });
      }
    }
  };
  const connect = () => {
    if (stopped) return;
    onStatus('signaling');
    const url = new URL('/camera-signal', window.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const currentSocket = new WebSocket(url);
    socket = currentSocket;
    let messages = Promise.resolve();
    currentSocket.onopen = () => {
      backoff = 1000;
      onError('');
      send({ type: 'join', role, room, dashboardRelay: true });
    };
    currentSocket.onmessage = ({ data }) => {
      messages = messages.then(() => {
        if (stopped || socket !== currentSocket) return;
        return handle(JSON.parse(data));
      }).catch((error) => {
        if (stopped || socket !== currentSocket) return;
        onError(`Camera connection: ${error.message}`);
        retry();
      });
    };
    currentSocket.onerror = () => onError('Camera signaling is unavailable. Reconnecting…');
    currentSocket.onclose = (event) => {
      if (stopped || socket !== currentSocket) return;
      session = null;
      resetPeer();
      if (event.code === 1008) { onStatus('error'); onError(event.reason); return; }
      onStatus('reconnecting');
      reconnectTimer = setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 5000);
    };
  };
  connect();
  const close = () => {
    stopped = true;
    clearTimeout(reconnectTimer);
    resetPeer();
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      socket.close();
    }
  };
  close.sendData = (message) => {
    const transport = dashboardRelay ? socket : channel;
    const openState = dashboardRelay ? WebSocket.OPEN : 'open';
    if (stopped || !session || transport?.readyState !== openState || transport.bufferedAmount > DASHBOARD_MAX_BYTES) return false;
    const data = JSON.stringify(dashboardRelay ? { type: 'evaluation', session, data: message } : message);
    if (new TextEncoder().encode(data).length > DASHBOARD_MAX_BYTES) return false;
    try { transport.send(data); return true; } catch { return false; }
  };
  return close;
}
