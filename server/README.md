# Crux Client — Presence Server

Tiny, dependency-free Node.js server that powers the **Friends tab online status**
and **friend requests** in the Crux Client launcher. It keeps an in-memory map
`uuid -> { online, inGame, ... }` for presence and persists friend requests to a
JSON file. No database, no external packages.

## Local run

```bash
npm start            # or: node presence-server.js
# listens on http://localhost:8787  (override with PORT=9000)
# requests are stored in ./data/requests.json  (override with DATA_DIR)
```

Verify:

```bash
curl http://localhost:8787/v1/health
# -> {"ok":true,"time":...,"count":0}
```

## Deploy on Render (free)

1. Push this repo to GitHub.
2. Go to https://render.com → **New → Blueprint** and pick the repo.
3. Render finds `render.yaml` (service `crux-presence`) and deploys automatically.
4. Open **Dashboard → crux-presence → Settings** and copy the URL, e.g.
   `https://crux-presence.onrender.com`.

> Note: the free tier sleeps after ~15 min idle (first request after waking takes
> ~1 min) and the disk is ephemeral — friend requests survive instance restarts
> but not redeploys. Presence is in-memory and repopulates via heartbeats.

Other hosts that run Node.js work too (Railway, Fly.io, VPS with Nginx/Caddy for TLS).

## Launcher configuration

1. Open the launcher **Settings → Friends & Bug Reports**.
2. Set **Presence server URL** to the public URL of this server (e.g. `https://crux-presence.onrender.com`).
3. In the **Friends** tab, send friend requests by Minecraft username and accept/decline incoming ones.

## API

| Method | Path | Body / Query | Description |
|---|---|---|---|
| GET | `/v1/health` | – | Liveness check |
| POST | `/v1/status` | `{ uuid, username, online, inGame, server?, instanceName? }` | Update own presence (heartbeat every 15 s) |
| GET | `/v1/status?friends=uuid1,uuid2` | – | Returns status for the given UUIDs |
| POST | `/v1/requests` | `{ fromUuid, fromName, toUuid, toName, message? }` | Send a friend request → `{ ok, status: created\|exists\|self }` |
| GET | `/v1/requests?uuid=X` | – | Pending requests sent **to** X + notifications of requests **from** X that were accepted |
| POST | `/v1/requests/respond` | `{ fromUuid, toUuid, accept, acceptorName? }` | Respond (accept/decline); on accept the requester gets notified |
| POST | `/v1/requests/consume` | `{ uuid, fromUuid }` | Requester confirms it added the acceptor → clears the notification |

UUIDs are normalized (dashes removed, lower case). A friend counts as **offline**
if no heartbeat arrived for 90 seconds.
