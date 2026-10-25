// RageClickRadar — unit tests for data retention (RETENTION_DAYS). Runs against
// in-memory databases with an injected clock, so nothing depends on wall time.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { openDb, parseRetentionDays, purgeExpired } from '../../server/db.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 26);

// Two sessions go stale (120 days) and one stays recent. The mixed session has
// a recent last_seen but an old event, so only that event should go.
function seededDb() {
  const db = openDb(':memory:');
  const insSession = db.prepare(
    'INSERT INTO sessions (id, started_at, last_seen, vw, vh) VALUES (?, ?, ?, ?, ?)',
  );
  const insEvent = db.prepare(
    'INSERT INTO events (session_id, page, type, ts, received_at) VALUES (?, ?, ?, ?, ?)',
  );
  insSession.run('s_old000000001', NOW - 120 * DAY, NOW - 100 * DAY, 800, 600);
  insEvent.run('s_old000000001', '/a', 'dead', 1, NOW - 120 * DAY);
  insEvent.run('s_old000000001', '/a', 'rage', 2, NOW - 100 * DAY);
  insSession.run('s_mix000000001', NOW - 120 * DAY, NOW - 1 * DAY, 800, 600);
  insEvent.run('s_mix000000001', '/b', 'dead', 1, NOW - 100 * DAY);
  insEvent.run('s_mix000000001', '/b', 'rage', 2, NOW - 1 * DAY);
  insSession.run('s_new000000001', NOW - 2 * DAY, NOW - 1 * DAY, 800, 600);
  insEvent.run('s_new000000001', '/a', 'dead', 1, NOW - 2 * DAY);
  return db;
}

function count(db, table) {
  return db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
}

test('RETENTION_DAYS: unset, empty and 0 mean keep forever; whole days parse', () => {
  assert.equal(parseRetentionDays(undefined), 0);
  assert.equal(parseRetentionDays(''), 0);
  assert.equal(parseRetentionDays('0'), 0);
  assert.equal(parseRetentionDays('90'), 90);
});

test('RETENTION_DAYS: anything that is not a whole number of days throws', () => {
  for (const bad of ['abc', '-1', '1.5', '90d', ' 7', '1e3']) {
    assert.throws(() => parseRetentionDays(bad), /RETENTION_DAYS: must be a whole number/, bad);
  }
});

test('retention is off by default: purge with 0 days deletes nothing', () => {
  const db = seededDb();
  const before = [count(db, 'events'), count(db, 'sessions')];
  const removed = purgeExpired(db, parseRetentionDays(undefined), NOW);
  assert.deepEqual(removed, { events: 0, sessions: 0 });
  assert.deepEqual([count(db, 'events'), count(db, 'sessions')], before);
});

test('old events and stale sessions are removed, recent rows are kept', () => {
  const db = seededDb();
  const removed = purgeExpired(db, 90, NOW);
  assert.deepEqual(removed, { events: 3, sessions: 1 });

  const sessions = db.prepare('SELECT id FROM sessions ORDER BY id').all().map((r) => r.id);
  assert.deepEqual(sessions, ['s_mix000000001', 's_new000000001']);

  // Every surviving event is recent, and the mixed session keeps its recent one.
  const events = db.prepare('SELECT session_id, received_at FROM events ORDER BY id').all();
  assert.equal(events.length, 2);
  for (const e of events) assert.ok(e.received_at >= NOW - 90 * DAY);
  assert.equal(events[0].session_id, 's_mix000000001');
});

test('an event exactly at the cutoff is kept (the boundary is strict)', () => {
  const db = openDb(':memory:');
  db.prepare(
    'INSERT INTO events (session_id, page, type, ts, received_at) VALUES (?, ?, ?, ?, ?)',
  ).run('s_edge00000001', '/a', 'dead', 1, NOW - 90 * DAY);
  assert.deepEqual(purgeExpired(db, 90, NOW), { events: 0, sessions: 0 });
  assert.equal(count(db, 'events'), 1);
});

test('a second purge with nothing expired is a no-op', () => {
  const db = seededDb();
  purgeExpired(db, 90, NOW);
  assert.deepEqual(purgeExpired(db, 90, NOW), { events: 0, sessions: 0 });
});

test('the received_at index exists so the purge does not scan the table', () => {
  const db = openDb(':memory:');
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_events_received'")
    .get();
  assert.ok(row, 'idx_events_received is missing');
});
