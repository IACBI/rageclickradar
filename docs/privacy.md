# Privacy statement

RageClickRadar is built to measure *frustration*, not *people*. It computes
behavioral signals inside the browser and sends only anonymous conclusions to the
collector. No text you type, no field values, no IP address, no user agent, and
no cross-site identifier is ever transmitted or stored. This document describes
exactly what is and isn't collected, from both the visitor's and the operator's
point of view.

## Exactly what is collected

Each batch the tracker sends is a small JSON envelope plus a list of events. This
is the **entire** wire schema — every field the collector accepts is listed here;
anything else in a payload is dropped on the server before storage.

### Envelope

| Field | Example | Why it exists |
| --- | --- | --- |
| `v` | `1` | Wire format version (must be `1`). |
| `sid` | `"s_9f3a2b8c1d0e"` | Per-tab session id, random, from `sessionStorage`. Not a cookie; gone when the tab closes. |
| `page` | `"/pricing"` | `location.pathname` only — query string and hash are stripped client-side and again on the server. |
| `vw` | `1280` | Viewport width (px), to bucket heatmaps by screen size. |
| `vh` | `720` | Viewport height (px). |
| `dw` | `1280` | Document width (px), to place coordinates on the page. |
| `dh` | `3400` | Document height (px). |
| `events` | `[ … ]` | The array of frustration signals (below). |

### Event

| Field | Example | Why it exists |
| --- | --- | --- |
| `t` | `"rage"` | Signal type: `rage`, `dead`, `formaband`, or `correction`. |
| `ts` | `4210` | Milliseconds **since page load** — a relative offset, never a wall-clock time. |
| `x` | `512.0` | Click x-coordinate on the page (present for click signals only). |
| `y` | `1180.0` | Click y-coordinate on the page (present for click signals only). |
| `sel` | `"button#buy-now"` | Sanitized CSS selector built from tag / id / class only — never text content. Capped at 120 chars. |
| `n` | `5` | Signal magnitude: clicks in a rage burst, deletions in a correction, engaged fields in an abandonment. |
| `m` | `{ "i": 14 }` | Tiny type-specific meta (e.g. insertion count, last-field selector, dwell ms). Capped at 500 chars, structure only — no text values. |

The server also records three wall-clock timestamps the browser never sends (all
`Date.now()`, in milliseconds). None is tied to any identity:

| Field | Where | Why it exists |
| --- | --- | --- |
| `received_at` | on each event | Arrival time; drives retention (delete rows older than a cutoff). |
| `started_at` | on the session | When the session's first batch arrived. |
| `last_seen` | on the session | Updated on every batch; orders the session list newest-first and lets you prune stale sessions. |

## What is NOT collected

RageClickRadar deliberately never collects, transmits, or stores:

- **Keystrokes or their contents.** Correction and abandonment signals are
  derived by *counting* input-event types (insert vs. delete); the code has no
  path that reads `event.data` or an element's `.value`.
- **Field / form values.** Nothing you type into any input is read or sent.
- **IP addresses.** The client IP is used only for in-memory rate limiting and is
  never logged or stored. The database schema has no IP column.
- **User agent / browser headers.** Not read, not stored.
- **Cookies.** None are set. The per-tab id lives in `sessionStorage`.
- **Full URLs.** Only `location.pathname` — the query string and fragment (which
  often carry tokens or search terms) are stripped.
- **Wall-clock client time.** Event timestamps are relative to page load, so they
  reveal nothing about the visitor's local time or timezone.
- **Cross-site or persistent identifiers.** No fingerprinting; the session id is
  random, per-tab, and discarded when the tab closes.

## From the visitor's perspective

You are **anonymous by design**. There is no cookie, no login, and no persistent
id — the session identifier lives in `sessionStorage`, is a random string with no
personal meaning, and disappears the moment the tab is closed. Reopening the site
in a new tab produces a fresh, unlinkable id. There is no device fingerprinting
and nothing that follows you between sites. The only things recorded are anonymous
facts about *where an interaction happened* (a path, a coordinate, a CSS
selector) and *what kind of friction it was* — never *what you wrote* or *who you
are*.

Site operators can also add `data-radar-ignore` to any element (or a container)
to exclude it from tracking entirely.

## From the operator's perspective

Because RageClickRadar is self-hosted, **you host it and you own the data**.
Nothing is sent to a third party — signals go to your collector and land in your
SQLite file. That also means the responsibilities are yours:

- **Retention is your policy.** Data stays until you delete it. See the retention
  SQL and scheduling examples in [self-hosting.md](self-hosting.md).
- **Access control is yours.** The MVP has no authentication; keep the dashboard
  behind a reverse proxy, VPN, or allow-list.
- **Disclosure is yours.** If your privacy policy enumerates what you collect, the
  "what is collected" table above is the accurate list to mirror.

## GDPR and e-privacy

RageClickRadar is intentionally designed to **avoid processing personal data**:
no cookies (so no cookie-consent trigger under the e-Privacy Directive from *this*
tool), no IP retention, no fingerprinting, and only anonymous per-tab signals.
The goal is analytics that fall outside the scope of consent-gated tracking.

**This is not legal advice.** Whether a given deployment needs consent or a
notice depends on your full stack, your jurisdiction, and how regulators
interpret "anonymous" versus "pseudonymous" data — and interpretations vary. If
you combine RageClickRadar with other systems, embed it in a site that already
identifies users, or operate under a strict regime, review it with someone
qualified. RageClickRadar gives you a privacy-preserving foundation; the
compliance conclusion is yours to make.

## How to verify these claims

Everything here is checkable in the source:

- **The wire schema** is the field whitelist in
  [`server/collect.js`](../server/collect.js) — `normalizeEvent()` and
  `handleCollectBody()` accept only the fields tabled above; the database schema
  is in [`server/db.js`](../server/db.js) (no ip/ua/header columns).
- **The privacy assertions** are enforced by the test
  `privacy: schema has no IP/UA-like columns and meta holds only m` in
  [`test/unit/collect.test.js`](../test/unit/collect.test.js). It scans the
  schema for any `ip` / `agent` / `ua` / `header` column and smuggles fabricated
  IP/UA markers into a payload, then asserts none of them reach any stored value.
- **The "no text is read" property** is visible in the tracker source
  ([`tracker/src/radar.js`](../tracker/src/radar.js) and
  [`tracker/src/detectors.js`](../tracker/src/detectors.js)): only
  `event.inputType` is classified — `event.data` and `element.value` are never
  touched.

Run the tests yourself with `npm test`.
