# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-10-26

Security hardening for self-hosted deployments. Two defaults change; read the
first two entries under Changed before upgrading.

### Changed

- **Behavior change: the server binds to `127.0.0.1` by default.** `HOST` used to
  default to all interfaces. If you reach the collector or dashboard from another
  machine, set `HOST=0.0.0.0` explicitly, and keep the unauthenticated read API
  behind a firewall or reverse proxy.
- **Behavior change: page paths are redacted by default.** Numeric segments, UUIDs,
  long hex strings, token-like segments and email addresses are stored as `:id` (for example
  `/users/12345` is stored as `/users/:id`). Set `PATH_REDACTION=off` to keep the
  previous verbatim paths. Only events received after the upgrade are affected.
- Read endpoints apply their result caps in SQL. `/api/pages` and `/api/hotspots`
  sort and limit in the database instead of in JavaScript. Hotspots are now capped
  at 200 selectors per page (`HOTSPOTS_LIMIT`), so very large selector sets return
  fewer rows.
- CI hardening: read-only `GITHUB_TOKEN` permissions for every job, actions pinned
  to commit SHAs, and Dependabot updates for npm and GitHub Actions.
- Docs trimmed to English and Turkish (README) and English (`docs/`).

### Added

- `TRUST_PROXY`: comma-separated IPs of reverse proxies whose `X-Forwarded-For` is
  trusted for rate limiting. Unset trusts no proxy, so the socket address is used.
- `RETENTION_DAYS`: opt-in data retention. When set to a whole number of days,
  events and sessions older than that are deleted at startup and then hourly. Off by
  default. Adds an index on `events.received_at`.
- `PATH_REDACTION`: `on` (default) or `off`, controlling the path redaction above.
- `/api/hotspots` returns an extra `totals` object: per-type signal counts for the whole
  page, not limited by the hotspot cap. Existing fields are unchanged.

### Fixed

- A malformed `TRUST_PROXY`, `PORT`, `RETENTION_DAYS` or `PATH_REDACTION` now prints
  one `RageClickRadar: ...` line and exits with status 1, instead of a stack trace.
  A port that is already in use is reported the same way. `PORT=0` and non-numeric
  `PORT` values used to fall back silently to 8639; they now exit with that error.

## [0.1.0] - 2026-07-19

Initial public release.

### Added

- Dependency-free browser tracker snippet (under 5 KB) that detects rage clicks,
  dead clicks, form abandonment, and input corrections entirely in the browser,
  sending only anonymous conclusions.
- Zero-dependency Node collector (`node:sqlite`) with a strict field whitelist,
  per-IP rate limiting, and a single SQLite file you own — no IP, user agent, or
  PII stored.
- Vanilla-JS dashboard: pages ranked by confusion score, click heatmaps,
  selector-level hotspots, and anonymous per-session timelines.
- "CloudNimbus" demo site with intentional UX traps, plus a one-command demo
  launcher (`npm run demo`).
- Synthetic session seeder for deterministic demo/test data.
- Documentation: README quickstart, self-hosting guide, and privacy statement.

[Unreleased]: https://github.com/IACBI/rageclickradar/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/IACBI/rageclickradar/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/IACBI/rageclickradar/releases/tag/v0.1.0
