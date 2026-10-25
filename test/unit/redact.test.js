// RageClickRadar — unit tests for path redaction (NV-01). Identifier-like path
// segments are collapsed to ':id' before storage; ordinary slugs are kept.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { openDb } from '../../server/db.js';
import { handleCollectBody, redactPath } from '../../server/collect.js';

function envelope(page) {
  return JSON.stringify({
    v: 1,
    sid: 's_a1b2c3d4e5f6',
    page,
    vw: 800,
    vh: 600,
    dw: 800,
    dh: 600,
    events: [{ t: 'dead', ts: 1 }],
  });
}

test('numeric, UUID, hex and token segments collapse to :id', () => {
  const cases = [
    ['/users/12345', '/users/:id'],
    ['/users/12345/', '/users/:id/'],
    ['/orders/550e8400-e29b-41d4-a716-446655440000', '/orders/:id'],
    ['/orders/550E8400-E29B-41D4-A716-446655440000', '/orders/:id'],
    ['/reset/9f86d081884c7d659a2feaa0c55ad015', '/reset/:id'],
    ['/cache/0123456789abcdef', '/cache/:id'],
    ['/tokens/Xk9_ab3dQ7pLm2wZ8rT5vYc1', '/tokens/:id'],
    [
      '/users/12345/orders/550e8400-e29b-41d4-a716-446655440000/items',
      '/users/:id/orders/:id/items',
    ],
  ];
  for (const [input, expected] of cases) {
    assert.equal(redactPath(input), expected, input);
  }
});

test('ordinary slugs, versions and short tokens are left alone', () => {
  const kept = [
    '/',
    '/pricing',
    '/blog/my-first-post',
    '/v2/docs',
    '/api/v1/items',
    '/shop/item-2/details',
    '/blog/my-very-long-post-title-about-2024-trends',
    '/docs/getting-started-with-rageclickradar',
    '/commit/abc123',
    '/reset/deadbeef',
    '/files/report.pdf',
  ];
  for (const input of kept) {
    assert.equal(redactPath(input), input, input);
  }
});

test('a bare year is collapsed too (documented heuristic)', () => {
  assert.equal(redactPath('/archive/2024'), '/archive/:id');
});

test('the stored page is redacted by default', () => {
  const db = openDb(':memory:');
  const res = handleCollectBody(db, envelope('/users/12345?tab=orders#top'));
  assert.equal(res.status, 204);
  assert.equal(db.prepare('SELECT page FROM events').get().page, '/users/:id');
});

test('redactPaths: false stores the path verbatim (PATH_REDACTION=off)', () => {
  const db = openDb(':memory:');
  const res = handleCollectBody(db, envelope('/users/12345'), { redactPaths: false });
  assert.equal(res.status, 204);
  assert.equal(db.prepare('SELECT page FROM events').get().page, '/users/12345');
});

test('email addresses in a segment collapse to :id, plain and percent-encoded', () => {
  const cases = [
    ['/u/john@example.com', '/u/:id'],
    ['/u/john%40example.com', '/u/:id'],
    ['/u/John%40Example.COM', '/u/:id'],
    ['/u/jane.doe+news@mail.example.org/settings', '/u/:id/settings'],
    ['/unsubscribe/a.b%40c.d', '/unsubscribe/:id'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(redactPath(input), expected, input);
  }
});

test('an @ or %40 without a dot after it is not treated as an email', () => {
  const kept = ['/u/john@localhost', '/u/john%40localhost', '/feed/%40', '/shop/a-b@c'];
  for (const input of kept) {
    assert.equal(redactPath(input), input, input);
  }
});

test('base64 tokens with + and = (raw or percent-encoded) collapse to :id', () => {
  const cases = [
    ['/t/q2X+8fLmN0pRsT5vWxY7zA1b', '/t/:id'],
    ['/t/q2X%2B8fLmN0pRsT5vWxY7zA1b', '/t/:id'],
    ['/t/abcdefghijklmnopqrstuvw1=', '/t/:id'],
    ['/t/abcdefghijklmnopqrstuvw1%3D', '/t/:id'],
    ['/t/q2X+8fLmN0pRsT5vWxY7zA1b/details', '/t/:id/details'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(redactPath(input), expected, input);
  }
});

test('+ and = alone do not make ordinary segments into tokens', () => {
  const kept = [
    '/t/abcdefghijklmnopqrstuvw=', // 24+ characters but no digit
    '/t/abcdefghijklmnop+qrstuvw', // 24+ characters but no digit
    '/t/q2X+8fLm', // a digit, but shorter than 24 characters
    '/t/a+b+c=d', // short and no long run
  ];
  for (const input of kept) {
    assert.equal(redactPath(input), input, input);
  }
});

test('documented non-collapse cases keep their current behavior', () => {
  const kept = ['/en-US/', '/blog/my-first-post', '/v2/docs'];
  for (const input of kept) {
    assert.equal(redactPath(input), input, input);
  }
  // A bare year and a bare number are collapsed by the documented heuristic.
  assert.equal(redactPath('/2024/10/post-slug'), '/:id/:id/post-slug');
});

test('a page that only fits under the cap before redaction is rejected after it', () => {
  // 256 x "/1" is exactly 512 characters. Each "/1" becomes "/:id" (4 characters),
  // so the stored path would be 1024 characters.
  const page = '/1'.repeat(256);
  assert.equal(page.length, 512);

  const db = openDb(':memory:');
  assert.deepEqual(handleCollectBody(db, envelope(page)), {
    status: 400,
    body: { error: 'invalid page' },
  });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM events').get().n, 0);

  // With redaction off the same path is stored verbatim, within the cap.
  assert.equal(handleCollectBody(db, envelope(page), { redactPaths: false }).status, 204);
});

test('a redacted page within the cap is still accepted', () => {
  const db = openDb(':memory:');
  const page = '/users/12345/orders/550e8400-e29b-41d4-a716-446655440000/items';
  assert.equal(handleCollectBody(db, envelope(page)).status, 204);
  assert.equal(
    db.prepare('SELECT page FROM events').get().page,
    '/users/:id/orders/:id/items',
  );
});
