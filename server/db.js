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
      'You need Node >= 22.5. On Node 22.5 through 23.3 you must also start\n' +
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

export default openDb;
