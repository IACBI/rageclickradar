# RageClickRadar

**Frustration analytics without the surveillance.** A privacy-first, self-hosted
alternative to Hotjar-style tools: it finds the buttons that do nothing, the
forms people give up on, and the spots where users angrily click over and over —
without cookies, without recording keystrokes, and without ever storing an IP
address or a user agent.

One dependency-free `<script>` snippet (under 5 KB), a single Node process with
zero runtime dependencies, and a plain SQLite file you own. That is the whole
product.

## Why

Most session-analytics tools work by collecting as much as they can: full URLs,
mouse recordings, keystrokes, IP-based identities, cross-site cookies. That is a
privacy liability and, in many jurisdictions, a consent-banner problem.

RageClickRadar takes the opposite approach. It computes *behavioral signals* in
the browser — a rage-click burst, a dead click, an abandoned form — and sends
only the anonymous conclusion (a signal type, a sanitized CSS selector, a
coordinate, a magnitude). No text, no values, no identity. The frustrating parts
of your UI still light up; the surveillance apparatus never gets built. See
[docs/privacy.md](docs/privacy.md) for the exact wire schema and the full
not-collected list.

## Quickstart

You need **Node 22.5 or newer** (Node 24 LTS recommended — see
[docs/self-hosting.md](docs/self-hosting.md) for the version matrix). Then:

```bash
git clone https://github.com/your-org/RageClickRadar.git
cd RageClickRadar
npm install && npm run demo
```

`npm run demo` builds the tracker if needed, starts the server, seeds a batch of
synthetic frustration sessions into a local demo database if it is empty, and
prints the URLs to open. Point your browser at the dashboard URL it prints and
explore the pre-seeded data; the "CloudNimbus" demo site (a deliberately
confusing three-page fake SaaS, full of traps) is served alongside it so you can
generate your own signals by clicking around.

### Instrument your own site

Drop one line into your pages. If your site is served by the same origin as the
collector:

```html
<script src="/radar.js" defer></script>
```

If your site lives on a different origin than the collector, point the snippet at
your collector explicitly with `data-endpoint`:

```html
<script src="https://your-host/radar.js"
        data-endpoint="https://your-host/api/collect" defer></script>
```

That is the entire install. Add `data-radar-ignore` to any element (or an
ancestor) to exclude it from tracking. Add `data-radar-allow-rapid` to any
element (or an ancestor) to suppress rage-click detection there — for controls
where repeated clicking is expected. The tracker already auto-exempts rapid
clicking on `input[type=number]`, `[role=spinbutton]`, `[role=slider]`, and any
element whose class contains `stepper`, `carousel`, or `qty`. Within a minute of
real traffic the dashboard at `/` starts showing per-page confusion scores, click
heatmaps, selector-level hotspots, and individual anonymous session timelines.

## Signals

RageClickRadar detects four kinds of frustration. Every threshold is a plain
number in [`shared/config.js`](shared/config.js) and can be overridden per-site
at runtime (see [Configuration](#configuration)).

| Signal | What it means | Default trigger | Tune via (`window.RadarConfig` keys) |
| --- | --- | --- | --- |
| **Rage click** | User clicks the same spot repeatedly in frustration. | ≥ 3 clicks, each within 500 ms of the last, all within a 30 px radius; the burst is emitted 700 ms after the last click. | `RAGE_MIN_CLICKS`, `RAGE_MAX_GAP_MS`, `RAGE_RADIUS_PX`, `RAGE_SETTLE_MS` |
| **Dead click** | User clicks something that looks clickable but isn't. | A non-interactive target (no link/button/role, no `cursor: pointer`) with no DOM mutation, scroll, text selection, or URL change within 600 ms. | `DEAD_WAIT_MS`, `DEAD_MAX_ANCESTORS`, `DEAD_SCROLL_PX`, `DEAD_DRAG_PX` |
| **Form abandonment** | User engages a form, then leaves without submitting. | A field received ≥ 3 input events and the form was never submitted; fires on page-hide, or after 30 s of focus elsewhere. A standalone search field (a lone search input, ≤ 1 field) never fires it. | `FORM_MIN_INPUTS`, `FORM_BLUR_ABANDON_MS` |
| **Correction** | User fights a field, deleting and retyping heavily. | In one field engagement: ≥ 8 deletions **and** deletions ≥ 0.5 × insertions (counted from input-event types only — the text is never read). | `CORRECTION_MIN_DELETES`, `CORRECTION_RATIO` |

Each page's **confusion score** is the sum of its signal rows weighted by type:
rage 3, form abandonment 3, correction 2, dead 1 (`SCORE_WEIGHTS`, server-side).

## Screenshots

> Images live under `docs/img/` (not included in this snapshot — add your own).

![Dashboard: pages ranked by confusion score, with per-type signal counts](docs/img/dashboard-pages.png)

![Click heatmap overlaid on a page wireframe, filterable by signal type](docs/img/heatmap.png)

![Session timeline: an anonymous per-tab session's signals in order](docs/img/session-timeline.png)

## Configuration

### Runtime tracker overrides

Set `window.RadarConfig` **before** the snippet loads to override any threshold.
Use the full key names below; each key is optional and falls back to its default.

```html
<script>
  window.RadarConfig = { RAGE_MIN_CLICKS: 4, DEAD_WAIT_MS: 800 };
</script>
<script src="/radar.js" defer></script>
```

| Key | Default | Meaning |
| --- | --- | --- |
| `RAGE_MIN_CLICKS` | `3` | Clicks needed to qualify as a rage burst. |
| `RAGE_MAX_GAP_MS` | `500` | Max ms between consecutive clicks in a burst. |
| `RAGE_RADIUS_PX` | `30` | Max px distance from the burst's first click. |
| `RAGE_SETTLE_MS` | `700` | Ms of silence that closes a burst (single emit). |
| `DEAD_WAIT_MS` | `600` | Reaction window after a click before it's declared dead. |
| `DEAD_MAX_ANCESTORS` | `10` | Ancestor levels walked when checking interactivity. |
| `DEAD_SCROLL_PX` | `5` | Scroll movement (px) that counts as a page reaction. |
| `DEAD_DRAG_PX` | `5` | Pointer travel between down/up that means a text-selection drag. |
| `FORM_MIN_INPUTS` | `3` | Input events on a field before the form counts as engaged. |
| `FORM_BLUR_ABANDON_MS` | `30000` | Ms of focus outside an engaged form before mid-session abandon. |
| `CORRECTION_MIN_DELETES` | `8` | Min deletions in one field engagement to consider a signal. |
| `CORRECTION_RATIO` | `0.5` | Deletions must be ≥ ratio × insertions to fire. |
| `MAX_EVENTS_PER_PAGEVIEW` | `200` | Hard cap per page view; the tracker goes silent afterward. |
| `BATCH_MAX_EVENTS` | `50` | Flush a batch when this many events are buffered. |
| `BATCH_INTERVAL_MS` | `5000` | Periodic flush interval. |
| `SELECTOR_MAX_LEN` | `120` | Hard cap on the emitted CSS selector length. |

### Server environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8639` | HTTP port for the collector and dashboard. |
| `DB_PATH` | `./data/radar.db` | SQLite database file (WAL mode; parent dir is created). |

Server-side thresholds (`DEFAULT_PORT`, `MAX_BODY_BYTES`, `RATE_LIMIT_PER_MIN`,
`SCORE_WEIGHTS`) also live in `shared/config.js` but are not browser-overridable.

## Architecture

```
  Browser                          Your server (one Node process)
 +-----------+   POST text/plain   +----------------------------+
 |  radar.js | ------------------> |  /api/collect  (validate,  |
 | (<5 KB)   |   {v,sid,page,...}  |   rate-limit, whitelist)   |
 +-----------+                     +-------------+--------------+
      ^  computes signals                        |
      |  in the browser;                         v
      |  sends conclusions              +------------------+
      |  only (no text/PII)             |  SQLite (WAL)    |
      |                                 |  radar.db        |
      |                                 +--------+---------+
      |   GET /api/pages|heatmap|...             |
 +----+------------------------------------------v---------+
 |  Dashboard (vanilla JS, served from /)                  |
 +--------------------------------------------------------+
```

The collector only ever writes whitelisted fields; there is no IP, user agent, or
header column anywhere in the schema.

### Repo layout

```
shared/config.js        Single source of truth for every threshold
tracker/src/            Browser tracker source (radar, detectors, selector, transport)
tracker/build.js        esbuild bundle -> tracker/dist/radar.min.js (<5 KB budget)
server/                 Zero-dependency Node server
  index.js              Entry: reads PORT / DB_PATH, opens DB, starts HTTP
  http.js               Routing, CORS, static serving, rate limiting
  collect.js            Payload validation + storage (the field whitelist)
  queries.js            Read/aggregation endpoints
  db.js                 node:sqlite open + migration (WAL)
dashboard/              Vanilla-JS dashboard (served at /)
demo/                   "CloudNimbus" demo site with intentional traps (/demo/)
tools/generate-sessions.js  Synthetic session seeder
test/unit/              Node built-in test-runner unit tests
test/e2e/               Playwright end-to-end tests
docs/                   This documentation
```

## FAQ

**Do I need cookie consent / is this GDPR-friendly?**
RageClickRadar is designed to avoid collecting personal data: no cookies, no IP
storage, no fingerprinting, per-tab anonymous ids only. That is intended to keep
you out of consent-banner territory, but interpretations vary by jurisdiction and
this is not legal advice. Read [docs/privacy.md](docs/privacy.md) before you
decide.

**Does it work with single-page apps?**
Yes. The tracker listens on `popstate` and `hashchange`, so History-API and hash
URL changes count as page reactions (a route change won't be misread as a dead
click). Signals carry `location.pathname` only.

**Do my users need accounts? Do I?**
No accounts anywhere — not for visitors, not for you. There is no auth layer in
the MVP; put the dashboard behind your reverse proxy or a VPN if you want to
restrict it (see [docs/self-hosting.md](docs/self-hosting.md)).

**How big is the snippet?**
The minified bundle is 5104 bytes (hard budget: 5120), dependency-free.

**How do I delete data?**
It is your SQLite file. Stop the server and delete `radar.db` (plus its `-wal` /
`-shm` siblings) to wipe everything, or run a dated `DELETE` for retention — see
the retention SQL in [docs/self-hosting.md](docs/self-hosting.md).

**Production hardening?**
See [docs/self-hosting.md](docs/self-hosting.md) for systemd, HTTPS reverse
proxies, backups, retention, and multi-site notes.

## Development

```bash
npm test                       # unit tests (Node built-in runner)
npm run build:tracker          # rebuild tracker/dist/radar.min.js (enforces <5 KB)
npm start                      # run the server (PORT, DB_PATH from env)
npm run seed -- --sessions 40 --seed 42 --url http://localhost:8639 --verify
npm run test:e2e               # Playwright end-to-end tests
```

> **Note:** The `test` script uses the glob form (`node --test test/unit/*.test.js`)
> because `node --test <directory>` does not expand a directory argument reliably
> on Windows.

The seeder POSTs synthetic sessions through the real `/api/collect` endpoint, so
the server must be running first. A fixed `--seed` makes generation fully
deterministic; `--verify` asserts the seeded corpus is demo-ready via the read
endpoints.

## License

MIT. See [LICENSE](LICENSE).
