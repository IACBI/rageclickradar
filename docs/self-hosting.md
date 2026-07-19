# Self-hosting RageClickRadar

RageClickRadar is one Node process with **zero runtime dependencies** and a
single SQLite file. Storage is `node:sqlite`, so there is nothing to install
beyond a recent Node. This guide covers the Node version matrix, running it as a
service, putting it behind HTTPS, backups, retention, and multi-site setups.

## Node version matrix

The server stores data through Node's built-in `node:sqlite` module. Its
availability depends on the Node version:

| Node version | `node:sqlite` | How to start |
| --- | --- | --- |
| < 22.5 | Not available | Not supported — upgrade Node. |
| 22.5 – 23.3 | Behind a flag | `node --experimental-sqlite server/index.js` |
| 23.4 – 24.x | Available unflagged | `node server/index.js` (i.e. `npm start`) |
| **24 LTS** | Available unflagged | **Recommended.** `npm start` |

> The npm scripts (`npm start`, `npm run demo`, `npm run seed`) do **not** pass
> `--experimental-sqlite`. On Node 22.5–23.3 you must invoke the server directly
> with the flag, e.g. `node --experimental-sqlite server/index.js`. On Node 23.4
> and newer (including 24 LTS) `npm start` works as-is. If `node:sqlite` is
> missing at startup the server prints the exact flag/version it needs and exits.

## Running it

The server reads two environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8639` | HTTP listen port. |
| `DB_PATH` | `./data/radar.db` | SQLite file path (parent directory is created automatically). |

Run on a different port and database path:

```bash
PORT=9000 DB_PATH=/var/lib/rageclickradar/radar.db npm start
```

On Windows PowerShell, set the variables first:

```powershell
$env:PORT='9000'; $env:DB_PATH='C:\rageclickradar\radar.db'; npm start
```

The database is opened in WAL mode, so you will see `radar.db`, `radar.db-wal`,
and `radar.db-shm` files next to each other in normal operation.

### systemd unit

Create `/etc/systemd/system/rageclickradar.service`:

```ini
[Unit]
Description=RageClickRadar
After=network.target

[Service]
Type=simple
User=rageradar
WorkingDirectory=/opt/rageclickradar
# Bind to localhost; a reverse proxy terminates TLS and forwards to it.
Environment=PORT=8639
Environment=DB_PATH=/var/lib/rageclickradar/radar.db
# Node 24 LTS: no flag needed. On Node 22.5-23.3 use:
#   ExecStart=/usr/bin/node --experimental-sqlite server/index.js
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
# The process ignores SIGINT/SIGTERM cleanly (closes the DB, then exits).
KillSignal=SIGTERM

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now rageclickradar
```

## Reverse proxy (HTTPS)

Run the Node process bound to localhost and let a proxy terminate TLS. You must
serve **both** the dashboard/static assets *and* `/api/collect` through the same
host so the snippet's default same-origin endpoint works.

### Caddy

Caddy gets you HTTPS in two lines (automatic certificates):

```caddy
analytics.example.com {
    reverse_proxy 127.0.0.1:8639
}
```

### nginx

```nginx
server {
    listen 443 ssl;
    server_name analytics.example.com;

    ssl_certificate     /etc/letsencrypt/live/analytics.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/analytics.example.com/privkey.pem;

    # One block covers everything: /, /radar.js, /api/collect, /api/pages, ...
    location / {
        proxy_pass http://127.0.0.1:8639;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

The collector never stores the client IP, but the in-memory rate limiter keys on
the raw socket's remote address — it deliberately ignores `X-Forwarded-For` so a
client cannot spoof its way into a fresh bucket. Behind a reverse proxy that
socket address is the proxy itself, so **all** clients share one bucket (per
budget). Either expose the collector directly, raise the limits to suit your
traffic, or rate-limit per client at the proxy layer instead (recommended behind
a proxy).

## CORS note

`/api/collect` responds with `Access-Control-Allow-Origin: *` **by design** — it
must accept beacons from any page you instrument, including cross-origin sites
that set `data-endpoint`. This is safe because the endpoint is *validate-only and
write-only*: it accepts a strictly whitelisted anonymous payload, returns `204`
with no readable body, and is rate limited per IP (60 requests/minute by
default, in-memory). None of the read/aggregation endpoints (`/api/pages`,
`/api/heatmap`, ...) send CORS headers, so browsers on other origins cannot read
your data. Keep the dashboard itself private (proxy auth, VPN, or an allow-list)
since the MVP has no built-in authentication.

## API limits

Two independent per-IP rate limits protect the process, both in-memory and keyed
on the raw socket address (see the reverse-proxy caveat above):

| Endpoint(s) | Limit | Where |
| --- | --- | --- |
| `/api/collect` (write) | 60 req/min | `RATE_LIMIT_PER_MIN` (`shared/config.js`) |
| `/api/pages`, `/api/heatmap`, `/api/hotspots`, `/api/sessions`, `/api/session` (read) | 300 req/min | `READ_RATE_LIMIT_PER_MIN` (`server/http.js`) |

The read endpoints also cap result size to bound response size and query cost on
busy pages (constants in `server/queries.js`). Rows are ordered *before* the cap,
so each response keeps the top-N under its ordering:

| Endpoint | Cap | Ordering kept |
| --- | --- | --- |
| `/api/pages` | 200 pages | Highest confusion score first. |
| `/api/heatmap` | 20,000 points | Oldest events first (by insert id). |
| `/api/session` | 5,000 events | Earliest events first (by `ts`). |

## Backups

The database is a single SQLite file. Because WAL mode keeps recent writes in the
`-wal` sidecar, do **not** just copy `radar.db` alone while the server is running
— you may miss committed data. Use one of:

- **Stop, copy, start.** Stop the service, copy `radar.db` (and, to be safe, the
  `-wal` / `-shm` files), start it again. Simplest and always correct.
- **Checkpoint first.** Force a WAL checkpoint so everything is folded into the
  main file, then copy `radar.db`:
  ```bash
  sqlite3 /var/lib/rageclickradar/radar.db "PRAGMA wal_checkpoint(TRUNCATE);"
  cp /var/lib/rageclickradar/radar.db /backups/radar-$(date +%F).db
  ```
- **Online backup (no downtime).** SQLite's backup API is consistent even while
  the server writes:
  ```bash
  sqlite3 /var/lib/rageclickradar/radar.db ".backup '/backups/radar-$(date +%F).db'"
  ```

## Data retention

The server stamps three wall-clock timestamps in milliseconds (all `Date.now()`,
none sent by the browser): `events.received_at` (arrival time, drives retention),
plus `sessions.started_at` and `sessions.last_seen` (set on first insert and
updated on every subsequent batch — they order the session list and let you prune
stale sessions). Delete events older than a cutoff and reclaim space:

```sql
-- Delete events older than 90 days (90 * 24 * 60 * 60 * 1000 ms).
DELETE FROM events
WHERE received_at < (strftime('%s','now') * 1000) - (90 * 24 * 60 * 60 * 1000);

-- Optionally drop sessions that no longer have any events.
DELETE FROM sessions
WHERE id NOT IN (SELECT DISTINCT session_id FROM events);

-- Reclaim disk space after large deletes.
VACUUM;
```

Schedule it. On Linux with cron (daily at 03:30):

```cron
30 3 * * * sqlite3 /var/lib/rageclickradar/radar.db "DELETE FROM events WHERE received_at < (strftime('%s','now')*1000) - (90*24*60*60*1000); DELETE FROM sessions WHERE id NOT IN (SELECT DISTINCT session_id FROM events); VACUUM;"
```

On Windows use Task Scheduler to run the same `sqlite3 ... "<sql>"` command on a
daily trigger. To wipe everything, just stop the server and delete `radar.db`
along with its `-wal` and `-shm` siblings.

## Multiple sites

The events table keys pages by **path only** (`location.pathname`; query and hash
are stripped). It stores no host. That has one consequence for multi-site setups:

- **One collector per site (recommended for the MVP).** Run a separate process
  with its own `DB_PATH` per site. Clean separation, no path collisions.
- **One shared collector for several sites.** Works, and cross-origin sites can
  post via `data-endpoint`. The caveat: two sites that share a path (both have a
  `/pricing`, say) will have their signals merged under that one path, because
  the store cannot tell them apart. Only share a collector across sites whose
  paths don't overlap, or accept the merge.
