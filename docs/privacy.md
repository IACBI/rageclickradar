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

## Path redaction

The tracker sends `location.pathname` as-is, and paths often carry identifiers:
`/users/12345`, `/orders/550e8400-e29b-41d4-a716-446655440000`, or a reset token in
`/reset/9f86d081884c7d659a2feaa0c55ad015`. Before storage, the collector replaces
each path segment that looks like an identifier with `:id`:

| Segment looks like | Example | Stored as |
| --- | --- | --- |
| only digits | `12345` | `:id` |
| a UUID | `550e8400-e29b-41d4-a716-446655440000` | `:id` |
| hex, 16 or more characters | `9f86d081884c7d659a2feaa0c55ad015` | `:id` |
| a token: 24 or more of `A-Z a-z 0-9 _ - + =` (`+` and `=` may appear as `%2B` and `%3D`), containing a digit and at most two `-` or `_` | `Xk9_ab3dQ7pLm2wZ8rT5vYc1` | `:id` |
| an email address: an `@` or `%40` followed later by a dot | `john@example.com`, `john%40example.com` | `:id` |

So `/users/12345/orders/550e8400-…/items` is stored as `/users/:id/orders/:id/items`,
while `/blog/my-first-post`, `/v2/docs` and `/blog/my-very-long-post-title-about-2024-trends`
are kept. Redaction is on by default. `PATH_REDACTION=off` stores paths verbatim; use
it only if your paths never carry identifiers. Any other value stops the server at startup.

Its limits, stated plainly:

- It is a heuristic, not a guarantee. A bare year (`/archive/2024`) is collapsed too.
- Identifiers written as readable words are not detected: `/users/jane-doe` is stored as-is.
- It applies to events received after the change. Rows already stored are not rewritten.
- A redacted path is not a real route, so the dashboard's heatmap does not load a live
  preview for it (`/users/:id` would be a 404). It shows the abstract layout with a notice.

The rules live in `redactPath()` in [`server/collect.js`](../server/collect.js) and are
tested in [`test/unit/redact.test.js`](../test/unit/redact.test.js).

## Element ids, classes and `data-radar-ignore`

A signal's `sel` is a CSS selector built from tag names, `id` and `class` attributes
(and `nth-of-type` positions where needed), exactly as they appear in your markup.
Text content is never used. An `id` that is not a valid CSS identifier (for example
one starting with a digit) is skipped in favor of classes, and the selector is capped
at 120 characters.

That means whatever you put in an `id` or `class` is stored. Do not put personal data
there, such as `id="jane.doe@example.com"` or `class="customer-8842"`. Use structural
names such as `id="checkout-submit"`.

To exclude an area, add `data-radar-ignore` to the element or to a container. Signals
from elements inside it are suppressed, so no selector from that area is sent.

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

- **Retention is your policy.** Data stays until you delete it, unless you set
  `RETENTION_DAYS` to delete old data automatically (off by default). See
  [self-hosting.md](self-hosting.md#data-retention).
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
