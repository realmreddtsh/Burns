import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import express from 'express';
import { WebSocketServer } from 'ws';

import { ROOMS, ROOM_IDS, buildInitialHistory } from './rooms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const HISTORY_LIMIT = 120;
const MAX_MESSAGE_LENGTH = 800;
const MAX_NAME_LENGTH = 24;

const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

app.get('/api/rooms', (_req, res) => res.json({ rooms: ROOMS }));
app.get('/api/health', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

/** @type {Record<string, any[]>} */
const history = buildInitialHistory();
/** @type {Map<import('ws').WebSocket, {id:string,name:string,room:string,alive:boolean,typingUntil:number}>} */
const clients = new Map();

const clean = (value, max) =>
  String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, max);

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

function broadcast(roomId, payload, { except } = {}) {
  for (const [ws, state] of clients) {
    if (state.room !== roomId || ws === except) continue;
    send(ws, payload);
  }
}

function broadcastAll(payload) {
  for (const ws of clients.keys()) send(ws, payload);
}

function record(roomId, entry) {
  const list = history[roomId] || (history[roomId] = []);
  list.push(entry);
  if (list.length > HISTORY_LIMIT) list.splice(0, list.length - HISTORY_LIMIT);
}

function occupants(roomId) {
  const names = [];
  for (const state of clients.values()) {
    if (state.room === roomId) names.push({ id: state.id, name: state.name });
  }
  return names;
}

function roomCounts() {
  const counts = Object.fromEntries(ROOMS.map((r) => [r.id, 0]));
  for (const state of clients.values()) {
    if (counts[state.room] !== undefined) counts[state.room] += 1;
  }
  return counts;
}

function pushPresence(roomId) {
  broadcast(roomId, { type: 'presence', room: roomId, people: occupants(roomId) });
  broadcastAll({ type: 'counts', counts: roomCounts() });
}

function typingNames(roomId, excludeId) {
  const now = Date.now();
  const names = [];
  for (const state of clients.values()) {
    if (state.room === roomId && state.id !== excludeId && state.typingUntil > now) names.push(state.name);
  }
  return names;
}

function pushTyping(roomId) {
  for (const [ws, state] of clients) {
    if (state.room !== roomId) continue;
    send(ws, { type: 'typing', room: roomId, names: typingNames(roomId, state.id) });
  }
}

function systemMessage(roomId, text) {
  const entry = { id: randomUUID(), type: 'system', room: roomId, text, at: Date.now() };
  record(roomId, entry);
  broadcast(roomId, entry);
}

function uniqueName(requested, selfId) {
  let base = clean(requested, MAX_NAME_LENGTH) || 'Guest';
  const taken = new Set(
    [...clients.values()].filter((s) => s.id !== selfId).map((s) => s.name.toLowerCase()),
  );
  if (!taken.has(base.toLowerCase())) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`.toLowerCase())) n += 1;
  return `${base} ${n}`;
}

function joinRoom(ws, state, nextRoomId) {
  const roomId = ROOM_IDS.has(nextRoomId) ? nextRoomId : ROOMS[0].id;
  const previous = state.room;
  if (previous === roomId) return;

  state.room = roomId;
  state.typingUntil = 0;

  send(ws, {
    type: 'history',
    room: roomId,
    messages: history[roomId] || [],
    people: occupants(roomId),
  });

  if (previous) {
    systemMessage(previous, `${state.name} left the room`);
    pushPresence(previous);
    pushTyping(previous);
  }
  systemMessage(roomId, `${state.name} joined the room`);
  pushPresence(roomId);
  pushTyping(roomId);
}

wss.on('connection', (ws) => {
  const state = { id: randomUUID(), name: '', room: '', alive: true, typingUntil: 0 };
  clients.set(ws, state);

  send(ws, { type: 'welcome', you: state.id, rooms: ROOMS, counts: roomCounts() });

  ws.on('pong', () => {
    state.alive = true;
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString().slice(0, 4000));
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== 'string') return;

    switch (msg.type) {
      case 'hello': {
        state.name = uniqueName(msg.name, state.id);
        send(ws, { type: 'identity', id: state.id, name: state.name });
        joinRoom(ws, state, msg.room);
        break;
      }

      case 'join': {
        if (!state.name) return;
        joinRoom(ws, state, msg.room);
        break;
      }

      case 'rename': {
        if (!state.name) return;
        const previous = state.name;
        const next = uniqueName(msg.name, state.id);
        if (next === previous) return;
        state.name = next;
        send(ws, { type: 'identity', id: state.id, name: next });
        if (state.room) {
          systemMessage(state.room, `${previous} is now known as ${next}`);
          pushPresence(state.room);
        }
        break;
      }

      case 'message': {
        if (!state.name || !state.room) return;
        const text = clean(msg.text, MAX_MESSAGE_LENGTH);
        if (!text) return;
        const entry = {
          id: randomUUID(),
          type: 'message',
          room: state.room,
          author: state.name,
          authorId: state.id,
          text,
          at: Date.now(),
        };
        record(state.room, entry);
        broadcast(state.room, entry);
        state.typingUntil = 0;
        pushTyping(state.room);
        break;
      }

      case 'typing': {
        if (!state.name || !state.room) return;
        state.typingUntil = msg.active ? Date.now() + 4000 : 0;
        pushTyping(state.room);
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => {
    const { room, name } = state;
    clients.delete(ws);
    if (room && name) {
      systemMessage(room, `${name} left the room`);
      pushPresence(room);
      pushTyping(room);
    } else {
      broadcastAll({ type: 'counts', counts: roomCounts() });
    }
  });

  ws.on('error', () => ws.terminate());
});

// Drop dead sockets so presence counts stay honest.
const heartbeat = setInterval(() => {
  for (const [ws, state] of clients) {
    if (!state.alive) {
      ws.terminate();
      continue;
    }
    state.alive = false;
    try {
      ws.ping();
    } catch {
      ws.terminate();
    }
  }
}, 30000);

// Expire stale typing indicators.
const typingSweep = setInterval(() => {
  const now = Date.now();
  const rooms = new Set();
  for (const state of clients.values()) {
    if (state.typingUntil && state.typingUntil <= now) {
      state.typingUntil = 0;
      rooms.add(state.room);
    }
  }
  rooms.forEach((r) => r && pushTyping(r));
}, 1500);

wss.on('close', () => {
  clearInterval(heartbeat);
  clearInterval(typingSweep);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Burns chat running on http://0.0.0.0:${PORT}`);
});
