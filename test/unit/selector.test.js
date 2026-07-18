import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSelector } from '../../tracker/src/selector.js';

// Build a plain element descriptor with sane defaults.
function d({ tag = 'div', id = null, classes = [], nthOfType = 1, parent = null }) {
  return { tag, id, classes, nthOfType, parent };
}

test('id priority: a CSS-safe id wins outright', () => {
  const sel = buildSelector(d({ tag: 'div', id: 'main', classes: ['x'], nthOfType: 2 }));
  assert.equal(sel, '#main');
});

test('unsafe id (leading digit) falls back to classes', () => {
  const sel = buildSelector(d({ tag: 'div', id: '123bad', classes: ['card', 'active'] }));
  assert.equal(sel, 'div.card.active');
});

test('classes: only the first two CSS-safe classes are used', () => {
  const sel = buildSelector(
    d({ tag: 'span', classes: ['1skip', 'alpha', 'beta', 'gamma'] })
  );
  // "1skip" is unsafe and dropped; first two safe ones are alpha, beta.
  assert.equal(sel, 'span.alpha.beta');
});

test('class fallback to nth-of-type path when target has no id/class', () => {
  const parent = d({ tag: 'section', classes: ['wrap'], nthOfType: 1 });
  const target = d({ tag: 'div', classes: [], nthOfType: 3, parent });
  const sel = buildSelector(target);
  assert.equal(sel, 'section.wrap>div:nth-of-type(3)');
});

test('nth-of-type path caps at 4 levels total', () => {
  // Six-deep chain of pure nth-of-type elements.
  let node = null;
  for (let i = 0; i < 6; i++) {
    node = d({ tag: 'div', classes: [], nthOfType: i + 1, parent: node });
  }
  const sel = buildSelector(node);
  const segments = sel.split('>');
  assert.equal(segments.length, 4);
  // The most specific (deepest) segment is retained on the right.
  assert.equal(segments[segments.length - 1], 'div:nth-of-type(6)');
});

test('an ancestor id stops the climb early', () => {
  const grandparent = d({ tag: 'main', id: 'root', nthOfType: 1 });
  const parent = d({ tag: 'section', classes: [], nthOfType: 2, parent: grandparent });
  const target = d({ tag: 'div', classes: [], nthOfType: 4, parent });
  const sel = buildSelector(target);
  assert.equal(sel, '#root>section:nth-of-type(2)>div:nth-of-type(4)');
});

test('maxLen cap truncates from the left with a leading ellipsis', () => {
  const long = 'longclassnameindeed_padding_wrapper_x';
  // Ancestors carry long class segments; the target is nth-of-type so the path
  // actually climbs and grows past 120 chars.
  const p3 = d({ tag: 'section', classes: [long], nthOfType: 1 });
  const p2 = d({ tag: 'article', classes: [long], nthOfType: 1, parent: p3 });
  const p1 = d({ tag: 'aside', classes: [long], nthOfType: 1, parent: p2 });
  const target = d({ tag: 'div', classes: [], nthOfType: 1, parent: p1 });
  const sel = buildSelector(target);
  assert.ok(sel.length <= 120, `expected <=120, got ${sel.length}`);
  assert.equal(sel.length, 120);
  assert.ok(sel.startsWith('…'));
  // The specific tail survives.
  assert.ok(sel.endsWith('div:nth-of-type(1)'));
});

test('custom maxLen is honored', () => {
  const target = d({ tag: 'div', classes: ['averylongclassname'], nthOfType: 1 });
  const sel = buildSelector(target, 10);
  assert.equal(sel.length, 10);
  assert.ok(sel.startsWith('…'));
});
