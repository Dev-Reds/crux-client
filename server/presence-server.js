#!/usr/bin/env node
// Crux Client — Presence + Friend Request Server (dependency-free)
//
// Small HTTP server that tracks online status / in-game state of friends and
// relays friend requests between launchers. No external packages required.
//
//   API:
//     GET  /v1/health                        -> { ok:true, build }
//     POST /v1/status                        body: { uuid, username, online, inGame, server?, instanceName? }
//     GET  /v1/status?friends=uuid1,uuid2    -> { friends: { uuid: { username, online, inGame, server, instanceName, lastSeen } } }
//     POST /v1/requests                      body: { fromUuid, fromName, toUuid, toName, message? } -> { ok, status }
//     GET  /v1/requests?uuid=X               -> { requests: [...], accepted: [...] }
//     POST /v1/requests/respond              body: { fromUuid, toUuid, accept, acceptorName? }
//     POST /v1/requests/consume              body: { uuid, fromUuid }
//     POST /v1/logins                        body: { uuid?, username, first?, last?, logins?, deviceId?, deviceName? } -> { ok, key }
//     GET  /v1/logins                        -> { logins: [ { uuid, username, first, last, logins, devices } ] }
//     POST /v1/bans                          body: { key?, uuid?, name, reason, by, start, end } -> { ok, key }
//     GET  /v1/bans                          -> { bans: [ { key, uuid, name, reason, by, start, end } ] }
//     POST /v1/bans/remove                   body: { key } -> { ok }
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

// Bumped whenever the deployed API changes; exposed via /v1/health so the
// launcher (and deploy checks) can verify which build is live.
const BUILD = 'logins-devices-2';

// uuid (no dashes, lower case) -> presence state
const presences = new Map();

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'requests.json');

// Persisted friend-request state
// db.requests: [{ fromUuid, fromName, toUuid, toName, message, sentAt }]   (pending)
// db.accepted: [{ requester, acceptor, at }]   (requester had their request accepted by acceptor)
// db.logins:   [{ uuid, username, first, last, logins, devices:{ [deviceId]: { name, first, last } } }]   (every account that ever logged in)
// db.bans:     [{ key, uuid, name, reason, by, start, end }]   (owner-managed bans)
let db = { requests: [], accepted: [], logins: [], bans: [] };
let saveTimer = null;

function loadDb() {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) || {};
  } catch {
    db = {};
  }
  if (!Array.isArray(db.requests)) db.requests = [];
  if (!Array.isArray(db.accepted)) db.accepted = [];
  if (!Array.isArray(db.logins)) db.logins = [];
  if (!Array.isArray(db.bans)) db.bans = [];
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

// Stable identity for an account: by uuid when present, otherwise by name.
function accountKey(uuid, name) {
  const u = normUuid(uuid);
  if (u) return 'u:' + u;
  const n = String(name || '').trim().toLowerCase();
  return n ? 'n:' + n : null;
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
    json(res, 200, { ok: true, time: now(), count: presences.size, build: BUILD });
    return;
  }

  // Live count of launchers currently open worldwide (with a seen uuid in the last 90s)
  if (p === '/v1/count' && req.method === 'GET') {
    const t = now();
    let live = 0;
    for (const s of presences.values()) {
      if (t - s.lastSeen <= OFFLINE_AFTER_MS) live++;
    }
    json(res, 200, { ok: true, time: t, count: live });
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

  // ── Global login registry (device-spanning account list) ───────────
  if (p === '/v1/logins' && req.method === 'POST') {
    const body = await parseBody(req);
    if (!body) { json(res, 400, { error: 'bad body' }); return; }
    const uuid = normUuid(body.uuid);
    const username = String(body.username || body.name || '').slice(0, 64);
    const key = accountKey(uuid, username);
    if (!key) { json(res, 400, { error: 'uuid or username required' }); return; }
    const t = now();
    const inFirst = Number(body.first) || 0;
    const inLast = Number(body.last) || 0;
    const inLogins = Number(body.logins) || 0;
    const deviceId = String(body.deviceId || '').slice(0, 64);
    const deviceName = String(body.deviceName || '').slice(0, 64);
    let e = db.logins.find(x => accountKey(x.uuid, x.username) === key);
    if (!e) {
      e = { uuid, username, first: inFirst || t, last: inLast || t, logins: inLogins || 1, devices: {} };
      db.logins.push(e);
    } else {
      if (uuid && !e.uuid) e.uuid = uuid;
      if (username) e.username = username;
      if (inFirst && (!e.first || inFirst < e.first)) e.first = inFirst;
      if (inLast && inLast > (e.last || 0)) e.last = inLast;
      if (inLogins > (e.logins || 0)) e.logins = inLogins;
    }
    // Per-device footprint: which machines ever logged in this account
    if (deviceId) {
      if (!e.devices || typeof e.devices !== 'object') e.devices = {};
      const d = e.devices[deviceId] || (e.devices[deviceId] = { name: deviceName, first: inFirst || t, last: 0 });
      if (deviceName) d.name = deviceName;
      const dLast = inLast || t;
      if (dLast > (d.last || 0)) d.last = dLast;
      if (inFirst && (!d.first || inFirst < d.first)) d.first = inFirst;
    }
    persistDebounced();
    json(res, 200, { ok: true, key });
    return;
  }

  if (p === '/v1/logins' && req.method === 'GET') {
    json(res, 200, { logins: db.logins });
    return;
  }

  // ── Bans (owner-managed, device-spanning) ─────────────────────────
  if (p === '/v1/bans' && req.method === 'POST') {
    const body = await parseBody(req);
    if (!body) { json(res, 400, { error: 'bad body' }); return; }
    const uuid = normUuid(body.uuid);
    const name = String(body.name || '').slice(0, 64);
    const key = String(body.key || '') || accountKey(uuid, name);
    if (!key || key === 'n:') { json(res, 400, { error: 'key, uuid or name required' }); return; }
    const entry = {
      key,
      uuid,
      name,
      reason: String(body.reason || '').slice(0, 500),
      by: String(body.by || '').slice(0, 64),
      start: Number(body.start) || now(),
      end: body.end ? Number(body.end) : null,
      disabled: Array.isArray(body.disabled)
        ? body.disabled.map(x => String(x).slice(0, 32)).slice(0, 32)
        : undefined
    };
    db.bans = db.bans.filter(b => b && b.key !== key);
    db.bans.push(entry);
    persistDebounced();
    json(res, 200, { ok: true, key });
    return;
  }

  if (p === '/v1/bans' && req.method === 'GET') {
    json(res, 200, { bans: db.bans });
    return;
  }

  if (p === '/v1/bans/remove' && req.method === 'POST') {
    const body = await parseBody(req);
    if (!body) { json(res, 400, { error: 'bad body' }); return; }
    const key = String(body.key || '');
    if (!key) { json(res, 400, { error: 'key required' }); return; }
    db.bans = db.bans.filter(b => b && b.key !== key);
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
