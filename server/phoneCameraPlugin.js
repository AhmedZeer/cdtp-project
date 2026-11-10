import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';

/** A room holds one phone and one laptop. Video travels over WebRTC, not this socket. */
export function attachCameraSignaling(httpServer) {
  let closed = false;
  const rooms = new Map();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  const send = (client, message) => {
    if (client?.readyState === WebSocket.OPEN) client.send(JSON.stringify(message));
  };
  const upgrade = (request, socket, head) => {
    if (request.url?.split('?')[0] !== '/camera-signal') return;
    // Accept browser connections from the origin serving this app only.
    if (request.headers.origin !== `${request.socket.encrypted ? 'https' : 'http'}://${request.headers.host}`) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    wss.handleUpgrade(request, socket, head, (client) => wss.emit('connection', client));
  };
  httpServer.on('upgrade', upgrade);

  wss.on('connection', (client) => {
    let room, role, roomId;
    let alive = true;
    const joinedWithin = setTimeout(() => client.close(1008, 'Join a camera room first.'), 10000);
    client.on('pong', () => { alive = true; });
    client.isAlive = () => alive;
    client.markPing = () => { alive = false; };
    client.on('error', () => {}); // close handles cleanup, including interrupted network connections
    client.on('message', (raw) => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { client.close(1008, 'Invalid camera message.'); return; }
      if (!message || typeof message !== 'object') { client.close(1008, 'Invalid camera message.'); return; }
      if (!room) {
        if (message.type !== 'join' || !['sender', 'receiver'].includes(message.role) || !/^[a-f0-9]{32}$/.test(message.room)) {
          client.close(1008, 'Invalid camera room.'); return;
        }
        roomId = message.room;
        role = message.role;
        room = rooms.get(roomId) ?? { sender: null, receiver: null, session: null };
        if (room[role]) { room = null; client.close(1008, `A ${role} is already connected to this camera room.`); return; }
        clearTimeout(joinedWithin);
        rooms.set(roomId, room);
        room[role] = client;
        send(client, { type: 'joined' });
        if (room.sender && room.receiver) {
          room.session = randomUUID();
          for (const peer of [room.sender, room.receiver]) send(peer, { type: 'ready', session: room.session });
        }
        return;
      }
      if (!room.session || message.session !== room.session) return;
      if (message.type === 'retry') {
        room.session = randomUUID();
        for (const peer of [room.sender, room.receiver]) send(peer, { type: 'ready', session: room.session });
        return;
      }
      if (!['offer', 'answer', 'ice'].includes(message.type)) return;
      if (message.type === 'offer' && role !== 'sender') return;
      if (message.type === 'answer' && role !== 'receiver') return;
      send(room[role === 'sender' ? 'receiver' : 'sender'], {
        type: message.type, session: room.session,
        ...(message.type === 'ice' ? { candidate: message.candidate } : { description: message.description }),
      });
    });
    client.on('close', () => {
      clearTimeout(joinedWithin);
      if (!room || room[role] !== client) return;
      room[role] = null;
      room.session = null;
      send(room[role === 'sender' ? 'receiver' : 'sender'], { type: 'peer-left' });
      if (!room.sender && !room.receiver) rooms.delete(roomId);
    });
  });
  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (!client.isAlive()) client.terminate();
      else { client.markPing(); client.ping(); }
    }
  }, 10000);
  heartbeat.unref();

  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    httpServer.off('upgrade', upgrade);
    httpServer.off('close', close);
    for (const client of wss.clients) client.terminate();
    wss.close();
  };
  httpServer.once('close', close);
  return close;
}

export default function phoneCameraPlugin() {
  const cleanups = new Set();
  const configure = (server) => {
    if (!server.httpServer) return;
    cleanups.add(attachCameraSignaling(server.httpServer));
    server.middlewares.use('/camera-config', (_request, response) => {
      response.setHeader('Content-Type', 'application/json');
      response.setHeader('Cache-Control', 'no-store');
      response.end(JSON.stringify({ origins: server.resolvedUrls?.network ?? [] }));
    });
  };
  const close = () => { for (const cleanup of cleanups) cleanup(); cleanups.clear(); };
  return { name: 'phone-camera', configureServer: configure, configurePreviewServer: configure, closeBundle: close, closePreviewServer: close };
}
