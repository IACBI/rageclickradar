// RageClickRadar — unit tests for the read/aggregation queries.
// No network: drive the exported query functions against an in-memory
// database seeded with a hand-computed fixture.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { openDb } from '../../server/db.js';
import {
  QueryError,
  getPages,
  getHeatmap,
  getHotspots,
  getSessions,
  getSessionDetail,
} from '../../server/queries.js';

function freshDb() {
  return openDb(':memory:');
}

// Fixture: 3 sessions (one mobile at vw=375), 2 pages, all 4 signal types.
//
// Hand-computed expectations (weights: rage 3, formaband 3, correction 2, dead 1):
//   /p1 rows: rage x2, dead x2, correction x1  -> score 3*2 + 1*2 + 2*1 = 10
//   /p2 rows: rage x2, dead x1, formaband x1, correction x1
//                                             -> score 3*2 + 1*1 + 3*1 + 2*1 = 12
function seededDb() {
  const db = freshDb();
  const insS = db.prepare(
    'INSERT INTO sessions (id, started_at, last_seen, vw, vh) VALUES (?, ?, ?, ?, ?)',
  );
  insS.run('s_aaaa1111bbbb', 1000, 5000, 1280, 720);
  insS.run('s_cccc2222dddd', 2000, 6000, 375, 812);
  insS.run('s_eeee3333ffff', 3000, 7000, 1280, 800);

  const insE = db.prepare(
    `INSERT INTO events
       (session_id, page, type, ts, x, y, doc_w, doc_h, selector, count, meta, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // --- /p1 ---
  insE.run('s_aaaa1111bbbb', '/p1', 'rage', 100, 10, 20, 1280, 2000, '#btn', 5, null, 5000);
  insE.run('s_aaaa1111bbbb', '/p1', 'dead', 200, 30, 40, 1280, 2000, '#btn', 1, null, 5000);
  insE.run('s_cccc2222dddd', '/p1', 'rage', 150, 50, 60, 375, 1500, '#link', 3, null, 6000);
  // Correction with no coordinates: must not appear in the heatmap.
  insE.run('s_cccc2222dddd', '/p1', 'correction', 300, null, null, 375, 1500, '#email', 10, null, 6000);
  // NULL selector: must be skipped by hotspots.
  insE.run('s_eeee3333ffff', '/p1', 'dead', 50, 70, 80, 1280, 2200, null, 1, null, 7000);
  // --- /p2 ---
  insE.run('s_aaaa1111bbbb', '/p2', 'formaband', 400, null, null, 1280, 2000, '#form', 1, '{"reason":"blur"}', 5000);
  insE.run('s_eeee3333ffff', '/p2', 'rage', 500, 90, 100, 1280, 2200, '#submit', 4, null, 7000);
  insE.run('s_eeee3333ffff', '/p2', 'rage', 600, 91, 101, 1280, 2200, '#submit', 2, null, 7000);
  // Empty-string selector: must also be skipped by hotspots.
  insE.run('s_eeee3333ffff', '/p2', 'dead', 700, 5, 6, 1280, 2200, '', 1, null, 7000);
  insE.run('s_cccc2222dddd', '/p2', 'correction', 800, null, null, 375, 1500, '#pwd', 12, null, 6000);
  return db;
}

// --- /api/pages -----------------------------------------------------------

test('pages: ranked by weighted score with exact counts and distinct sessions', () => {
  const db = seededDb();
  const pages = getPages(db);
  assert.equal(pages.length, 2);

  // /p2 (score 12) must rank above /p1 (score 10).
  assert.deepEqual(pages[0], {
    page: '/p2',
    score: 12,
    counts: { rage: 2, dead: 1, formaband: 1, correction: 1 },
    sessions: 3,
    lastSeen: 7000,
  });
  assert.deepEqual(pages[1], {
    page: '/p1',
    score: 10,
    counts: { rage: 2, dead: 2, formaband: 0, correction: 1 },
    sessions: 3, // 5 rows but only 3 distinct sessions
    lastSeen: 7000,
  });
});

test('pages: score counts one signal per row, ignoring the count column', () => {
  const db = freshDb();
  db.prepare(
    `INSERT INTO events
       (session_id, page, type, ts, x, y, doc_w, doc_h, selector, count, meta, received_at)
     VALUES ('s_zzzz9999yyyy', '/x', 'rage', 1, 1, 1, 100, 100, '#a', 999, NULL, 42)`,
  ).run();
  db.prepare(
    "INSERT INTO sessions (id, started_at, last_seen, vw, vh) VALUES ('s_zzzz9999yyyy', 1, 1, 800, 600)",
  ).run();
  const pages = getPages(db);
  assert.equal(pages[0].score, 3); // 1 row * weight 3, NOT 999 * 3
});

test('pages: empty DB returns []', () => {
  assert.deepEqual(getPages(freshDb()), []);
});

// --- /api/heatmap ---------------------------------------------------------

test('heatmap: page filter returns only coordinate-bearing rows for that page', () => {
  const db = seededDb();
  const { page, points } = getHeatmap(db, { page: '/p1' });
  assert.equal(page, '/p1');
  // 5 rows on /p1, but the correction row has no x/y -> 4 points.
  assert.equal(points.length, 4);
  assert.deepEqual(points[0], { x: 10, y: 20, docW: 1280, docH: 2000, type: 'rage', n: 5 });
  for (const p of points) {
    assert.notEqual(p.x, null);
    assert.notEqual(p.y, null);
  }
});

test('heatmap: type filter works', () => {
  const db = seededDb();
  const { points } = getHeatmap(db, { page: '/p1', type: 'rage' });
  assert.equal(points.length, 2);
  for (const p of points) assert.equal(p.type, 'rage');
});

test('heatmap: vwMin excludes points from the 375-vw session', () => {
  const db = seededDb();
  const { points } = getHeatmap(db, { page: '/p1', vwMin: '400' });
  assert.equal(points.length, 3); // e3 (session vw 375) is excluded
  for (const p of points) assert.notEqual(p.docW, 375);
});

test('heatmap: vwMax keeps only the mobile session', () => {
  const db = seededDb();
  const { points } = getHeatmap(db, { page: '/p1', vwMax: '400' });
  assert.equal(points.length, 1);
  assert.deepEqual(points[0], { x: 50, y: 60, docW: 375, docH: 1500, type: 'rage', n: 3 });
});

test('heatmap: invalid type throws QueryError 400', () => {
  const db = seededDb();
  assert.throws(
    () => getHeatmap(db, { page: '/p1', type: 'bogus' }),
    (err) => err instanceof QueryError && err.status === 400,
  );
});

test('heatmap: missing page throws QueryError 400', () => {
  const db = seededDb();
  assert.throws(
    () => getHeatmap(db, {}),
    (err) => err instanceof QueryError && err.status === 400,
  );
});

test('heatmap: non-integer vwMin throws QueryError 400', () => {
  const db = seededDb();
  assert.throws(
    () => getHeatmap(db, { page: '/p1', vwMin: 'abc' }),
    (err) => err instanceof QueryError && err.status === 400,
  );
});

test('heatmap: unknown page returns empty points, not an error', () => {
  const db = seededDb();
  assert.deepEqual(getHeatmap(db, { page: '/nope' }), { page: '/nope', points: [] });
});

// --- /api/hotspots --------------------------------------------------------

test('hotspots: grouped by selector, ranked by weighted score, magnitudes summed', () => {
  const db = seededDb();
  const { page, hotspots } = getHotspots(db, { page: '/p1' });
  assert.equal(page, '/p1');
  // NULL-selector dead row is skipped -> 3 hotspots.
  assert.deepEqual(hotspots, [
    {
      selector: '#btn',
      score: 4, // rage(3) + dead(1)
      counts: { rage: 1, dead: 1, formaband: 0, correction: 0 },
      totalMagnitude: 6, // 5 + 1
    },
    {
      selector: '#link',
      score: 3,
      counts: { rage: 1, dead: 0, formaband: 0, correction: 0 },
      totalMagnitude: 3,
    },
    {
      selector: '#email',
      score: 2,
      counts: { rage: 0, dead: 0, formaband: 0, correction: 1 },
      totalMagnitude: 10,
    },
  ]);
});

test('hotspots: empty-string selectors skipped; multiple same-selector rows merge', () => {
  const db = seededDb();
  const { hotspots } = getHotspots(db, { page: '/p2' });
  assert.deepEqual(
    hotspots.map((h) => h.selector),
    ['#submit', '#form', '#pwd'], // scores 6, 3, 2; the ''-selector dead row is gone
  );
  const submit = hotspots[0];
  assert.equal(submit.score, 6); // two rage rows
  assert.equal(submit.counts.rage, 2);
  assert.equal(submit.totalMagnitude, 6); // 4 + 2
});

test('hotspots: missing page throws QueryError 400; unknown page returns empty', () => {
  const db = seededDb();
  assert.throws(
    () => getHotspots(db, {}),
    (err) => err instanceof QueryError && err.status === 400,
  );
  assert.deepEqual(getHotspots(db, { page: '/nope' }), { page: '/nope', hotspots: [] });
});

// --- /api/sessions --------------------------------------------------------

test('sessions: newest first by last_seen with exact per-session aggregates', () => {
  const db = seededDb();
  const sessions = getSessions(db, {});
  assert.deepEqual(
    sessions.map((s) => s.id),
    ['s_eeee3333ffff', 's_cccc2222dddd', 's_aaaa1111bbbb'],
  );
  assert.deepEqual(sessions[0], {
    id: 's_eeee3333ffff',
    startedAt: 3000,
    lastSeen: 7000,
    vw: 1280,
    vh: 800,
    events: 4,
    pages: ['/p1', '/p2'],
    counts: { rage: 2, dead: 2, formaband: 0, correction: 0 },
  });
  assert.deepEqual(sessions[2].counts, { rage: 1, dead: 1, formaband: 1, correction: 0 });
  assert.equal(sessions[2].events, 3);
});

test('sessions: limit respected', () => {
  const db = seededDb();
  const sessions = getSessions(db, { limit: '2' });
  assert.deepEqual(
    sessions.map((s) => s.id),
    ['s_eeee3333ffff', 's_cccc2222dddd'],
  );
});

test('sessions: limit above the max is clamped, not an error', () => {
  const db = seededDb();
  assert.equal(getSessions(db, { limit: '9999' }).length, 3);
});

test('sessions: invalid limit throws QueryError 400', () => {
  const db = seededDb();
  for (const bad of ['abc', '0', '-5', '1.5']) {
    assert.throws(
      () => getSessions(db, { limit: bad }),
      (err) => err instanceof QueryError && err.status === 400,
      `limit=${bad} should be rejected`,
    );
  }
});

test('sessions: page filter restricts sessions and per-page aggregates', () => {
  const db = seededDb();
  const sessions = getSessions(db, { page: '/p1' });
  assert.equal(sessions.length, 3); // all three touched /p1
  const s3 = sessions.find((s) => s.id === 's_eeee3333ffff');
  // s3 has 4 events overall but only 1 on /p1.
  assert.equal(s3.events, 1);
  assert.deepEqual(s3.pages, ['/p1']);
  assert.deepEqual(s3.counts, { rage: 0, dead: 1, formaband: 0, correction: 0 });
});

test('sessions: empty DB returns []', () => {
  assert.deepEqual(getSessions(freshDb(), {}), []);
});

// --- /api/session (detail) ------------------------------------------------

test('session detail: events ordered by ts asc with parsed meta', () => {
  const db = seededDb();
  const detail = getSessionDetail(db, 's_aaaa1111bbbb');
  assert.equal(detail.id, 's_aaaa1111bbbb');
  assert.equal(detail.vw, 1280);
  assert.equal(detail.vh, 720);
  assert.equal(detail.startedAt, 1000);
  assert.deepEqual(
    detail.events.map((e) => e.ts),
    [100, 200, 400],
  );
  assert.deepEqual(detail.events[0], {
    page: '/p1',
    type: 'rage',
    ts: 100,
    x: 10,
    y: 20,
    selector: '#btn',
    n: 5,
    meta: null,
  });
  assert.deepEqual(detail.events[2].meta, { reason: 'blur' });
});

test('session detail: unknown id throws QueryError 404', () => {
  const db = seededDb();
  assert.throws(
    () => getSessionDetail(db, 's_doesnotexist'),
    (err) => err instanceof QueryError && err.status === 404,
  );
});
