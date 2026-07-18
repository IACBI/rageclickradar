// RageClickRadar — read/aggregation API (queries + handlers).
// All SQL lives here as prepared, fully-parameterized statements. The query
// functions are pure ((db, params) -> plain data) so the unit tests can drive
// them directly without an HTTP layer; the *Handler wrappers below adapt them
// to the (req, res, ctx) contract used by http.js.
//
// Scoring rule: every event ROW contributes SCORE_WEIGHTS[type] once (one row
// == one detected signal occurrence). The `count` column is signal magnitude
// (e.g. clicks in a rage burst), surfaced as `n`/`totalMagnitude` but never
// multiplied into the confusion score.

import { CONFIG } from '../shared/config.js';

const WEIGHTS = CONFIG.SCORE_WEIGHTS;
const TYPES = Object.freeze(['rage', 'dead', 'formaband', 'correction']);
const VALID_TYPES = new Set(TYPES);
const MAX_SESSIONS_LIMIT = 200;
const DEFAULT_SESSIONS_LIMIT = 50;

/**
 * Error carrying an HTTP status for invalid input (400) or missing resources
 * (404). Handlers translate it into a JSON { error } response.
 */
export class QueryError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'QueryError';
    this.status = status;
  }
}

// --- Param helpers --------------------------------------------------------

// Require a non-empty string page param.
function requirePage(params) {
  const page = params && params.page;
  if (typeof page !== 'string' || page.length === 0) {
    throw new QueryError('page is required');
  }
  return page;
}

// Optional signal type, validated against the known set.
function optionalType(params) {
  const type = params && params.type;
  if (type === undefined || type === null || type === '') return null;
  if (typeof type !== 'string' || !VALID_TYPES.has(type)) {
    throw new QueryError('invalid type');
  }
  return type;
}

// Optional integer param. Accepts numbers or numeric strings; absent -> null;
// present-but-not-an-integer -> 400.
function optionalInt(params, key) {
  const raw = params ? params[key] : undefined;
  if (raw === undefined || raw === null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(n)) {
    throw new QueryError(`invalid ${key}`);
  }
  return n;
}

// Build a zeroed per-type counts object.
function zeroCounts() {
  return { rage: 0, dead: 0, formaband: 0, correction: 0 };
}

// --- Queries --------------------------------------------------------------

/**
 * Per-page confusion summary, ranked by weighted score descending.
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {Array<{page:string, score:number, counts:object, sessions:number, lastSeen:number}>}
 */
export function getPages(db) {
  // Row counts per (page, type) drive both the counts object and the score.
  const perType = db
    .prepare('SELECT page, type, COUNT(*) AS cnt FROM events GROUP BY page, type')
    .all();
  // Distinct sessions and most-recent activity per page.
  const perPage = db
    .prepare(
      'SELECT page, COUNT(DISTINCT session_id) AS sessions, MAX(received_at) AS lastSeen ' +
        'FROM events GROUP BY page',
    )
    .all();

  const byPage = new Map();
  for (const row of perPage) {
    byPage.set(row.page, {
      page: row.page,
      score: 0,
      counts: zeroCounts(),
      sessions: row.sessions,
      lastSeen: row.lastSeen,
    });
  }
  for (const row of perType) {
    const entry = byPage.get(row.page);
    if (!entry) continue;
    if (Object.prototype.hasOwnProperty.call(entry.counts, row.type)) {
      entry.counts[row.type] = row.cnt;
    }
    entry.score += (WEIGHTS[row.type] || 0) * row.cnt;
  }

  return [...byPage.values()].sort((a, b) => b.score - a.score);
}

/**
 * Coordinate points for a page's heatmap. Only rows with both x and y present
 * are returned (form/correction rows without coordinates fall out naturally).
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{page:string, type?:string, vwMin?:number, vwMax?:number}} params
 */
export function getHeatmap(db, params) {
  const page = requirePage(params);
  const type = optionalType(params);
  const vwMin = optionalInt(params, 'vwMin');
  const vwMax = optionalInt(params, 'vwMax');

  const clauses = ['e.page = ?', 'e.x IS NOT NULL', 'e.y IS NOT NULL'];
  const args = [page];
  if (type !== null) {
    clauses.push('e.type = ?');
    args.push(type);
  }
  if (vwMin !== null) {
    clauses.push('s.vw >= ?');
    args.push(vwMin);
  }
  if (vwMax !== null) {
    clauses.push('s.vw <= ?');
    args.push(vwMax);
  }

  const rows = db
    .prepare(
      'SELECT e.x AS x, e.y AS y, e.doc_w AS docW, e.doc_h AS docH, ' +
        'e.type AS type, e.count AS n ' +
        'FROM events e JOIN sessions s ON s.id = e.session_id ' +
        'WHERE ' +
        clauses.join(' AND ') +
        ' ORDER BY e.id ASC',
    )
    .all(...args);

  // Re-wrap as plain objects (sqlite rows have a null prototype).
  const points = rows.map((r) => ({
    x: r.x,
    y: r.y,
    docW: r.docW,
    docH: r.docH,
    type: r.type,
    n: r.n,
  }));

  return { page, points };
}

/**
 * Selector-level hotspots for a page, ranked by weighted score descending.
 * Rows with a NULL or empty selector are skipped.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{page:string}} params
 */
export function getHotspots(db, params) {
  const page = requirePage(params);

  const rows = db
    .prepare(
      "SELECT selector, type, COUNT(*) AS cnt, SUM(count) AS mag " +
        "FROM events WHERE page = ? AND selector IS NOT NULL AND selector <> '' " +
        'GROUP BY selector, type',
    )
    .all(page);

  const bySelector = new Map();
  for (const row of rows) {
    let entry = bySelector.get(row.selector);
    if (!entry) {
      entry = { selector: row.selector, score: 0, counts: zeroCounts(), totalMagnitude: 0 };
      bySelector.set(row.selector, entry);
    }
    if (Object.prototype.hasOwnProperty.call(entry.counts, row.type)) {
      entry.counts[row.type] = row.cnt;
    }
    entry.score += (WEIGHTS[row.type] || 0) * row.cnt;
    entry.totalMagnitude += row.mag;
  }

  const hotspots = [...bySelector.values()].sort((a, b) => b.score - a.score);
  return { page, hotspots };
}

/**
 * Session list, newest-first by last_seen. An optional page filter restricts
 * both which sessions appear (those with at least one event on the page) and
 * the per-session aggregates, which are computed over the matching events.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{page?:string, limit?:number}} params
 */
export function getSessions(db, params) {
  const pageRaw = params ? params.page : undefined;
  let page = null;
  if (pageRaw !== undefined && pageRaw !== null && pageRaw !== '') {
    if (typeof pageRaw !== 'string') throw new QueryError('invalid page');
    page = pageRaw;
  }

  let limit = optionalInt(params, 'limit');
  if (limit === null) limit = DEFAULT_SESSIONS_LIMIT;
  if (limit < 1) throw new QueryError('invalid limit');
  if (limit > MAX_SESSIONS_LIMIT) limit = MAX_SESSIONS_LIMIT;

  const sessionRows = page
    ? db
        .prepare(
          'SELECT s.id, s.started_at AS startedAt, s.last_seen AS lastSeen, s.vw, s.vh ' +
            'FROM sessions s ' +
            'WHERE EXISTS (SELECT 1 FROM events e WHERE e.session_id = s.id AND e.page = ?) ' +
            'ORDER BY s.last_seen DESC LIMIT ?',
        )
        .all(page, limit)
    : db
        .prepare(
          'SELECT id, started_at AS startedAt, last_seen AS lastSeen, vw, vh ' +
            'FROM sessions ORDER BY last_seen DESC LIMIT ?',
        )
        .all(limit);

  if (sessionRows.length === 0) return [];

  // Pull the events for exactly these sessions in one parameterized query.
  const ids = sessionRows.map((s) => s.id);
  const placeholders = ids.map(() => '?').join(',');
  const evArgs = [...ids];
  let evSql =
    `SELECT session_id, page, type FROM events WHERE session_id IN (${placeholders})`;
  if (page) {
    evSql += ' AND page = ?';
    evArgs.push(page);
  }
  const eventRows = db.prepare(evSql).all(...evArgs);

  const agg = new Map();
  for (const id of ids) {
    agg.set(id, { events: 0, pages: new Set(), counts: zeroCounts() });
  }
  for (const row of eventRows) {
    const a = agg.get(row.session_id);
    if (!a) continue;
    a.events += 1;
    a.pages.add(row.page);
    if (Object.prototype.hasOwnProperty.call(a.counts, row.type)) {
      a.counts[row.type] += 1;
    }
  }

  return sessionRows.map((s) => {
    const a = agg.get(s.id);
    return {
      id: s.id,
      startedAt: s.startedAt,
      lastSeen: s.lastSeen,
      vw: s.vw,
      vh: s.vh,
      events: a.events,
      pages: [...a.pages].sort(),
      counts: a.counts,
    };
  });
}

/**
 * Full detail for one session, with its events ordered by ts ascending.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} id
 */
export function getSessionDetail(db, id) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new QueryError('id is required');
  }
  const session = db
    .prepare('SELECT id, vw, vh, started_at AS startedAt FROM sessions WHERE id = ?')
    .get(id);
  if (!session) {
    throw new QueryError('session not found', 404);
  }

  const rows = db
    .prepare(
      'SELECT page, type, ts, x, y, selector, count AS n, meta ' +
        'FROM events WHERE session_id = ? ORDER BY ts ASC',
    )
    .all(id);

  const events = rows.map((r) => {
    let meta = null;
    if (r.meta !== null && r.meta !== undefined) {
      // meta is JSON text; fall back to the raw string if it was truncated.
      try {
        meta = JSON.parse(r.meta);
      } catch {
        meta = r.meta;
      }
    }
    return {
      page: r.page,
      type: r.type,
      ts: r.ts,
      x: r.x,
      y: r.y,
      selector: r.selector,
      n: r.n,
      meta,
    };
  });

  return {
    id: session.id,
    vw: session.vw,
    vh: session.vh,
    startedAt: session.startedAt,
    events,
  };
}

// --- HTTP handlers --------------------------------------------------------

function sendJson(res, status, obj) {
  const payload = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
  });
  res.end(payload);
}

// Parse the request URL's query string into a plain object of strings.
function queryParams(req) {
  const url = new URL(req.url, 'http://localhost');
  const out = {};
  for (const [k, v] of url.searchParams) out[k] = v;
  return out;
}

// Wrap a pure query function into an (req, res, ctx) handler. QueryError ->
// its status; anything else bubbles to http.js's 500 catch.
function handlerFor(extract) {
  return (req, res, ctx) => {
    let result;
    try {
      result = extract(ctx.db, req);
    } catch (err) {
      if (err instanceof QueryError) {
        sendJson(res, err.status, { error: err.message });
        return;
      }
      throw err;
    }
    sendJson(res, 200, result);
  };
}

export const pagesHandler = handlerFor((db) => getPages(db));
export const heatmapHandler = handlerFor((db, req) => getHeatmap(db, queryParams(req)));
export const hotspotsHandler = handlerFor((db, req) => getHotspots(db, queryParams(req)));
export const sessionsHandler = handlerFor((db, req) => getSessions(db, queryParams(req)));
// Exact-path router: session detail is addressed as /api/session?id=...
export const sessionDetailHandler = handlerFor((db, req) =>
  getSessionDetail(db, queryParams(req).id),
);

/**
 * Register every read endpoint on the router.
 * @param {(method:string, routePath:string, handler:Function)=>void} registerRoute
 */
export function registerReadRoutes(registerRoute) {
  registerRoute('GET', '/api/pages', pagesHandler);
  registerRoute('GET', '/api/heatmap', heatmapHandler);
  registerRoute('GET', '/api/hotspots', hotspotsHandler);
  registerRoute('GET', '/api/sessions', sessionsHandler);
  registerRoute('GET', '/api/session', sessionDetailHandler);
}
