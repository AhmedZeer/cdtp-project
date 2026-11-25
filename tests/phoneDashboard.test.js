import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultPhoneSetup } from '../src/utils/phoneVision.js';
import { readPhoneControl, readPhoneDashboard, summarizePhoneResult, DICTIONARY_LABELS, DASHBOARD_MAX_BYTES } from '../src/utils/phoneDashboard.js';
import { connectPhoneCamera } from '../src/utils/phoneCameraConnection.js';
import { createMarkerDetector } from '../src/utils/markerDetector.js';

function dashboard() {
  return { type: 'dashboard', source: 'phone', size: { width: 720, height: 1280 }, setup: defaultPhoneSetup(), setupRevision: 3,
    calibration: { state: 'collecting', progress: 0.5 }, markers: [{ id: 100, centre: { x: 150, y: 150 },
      corners: [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 200 }, { x: 100, y: 200 }] }],
    detectorMs: 12, ready: false, trackingFresh: true, motion: { state: 'not-tracked' }, run: null, lastResult: null };
}

test('phone dashboards retain source-pixel corners and reject malformed or non-phone snapshots', () => {
  const d = dashboard();
  assert.deepEqual(readPhoneDashboard(JSON.parse(JSON.stringify(d))), d);
  for (const bad of [null, {}, { ...d, source: 'simulator' }, { ...d, size: { width: 0, height: 1280 } },
    { ...d, setup: {} }, { ...d, detectorMs: undefined }, { ...d, calibration: {} }, { ...d, markers: [{ id: 1, corners: [] }] },
    { ...d, run: { elapsedS: 1 }, runTask: { id: 'invalid' } }]) assert.equal(readPhoneDashboard(bad), null);
});

test('phone controls accept Original ArUco ID 100, valid tasks and revisioned settings only', () => {
  assert.equal(DICTIONARY_LABELS.legacy, 'Original ArUco');
  const setup = defaultPhoneSetup();
  setup.family = 'legacy'; setup.ids.robot = 100;
  const control = { type: 'control', id: 'request-1', action: 'setup', revision: 3, setup };
  assert.deepEqual(readPhoneControl(control), control);
  assert.equal(readPhoneControl({ ...control, revision: -1 }), null);
  assert.equal(readPhoneControl({ ...control, setup: { family: 'legacy' } }), null);
  assert.equal(readPhoneControl({ ...control, setup: { ...setup, family: '5x5_100' } }), null);
  for (const action of ['recalibrate', 'end']) assert.equal(readPhoneControl({ type: 'control', id: 'r', action }).action, action);
  assert.equal(readPhoneControl({ type: 'control', id: 'r', action: 'start', task: { id: 'robot-guidance', direction: 'backward' } }).task.direction, 'backward');
  assert.equal(readPhoneControl({ type: 'control', id: 'r', action: 'start', task: { id: 'robot-guidance', direction: 'sideways' } }), null);
  assert.equal(readPhoneControl({ type: 'control', id: 'r', action: 'drive-robot' }), null);
});

test('phone result summaries omit raw evidence arrays while preserving verdicts and counts', () => {
  const sealed = { record: { task: { id: 'static-balance' }, frames: Array(300).fill({}), packets: Array(30).fill({}), durationS: 30, wallClock: 'test', endReason: 'completed' },
    result: { status: 'passed', points: 5, checks: [] }, digest: 'test-digest' };
  const summary = summarizePhoneResult(sealed);
  assert.equal(summary.frameCount, 300); assert.equal(summary.packetCount, 30);
  assert.deepEqual(summary.result, sealed.result);
  assert.equal(summary.frames, undefined); assert.equal(summary.record, undefined);
  assert.equal(summarizePhoneResult(null), null);
});

test('Original ArUco ID 100 from the supplied screenshot decodes with refined corners', () => {
  // Five payload rows transcribed from the supplied arucogen screenshot, not our codebook.
  const bits = ['10000', '10111', '01001', '10111', '10000'];
  const width = 400, height = 400, cell = 32, margin = 70;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
    if (x > 0 && y > 0 && x < 6 && y < 6 && bits[y - 1][x - 1] === '1') continue;
    for (let dy = 0; dy < cell; dy++) for (let dx = 0; dx < cell; dx++) {
      const i = ((margin + y * cell + dy) * width + margin + x * cell + dx) * 4;
      data[i] = data[i + 1] = data[i + 2] = 0;
    }
  }
  const markers = createMarkerDetector('legacy', { minPerimeterFraction: 0.03, refine: true }).detect({ width, height, data });
  assert.deepEqual(markers.map((m) => m.id), [100]);
});

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function connectionFixture(t, role = 'sender') {
  const original = { window: globalThis.window, WebSocket: globalThis.WebSocket, RTCPeerConnection: globalThis.RTCPeerConnection };
  const sockets = [], peers = [], received = [], channelStates = [];
  class Socket {
    static OPEN = 1;
    readyState = 1;
    sent = [];
    constructor() { sockets.push(this); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = 3; }
    receive(message) { this.onmessage({ data: JSON.stringify(message) }); }
  }
  class Channel {
    label = 'evaluation'; readyState = 'connecting'; bufferedAmount = 0; sent = [];
    open() { this.readyState = 'open'; this.onopen?.(); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = 'closed'; this.onclose?.(); }
    receive(message) { this.onmessage?.({ data: JSON.stringify(message) }); }
  }
  class Peer {
    connectionState = 'new';
    constructor() { peers.push(this); }
    createDataChannel() { this.channel = new Channel(); return this.channel; }
    addTrack() {}
    async createOffer() { return { type: 'offer' }; }
    async setLocalDescription(d) { this.localDescription = { ...d, toJSON: () => d }; }
    close() { this.connectionState = 'closed'; }
  }
  globalThis.window = { location: { href: 'https://laptop.test/?scene=phone' } };
  globalThis.WebSocket = Socket; globalThis.RTCPeerConnection = Peer;
  const connection = connectPhoneCamera({ role, room: 'a'.repeat(32), stream: { getVideoTracks: () => [{}] },
    onStatus: () => {}, onError: (error) => { if (error) throw new Error(error); }, onData: (data) => received.push(data), onDataStatus: (ready) => channelStates.push(ready) });
  t.after(() => {
    connection();
    for (const [key, value] of Object.entries(original)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  });
  sockets[0].onopen();
  return { connection, sockets, peers, received, channelStates, Channel };
}

test('paired data channel carries analysis and controls, rejects malformed packets, and drops old sessions', async (t) => {
  const f = connectionFixture(t);
  assert.equal(f.connection.sendData({ type: 'control' }), false);
  f.sockets[0].receive({ type: 'ready', session: 'first' }); await flush();
  const channel = f.peers[0].channel;
  channel.open();
  assert.equal(f.channelStates.at(-1), true);
  assert.equal(f.connection.sendData({ type: 'control', action: 'recalibrate' }), true);
  assert.equal(channel.sent[0].action, 'recalibrate');
  const snapshot = dashboard(); channel.receive(snapshot);
  assert.deepEqual(f.received, [snapshot]);
  channel.onmessage({ data: '{invalid json' });
  channel.onmessage({ data: 'x'.repeat(DASHBOARD_MAX_BYTES + 1) });
  assert.equal(f.received.length, 1);
  channel.bufferedAmount = DASHBOARD_MAX_BYTES + 1;
  assert.equal(f.connection.sendData(snapshot), false);
  channel.bufferedAmount = 0;
  assert.equal(f.connection.sendData({ data: 'x'.repeat(DASHBOARD_MAX_BYTES) }), false);
  const staleHandler = channel.onmessage;
  f.sockets[0].receive({ type: 'ready', session: 'second' }); await flush();
  assert.equal(channel.readyState, 'closed');
  staleHandler({ data: JSON.stringify(snapshot) });
  assert.equal(f.received.length, 1);
  const next = f.peers[1].channel; next.open(); next.receive(snapshot);
  assert.equal(f.received.length, 2);
  f.sockets[0].receive({ type: 'peer-left' }); await flush();
  assert.equal(f.channelStates.at(-1), false);
  assert.equal(f.connection.sendData(snapshot), false);
});

test('laptop accepts the phone data channel and can reply with synchronized analysis', async (t) => {
  const f = connectionFixture(t, 'receiver');
  f.sockets[0].receive({ type: 'ready', session: 'paired' }); await flush();
  const channel = new f.Channel();
  f.peers[0].ondatachannel({ channel }); channel.open();
  channel.receive({ type: 'control', action: 'end', id: 'r' });
  assert.equal(f.received[0].action, 'end');
  assert.equal(f.connection.sendData(dashboard()), true);
  assert.equal(channel.sent[0].setupRevision, 3);
});

test('phone receives marker corners over the pairing socket before the video peer reports connected', async (t) => {
  const f = connectionFixture(t);
  assert.equal(f.sockets[0].sent[0].dashboardRelay, true);
  f.sockets[0].receive({ type: 'ready', session: 'paired', dashboardRelay: true });
  await flush();
  assert.equal(f.peers[0].connectionState, 'new');
  assert.equal(f.peers[0].channel, undefined);
  assert.equal(f.channelStates.at(-1), true);

  const snapshot = dashboard();
  f.sockets[0].receive({ type: 'evaluation', session: 'old', data: snapshot });
  f.sockets[0].receive({ type: 'evaluation', session: 'paired', data: snapshot });
  await flush();
  assert.deepEqual(f.received.map(readPhoneDashboard), [snapshot]);

  const control = { type: 'control', id: 'recalibrate-1', action: 'recalibrate' };
  assert.equal(f.connection.sendData(control), true);
  assert.deepEqual(f.sockets[0].sent.at(-1), { type: 'evaluation', session: 'paired', data: control });

  f.sockets[0].receive({ type: 'peer-left' });
  await flush();
  assert.equal(f.channelStates.at(-1), false);
  assert.equal(f.connection.sendData(control), false);
});

test('laptop sends its analysis snapshots without waiting for a WebRTC data channel', async (t) => {
  const f = connectionFixture(t, 'receiver');
  f.sockets[0].receive({ type: 'ready', session: 'paired', dashboardRelay: true });
  await flush();
  const snapshot = dashboard();
  assert.equal(f.connection.sendData(snapshot), true);
  assert.deepEqual(f.sockets[0].sent.at(-1), { type: 'evaluation', session: 'paired', data: snapshot });
});
