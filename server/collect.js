// RageClickRadar — collector body handler.
// Pure-ish: takes the raw request body string and an open DB handle and
// returns { status, body? }. No req/res objects, so tests can drive it
// directly. Only whitelisted wire fields ever reach the database — no IP,
// no user agent, no headers. received_at is the single wall-clock value.

import { CONFIG } from '../shared/config.js';

const SID_RE = /^s_[a-z0-9]{8,16}$/;
const VALID_TYPES = new Set(['rage', 'dead', 'formaband', 'correction']);
const PAGE_MAX_LEN = 512;
const DIM_MAX = 100000;
const META_MAX_LEN = 500;
const N_MAX = 10000;

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Strip any query/fragment and enforce the length cap. Returns the cleaned
// path, or null if the input is not a valid page string.
function normalizePage(page) {
  if (typeof page !== 'string' || !page.startsWith('/')) return null;
  let clean = page;
  const cut = Math.min(
    ...[clean.indexOf('?'), clean.indexOf('#')].filter((i) => i !== -1),
    clean.length,
  );
  clean = clean.slice(0, cut);
  if (clean.length === 0 || clean.length > PAGE_MAX_LEN) return null;
  return clean;
}

// Validate + normalize a single event against the envelope dimensions.
// Returns a normalized row object, or null if the event is invalid (dropped).
function normalizeEvent(ev, dw, dh) {
  if (!isPlainObject(ev)) return null;

  if (!VALID_TYPES.has(ev.t)) return null;

  if (!isFiniteNumber(ev.ts) || ev.ts < 0) return null;
  const ts = Math.trunc(ev.ts);

  // x / y are optional; when present they must be finite and >= 0, and are
  // clamped into the document bounds.
  let x = null;
  if (ev.x !== undefined && ev.x !== null) {
    if (!isFiniteNumber(ev.x) || ev.x < 0) return null;
    x = Math.min(ev.x, dw);
  }
  let y = null;
  if (ev.y !== undefined && ev.y !== null) {
    if (!isFiniteNumber(ev.y) || ev.y < 0) return null;
    y = Math.min(ev.y, dh);
  }

  let selector = null;
  if (ev.sel !== undefined && ev.sel !== null) {
    if (typeof ev.sel !== 'string') return null;
    selector = ev.sel.slice(0, CONFIG.SELECTOR_MAX_LEN);
  }

  let count = 1;
  if (ev.n !== undefined && ev.n !== null) {
    if (!Number.isInteger(ev.n) || ev.n < 1 || ev.n > N_MAX) return null;
    count = ev.n;
  }

  let meta = null;
  if (ev.m !== undefined && ev.m !== null) {
    if (!isPlainObject(ev.m)) return null;
    meta = JSON.stringify(ev.m).slice(0, META_MAX_LEN);
  }

  return { type: ev.t, ts, x, y, selector, count, meta };
}

/**
 * Validate a collector payload and persist it.
 * @param {import('node:sqlite').DatabaseSync} db Open database handle.
 * @param {string} rawBody Raw request body (may be text/plain via sendBeacon).
 * @returns {{status: number, body?: object}} 204 on success (no body),
 *   otherwise 400 with an { error } body.
 */
export function handleCollectBody(db, rawBody) {
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: 'invalid JSON' } };
  }

  if (!isPlainObject(payload)) {
    return { status: 400, body: { error: 'body must be a JSON object' } };
  }
  if (payload.v !== 1) {
    return { status: 400, body: { error: 'unsupported version' } };
  }
  if (typeof payload.sid !== 'string' || !SID_RE.test(payload.sid)) {
    return { status: 400, body: { error: 'invalid sid' } };
  }

  const page = normalizePage(payload.page);
  if (page === null) {
    return { status: 400, body: { error: 'invalid page' } };
  }

  for (const key of ['vw', 'vh', 'dw', 'dh']) {
    const val = payload[key];
    if (!isFiniteNumber(val) || val <= 0 || val >= DIM_MAX) {
      return { status: 400, body: { error: `invalid ${key}` } };
    }
  }
  const vw = Math.trunc(payload.vw);
  const vh = Math.trunc(payload.vh);
  const dw = Math.trunc(payload.dw);
  const dh = Math.trunc(payload.dh);

  if (
    !Array.isArray(payload.events) ||
    payload.events.length < 1 ||
    payload.events.length > CONFIG.BATCH_MAX_EVENTS
  ) {
    return { status: 400, body: { error: 'invalid events array' } };
  }

  const rows = [];
  for (const ev of payload.events) {
    const row = normalizeEvent(ev, dw, dh);
    if (row !== null) rows.push(row);
  }
  if (rows.length === 0) {
    return { status: 400, body: { error: 'no valid events' } };
  }

  const now = Date.now();

  const upsertSession = db.prepare(
    `INSERT INTO sessions (id, started_at, last_seen, vw, vh)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen`,
  );
  const insertEvent = db.prepare(
    `INSERT INTO events
       (session_id, page, type, ts, x, y, doc_w, doc_h, selector, count, meta, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  db.exec('BEGIN');
  try {
    upsertSession.run(payload.sid, now, now, vw, vh);
    for (const r of rows) {
      insertEvent.run(
        payload.sid,
        page,
        r.type,
        r.ts,
        r.x,
        r.y,
        dw,
        dh,
        r.selector,
        r.count,
        r.meta,
        now,
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return { status: 500, body: { error: 'storage failure' } };
  }

  return { status: 204 };
}

export default handleCollectBody;
