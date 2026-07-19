# Contributing to RageClickRadar

Thanks for your interest in improving RageClickRadar. This is a small,
privacy-first project with a deliberately tight scope, and contributions of all
sizes are welcome — bug fixes, docs, tests, and well-argued features.

## Development setup

You need **Node 22.5 or newer** (Node 24 LTS recommended). There are no runtime
dependencies; the only dev dependencies are esbuild and Playwright.

```bash
git clone https://github.com/IACBI/rageclickradar.git
cd rageclickradar
npm install
npm run demo
```

`npm run demo` builds the tracker, starts the server, seeds a batch of synthetic
frustration sessions into a local demo database if it is empty, and prints the
dashboard and demo-site URLs to open.

## Running the tests

```bash
npm test                # unit tests (Node built-in test runner)
npm run test:e2e        # Playwright end-to-end tests (chromium)
npm run build:tracker   # rebuild the tracker bundle; fails over the size budget
```

The e2e suite boots its own server on a fixed port with a fresh, per-run SQLite
file — you do not need to start anything first.

> **Note:** the `test` script uses the glob form
> (`node --test test/unit/*.test.js`) because `node --test <directory>` does not
> expand a directory argument reliably on Windows. Keep that form.

## Project layout

```
shared/config.js        Single source of truth for every threshold
tracker/src/            Browser tracker source (radar, detectors, selector, transport)
tracker/build.js        esbuild bundle -> tracker/dist/radar.min.js (enforces the budget)
server/                 Zero-dependency Node server (http, collect, queries, db)
dashboard/              Vanilla-JS dashboard (served at /)
demo/                   "CloudNimbus" demo site with intentional traps (/demo/)
tools/                  Demo launcher and synthetic session seeder
test/unit/              Node built-in test-runner unit tests
test/e2e/               Playwright end-to-end tests
docs/                   Documentation (self-hosting, privacy)
```

## Hard rules

These invariants are what make RageClickRadar what it is. A change that breaks
one of them will not be merged.

- **Tracker bundle budget: 5120 bytes, hard.** `npm run build:tracker` measures
  the minified bundle and exits non-zero if it exceeds 5120 bytes. CI runs this,
  so an over-budget bundle fails the build. Keep the snippet small.
- **Zero runtime dependencies for the server.** The server runs on Node built-ins
  only (including `node:sqlite`). Do not add a runtime dependency to
  `package.json`. Dev-only tooling (esbuild, Playwright) is the only exception.
- **Privacy invariants — never weaken them.** The tracker must never read typed
  text or field values (`event.data` / `element.value` are off-limits; only
  input-event *types* are counted). The server must never store an IP address,
  user agent, request header, full URL, or any cross-site identifier. The
  collector writes a strict field whitelist and nothing else. See
  [docs/privacy.md](docs/privacy.md) for the exact wire schema and the enforcing
  test (`test/unit/collect.test.js`). If your change touches collection, it must
  keep that test green.
- **Tests are required for behavior changes.** Any change to detection, storage,
  or the read endpoints needs unit-test coverage (and e2e coverage where it
  affects the dashboard). Bug fixes should come with a test that fails without
  the fix.

## Pull requests

- Keep PRs small and focused — one logical change per PR is much easier to review.
- CI must be green (unit + e2e on the supported Node versions, and the tracker
  bundle within budget) before a PR can merge.
- Update the docs (`README.md`, `docs/`) when behavior or configuration changes.
- Describe what you changed and how you tested it; the PR template has a short
  checklist to follow.

By contributing you agree that your contributions are licensed under the MIT
License, the same as the rest of the project.
