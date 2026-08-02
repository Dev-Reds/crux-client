#!/usr/bin/env node
// Crux Client — Presence + Friend Request Server (dependency-free)
//
// Small HTTP server that tracks online status / in-game state of friends and
// relays friend requests between launchers. No external packages required.
//
//   API:
//     GET  /v1/health                        -> { ok:true }
//     POST /v1/status                        body: { uuid, username, online, inGame, server?, instanceName? }
//     GET  /v1/status?friends=uuid1,uuid2    -> { friends: { uuid: { username, online, inGame, server, instanceName, lastSeen } } }
//     POST /v1/requests                      body: { fromUuid, fromName, toUuid, toName, message? } -> { ok, status }
//     GET  /v1/requests?uuid=X               -> { requests: [...], accepted: [...] }
//     POST /v1/requests/respond              body: { fromUuid, toUuid, accept, acceptorName? }
//     POST /v1/requests/consume              body: { uuid, fromUuid }
//
//   Friend requests are persisted to a JSON file (DATA_DIR, default ./data).
//   On hosts with ephemeral disks (e.g. Render free tier) they survive process
//   restarts of the same instance but not redeploys — fine for a launcher.
//
//   Deploy: any VPS / Railway / Render / Fly.io that can run Node.js.
//   HTTPS is added by the hosting platform (or a reverse proxy) automatically
//   on those platforms. Set the public URL in the launcher under
//   Settings -> Friends & Bug Reports -> Presence server URL.

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8787;
const OFFLINE_AFTER_MS = 90000; // no heartbeat for 90s -> shown offline

// uuid (no dashes, lower case) -> presence state
const presences = new Map();

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'requests.json');

// Persisted friend-request state
// db.requests: [{ fromUuid, fromName, toUuid, toName, message, sentAt }]   (pending)
// db.accepted: [{ requester, acceptor, at }]   (requester had their request accepted by acceptor)
let db = { requests: [], accepted: [] };
let saveTimer = null;

function loadDb() {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) || {};
  } catch {
    db = {};
  }
  if (!Array.isArray(db.requests)) db.requests = [];
  if (!Array.isArray(db.accepted)) db.accepted = [];
}

function persist() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch {}
}

function persistDebounced() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 500);
}

function now() { return Date.now(); }

function clean() {
  const t = now();
  for (const [uuid, s] of presences) {
    if (t - s.lastSeen > OFFLINE_AFTER_MS) presences.delete(uuid);
  }
  const stale = db.accepted.filter(a => t - a.at < 30 * 24 * 3600 * 1000);
  if (stale.length !== db.accepted.length) { db.accepted = stale; persistDebounced(); }
}
setInterval(clean, 30000);

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res, code, data) {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise(resolve => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(b));
    req.on('error', () => resolve(''));
  });
}

function normUuid(u) {
  return String(u || '').replace(/-/g, '').toLowerCase();
}

async function parseBody(req) {
  try { return JSON.parse(await readBody(req)); } catch { return null; }
}

function hasPendingBetween(a, b) {
  return db.requests.some(r =>
    (r.fromUuid === a && r.toUuid === b) || (r.fromUuid === b && r.toUuid === a));
}

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (p === '/v1/health' && req.method === 'GET') {
    json(res, 200, { ok: true, time: now(), count: presences.size });
    return;
  }

  if (p === '/v1/status' && req.method === 'POST') {
    const body = await parseBody(req);
    if (!body) { json(res, 400, { error: 'bad body' }); return; }
    const uuid = normUuid(body.uuid);
    if (!uuid) { json(res, 400, { error: 'uuid required' }); return; }
    presences.set(uuid, {
      uuid,
      username: String(body.username || '').slice(0, 64),
      online: !!body.online,
      inGame: !!body.inGame,
      server: body.server ? String(body.server).slice(0, 255) : null,
      instanceName: body.instanceName ? String(body.instanceName).slice(0, 128) : null,
      lastSeen: now()
    });
    json(res, 200, { ok: true });
    return;
  }

  if (p === '/v1/status' && req.method === 'GET') {
    const friends = (url.searchParams.get('friends') || '')
      .split(',').map(normUuid).filter(Boolean);
    const out = {};
    const t = now();
    for (const uuid of friends) {
      const s = presences.get(uuid);
      if (!s) continue;
      const offline = t - s.lastSeen > OFFLINE_AFTER_MS;
      out[uuid] = {
        username: s.username,
        online: !offline && !!s.online,
        inGame: !offline && !!s.inGame,
        server: !offline ? s.server : null,
        instanceName: !offline ? s.instanceName : null,
        lastSeen: s.lastSeen
      };
    }
    json(res, 200, { friends: out });
    return;
  }

  // ── Friend requests ────────────────────────────────────────────────
  if (p === '/v1/requests' && req.method === 'POST') {
    const body = await parseBody(req);
    if (!body) { json(res, 400, { error: 'bad body' }); return; }
    const fromUuid = normUuid(body.fromUuid);
    const toUuid = normUuid(body.toUuid);
    if (!fromUuid || !toUuid) { json(res, 400, { error: 'uuids required' }); return; }
    if (fromUuid === toUuid) { json(res, 200, { ok: false, status: 'self' }); return; }
    if (hasPendingBetween(fromUuid, toUuid)) { json(res, 200, { ok: false, status: 'exists' }); return; }
    db.requests.push({
      fromUuid,
      fromName: String(body.fromName || '').slice(0, 64),
      toUuid,
      toName: String(body.toName || '').slice(0, 64),
      message: body.message ? String(body.message).slice(0, 500) : null,
      sentAt: now()
    });
    persistDebounced();
    json(res, 200, { ok: true, status: 'created' });
    return;
  }

  if (p === '/v1/requests' && req.method === 'GET') {
    const uuid = normUuid(url.searchParams.get('uuid') || '');
    if (!uuid) { json(res, 400, { error: 'uuid required' }); return; }
    json(res, 200, {
      requests: db.requests.filter(r => r.toUuid === uuid),
      sent: db.requests.filter(r => r.fromUuid === uuid),
      accepted: db.accepted.filter(a => a.requester === uuid)
    });
    return;
  }

  if (p === '/v1/requests/withdraw' && req.method === 'POST') {
    const body = await parseBody(req);
    if (!body) { json(res, 400, { error: 'bad body' }); return; }
    const fromUuid = normUuid(body.fromUuid);
    const toUuid = normUuid(body.toUuid);
    if (!fromUuid || !toUuid) { json(res, 400, { error: 'uuids required' }); return; }
    const before = db.requests.length;
    db.requests = db.requests.filter(r => !(r.fromUuid === fromUuid && r.toUuid === toUuid));
    if (db.requests.length !== before) persistDebounced();
    json(res, 200, { ok: true });
    return;
  }

  if (p === '/v1/requests/respond' && req.method === 'POST') {
    const body = await parseBody(req);
    if (!body) { json(res, 400, { error: 'bad body' }); return; }
    const requester = normUuid(body.fromUuid);
    const responder = normUuid(body.toUuid);
    if (!requester || !responder) { json(res, 400, { error: 'uuids required' }); return; }
    db.requests = db.requests.filter(r => !(r.fromUuid === requester && r.toUuid === responder));
    if (body.accept) {
      db.accepted.push({ requester, acceptor: responder, acceptorName: String(body.acceptorName || '').slice(0, 64), at: now() });
    }
    persistDebounced();
    json(res, 200, { ok: true });
    return;
  }

  if (p === '/v1/requests/consume' && req.method === 'POST') {
    const body = await parseBody(req);
    if (!body) { json(res, 400, { error: 'bad body' }); return; }
    const uuid = normUuid(body.uuid);
    const fromUuid = normUuid(body.fromUuid);
    db.accepted = db.accepted.filter(a => !(a.requester === uuid && a.acceptor === fromUuid));
    persistDebounced();
    json(res, 200, { ok: true });
    return;
  }

  json(res, 404, { error: 'not found' });
});

loadDb();
server.listen(PORT, () => {
  console.log('[Crux Presence] listening on :' + PORT + ' (data dir: ' + DATA_DIR + ')');
});
