# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.0]: https://github.com/IACBI/rageclickradar/releases/tag/v0.1.0
