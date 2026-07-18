// RageClickRadar — bundle size budget + transport serializer tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildEnvelope } from '../../tracker/src/transport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUNDLE = path.resolve(__dirname, '..', '..', 'tracker', 'dist', 'radar.min.js');
const BUDGET_BYTES = 5120;

test('bundle exists and fits the 5120-byte budget', () => {
  assert.ok(fs.existsSync(BUNDLE), `missing bundle: ${BUNDLE} (run npm run build:tracker)`);
  const size = fs.statSync(BUNDLE).size;
  assert.ok(size > 0, 'bundle is empty');
  assert.ok(size <= BUDGET_BYTES, `bundle is ${size} bytes; budget is ${BUDGET_BYTES}`);
});

function meta(overrides = {}) {
  return {
    sid: 's_a1b2c3d4e5f6',
    page: '/pricing',
    vw: 1280,
    vh: 720,
    getDocSize: () => ({ dw: 1300, dh: 4200 }),
    ...overrides,
  };
}

test('buildEnvelope produces the exact wire shape once serialized', () => {
  const events = [{ t: 'rage', ts: 4210, x: 512, y: 1180, sel: '#buy-now', n: 5 }];
  const env = buildEnvelope(meta(), events);
  // The wire form is what the collector receives: serialize the way the
  // transport does (JSON.stringify drops the getDocSize function property).
  assert.deepEqual(JSON.parse(JSON.stringify(env)), {
    v: 1,
    sid: 's_a1b2c3d4e5f6',
    page: '/pricing',
    vw: 1280,
    vh: 720,
    dw: 1300,
    dh: 4200,
    events,
  });
});

test('buildEnvelope propagates sid and page from meta', () => {
  const env = buildEnvelope(meta({ sid: 's_zzzzzzzzzzzz', page: '/signup' }), [
    { t: 'dead', ts: 10, x: 1, y: 2, sel: 'div.promo', n: 1 },
  ]);
  assert.equal(env.sid, 's_zzzzzzzzzzzz');
  assert.equal(env.page, '/signup');
});

test('buildEnvelope passes the events array through untouched', () => {
  const events = [
    { t: 'dead', ts: 1, x: 5, y: 6, sel: 'span#learn-more-text', n: 1 },
    { t: 'formaband', ts: 2, sel: 'form#signup', n: 3, m: { last: '#email', dwell: 1200 } },
  ];
  const env = buildEnvelope(meta(), events);
  assert.equal(env.events, events); // same reference, no copy or mutation
  assert.equal(env.events.length, 2);
});

test('buildEnvelope reads dw/dh from getDocSize at call time', () => {
  let dh = 1000;
  const m = meta({ getDocSize: () => ({ dw: 800, dh }) });
  const first = buildEnvelope(m, [{ t: 'dead', ts: 1, n: 1 }]);
  dh = 5000; // the document grew between flushes
  const second = buildEnvelope(m, [{ t: 'dead', ts: 2, n: 1 }]);
  assert.equal(first.dw, 800);
  assert.equal(first.dh, 1000);
  assert.equal(second.dh, 5000);
});
