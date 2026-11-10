export function readCameraRoom() {
  const room = new URLSearchParams(window.location.search).get('cameraRoom');
  return /^[a-f0-9]{32}$/.test(room ?? '') ? room : null;
}

/** One-way video, with sender-created offers and fresh peer connections after each reconnect. */
export function connectPhoneCamera({ role, room, stream = null, onStatus, onStream = () => {}, onError }) {
  let stopped = false, socket, peer = null, session = null, candidates = [], remoteStream = null;
  let reconnectTimer, retryTimer, negotiationTimer;
  let backoff = 1000;
  const send = (message) => {
    if (!stopped && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ ...message, session }));
  };
  const resetPeer = () => {
    clearTimeout(retryTimer);
    clearTimeout(negotiationTimer);
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
  const createPeer = () => {
    resetPeer();
    const current = new RTCPeerConnection({ iceServers: [] }); // Same LAN; no external signaling or relay.
    peer = current;
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
      const current = createPeer();
      if (role === 'sender') {
        await current.setLocalDescription(await current.createOffer());
        if (peer === current) send({ type: 'offer', description: current.localDescription.toJSON() });
      }
      return;
    }
    const current = peer;
    if (!current || message.session !== session) return;
    if (message.type === 'ice') {
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
      send({ type: 'join', role, room });
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
  return () => {
    stopped = true;
    clearTimeout(reconnectTimer);
    resetPeer();
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      socket.close();
    }
  };
}
