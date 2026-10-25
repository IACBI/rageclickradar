// RageClickRadar — server entry point.
// Reads PORT, HOST, DB_PATH, TRUST_PROXY, RETENTION_DAYS and PATH_REDACTION
// from the environment, opens the database, starts the HTTP server, and shuts
// down gracefully on SIGINT/SIGTERM.

import fs from 'node:fs';
import path from 'node:path';

import { CONFIG } from '../shared/config.js';
import { openDb, parseRetentionDays, purgeExpired } from './db.js';
import { createServer, parseTrustedProxies } from './http.js';

const RETENTION_SWEEP_MS = 60 * 60 * 1000;

// A bad setting prints one line and exits, instead of a stack trace.
function fail(message) {
  process.stderr.write(`RageClickRadar: ${message}\n`);
  process.exit(1);
}

function parsePort(raw) {
  if (raw === undefined || raw === '') return CONFIG.DEFAULT_PORT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`PORT: must be an integer from 1 to 65535, got "${raw}"`);
  }
  return n;
}

// Redaction is on unless explicitly switched off, so a typo cannot silently
// turn privacy protection off.
function parsePathRedaction(raw) {
  if (raw === undefined || raw === '' || raw.toLowerCase() === 'on') return true;
  if (raw.toLowerCase() === 'off') return false;
  throw new Error(`PATH_REDACTION: must be "on" or "off", got "${raw}"`);
}

let settings;
try {
  settings = {
    PORT: parsePort(process.env.PORT),
    HOST: process.env.HOST || CONFIG.DEFAULT_HOST,
    DB_PATH: process.env.DB_PATH || './data/radar.db',
    TRUSTED_PROXIES: parseTrustedProxies(process.env.TRUST_PROXY),
    RETENTION_DAYS: parseRetentionDays(process.env.RETENTION_DAYS),
    REDACT_PATHS: parsePathRedaction(process.env.PATH_REDACTION),
  };
} catch (err) {
  fail(err.message);
}
const { PORT, HOST, DB_PATH, TRUSTED_PROXIES, RETENTION_DAYS, REDACT_PATHS } = settings;

// Ensure the parent directory for a file-backed DB exists (skip :memory:).
if (DB_PATH !== ':memory:') {
  const dir = path.dirname(path.resolve(DB_PATH));
  fs.mkdirSync(dir, { recursive: true });
}

const db = openDb(DB_PATH);
const server = createServer(db, { ...CONFIG, TRUSTED_PROXIES, REDACT_PATHS });

// Retention runs once at startup and then hourly. The sweep is synchronous, so
// it never overlaps a write, and the timer is unref'd and cleared on shutdown.
let retentionTimer = null;
if (RETENTION_DAYS > 0) {
  const sweep = () => {
    try {
      const { events, sessions } = purgeExpired(db, RETENTION_DAYS);
      if (events || sessions) {
        process.stdout.write(
          `RageClickRadar: retention removed ${events} event(s) and ${sessions} session(s)\n`,
        );
      }
    } catch (err) {
      process.stderr.write(`RageClickRadar: retention sweep failed: ${err.message}\n`);
    }
  };
  sweep();
  retentionTimer = setInterval(sweep, RETENTION_SWEEP_MS);
  if (typeof retentionTimer.unref === 'function') retentionTimer.unref();
}

server.on('error', (err) => {
  fail(`cannot listen on ${HOST}:${PORT} (${err.code || err.message})`);
});

server.listen(PORT, HOST, () => {
  // Print the address Node actually bound, so a HOST typo or hostname
  // resolution shows up here instead of as a silent mismatch.
  const { address, family } = server.address();
  const hostForUrl = family === 'IPv6' ? `[${address}]` : address;
  process.stdout.write(`RageClickRadar listening on http://${hostForUrl}:${PORT}\n`);
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write(`\nReceived ${signal}, shutting down...\n`);
  if (retentionTimer) clearInterval(retentionTimer);
  server.close(() => {
    try {
      db.close();
    } catch {
      // ignore close errors during shutdown
    }
    process.exit(0);
  });
  // Failsafe: force exit if connections do not drain promptly.
  const t = setTimeout(() => process.exit(0), 5000);
  if (typeof t.unref === 'function') t.unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
