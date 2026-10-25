// RageClickRadar — SQLite storage layer (node:sqlite, zero runtime deps).
// Opens a DatabaseSync handle, enables WAL, and applies the fixed migration.

// Wrap the node:sqlite import: on Node builds without it, print a friendly
// message telling the user which version/flag they need, then exit.
let DatabaseSync;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  process.stderr.write(
    'RageClickRadar: node:sqlite is not available in this Node runtime.\n' +
      'You need Node >= 22.5. On 22.5-22.12 and 23.0-23.3 you must also start\n' +
      'the process with the --experimental-sqlite flag, e.g.:\n' +
      '  node --experimental-sqlite server/index.js\n' +
      'On Node 23.4+ (and 24.x) it is available without any flag.\n',
  );
  process.exit(1);
}

const MIGRATION = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, started_at INTEGER, last_seen INTEGER, vw INTEGER, vh INTEGER
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL, page TEXT NOT NULL, type TEXT NOT NULL,
  ts INTEGER NOT NULL,
  x REAL, y REAL, doc_w INTEGER, doc_h INTEGER,
  selector TEXT, count INTEGER DEFAULT 1, meta TEXT,
  received_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_page_type ON events(page, type);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, ts);
CREATE INDEX IF NOT EXISTS idx_sessions_last_seen ON sessions(last_seen);
CREATE INDEX IF NOT EXISTS idx_events_received ON events(received_at);
`;

/**
 * Open the RageClickRadar database.
 * @param {string} path Filesystem path, or ':memory:' for an in-memory DB.
 * @returns {import('node:sqlite').DatabaseSync} An open, migrated handle.
 */
export function openDb(path) {
  const db = new DatabaseSync(path);
  // WAL gives better read/write concurrency; harmless (and a no-op journal
  // mode) for :memory: databases used by the tests.
  db.exec('PRAGMA journal_mode=WAL');
  db.exec(MIGRATION);
  return db;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Parse RETENTION_DAYS. Unset, empty or "0" keeps data forever (the default).
 * @param {string|undefined} raw
 * @returns {number} whole days, 0 when retention is off
 */
export function parseRetentionDays(raw) {
  if (raw === undefined || raw === '' || raw === '0') return 0;
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(n)) {
    throw new Error(`RETENTION_DAYS: must be a whole number of days, got "${raw}"`);
  }
  return n;
}

/**
 * Delete events received, and sessions last seen, before the retention cutoff.
 * Both timestamps are wall-clock ms written by the collector. A session's
 * last_seen is at least its newest event's received_at, so a session that is
 * removed has no events left behind.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} retentionDays 0 or less is a no-op (retention off).
 * @param {number} [now=Date.now()] Injected by tests.
 * @returns {{events: number, sessions: number}} rows removed
 */
export function purgeExpired(db, retentionDays, now = Date.now()) {
  if (!(retentionDays > 0)) return { events: 0, sessions: 0 };
  const cutoff = now - retentionDays * DAY_MS;
  const deleteEvents = db.prepare('DELETE FROM events WHERE received_at < ?');
  const deleteSessions = db.prepare('DELETE FROM sessions WHERE last_seen < ?');
  db.exec('BEGIN');
  try {
    const events = deleteEvents.run(cutoff).changes;
    const sessions = deleteSessions.run(cutoff).changes;
    db.exec('COMMIT');
    return { events: Number(events), sessions: Number(sessions) };
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore — the original error is the one worth reporting
    }
    throw err;
  }
}

export default openDb;
