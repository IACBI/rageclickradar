// RageClickRadar — unit tests for the heatmap view's preview guard. The redacted
// path check is pure, so it is tested here without a DOM. The iframe itself is
// only reachable in a browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isRedactedPath } from '../../dashboard/js/heatmap.js';

test('a path with an :id segment is redacted and gets no live preview', () => {
  assert.equal(isRedactedPath('/users/:id'), true);
  assert.equal(isRedactedPath('/users/:id/orders/:id/items'), true);
  assert.equal(isRedactedPath('/:id'), true);
});

test('ordinary paths, including ones that only contain the text id, are previewable', () => {
  assert.equal(isRedactedPath('/'), false);
  assert.equal(isRedactedPath('/users/12345'), false);
  assert.equal(isRedactedPath('/blog/my-first-post'), false);
  assert.equal(isRedactedPath('/demo/index.html'), false);
  assert.equal(isRedactedPath('/a:id'), false);
  assert.equal(isRedactedPath('/:identity'), false);
});

test('an empty or missing page is not treated as redacted', () => {
  assert.equal(isRedactedPath(undefined), false);
  assert.equal(isRedactedPath(''), false);
});
