// RageClickRadar — unit tests for the HTTP layer's per-IP rate limiting.
// No sockets: drive createRequestHandler() with mock req/res objects. Only the
// synchronous 429 decision (taken before the handler runs) is asserted, so the
// async read/collect handlers do not need real streaming behavior.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { openDb } from '../../server/db.js';
import { createRequestHandler } from '../../server/http.js';
import { CONFIG } from '../../shared/config.js';

// Minimal ServerResponse stand-in capturing the status of the first writeHead.
function mockRes() {
  return {
    statusCode: null,
    headersSent: false,
    writeHead(status) {
      this.statusCode = status;
      this.headersSent = true;
      return this;
    },
    end() {
      return this;
    },
  };
}

// Fire a GET read request and return its response status.
function hitRead(handler, url, ip) {
  const res = mockRes();
  handler({ method: 'GET', url, socket: { remoteAddress: ip } }, res);
  return res.statusCode;
}

// Fire a POST /api/collect with a valid body and return its status. The body
// is delivered synchronously via a tiny on() stub so readBody resolves.
function hitCollect(handler, ip) {
  const body = JSON.stringify({
    v: 1,
    sid: 's_a1b2c3d4e5f6',
    page: '/x',
    vw: 800,
    vh: 600,
    dw: 800,
    dh: 600,
    events: [{ t: 'dead', ts: 1 }],
  });
  const res = mockRes();
  const req = {
    method: 'POST',
    url: '/api/collect',
    socket: { remoteAddress: ip },
    on(event, cb) {
      if (event === 'data') cb(Buffer.from(body));
      else if (event === 'end') cb();
      return this;
    },
  };
  handler(req, res);
  return res.statusCode;
}

test('read endpoints share a 300/min per-IP budget and 429 past it', () => {
  const handler = createRequestHandler(openDb(':memory:'), CONFIG);
  const ip = '198.51.100.5';
  for (let i = 0; i < 300; i++) {
    assert.equal(hitRead(handler, '/api/pages', ip), 200, `read #${i} should pass`);
  }
  assert.equal(hitRead(handler, '/api/pages', ip), 429);
  // The budget is shared across the read endpoints (same bucket), not per-path.
  assert.equal(hitRead(handler, '/api/sessions', ip), 429);
  // A different IP is unaffected.
  assert.equal(hitRead(handler, '/api/pages', '198.51.100.6'), 200);
});

test('collect keeps its own 60/min budget, independent of the read budget', () => {
  const handler = createRequestHandler(openDb(':memory:'), CONFIG);
  const ip = '198.51.100.9';

  // Exhaust the read budget without ever touching collect.
  for (let i = 0; i < 300; i++) hitRead(handler, '/api/pages', ip);
  assert.equal(hitRead(handler, '/api/pages', ip), 429);

  // Collect still has its full, separate budget for the same IP.
  for (let i = 0; i < 60; i++) {
    assert.notEqual(hitCollect(handler, ip), 429, `collect #${i} should pass`);
  }
  assert.equal(hitCollect(handler, ip), 429);
});
