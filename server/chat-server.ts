#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write --unstable-kv
// Crux Client — Chat Server for Deno Deploy
//
// Long-poll based chat between friends, persisted in Deno KV. Deno KV is
// globally replicated and survives restarts AND redeploys on Deno Deploy.
//
//   Deploy: Deno Deploy dashboard -> New Project -> connect GitHub repo
//           -> Root: server  -> Entrypoint: chat-server.ts
//   Or:     deployctl deploy --project=crux-chat server/chat-server.ts
//
// API:
//   GET  /v1/health                        -> { ok:true, time, count }
//   POST /v1/send   { from, to, text }     -> store message -> { ok:true, msg }
//   GET  /v1/poll   ?from&to&after&timeout -> long-poll; returns new messages
//   GET  /v1/messages?from&to&after&limit  -> immediate history fetch

const kv = await Deno.openKv();

const TEXT_MAX = 2000;
const HISTORY_MAX = 200;
const POLL_STEP_MS = 1500;
const POLL_MAX_MS = 20000;

function normUuid(u) {
  return String(u || '').toLowerCase().replace(/[^0-9a-f]/g, '');
}

function convKey(a, b) {
  return [a, b].sort().join(':');
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

async function readBody(req) {
  try { return await req.json(); } catch { return null; }
}

async function listMessages(from, to, afterTs, limit) {
  const key = convKey(from, to);
  const iter = kv.list({ prefix: ['msg', key] });
  const out = [];
  for await (const e of iter) {
    if (e.value.ts > afterTs) out.push(e.value);
  }
  out.sort((a, b) => (a.ts - b.ts) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out.slice(-limit);
}

async function trimConversation(from, to) {
  const key = convKey(from, to);
  const iter = kv.list({ prefix: ['msg', key] });
  let count = 0;
  const extra = [];
  for await (const e of iter) {
    count++;
    if (count > HISTORY_MAX) extra.push(e.key);
  }
  if (extra.length) {
    const atomic = kv.atomic();
    for (const k of extra) atomic.delete(k);
    await atomic.commit();
  }
}

async function storeMessage(from, to, text) {
  const ts = Date.now();
  const id = ts + ':' + crypto.randomUUID();
  const msg = { id, from, to, text, ts };
  await kv.set(['msg', convKey(from, to), ts, id], msg);
  await trimConversation(from, to);
  notifyWaiters(convKey(from, to));
  return msg;
}

// In-process waiters so long-poll responds instantly when a message lands on
// the same isolate; other isolates re-check KV every POLL_STEP_MS.
const waiters = new Set();

function notifyWaiters(key) {
  for (const w of waiters) {
    if (w.key === key) w.resolve();
  }
}

async function pollMessages(from, to, afterTs, timeoutMs) {
  const deadline = Date.now() + Math.min(timeoutMs, POLL_MAX_MS);
  while (Date.now() < deadline) {
    const msgs = await listMessages(from, to, afterTs, 50);
    if (msgs.length) return msgs;
    const waiter = { key: convKey(from, to), resolve: null };
    const done = new Promise((resolve) => { waiter.resolve = resolve; });
    waiters.add(waiter);
    const timer = setTimeout(() => {
      waiters.delete(waiter);
      waiter.resolve();
    }, POLL_STEP_MS);
    await done;
    clearTimeout(timer);
    waiters.delete(waiter);
  }
  return [];
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const p = url.pathname;

  if (req.method === 'OPTIONS') return json(204, {});

  if (p === '/v1/health' && req.method === 'GET') {
    return json(200, { ok: true, time: Date.now() });
  }

  if (p === '/v1/send' && req.method === 'POST') {
    const body = await readBody(req);
    const from = normUuid(body && body.from);
    const to = normUuid(body && body.to);
    const text = String((body && body.text) || '').slice(0, TEXT_MAX).trim();
    if (!from || !to || !text) return json(400, { error: 'bad request' });
    if (from === to) return json(200, { ok: false, status: 'self' });
    const msg = await storeMessage(from, to, text);
    return json(200, { ok: true, msg });
  }

  if (p === '/v1/messages' && req.method === 'GET') {
    const from = normUuid(url.searchParams.get('from'));
    const to = normUuid(url.searchParams.get('to'));
    if (!from || !to) return json(400, { error: 'uuids required' });
    const afterTs = parseInt(url.searchParams.get('after') || '0', 10) || 0;
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 200);
    const msgs = await listMessages(from, to, afterTs, limit);
    return json(200, { messages: msgs });
  }

  if (p === '/v1/poll' && req.method === 'GET') {
    const from = normUuid(url.searchParams.get('from'));
    const to = normUuid(url.searchParams.get('to'));
    if (!from || !to) return json(400, { error: 'uuids required' });
    const afterTs = parseInt(url.searchParams.get('after') || '0', 10) || 0;
    const timeout = parseInt(url.searchParams.get('timeout') || '8000', 10) || 8000;
    const msgs = await pollMessages(from, to, afterTs, timeout);
    return json(200, { messages: msgs });
  }

  return json(404, { error: 'not found' });
});
