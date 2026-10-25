// RageClickRadar — HTTP layer (node:http, zero runtime deps).
// Owns routing, CORS, static file serving, body cap, and in-memory
// per-IP rate limiting. Storage/validation lives in collect.js.

import http from 'node:http';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleCollectBody } from './collect.js';
import { registerReadRoutes } from './queries.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DASHBOARD_DIR = path.join(ROOT, 'dashboard');
const DEMO_DIR = path.join(ROOT, 'demo');
const RADAR_FILE = path.join(ROOT, 'tracker', 'dist', 'radar.min.js');

// CORS is applied to /api/collect responses only.
const COLLECT_CORS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
});

// Read API endpoints get their own, more generous per-IP budget than the
// write path (/api/collect, whose limit comes from config.RATE_LIMIT_PER_MIN).
const READ_RATE_LIMIT_PER_MIN = 300;

// --- Route table ----------------------------------------------------------
// Keyed by pathname -> { METHOD: handler }. A handler is (req, res, ctx).
// Adding a read endpoint later is a single registerRoute() call.
export const apiRoutes = new Map();

/**
 * Register an API route handler.
 * @param {string} method HTTP method, e.g. 'GET' or 'POST'.
 * @param {string} routePath Exact pathname, e.g. '/api/heatmap'.
 * @param {(req: http.IncomingMessage, res: http.ServerResponse, ctx: object) => void} handler
 */
export function registerRoute(method, routePath, handler) {
  let byMethod = apiRoutes.get(routePath);
  if (!byMethod) {
    byMethod = {};
    apiRoutes.set(routePath, byMethod);
  }
  byMethod[method.toUpperCase()] = handler;
}

// --- Client identity for rate limiting ------------------------------------

// Socket peers can appear as IPv4-mapped IPv6 (::ffff:127.0.0.1) or in any
// IPv6 spelling, so the peer and the configured proxies are compared in one
// canonical form.
function canonicalIp(ip) {
  let s = ip.trim().toLowerCase();
  if (net.isIPv6(s)) {
    s = new URL(`http://[${s}]`).hostname.slice(1, -1);
    const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(s);
    if (mapped) {
      const v = parseInt(mapped[1], 16) * 65536 + parseInt(mapped[2], 16);
      s = [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].join('.');
    }
  }
  return s;
}

/**
 * Parse the TRUST_PROXY setting: a comma-separated list of exact proxy IPs.
 * Unset or empty trusts no proxy. An invalid entry throws, so a typo fails at
 * startup rather than silently trusting nothing.
 * @param {string|undefined} raw
 * @returns {Set<string>} canonical IPs
 */
export function parseTrustedProxies(raw) {
  const out = new Set();
  if (!raw) return out;
  for (const part of raw.split(',')) {
    const entry = part.trim();
    if (entry === '') continue;
    if (!net.isIP(entry) || entry.includes('%')) {
      throw new Error(`TRUST_PROXY: invalid IP address "${entry}"`);
    }
    out.add(canonicalIp(entry));
  }
  return out;
}

// One X-Forwarded-For hop as an address. Proxies commonly append a port
// (`a.b.c.d:port`) or bracket an IPv6 address (`[addr]` or `[addr]:port`), so
// those forms are unwrapped first. A bare IPv6 address has several colons and
// is left alone. Returns null for a hop that is not an address at all.
function hopAddress(raw) {
  let s = raw.trim();
  if (s.startsWith('[')) {
    const close = s.indexOf(']');
    if (close === -1) return null;
    const after = s.slice(close + 1);
    if (after !== '' && !/^:\d+$/.test(after)) return null;
    s = s.slice(1, close);
  } else if ((s.match(/:/g) || []).length === 1) {
    const colon = s.indexOf(':');
    if (!/^\d+$/.test(s.slice(colon + 1))) return null;
    s = s.slice(0, colon);
  }
  if (!net.isIP(s) || s.includes('%')) return null;
  return canonicalIp(s);
}

// Rate-limit key for a request. X-Forwarded-For is read only when the immediate
// peer is a trusted proxy. Walking it right-to-left and skipping trusted hops
// means a client cannot choose its own bucket by prepending addresses: each
// proxy appends the address it actually saw, and that entry is the one used.
function clientKeyOf(req, trustedProxies) {
  const peerRaw = req.socket && req.socket.remoteAddress;
  const peer = peerRaw ? canonicalIp(peerRaw) : 'unknown';
  if (!trustedProxies.has(peer)) return peer;

  const xff = req.headers && req.headers['x-forwarded-for'];
  if (typeof xff !== 'string') return peer;
  const hops = xff.split(',');
  for (let i = hops.length - 1; i >= 0; i--) {
    // An empty hop (for example a trailing comma) names no client: skip it.
    if (hops[i].trim() === '') continue;
    // A hop that is not an address means the header cannot be trusted.
    const ip = hopAddress(hops[i]);
    if (ip === null) return peer;
    if (!trustedProxies.has(ip)) return ip;
  }
  return peer;
}

// --- Helpers --------------------------------------------------------------
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function contentTypeFor(file) {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function sendJson(res, status, obj, extraHeaders) {
  const payload = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    ...(extraHeaders || {}),
  });
  res.end(payload);
}

// Read the request body, enforcing a hard byte cap. Rejects with
// { tooLarge: true } and destroys the socket once the cap is exceeded.
function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject({ tooLarge: true });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', (err) => reject(err));
  });
}

// In-memory token-bucket rate limiter with independent named budgets (e.g.
// 'collect' vs. 'read') sharing one bucket map and one prune loop. IPs live
// only in this map, are never logged or persisted, and stale entries are
// pruned. `limits` maps bucket name -> per-minute allowance.
function createRateLimiter(limits) {
  const WINDOW_MS = 60000;
  const buckets = new Map();

  // Namespace each IP under its bucket so the budgets never cross-contaminate.
  function keyOf(bucket, ip) {
    return bucket + '\0' + ip;
  }

  function allow(bucket, ip) {
    const limitPerMin = limits[bucket];
    const now = Date.now();
    const key = keyOf(bucket, ip);
    let b = buckets.get(key);
    if (!b) {
      b = { tokens: limitPerMin, last: now };
      buckets.set(key, b);
    }
    const refill = ((now - b.last) / WINDOW_MS) * limitPerMin;
    b.tokens = Math.min(limitPerMin, b.tokens + refill);
    b.last = now;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return true;
    }
    return false;
  }

  function prune() {
    const now = Date.now();
    for (const [key, b] of buckets) {
      if (now - b.last > WINDOW_MS * 2) buckets.delete(key);
    }
  }

  return { allow, prune };
}

// Join a relative request path onto a base directory, rejecting traversal
// attempts. Returns an absolute path inside baseDir, or null.
function safeJoin(baseDir, rel) {
  let relClean = rel.replace(/^\/+/, '');
  if (relClean === '' || relClean.endsWith('/')) relClean += 'index.html';
  const candidate = path.resolve(baseDir, relClean);
  if (candidate !== baseDir && !candidate.startsWith(baseDir + path.sep)) {
    return null;
  }
  return candidate;
}

// Map a request pathname to a static file descriptor, or null for 404.
function resolveStatic(pathname) {
  if (pathname === '/radar.js') {
    return { file: RADAR_FILE, contentType: 'text/javascript', cacheControl: 'no-cache' };
  }

  let baseDir;
  let rel;
  if (pathname === '/demo' || pathname === '/demo/') {
    baseDir = DEMO_DIR;
    rel = 'index.html';
  } else if (pathname.startsWith('/demo/')) {
    baseDir = DEMO_DIR;
    rel = pathname.slice('/demo/'.length);
  } else {
    baseDir = DASHBOARD_DIR;
    rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  }

  const file = safeJoin(baseDir, rel);
  if (!file) return null;
  return { file, contentType: contentTypeFor(file), cacheControl: null };
}

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: 'method not allowed' });
    return;
  }
  const resolved = resolveStatic(pathname);
  if (!resolved) {
    sendJson(res, 404, { error: 'not found' });
    return;
  }
  fs.readFile(resolved.file, (err, data) => {
    if (err) {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    const headers = { 'Content-Type': resolved.contentType, 'Content-Length': data.length };
    if (resolved.cacheControl) headers['Cache-Control'] = resolved.cacheControl;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

// --- Built-in routes ------------------------------------------------------
async function collectHandler(req, res, ctx) {
  let raw;
  try {
    raw = await readBody(req, ctx.config.MAX_BODY_BYTES);
  } catch (err) {
    if (err && err.tooLarge) {
      sendJson(res, 413, { error: 'payload too large' }, COLLECT_CORS);
    } else {
      sendJson(res, 400, { error: 'read error' }, COLLECT_CORS);
    }
    return;
  }

  let result;
  try {
    result = handleCollectBody(ctx.db, raw, { redactPaths: ctx.config.REDACT_PATHS !== false });
  } catch {
    sendJson(res, 500, { error: 'internal error' }, COLLECT_CORS);
    return;
  }

  if (result.status === 204) {
    res.writeHead(204, COLLECT_CORS);
    res.end();
    return;
  }
  sendJson(res, result.status, result.body, COLLECT_CORS);
}

registerRoute('POST', '/api/collect', collectHandler);

// Read/aggregation endpoints (pages, heatmap, hotspots, sessions).
registerReadRoutes(registerRoute);

// --- Request dispatch -----------------------------------------------------
function handleApi(req, res, ctx, pathname) {
  const method = req.method;
  const isCollect = pathname === '/api/collect';
  const cors = isCollect ? COLLECT_CORS : undefined;

  // Defensive CORS preflight for the collect endpoint.
  if (method === 'OPTIONS' && isCollect) {
    res.writeHead(204, COLLECT_CORS);
    res.end();
    return;
  }

  // Rate limit every /api/* request: the write path (/api/collect) on its
  // tight budget, read endpoints on their own generous one. Static file and
  // dashboard serving never reaches here, so it is never limited. Keyed on the
  // socket address, or on the forwarded client when TRUST_PROXY names the peer.
  const bucket = isCollect ? 'collect' : 'read';
  const key = clientKeyOf(req, ctx.trustedProxies);
  if (!ctx.rateLimiter.allow(bucket, key)) {
    sendJson(res, 429, { error: 'rate limit exceeded' }, cors);
    return;
  }

  const byMethod = apiRoutes.get(pathname);
  if (!byMethod) {
    sendJson(res, 404, { error: 'not found' }, cors);
    return;
  }
  const handler = byMethod[method];
  if (!handler) {
    sendJson(res, 405, { error: 'method not allowed' }, cors);
    return;
  }

  Promise.resolve(handler(req, res, ctx)).catch(() => {
    if (!res.headersSent) sendJson(res, 500, { error: 'internal error' }, cors);
  });
}

/**
 * Build the low-level request handler with its own rate-limiter instance.
 * Exported for testability (drive it without binding a socket).
 * @returns {(req: http.IncomingMessage, res: http.ServerResponse) => void}
 */
export function createRequestHandler(db, config) {
  const rateLimiter = createRateLimiter({
    collect: config.RATE_LIMIT_PER_MIN,
    read: READ_RATE_LIMIT_PER_MIN,
  });
  const trustedProxies = config.TRUSTED_PROXIES || new Set();
  const ctx = { db, config, rateLimiter, trustedProxies };

  // Periodically drop stale IP buckets; unref so it never holds the process.
  const pruneTimer = setInterval(() => rateLimiter.prune(), 60000);
  if (typeof pruneTimer.unref === 'function') pruneTimer.unref();

  return function requestHandler(req, res) {
    let pathname;
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch {
      sendJson(res, 400, { error: 'bad request' });
      return;
    }

    if (pathname.startsWith('/api/')) {
      handleApi(req, res, ctx, pathname);
      return;
    }
    serveStatic(req, res, pathname);
  };
}

/**
 * Create the RageClickRadar HTTP server.
 * @param {import('node:sqlite').DatabaseSync} db Open database handle.
 * @param {object} config Runtime config (CONFIG from shared/config.js).
 * @returns {http.Server}
 */
export function createServer(db, config) {
  return http.createServer(createRequestHandler(db, config));
}

export default createServer;
