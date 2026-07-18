// RageClickRadar — unit tests for the collector body handler.
// No network: drive handleCollectBody() against an in-memory database.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { openDb } from '../../server/db.js';
import { handleCollectBody } from '../../server/collect.js';

// Build a fresh in-memory DB per test to keep them isolated.
function freshDb() {
  return openDb(':memory:');
}

function validEnvelope(overrides = {}) {
  return {
    v: 1,
    sid: 's_a1b2c3d4e5f6',
    page: '/pricing',
    vw: 1280,
    vh: 720,
    dw: 1280,
    dh: 3400,
    events: [
      { t: 'rage', ts: 4210, x: 512.0, y: 1180.0, sel: 'button#buy-now', n: 5, m: {} },
    ],
    ...overrides,
  };
}

test('valid batch stores session and event rows with correct values', () => {
  const db = freshDb();
  const res = handleCollectBody(db, JSON.stringify(validEnvelope()));
  assert.equal(res.status, 204);
  assert.equal(res.body, undefined);

  const sess = db.prepare('SELECT * FROM sessions').all();
  assert.equal(sess.length, 1);
  assert.equal(sess[0].id, 's_a1b2c3d4e5f6');
  assert.equal(sess[0].vw, 1280);
  assert.equal(sess[0].vh, 720);
  assert.ok(sess[0].started_at > 0);
  assert.equal(sess[0].started_at, sess[0].last_seen);

  const events = db.prepare('SELECT * FROM events').all();
  assert.equal(events.length, 1);
  const e = events[0];
  assert.equal(e.session_id, 's_a1b2c3d4e5f6');
  assert.equal(e.page, '/pricing');
  assert.equal(e.type, 'rage');
  assert.equal(e.ts, 4210);
  assert.equal(e.x, 512);
  assert.equal(e.y, 1180);
  assert.equal(e.doc_w, 1280);
  assert.equal(e.doc_h, 3400);
  assert.equal(e.selector, 'button#buy-now');
  assert.equal(e.count, 5);
  assert.equal(e.meta, '{}');
  assert.ok(e.received_at > 0);
});

test('malformed JSON returns 400', () => {
  const db = freshDb();
  const res = handleCollectBody(db, '{not json');
  assert.equal(res.status, 400);
  assert.ok(res.body.error);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM events').get().c, 0);
});

test('wrong version returns 400', () => {
  const db = freshDb();
  const res = handleCollectBody(db, JSON.stringify(validEnvelope({ v: 2 })));
  assert.equal(res.status, 400);
});

test('bad sid returns 400', () => {
  const db = freshDb();
  const res = handleCollectBody(db, JSON.stringify(validEnvelope({ sid: 'nope' })));
  assert.equal(res.status, 400);
});

test('bad page (no leading slash) returns 400', () => {
  const db = freshDb();
  const res = handleCollectBody(db, JSON.stringify(validEnvelope({ page: 'pricing' })));
  assert.equal(res.status, 400);
});

test('oversize events array (51) returns 400', () => {
  const db = freshDb();
  const events = [];
  for (let i = 0; i < 51; i++) events.push({ t: 'dead', ts: i });
  const res = handleCollectBody(db, JSON.stringify(validEnvelope({ events })));
  assert.equal(res.status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM events').get().c, 0);
});

test('batch with 1 valid + 2 invalid-type events stores exactly 1 row', () => {
  const db = freshDb();
  const events = [
    { t: 'rage', ts: 100 },
    { t: 'bogus', ts: 200 },
    { t: '', ts: 300 },
  ];
  const res = handleCollectBody(db, JSON.stringify(validEnvelope({ events })));
  assert.equal(res.status, 204);
  const rows = db.prepare('SELECT * FROM events').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, 'rage');
});

test('all events invalid returns 400', () => {
  const db = freshDb();
  const events = [
    { t: 'bogus', ts: 1 },
    { t: 'dead', ts: -1 },
  ];
  const res = handleCollectBody(db, JSON.stringify(validEnvelope({ events })));
  assert.equal(res.status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM events').get().c, 0);
});

test('selector truncated to SELECTOR_MAX_LEN (120)', () => {
  const db = freshDb();
  const longSel = 'a'.repeat(300);
  const events = [{ t: 'dead', ts: 1, sel: longSel }];
  const res = handleCollectBody(db, JSON.stringify(validEnvelope({ events })));
  assert.equal(res.status, 204);
  const row = db.prepare('SELECT selector FROM events').get();
  assert.equal(row.selector.length, 120);
});

test('page with ?query#hash is stored stripped', () => {
  const db = freshDb();
  const res = handleCollectBody(
    db,
    JSON.stringify(validEnvelope({ page: '/search?q=secret#frag' })),
  );
  assert.equal(res.status, 204);
  const row = db.prepare('SELECT page FROM events').get();
  assert.equal(row.page, '/search');
});

test('x is clamped to dw', () => {
  const db = freshDb();
  const events = [{ t: 'rage', ts: 1, x: 99999, y: 10 }];
  const res = handleCollectBody(db, JSON.stringify(validEnvelope({ dw: 1000, events })));
  assert.equal(res.status, 204);
  const row = db.prepare('SELECT x FROM events').get();
  assert.equal(row.x, 1000);
});

test('session upsert updates last_seen but not started_at', async () => {
  const db = freshDb();
  const r1 = handleCollectBody(db, JSON.stringify(validEnvelope()));
  assert.equal(r1.status, 204);
  const first = db.prepare('SELECT started_at, last_seen FROM sessions').get();

  // Wait so Date.now() advances, then send a second batch for the same sid.
  await new Promise((resolve) => setTimeout(resolve, 5));
  const r2 = handleCollectBody(
    db,
    JSON.stringify(validEnvelope({ events: [{ t: 'dead', ts: 900 }] })),
  );
  assert.equal(r2.status, 204);

  const after = db.prepare('SELECT started_at, last_seen FROM sessions').get();
  assert.equal(db.prepare('SELECT COUNT(*) c FROM sessions').get().c, 1);
  assert.equal(after.started_at, first.started_at); // unchanged
  assert.ok(after.last_seen >= first.last_seen); // advanced (or equal)
});

test('privacy: schema has no IP/UA-like columns and meta holds only m', () => {
  const db = freshDb();

  // Column inventory for both tables must contain no ip/ua/agent/header columns.
  const cols = [
    ...db.prepare('PRAGMA table_info(sessions)').all(),
    ...db.prepare('PRAGMA table_info(events)').all(),
  ].map((c) => c.name.toLowerCase());
  for (const c of cols) {
    assert.ok(!/ip|agent|\bua\b|user_?agent|header/.test(c), `unexpected column: ${c}`);
  }

  // Simulate a client that smuggles fabricated IP/UA markers alongside the
  // whitelisted fields. None of it must reach any stored string.
  const marker = '203.0.113.77-Mozilla/5.0-EVIL';
  const payload = validEnvelope({
    ip: marker,
    ua: marker,
    userAgent: marker,
    'x-forwarded-for': marker,
    events: [{ t: 'rage', ts: 1, sel: 'button', m: { note: 'ok' }, ip: marker }],
  });
  const res = handleCollectBody(db, JSON.stringify(payload));
  assert.equal(res.status, 204);

  const ev = db.prepare('SELECT * FROM events').get();
  const sess = db.prepare('SELECT * FROM sessions').get();
  for (const v of [...Object.values(ev), ...Object.values(sess)]) {
    if (typeof v === 'string') assert.ok(!v.includes(marker), `marker leaked: ${v}`);
  }
  // meta reflects only the whitelisted m object, nothing smuggled in.
  assert.equal(ev.meta, JSON.stringify({ note: 'ok' }));
});
