// RageClickRadar — HTTP layer (node:http, zero runtime deps).
// Owns routing, CORS, static file serving, body cap, and in-memory
// per-IP rate limiting. Storage/validation lives in collect.js.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleCollectBody } from './collect.js';

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

// In-memory token-bucket rate limiter. IPs live only in this map, are never
// logged or persisted, and stale entries are pruned.
function createRateLimiter(limitPerMin) {
  const WINDOW_MS = 60000;
  const buckets = new Map();

  function allow(ip) {
    const now = Date.now();
    let b = buckets.get(ip);
    if (!b) {
      b = { tokens: limitPerMin, last: now };
      buckets.set(ip, b);
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
    for (const [ip, b] of buckets) {
      if (now - b.last > WINDOW_MS * 2) buckets.delete(ip);
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
    result = handleCollectBody(ctx.db, raw);
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

  // Rate limit the collect endpoint only.
  if (isCollect) {
    const ip = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
    if (!ctx.rateLimiter.allow(ip)) {
      sendJson(res, 429, { error: 'rate limit exceeded' }, cors);
      return;
    }
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
  const rateLimiter = createRateLimiter(config.RATE_LIMIT_PER_MIN);
  const ctx = { db, config, rateLimiter };

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
