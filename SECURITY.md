# Security Policy

## Supported versions

RageClickRadar is pre-1.0. Security fixes land on the latest `0.x` release; there
are no back-ported patches for older versions. Please make sure you are on the
most recent release before reporting.

## Reporting a vulnerability

Please report security issues **privately**, not in a public issue.

Use GitHub's private vulnerability reporting on this repository:
**Security → Report a vulnerability**
(https://github.com/IACBI/rageclickradar/security/advisories/new). This opens a
private advisory visible only to you and the maintainers.

Please do **not** open a public issue, discussion, or pull request for a
suspected vulnerability until it has been addressed.

We aim to acknowledge a valid report within **7 days** and will keep you updated
as we investigate and prepare a fix. When a fix ships we are happy to credit you
in the advisory unless you prefer to remain anonymous.

## Scope note

RageClickRadar's collector (`/api/collect`) is **designed to be publicly
reachable without authentication** — it must accept anonymous beacons from any
page you instrument. As a result, anyone who can reach your instance can post
synthetic signals into *your own* database. This data-injection surface is **by
design**, not a vulnerability: the endpoint is validate-only and write-only,
accepts a strict anonymous whitelist, stores no IP/user-agent/PII, and is rate
limited. See [docs/self-hosting.md](docs/self-hosting.md) for the collector's
security model, the rate-limit behavior behind a reverse proxy, and how to keep
the dashboard (which has no built-in auth) private.

Reports that amount to "I can send data to the open collector" are expected
behavior and out of scope. Reports of the collector storing PII, of a way to read
another origin's data through the read endpoints, of injection/RCE, or of a way
to bypass the field whitelist are very much in scope.
