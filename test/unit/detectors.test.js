import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDetectors } from '../../tracker/src/detectors.js';
import { CONFIG } from '../../shared/config.js';

// Spin up a fresh detector with a signal collector.
function setup(overrides) {
  const config = overrides ? { ...CONFIG, ...overrides } : CONFIG;
  const signals = [];
  const handle = createDetectors(config, (s) => signals.push(s));
  return { handle, signals };
}

// A non-interactive, clickable target (also a dead-click candidate).
function plainTarget(sel = '.box') {
  return {
    sel,
    interactive: false,
    allowRapid: false,
    isBodyOrHtml: false,
    isCanvas: false,
    ignored: false,
    dragged: false,
  };
}

function field(overrides = {}) {
  return {
    sel: '#name',
    formSel: '#signup',
    isSearch: false,
    formFieldCount: 4,
    ignored: false,
    ...overrides,
  };
}

// --------------------------------------------------------------------------
// Rage
// --------------------------------------------------------------------------
test('rage: two clicks produce no signal', () => {
  const { handle, signals } = setup();
  handle.onClick({ ts: 0, x: 10, y: 10, target: plainTarget() });
  handle.onClick({ ts: 100, x: 12, y: 12, target: plainTarget() });
  handle.tick(2000);
  assert.equal(signals.filter((s) => s.t === 'rage').length, 0);
});

test('rage: three clicks emit one signal with n=3 after settle', () => {
  const { handle, signals } = setup();
  handle.onClick({ ts: 0, x: 10, y: 10, target: plainTarget('#btn') });
  handle.onClick({ ts: 100, x: 11, y: 11, target: plainTarget('#btn') });
  handle.onClick({ ts: 200, x: 12, y: 12, target: plainTarget('#btn') });
  // Not yet settled.
  handle.tick(500);
  assert.equal(signals.filter((s) => s.t === 'rage').length, 0);
  // Settle (>= 700ms after last click).
  handle.tick(900);
  const rage = signals.filter((s) => s.t === 'rage');
  assert.equal(rage.length, 1);
  assert.equal(rage[0].n, 3);
  assert.equal(rage[0].sel, '#btn');
  assert.equal(rage[0].x, 10); // first click coords
  assert.equal(rage[0].y, 10);
});

test('rage: a 501ms gap breaks the burst (500ms keeps it)', () => {
  const { handle, signals } = setup();
  handle.onClick({ ts: 0, x: 10, y: 10, target: plainTarget() });
  handle.onClick({ ts: 500, x: 10, y: 10, target: plainTarget() }); // gap 500 ok
  handle.onClick({ ts: 1001, x: 10, y: 10, target: plainTarget() }); // gap 501 breaks
  handle.tick(3000);
  // First burst had 2 clicks, then a lone third click: never qualifies.
  assert.equal(signals.filter((s) => s.t === 'rage').length, 0);
});

test('rage: a click 31px away breaks the burst, 30px stays', () => {
  const { handle, signals } = setup();
  // Three clicks within 30px -> one burst.
  handle.onClick({ ts: 0, x: 0, y: 0, target: plainTarget() });
  handle.onClick({ ts: 100, x: 30, y: 0, target: plainTarget() }); // exactly 30px stays
  handle.onClick({ ts: 200, x: 0, y: 0, target: plainTarget() });
  handle.tick(1000);
  const first = signals.filter((s) => s.t === 'rage');
  assert.equal(first.length, 1);
  assert.equal(first[0].n, 3);

  // Fresh detector: a 31px jump breaks it.
  const b = setup();
  b.handle.onClick({ ts: 0, x: 0, y: 0, target: plainTarget() });
  b.handle.onClick({ ts: 100, x: 31, y: 0, target: plainTarget() }); // breaks
  b.handle.onClick({ ts: 200, x: 31, y: 0, target: plainTarget() });
  b.handle.tick(1000);
  assert.equal(b.signals.filter((s) => s.t === 'rage').length, 0);
});

test('rage: a five-click tantrum emits a single signal with n=5', () => {
  const { handle, signals } = setup();
  for (let i = 0; i < 5; i++) {
    handle.onClick({ ts: i * 100, x: 5, y: 5, target: plainTarget() });
  }
  handle.tick(1500);
  const rage = signals.filter((s) => s.t === 'rage');
  assert.equal(rage.length, 1);
  assert.equal(rage[0].n, 5);
});

test('rage: onHide flushes a qualifying pending burst', () => {
  const { handle, signals } = setup();
  handle.onClick({ ts: 0, x: 5, y: 5, target: plainTarget() });
  handle.onClick({ ts: 100, x: 5, y: 5, target: plainTarget() });
  handle.onClick({ ts: 200, x: 5, y: 5, target: plainTarget() });
  handle.onHide(300); // well within the settle window
  assert.equal(signals.filter((s) => s.t === 'rage').length, 1);
});

test('rage: allowRapid / canvas / ignored targets never rage', () => {
  for (const flag of ['allowRapid', 'isCanvas', 'ignored']) {
    const { handle, signals } = setup();
    const t = { ...plainTarget(), [flag]: true };
    handle.onClick({ ts: 0, x: 5, y: 5, target: t });
    handle.onClick({ ts: 100, x: 5, y: 5, target: t });
    handle.onClick({ ts: 200, x: 5, y: 5, target: t });
    handle.tick(1000);
    assert.equal(
      signals.filter((s) => s.t === 'rage').length,
      0,
      `${flag} should never rage`
    );
  }
});

// --------------------------------------------------------------------------
// Dead clicks
// --------------------------------------------------------------------------
test('dead: non-interactive click confirmed after 600ms', () => {
  const { handle, signals } = setup();
  handle.onClick({ ts: 0, x: 7, y: 8, target: plainTarget('.dead') });
  handle.tick(650);
  const dead = signals.filter((s) => s.t === 'dead');
  assert.equal(dead.length, 1);
  assert.equal(dead[0].n, 1);
  assert.equal(dead[0].sel, '.dead');
  assert.equal(dead[0].x, 7);
});

test('dead: a reaction at +300ms cancels the candidate', () => {
  const { handle, signals } = setup();
  handle.onClick({ ts: 0, x: 7, y: 8, target: plainTarget() });
  handle.onReaction(300);
  handle.tick(700);
  assert.equal(signals.filter((s) => s.t === 'dead').length, 0);
});

test('dead: interactive / body / dragged clicks are never candidates', () => {
  const { handle, signals } = setup();
  handle.onClick({ ts: 0, x: 1, y: 1, target: { ...plainTarget(), interactive: true } });
  handle.onClick({ ts: 700, x: 1, y: 1, target: { ...plainTarget(), isBodyOrHtml: true } });
  handle.onClick({ ts: 1400, x: 1, y: 1, target: { ...plainTarget(), dragged: true } });
  handle.tick(3000);
  assert.equal(signals.filter((s) => s.t === 'dead').length, 0);
});

test('dead: rage precedence — 3 fast clicks give 1 rage and 0 dead', () => {
  const { handle, signals } = setup();
  handle.onClick({ ts: 0, x: 5, y: 5, target: plainTarget() });
  handle.onClick({ ts: 100, x: 5, y: 5, target: plainTarget() });
  handle.onClick({ ts: 200, x: 5, y: 5, target: plainTarget() });
  handle.tick(1000);
  assert.equal(signals.filter((s) => s.t === 'rage').length, 1);
  assert.equal(signals.filter((s) => s.t === 'dead').length, 0);
});

test('dead: onHide discards unexpired candidates', () => {
  const { handle, signals } = setup();
  handle.onClick({ ts: 0, x: 5, y: 5, target: plainTarget() });
  handle.onHide(300); // window (600ms) not elapsed
  assert.equal(signals.filter((s) => s.t === 'dead').length, 0);
});

// --------------------------------------------------------------------------
// Form abandonment
// --------------------------------------------------------------------------
test('form: engage then submit then hide emits nothing', () => {
  const { handle, signals } = setup();
  handle.onFieldFocus({ ts: 0, field: field() });
  handle.onFieldInput({ ts: 10, field: field(), kind: 'insert' });
  handle.onFieldInput({ ts: 20, field: field(), kind: 'insert' });
  handle.onFieldInput({ ts: 30, field: field(), kind: 'insert' });
  handle.onSubmit({ ts: 40, formSel: '#signup' });
  handle.onHide(1000);
  assert.equal(signals.filter((s) => s.t === 'formaband').length, 0);
});

test('form: engage then hide emits with correct n / m.last / m.dwell', () => {
  const { handle, signals } = setup();
  const a = field({ sel: '#name' });
  const b = field({ sel: '#email' });
  handle.onFieldFocus({ ts: 0, field: a });
  handle.onFieldInput({ ts: 10, field: a, kind: 'insert' });
  handle.onFieldInput({ ts: 20, field: a, kind: 'insert' });
  handle.onFieldInput({ ts: 30, field: a, kind: 'insert' }); // A engaged
  handle.onFieldBlur({ ts: 40, field: a });
  handle.onFieldFocus({ ts: 50, field: b });
  handle.onFieldInput({ ts: 60, field: b, kind: 'insert' }); // B touched
  handle.onHide(1000);
  const fa = signals.filter((s) => s.t === 'formaband');
  assert.equal(fa.length, 1);
  assert.equal(fa[0].sel, '#signup');
  assert.equal(fa[0].n, 2); // two distinct fields touched
  assert.equal(fa[0].m.last, '#email');
  assert.equal(fa[0].m.dwell, 990); // 1000 - firstInputTs(10)
});

test('form: two inputs only does not engage', () => {
  const { handle, signals } = setup();
  handle.onFieldFocus({ ts: 0, field: field() });
  handle.onFieldInput({ ts: 10, field: field(), kind: 'insert' });
  handle.onFieldInput({ ts: 20, field: field(), kind: 'insert' });
  handle.onHide(1000);
  assert.equal(signals.filter((s) => s.t === 'formaband').length, 0);
});

test('form: single-field search box is exempt', () => {
  const { handle, signals } = setup();
  const s = field({ sel: '#q', formSel: '#search', isSearch: true, formFieldCount: 1 });
  handle.onFieldFocus({ ts: 0, field: s });
  handle.onFieldInput({ ts: 10, field: s, kind: 'insert' });
  handle.onFieldInput({ ts: 20, field: s, kind: 'insert' });
  handle.onFieldInput({ ts: 30, field: s, kind: 'insert' });
  handle.onHide(1000);
  assert.equal(signals.filter((s) => s.t === 'formaband').length, 0);
});

test('form: onFormRemoved is neutral', () => {
  const { handle, signals } = setup();
  handle.onFieldFocus({ ts: 0, field: field() });
  handle.onFieldInput({ ts: 10, field: field(), kind: 'insert' });
  handle.onFieldInput({ ts: 20, field: field(), kind: 'insert' });
  handle.onFieldInput({ ts: 30, field: field(), kind: 'insert' });
  handle.onFormRemoved({ ts: 40, formSel: '#signup' });
  handle.onHide(1000);
  assert.equal(signals.filter((s) => s.t === 'formaband').length, 0);
});

test('form: blur beyond FORM_BLUR_ABANDON_MS abandons once via tick', () => {
  const { handle, signals } = setup();
  handle.onFieldFocus({ ts: 0, field: field() });
  handle.onFieldInput({ ts: 10, field: field(), kind: 'insert' });
  handle.onFieldInput({ ts: 20, field: field(), kind: 'insert' });
  handle.onFieldInput({ ts: 30, field: field(), kind: 'insert' });
  handle.onFieldBlur({ ts: 40, field: field() });
  handle.tick(40 + 29000); // not yet past the window
  assert.equal(signals.filter((s) => s.t === 'formaband').length, 0);
  handle.tick(40 + 30001); // past the 30000ms window
  assert.equal(signals.filter((s) => s.t === 'formaband').length, 1);
  // A second onHide emits nothing new.
  handle.onHide(200000);
  assert.equal(signals.filter((s) => s.t === 'formaband').length, 1);
});

// --------------------------------------------------------------------------
// Correction
// --------------------------------------------------------------------------
function runField(handle, sel, deletes, inserts, ignored = false) {
  const f = field({ sel, formSel: null, ignored });
  handle.onFieldFocus({ ts: 0, field: f });
  let ts = 1;
  for (let i = 0; i < inserts; i++) handle.onFieldInput({ ts: ts++, field: f, kind: 'insert' });
  for (let i = 0; i < deletes; i++) handle.onFieldInput({ ts: ts++, field: f, kind: 'delete' });
  return { f, ts };
}

test('correction: D=8 I=16 fires (8 >= 0.5*16) with n and m.i', () => {
  const { handle, signals } = setup();
  const { f, ts } = runField(handle, '#c1', 8, 16);
  handle.onFieldBlur({ ts: ts + 1, field: f });
  const c = signals.filter((s) => s.t === 'correction');
  assert.equal(c.length, 1);
  assert.equal(c[0].n, 8);
  assert.equal(c[0].m.i, 16);
  assert.equal(c[0].sel, '#c1');
});

test('correction: D=8 I=17 does not fire (8 < 8.5)', () => {
  const { handle, signals } = setup();
  const { f, ts } = runField(handle, '#c2', 8, 17);
  handle.onFieldBlur({ ts: ts + 1, field: f });
  assert.equal(signals.filter((s) => s.t === 'correction').length, 0);
});

test('correction: D=7 I=0 does not fire (below min deletes)', () => {
  const { handle, signals } = setup();
  const { f, ts } = runField(handle, '#c3', 7, 0);
  handle.onFieldBlur({ ts: ts + 1, field: f });
  assert.equal(signals.filter((s) => s.t === 'correction').length, 0);
});

test('correction: D=10 I=2 fires with n=10, m.i=2', () => {
  const { handle, signals } = setup();
  const { f, ts } = runField(handle, '#c4', 10, 2);
  handle.onFieldBlur({ ts: ts + 1, field: f });
  const c = signals.filter((s) => s.t === 'correction');
  assert.equal(c.length, 1);
  assert.equal(c[0].n, 10);
  assert.equal(c[0].m.i, 2);
});

test('correction: still-focused field is evaluated on onHide', () => {
  const { handle, signals } = setup();
  runField(handle, '#c5', 9, 4); // no blur — still focused
  handle.onHide(5000);
  const c = signals.filter((s) => s.t === 'correction');
  assert.equal(c.length, 1);
  assert.equal(c[0].n, 9);
  // Idempotent second hide.
  handle.onHide(6000);
  assert.equal(signals.filter((s) => s.t === 'correction').length, 1);
});

test('correction: ignored fields are skipped', () => {
  const { handle, signals } = setup();
  const { f, ts } = runField(handle, '#c6', 12, 2, true);
  handle.onFieldBlur({ ts: ts + 1, field: f });
  assert.equal(signals.filter((s) => s.t === 'correction').length, 0);
});
