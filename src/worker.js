export const allowedImageHost = hostname => hostname === 'slaythespire.wiki.gg' ||
  hostname === 'tiermaker.com' || hostname.endsWith('.tiermaker.com');

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_GRACE_MS = 60_000;
const ROOM_CAPACITY = 4;
// A SQLite Durable Object KV value is limited to 2 MB. Keep the board below
// 1 MB and trim operation history so the complete ephemeral room stays clear
// of that ceiling.
const MAX_BOARD_BYTES = 900_000;
const MAX_ROOM_BYTES = 1_700_000;
const COLORS = ['#58a6ff', '#f0883e', '#3fb950', '#d2a8ff'];

const clone = value => structuredClone(value);
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const randomToken = () => crypto.randomUUID().replaceAll('-', '');
function roomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map(byte => ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length]).join('');
}
function cleanName(value, fallback) {
  const name = String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 32);
  return name || fallback;
}
function shareableImage(value) {
  if (typeof value !== 'string' || !value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  const path = value.replace(/^\.?\//, '');
  return path.startsWith('Images/catalogs/') ? path : '';
}
export function sanitizeSharedBoard(input) {
  const board = clone(input);
  if (!board || typeof board !== 'object' || !Array.isArray(board.tiers) ||
      !board.items || typeof board.items !== 'object') throw new Error('invalid board');
  for (const item of Object.values(board.items)) {
    if (!item || typeof item !== 'object') continue;
    for (const field of ['img', 'fallbackImg', 'remoteFallbackImg', 'localImg']) {
      if (field in item) {
        const image = shareableImage(item[field]);
        if (image) item[field] = image;
        else delete item[field];
      }
    }
  }
  if (JSON.stringify(board).length > MAX_BOARD_BYTES) throw new Error('board is too large for co-op');
  return board;
}

function pathValue(root, path) {
  let value = root;
  for (const part of path) {
    if (value === null || typeof value !== 'object' || !(part in value)) return { exists: false };
    value = value[part];
  }
  return { exists: true, value };
}
function setPath(root, path, exists, value) {
  if (!path.length) throw new Error('root replacement is not allowed');
  let target = root;
  for (let index = 0; index < path.length - 1; index += 1) {
    const part = path[index];
    if (target === null || typeof target !== 'object' || !(part in target)) throw new Error('invalid patch path');
    target = target[part];
  }
  const key = path.at(-1);
  if (Array.isArray(target) && !Number.isInteger(Number(key))) throw new Error('invalid array path');
  if (exists) target[key] = clone(value);
  else if (Array.isArray(target)) target.splice(Number(key), 1);
  else delete target[key];
}
function validOperation(operation) {
  return operation && Array.isArray(operation.path) && operation.path.length > 0 && operation.path.length <= 12 &&
    operation.path.every(part => (typeof part === 'string' || Number.isInteger(part)) &&
      !['__proto__', 'prototype', 'constructor'].includes(String(part))) &&
    typeof operation.beforeExists === 'boolean' && typeof operation.afterExists === 'boolean';
}
function trimHistory(room) {
  while (room.history.length > 200) room.history.shift();
  while (room.history.length && JSON.stringify(room).length > MAX_ROOM_BYTES) room.history.shift();
}

export class TierForgeRoom {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async room() { return this.ctx.storage.get('room'); }
  connectedIds() {
    return new Set(this.ctx.getWebSockets().map(socket => socket.deserializeAttachment()?.participantId).filter(Boolean));
  }
  send(socket, value) {
    try { socket.send(JSON.stringify(value)); } catch {}
  }
  broadcast(value, except = null) {
    const message = JSON.stringify(value);
    for (const socket of this.ctx.getWebSockets()) if (socket !== except) {
      try { socket.send(message); } catch {}
    }
  }
  publicParticipants(room) {
    const connected = this.connectedIds();
    return Object.values(room.participants).map(participant => ({
      id: participant.id, name: participant.name, color: participant.color,
      host: participant.id === room.hostId, connected: connected.has(participant.id),
    }));
  }
  async save(room) { await this.ctx.storage.put('room', room); }
  async scheduleCleanup(room) {
    const connected = this.connectedIds();
    const deadlines = Object.values(room.participants)
      .filter(participant => !connected.has(participant.id) && participant.disconnectedAt)
      .map(participant => participant.disconnectedAt + ROOM_GRACE_MS);
    if (deadlines.length) await this.ctx.storage.setAlarm(Math.min(...deadlines));
    else await this.ctx.storage.deleteAlarm();
  }
  async addParticipant(room, requestedName) {
    if (Object.keys(room.participants).length >= ROOM_CAPACITY) return null;
    const id = randomToken().slice(0, 12), token = randomToken();
    const number = room.nextPlayer++;
    room.participants[id] = {
      id, token, name: cleanName(requestedName, `Player ${number}`),
      color: COLORS[(number - 1) % COLORS.length], joinedAt: Date.now(), disconnectedAt: Date.now(),
    };
    return room.participants[id];
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/initialize') {
      if (await this.room()) return json(409, { error: 'room code is already in use' });
      let input;
      try { input = await request.json(); } catch { return json(400, { error: 'invalid JSON' }); }
      let board;
      try { board = sanitizeSharedBoard(input.board); }
      catch (error) { return json(400, { error: error.message }); }
      const room = { board, revision: 0, participants: {}, history: [], nextPlayer: 1,
        hostId: null, createdAt: Date.now() };
      const host = await this.addParticipant(room, input.name);
      room.hostId = host.id;
      await this.save(room);
      await this.scheduleCleanup(room);
      return json(201, { participantId: host.id, token: host.token, name: host.name, color: host.color });
    }
    if (request.method === 'POST' && url.pathname === '/join') {
      const room = await this.room();
      if (!room) return json(404, { error: 'session not found' });
      let input = {};
      try { input = await request.json(); } catch {}
      const participant = await this.addParticipant(room, input.name);
      if (!participant) return json(409, { error: 'this session already has four participants' });
      await this.save(room);
      await this.scheduleCleanup(room);
      return json(201, { participantId: participant.id, token: participant.token,
        name: participant.name, color: participant.color });
    }
    if (request.method === 'GET' && url.pathname === '/connect') {
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
        return json(426, { error: 'WebSocket upgrade required' });
      }
      const room = await this.room();
      if (!room) return json(404, { error: 'session not found' });
      const participant = room.participants[url.searchParams.get('participant')];
      if (!participant || participant.token !== url.searchParams.get('token')) {
        return json(403, { error: 'invalid participant credentials' });
      }
      for (const existing of this.ctx.getWebSockets()) {
        if (existing.deserializeAttachment()?.participantId === participant.id) existing.close(4001, 'Reconnected');
      }
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ participantId: participant.id });
      delete participant.disconnectedAt;
      await this.save(room);
      await this.scheduleCleanup(room);
      this.send(server, { type: 'welcome', board: room.board, revision: room.revision,
        selfId: participant.id, hostId: room.hostId, participants: this.publicParticipants(room) });
      this.broadcast({ type: 'presence', hostId: room.hostId, participants: this.publicParticipants(room) });
      return new Response(null, { status: 101, webSocket: client });
    }
    return json(404, { error: 'not found' });
  }

  async webSocketMessage(socket, rawMessage) {
    const attachment = socket.deserializeAttachment();
    const room = await this.room();
    if (!room || !attachment?.participantId) return socket.close(4004, 'Session ended');
    const participant = room.participants[attachment.participantId];
    if (!participant) return socket.close(4003, 'Participant expired');
    let message;
    try { message = JSON.parse(String(rawMessage)); } catch { return; }
    if (message.type === 'cursor') {
      const x = Number(message.x), y = Number(message.y);
      const boardX = Number(message.boardX), boardY = Number(message.boardY);
      const sourceAnchor = message.anchor && typeof message.anchor === 'object' ? message.anchor : null;
      const anchorX = Number(sourceAnchor?.x), anchorY = Number(sourceAnchor?.y);
      const anchor = typeof sourceAnchor?.itemId === 'string' && Number.isFinite(anchorX) && Number.isFinite(anchorY)
        ? { itemId: sourceAnchor.itemId.slice(0, 128),
          x: Math.max(0, Math.min(1, anchorX)), y: Math.max(0, Math.min(1, anchorY)) } : null;
      const cursor = ['ironclad', 'necrobinder', 'silent'].includes(message.cursor) ? message.cursor : '';
      const pressed = message.pressed === true;
      const selection = Array.isArray(message.selection) ? message.selection.filter(id => typeof id === 'string').slice(0, 500) : [];
      this.broadcast({ type: 'cursor', participantId: participant.id,
        x: Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : null,
        y: Number.isFinite(y) ? Math.max(0, Math.min(1, y)) : null,
        boardX: Number.isFinite(boardX) ? Math.max(-10000, Math.min(10000, boardX)) : null,
        boardY: Number.isFinite(boardY) ? Math.max(-10000, Math.min(10000, boardY)) : null,
        anchor, cursor, pressed, selection }, socket);
      return;
    }
    if (message.type === 'rename') {
      participant.name = cleanName(message.name, participant.name);
      await this.save(room);
      this.broadcast({ type: 'presence', hostId: room.hostId, participants: this.publicParticipants(room) });
      return;
    }
    if (message.type === 'end') {
      if (room.hostId !== participant.id) return this.send(socket, { type: 'error', error: 'only the host can end the session' });
      this.broadcast({ type: 'ended', reason: 'The host ended the session.' });
      for (const peer of this.ctx.getWebSockets()) peer.close(1000, 'Session ended');
      await this.ctx.storage.deleteAll();
      return;
    }
    if (message.type === 'undo') return this.undo(room, participant, message.actionId);
    if (message.type !== 'patch' || !Array.isArray(message.operations) ||
        message.operations.length < 1 || message.operations.length > 4000 ||
        !message.operations.every(validOperation)) return;

    for (const operation of message.operations) {
      const current = pathValue(room.board, operation.path);
      if (current.exists !== operation.beforeExists || (current.exists && !equal(current.value, operation.before))) {
        return this.send(socket, { type: 'conflict', actionId: message.actionId,
          board: room.board, revision: room.revision });
      }
    }
    const next = clone(room.board);
    try {
      for (const operation of message.operations) setPath(next, operation.path, operation.afterExists, operation.after);
      room.board = sanitizeSharedBoard(next);
    } catch (error) {
      return this.send(socket, { type: 'error', actionId: message.actionId, error: error.message });
    }
    room.revision += 1;
    room.history.push({ actionId: String(message.actionId || randomToken()), participantId: participant.id,
      operations: clone(message.operations), undone: false, at: Date.now() });
    trimHistory(room);
    await this.save(room);
    this.broadcast({ type: 'state', actionId: message.actionId, actorId: participant.id,
      board: room.board, revision: room.revision });
  }

  async undo(room, participant, requestId) {
    const action = [...room.history].reverse().find(entry =>
      entry.participantId === participant.id && !entry.undone);
    if (!action) return this.send(this.socketFor(participant.id), { type: 'undo-result',
      actionId: requestId, applied: 0, skipped: 0, message: 'Nothing to undo' });
    let applied = 0, skipped = 0;
    const next = clone(room.board);
    for (const operation of [...action.operations].reverse()) {
      const current = pathValue(next, operation.path);
      if (current.exists === operation.afterExists && (!current.exists || equal(current.value, operation.after))) {
        try { setPath(next, operation.path, operation.beforeExists, operation.before); applied += 1; }
        catch { skipped += 1; }
      } else skipped += 1;
    }
    action.undone = true;
    if (applied) {
      room.board = sanitizeSharedBoard(next);
      room.revision += 1;
      await this.save(room);
      this.broadcast({ type: 'state', actionId: requestId, actorId: participant.id,
        board: room.board, revision: room.revision, undo: { applied, skipped } });
    } else {
      await this.save(room);
      this.send(this.socketFor(participant.id), { type: 'undo-result', actionId: requestId,
        applied, skipped, message: skipped ? 'That change was already modified by someone else' : 'Nothing to undo' });
    }
  }

  socketFor(participantId) {
    return this.ctx.getWebSockets().find(socket => socket.deserializeAttachment()?.participantId === participantId);
  }
  async disconnected(socket) {
    const participantId = socket.deserializeAttachment()?.participantId;
    const room = await this.room();
    if (!room?.participants[participantId]) return;
    if (this.connectedIds().has(participantId)) delete room.participants[participantId].disconnectedAt;
    else room.participants[participantId].disconnectedAt = Date.now();
    await this.save(room);
    this.broadcast({ type: 'presence', hostId: room.hostId, participants: this.publicParticipants(room) });
    await this.scheduleCleanup(room);
  }
  async webSocketClose(socket) { await this.disconnected(socket); }
  async webSocketError(socket) { await this.disconnected(socket); }

  async alarm() {
    const room = await this.room();
    if (!room) return;
    const connected = this.connectedIds(), cutoff = Date.now() - ROOM_GRACE_MS;
    for (const participant of Object.values(room.participants)) {
      if (!connected.has(participant.id) && participant.disconnectedAt <= cutoff) delete room.participants[participant.id];
    }
    if (!Object.keys(room.participants).length) {
      await this.ctx.storage.deleteAll();
      return;
    }
    if (!room.participants[room.hostId]) {
      room.hostId = Object.values(room.participants).sort((a, b) => a.joinedAt - b.joinedAt)[0].id;
    }
    await this.save(room);
    this.broadcast({ type: 'presence', hostId: room.hostId, participants: this.publicParticipants(room) });
    await this.scheduleCleanup(room);
  }
}

function json(status, value) {
  return Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
}

async function imageResponse(request) {
  const source = new URL(request.url).searchParams.get('url');
  let upstream;
  try { upstream = new URL(source); }
  catch { return json(400, { error: 'invalid image URL' }); }
  if (upstream.protocol !== 'https:' || !allowedImageHost(upstream.hostname)) {
    return json(403, { error: 'image host is not allowed' });
  }

  const cache = caches.default;
  const cacheKey = new Request(request.url, { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const response = await fetch(upstream, {
    headers: { 'user-agent': 'TierForge image cache/1.0' },
    redirect: 'follow',
  });
  if (!response.ok) return json(response.status, { error: `upstream HTTP ${response.status}` });
  const type = response.headers.get('content-type') || '';
  if (!type.startsWith('image/')) return json(415, { error: 'upstream response is not an image' });

  const headers = new Headers(response.headers);
  headers.set('access-control-allow-origin', '*');
  headers.set('cross-origin-resource-policy', 'cross-origin');
  headers.set('cache-control', 'public, max-age=14400, s-maxage=86400');
  headers.delete('set-cookie');
  const result = new Response(response.body, { status: 200, headers });
  await cache.put(cacheKey, result.clone());
  return result;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/image') return imageResponse(request);
    if (url.pathname === '/api/sessions' && request.method === 'POST') {
      let body;
      try { body = await request.text(); } catch { return json(400, { error: 'invalid request' }); }
      if (body.length > MAX_BOARD_BYTES) return json(413, { error: 'board is too large for co-op' });
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = roomCode(), stub = env.TIERFORGE_ROOMS.getByName(code);
        const response = await stub.fetch('https://room/initialize', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body,
        });
        if (response.status === 409) continue;
        const result = await response.json();
        return json(response.status, response.ok ? { code, ...result } : result);
      }
      return json(503, { error: 'could not allocate a session code' });
    }
    const match = url.pathname.match(/^\/api\/sessions\/([A-Z2-9]{8})\/(join|connect)$/);
    if (match) {
      const [, code, action] = match;
      const target = new URL(`https://room/${action}`);
      target.search = url.search;
      return env.TIERFORGE_ROOMS.getByName(code).fetch(new Request(target, request));
    }
    return env.ASSETS.fetch(request);
  },
};
