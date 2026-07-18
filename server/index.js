// RageClickRadar — server entry point.
// Reads PORT and DB_PATH from the environment, opens the database, starts
// the HTTP server, and shuts down gracefully on SIGINT/SIGTERM.

import fs from 'node:fs';
import path from 'node:path';

import { CONFIG } from '../shared/config.js';
import { openDb } from './db.js';
import { createServer } from './http.js';

const PORT = Number(process.env.PORT) || CONFIG.DEFAULT_PORT;
const DB_PATH = process.env.DB_PATH || './data/radar.db';

// Ensure the parent directory for a file-backed DB exists (skip :memory:).
if (DB_PATH !== ':memory:') {
  const dir = path.dirname(path.resolve(DB_PATH));
  fs.mkdirSync(dir, { recursive: true });
}

const db = openDb(DB_PATH);
const server = createServer(db, CONFIG);

server.listen(PORT, () => {
  process.stdout.write(`RageClickRadar listening on http://localhost:${PORT}\n`);
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write(`\nReceived ${signal}, shutting down...\n`);
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
