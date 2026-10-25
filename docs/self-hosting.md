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
| < 22.5 | Not available | Not supported. Upgrade Node. |
| 22.5 – 22.12, 23.0 – 23.3 | Behind a flag | `node --experimental-sqlite server/index.js` |
| 22.13 and later, 23.4 and later | Available unflagged | `npm start` |
| **24 LTS** | Available unflagged | **Recommended.** `npm start` |

> The npm scripts (`npm start`, `npm run demo`, `npm run seed`) do **not** pass
> `--experimental-sqlite`. On the versions in the flag row you must start the
> server directly with the flag, e.g. `node --experimental-sqlite server/index.js`.
> On every other supported version `npm start` works as-is. If `node:sqlite` is
> missing at startup, the server prints the flag and version it needs and exits.

## Running it

The server reads these environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8639` | HTTP listen port. |
| `DB_PATH` | `./data/radar.db` | SQLite file path (parent directory is created automatically). |
| `HOST` | `127.0.0.1` | Interface to bind. Loopback only by default. Set `0.0.0.0` to expose the process; the read API has no authentication, so do that only behind a firewall or proxy. |
| `TRUST_PROXY` | *(empty)* | Comma-separated exact IPs of reverse proxies you run. Their `X-Forwarded-For` is trusted for rate limiting. Empty trusts none. |
| `RETENTION_DAYS` | *(off)* | Delete events and sessions older than this many days, at startup and hourly. Empty or `0` keeps everything. |
| `PATH_REDACTION` | `on` | `off` stores page paths verbatim. Otherwise identifier-like segments (numbers, UUIDs, tokens) are stored as `:id`. See [privacy.md](privacy.md). |

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
Environment=HOST=127.0.0.1
Environment=PORT=8639
Environment=DB_PATH=/var/lib/rageclickradar/radar.db
# The proxy runs on this host, so its address is the one to trust for X-Forwarded-For.
Environment=TRUST_PROXY=127.0.0.1
# Node 24 LTS: no flag needed. On Node 22.5-22.12 or 23.0-23.3 use:
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
    # Caddy sets X-Forwarded-For to the client address by default.
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
        # Appends the client address. With TRUST_PROXY set to this proxy, the collector reads it.
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

> **Warning: with `TRUST_PROXY`, the proxy must append to `X-Forwarded-For`, never pass the client's value through.** With `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`, nginx adds the address it saw to whatever the client sent, and the collector reads the rightmost untrusted entry. Do not use `$http_x_forwarded_for` for this header: it forwards the client's own value unchanged, so clients can choose their bucket. Caddy's `reverse_proxy` sets `X-Forwarded-For` from the client address and ignores `X-Forwarded-*` headers sent by clients unless `trusted_proxies` is configured. Keep that default and do not copy the incoming header.

The collector never stores the client IP, but the in-memory rate limiter needs a key per client. By default it keys on the socket's remote address and ignores `X-Forwarded-For`, so a client cannot spoof its way into a fresh bucket. Behind a reverse proxy that address is the proxy itself, so **all** clients share one bucket per budget. To fix that, set `TRUST_PROXY` to the proxy's exact IP address (or a comma-separated list of proxies you run). When the immediate peer is one of them, the limiter reads `X-Forwarded-For` and walks it right to left, skipping trusted proxies, so the first address that is not a trusted proxy is the client. A client cannot pick its own bucket by prepending addresses, and a header from any other peer is ignored. Keep `TRUST_PROXY` empty when clients connect to the process directly.

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

Two independent per-IP rate limits protect the process, both in-memory. The key is the client address: the socket address, or the forwarded client address when `TRUST_PROXY` names the peer (see the reverse proxy section above):

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
| `/api/hotspots` | 200 selectors per page | Highest confusion score first; equal scores by selector name. |
| `/api/heatmap` | 20,000 points | Oldest events first (by insert id). |
| `/api/sessions` | 50 sessions by default, 200 at most (`limit` parameter) | Most recently seen first. |
| `/api/session` | 5,000 events | Earliest events first (by `ts`). |

`/api/hotspots` also returns `totals`: per-type signal counts for the whole page. It is not limited by the cap and includes NULL and empty selectors. Use it for page-wide figures, because summing `hotspots[].counts` undercounts once the cap applies.

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

Retention is off by default: rows stay until you delete them. To bound the database,
set `RETENTION_DAYS` to the number of days to keep. 90 is a sensible starting point:

```bash
RETENTION_DAYS=90 npm start
```

The server runs the sweep once at startup and then every hour. It deletes:

- events whose `received_at` (arrival time) is older than the cutoff, and
- sessions whose `last_seen` is older than the cutoff.

Both deletes run in one transaction, and an index on `events.received_at` keeps the
sweep from scanning the whole table. Events are judged one by one, so a session that
is still active keeps its row and loses only its older events. The sweep writes to
stdout only when it removes something.

`RETENTION_DAYS` must be a whole number of days. Any other value (for example `90d`)
stops the server at startup with a one-line error.

SQLite does not shrink the file when rows are deleted; freed pages are reused for new
data. To return the space to the operating system, run `VACUUM` while the server is
stopped:

```bash
sqlite3 /var/lib/rageclickradar/radar.db "VACUUM;"
```

To wipe everything, stop the server and delete `radar.db` along with its `-wal` and
`-shm` siblings.

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
