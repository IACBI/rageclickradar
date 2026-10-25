// RageClickRadar — unit tests for the HTTP layer's per-IP rate limiting.
// No sockets: drive createRequestHandler() with mock req/res objects. Only the
// synchronous 429 decision (taken before the handler runs) is asserted, so the
// async read/collect handlers do not need real streaming behavior.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { openDb } from '../../server/db.js';
import { createRequestHandler, createServer, parseTrustedProxies } from '../../server/http.js';
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

// --- Bind address ---------------------------------------------------------

test('the default HOST is loopback only', () => {
  assert.equal(CONFIG.DEFAULT_HOST, '127.0.0.1');
});

test('a server listening on the default host is reachable only on loopback', async () => {
  const server = createServer(openDb(':memory:'), CONFIG);
  await new Promise((resolve) => server.listen(0, CONFIG.DEFAULT_HOST, resolve));
  try {
    assert.equal(server.address().address, '127.0.0.1');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// --- Trusted proxies (TRUST_PROXY) ----------------------------------------

// Like hitRead, but with request headers so X-Forwarded-For can be exercised.
function hitReadFrom(handler, ip, xff) {
  const res = mockRes();
  const headers = xff === undefined ? {} : { 'x-forwarded-for': xff };
  handler({ method: 'GET', url: '/api/pages', headers, socket: { remoteAddress: ip } }, res);
  return res.statusCode;
}

function proxiedHandler(trust) {
  return createRequestHandler(openDb(':memory:'), {
    ...CONFIG,
    TRUSTED_PROXIES: parseTrustedProxies(trust),
  });
}

test('TRUST_PROXY: clients behind one trusted proxy get separate buckets', () => {
  const handler = proxiedHandler('10.0.0.1');
  for (let i = 0; i < 300; i++) {
    assert.equal(hitReadFrom(handler, '10.0.0.1', '198.51.100.20'), 200);
  }
  assert.equal(hitReadFrom(handler, '10.0.0.1', '198.51.100.20'), 429);
  // Same proxy, different forwarded client: a fresh bucket.
  assert.equal(hitReadFrom(handler, '10.0.0.1', '198.51.100.21'), 200);
});

test('TRUST_PROXY: X-Forwarded-For from an untrusted peer is ignored', () => {
  const handler = proxiedHandler('10.0.0.1');
  // Rotating the header from a peer that is not a trusted proxy must not
  // mint new buckets: every request is keyed on the socket address.
  for (let i = 0; i < 300; i++) {
    assert.equal(hitReadFrom(handler, '203.0.113.9', `192.0.2.${i % 250}`), 200);
  }
  assert.equal(hitReadFrom(handler, '203.0.113.9', '192.0.2.251'), 429);
});

test('TRUST_PROXY: the right-most untrusted hop is used, not a spoofed left entry', () => {
  const handler = proxiedHandler('10.0.0.1');
  // The client prepends a fake address; the proxy appends the real one.
  for (let i = 0; i < 300; i++) {
    assert.equal(hitReadFrom(handler, '10.0.0.1', `203.0.113.${i % 250}, 198.51.100.30`), 200);
  }
  assert.equal(hitReadFrom(handler, '10.0.0.1', '1.2.3.4, 198.51.100.30'), 429);
});

test('TRUST_PROXY: a chain of trusted proxies is skipped right-to-left', () => {
  const handler = proxiedHandler('10.0.0.1, 10.0.0.2');
  for (let i = 0; i < 300; i++) {
    assert.equal(hitReadFrom(handler, '10.0.0.1', '198.51.100.40, 10.0.0.2'), 200);
  }
  assert.equal(hitReadFrom(handler, '10.0.0.1', '198.51.100.40, 10.0.0.2'), 429);
});

test('TRUST_PROXY: an IPv4-mapped IPv6 peer matches a plain IPv4 entry', () => {
  const handler = proxiedHandler('127.0.0.1');
  for (let i = 0; i < 300; i++) {
    assert.equal(hitReadFrom(handler, '::ffff:127.0.0.1', '198.51.100.50'), 200);
  }
  assert.equal(hitReadFrom(handler, '::ffff:127.0.0.1', '198.51.100.50'), 429);
  assert.equal(hitReadFrom(handler, '::ffff:127.0.0.1', '198.51.100.51'), 200);
});

test('TRUST_PROXY: a malformed forwarded hop falls back to the proxy address', () => {
  const handler = proxiedHandler('10.0.0.1');
  for (let i = 0; i < 300; i++) {
    assert.equal(hitReadFrom(handler, '10.0.0.1', 'not-an-ip'), 200);
  }
  // Still the proxy's own bucket: the malformed header named no client.
  assert.equal(hitReadFrom(handler, '10.0.0.1', 'not-an-ip'), 429);
  // A well-formed forwarded address is a separate client, with its own budget.
  assert.equal(hitReadFrom(handler, '10.0.0.1', '198.51.100.60'), 200);
});

// Each hop form below must key on the bare client address: 300 requests use one
// spelling, then a different spelling of the same client is already over budget.
function assertSameBucket(handler, proxyIp, first, second) {
  for (let i = 0; i < 300; i++) {
    assert.equal(hitReadFrom(handler, proxyIp, first), 200, `${first} #${i} should pass`);
  }
  assert.equal(hitReadFrom(handler, proxyIp, second), 429, `${second} should share the bucket`);
}

test('TRUST_PROXY: an IPv4 hop with a port is keyed on the address, not the port', () => {
  const handler = proxiedHandler('10.0.0.1');
  assertSameBucket(handler, '10.0.0.1', '198.51.100.70:4444', '198.51.100.70');
  assert.equal(hitReadFrom(handler, '10.0.0.1', '198.51.100.70:5555'), 429);
  assert.equal(hitReadFrom(handler, '10.0.0.1', '198.51.100.71:4444'), 200);
});

test('TRUST_PROXY: a bracketed IPv6 hop with a port is keyed on the address', () => {
  const handler = proxiedHandler('10.0.0.1');
  assertSameBucket(handler, '10.0.0.1', '[2001:db8::1]:443', '2001:db8::1');
  assert.equal(hitReadFrom(handler, '10.0.0.1', '[2001:db8::1]'), 429);
  assert.equal(hitReadFrom(handler, '10.0.0.1', '[2001:db8::2]:443'), 200);
});

test('TRUST_PROXY: a bracketed IPv6 hop without a port is keyed on the address', () => {
  const handler = proxiedHandler('10.0.0.1');
  assertSameBucket(handler, '10.0.0.1', '[2001:db8::3]', '2001:db8::3');
});

test('TRUST_PROXY: a bare IPv6 hop is kept whole, not split on its colons', () => {
  const handler = proxiedHandler('10.0.0.1');
  assertSameBucket(handler, '10.0.0.1', '2001:db8::4', '[2001:db8::4]');
  assert.equal(hitReadFrom(handler, '10.0.0.1', '2001:db8::5'), 200);
});

test('TRUST_PROXY: empty hops are skipped, so a trailing comma does not hide the client', () => {
  const handler = proxiedHandler('10.0.0.1');
  assertSameBucket(handler, '10.0.0.1', '198.51.100.80, ', '198.51.100.80');
  assert.equal(hitReadFrom(handler, '10.0.0.1', ' , 198.51.100.80 ,'), 429);
});

test('TRUST_PROXY: ported trusted proxies in a chain are skipped right-to-left', () => {
  const handler = proxiedHandler('10.0.0.1, 10.0.0.2');
  assertSameBucket(handler, '10.0.0.1', '198.51.100.90:1, 10.0.0.2:8080', '198.51.100.90');
});

test('TRUST_PROXY: a hop with a non-numeric port is malformed and falls back to the proxy', () => {
  const handler = proxiedHandler('10.0.0.1');
  for (let i = 0; i < 300; i++) {
    assert.equal(hitReadFrom(handler, '10.0.0.1', '198.51.100.95:http'), 200);
  }
  // Still the proxy's own bucket: the hop named no valid client address.
  assert.equal(hitReadFrom(handler, '10.0.0.1', '198.51.100.95:http'), 429);
  assert.equal(hitReadFrom(handler, '10.0.0.1', '198.51.100.95'), 200);
});

test('parseTrustedProxies: unset is empty, entries are canonicalized, bad input throws', () => {
  assert.equal(parseTrustedProxies(undefined).size, 0);
  assert.equal(parseTrustedProxies('').size, 0);
  assert.deepEqual([...parseTrustedProxies(' ::ffff:10.0.0.1 , 10.0.0.2 ')].sort(), [
    '10.0.0.1',
    '10.0.0.2',
  ]);
  assert.deepEqual([...parseTrustedProxies('0:0:0:0:0:0:0:1')], ['::1']);
  assert.throws(() => parseTrustedProxies('10.0.0.1, proxy.internal'), /invalid IP address/);
  assert.throws(() => parseTrustedProxies('fe80::1%eth0'), /invalid IP address/);
});
