import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import WebSocket from 'ws';
import { attachCameraSignaling } from '../server/phoneCameraPlugin.js';

const ROOM = 'a'.repeat(32);

async function fixture(t) {
  const server = createServer();
  const close = attachCameraSignaling(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { close(); server.close(); await once(server, 'close'); });
  const connect = async (role, room = ROOM) => {
    const socket = new WebSocket(`${origin.replace('http:', 'ws:')}/camera-signal`, { origin });
    const queue = [], waiting = [];
    socket.on('message', (data) => {
      const message = JSON.parse(data);
      const index = waiting.findIndex((waiter) => waiter.type === message.type);
      if (index < 0) queue.push(message);
      else { const [waiter] = waiting.splice(index, 1); clearTimeout(waiter.timer); waiter.resolve(message); }
    });
    const next = (type) => {
      const index = queue.findIndex((message) => message.type === type);
      if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { type, resolve, timer: setTimeout(() => reject(new Error(`No ${type} message`)), 2000) };
        waiting.push(waiter);
      });
    };
    await once(socket, 'open');
    const send = (message) => socket.send(JSON.stringify(message));
    send({ type: 'join', role, room });
    return { socket, send, next, queue };
  };
  return { origin, connect };
}

test('camera signaling pairs one phone with its laptop and isolates other rooms', async (t) => {
  const { connect } = await fixture(t);
  const laptop = await connect('receiver'), other = await connect('receiver', 'b'.repeat(32));
  await laptop.next('joined'); await other.next('joined');
  const phone = await connect('sender');
  const { session } = await laptop.next('ready');
  assert.equal((await phone.next('ready')).session, session);
  const description = { type: 'offer', sdp: 'phone offer' };
  phone.send({ type: 'offer', session, description });
  assert.deepEqual((await laptop.next('offer')).description, description);
  laptop.send({ type: 'answer', session, description: { type: 'answer', sdp: 'laptop answer' } });
  assert.equal((await phone.next('answer')).description.sdp, 'laptop answer');
  phone.send({ type: 'ice', session, candidate: { candidate: 'test candidate' } });
  assert.equal((await laptop.next('ice')).candidate.candidate, 'test candidate');
  assert.deepEqual(other.queue, []);
});

test('leaving restores waiting state; rejoining starts a fresh session and drops stale signals', async (t) => {
  const { connect } = await fixture(t);
  const laptop = await connect('receiver'), phone = await connect('sender');
  const first = await laptop.next('ready');
  const left = laptop.next('peer-left');
  phone.socket.close();
  await left;
  const replacement = await connect('sender');
  const next = await laptop.next('ready');
  assert.notEqual(next.session, first.session);
  replacement.send({ type: 'offer', session: first.session, description: { sdp: 'stale' } });
  replacement.send({ type: 'offer', session: next.session, description: { sdp: 'fresh' } });
  assert.equal((await laptop.next('offer')).description.sdp, 'fresh');
  replacement.send({ type: 'retry', session: next.session });
  assert.notEqual((await laptop.next('ready')).session, next.session);
});

test('a second sender is refused without disconnecting the existing pair', async (t) => {
  const { connect } = await fixture(t);
  const laptop = await connect('receiver'), phone = await connect('sender');
  const { session } = await laptop.next('ready');
  const duplicate = await connect('sender');
  const [code] = await once(duplicate.socket, 'close');
  assert.equal(code, 1008);
  phone.send({ type: 'offer', session, description: { sdp: 'original phone still connected' } });
  assert.equal((await laptop.next('offer')).description.sdp, 'original phone still connected');
});

test('invalid pairing rooms and cross-origin socket connections are refused', async (t) => {
  const { origin, connect } = await fixture(t);
  const invalid = await connect('sender', 'not-a-room');
  assert.equal((await once(invalid.socket, 'close'))[0], 1008);
  const socket = new WebSocket(`${origin.replace('http:', 'ws:')}/camera-signal`, { origin: 'https://unrelated.example' });
  socket.on('error', () => {});
  const [, response] = await once(socket, 'unexpected-response');
  assert.equal(response.statusCode, 403);
  socket.terminate();
});
