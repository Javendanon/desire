// Picking must follow the drawn marker: a fixed pick blob swallows close-zoom clicks.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PLACE_PICK_MIN_RADIUS,
  placePickRadius,
} from '../src/lib/engine/scene/map-markers.ts';

test('the place pick sphere shrinks with the marker scale', () => {
  const close = placePickRadius(0.5);
  const overview = placePickRadius(3.5);
  assert.ok(close <= 0.35 * 60, `close-zoom pick radius ${close} m`);
  assert.ok(overview > close * 3, 'the overview keeps a generous pick sphere');
  for (const scale of [0.5, 1, 2, 3.5]) {
    assert.ok(placePickRadius(scale) <= (scale + 1) * 20);
  }
});

test('the pick sphere never falls below the metre floor', () => {
  assert.equal(placePickRadius(0.01), PLACE_PICK_MIN_RADIUS);
  assert.throws(() => placePickRadius(0), /positive/);
});
