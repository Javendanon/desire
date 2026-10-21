import assert from 'node:assert/strict';
import test from 'node:test';

import { instanceBounds } from '../src/lib/engine/math/instance-bounds.ts';

/** Column-major 4 × 4: scale (sx, sy, sz) then translate (tx, ty, tz). */
function scaled(scale: [number, number, number], at: [number, number, number]): Float32Array {
  const [sx, sy, sz] = scale;
  return Float32Array.from([sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, ...at, 1]);
}

test('the bounds of a batch hold every instance of a unit mesh', () => {
  const data = new Float32Array(32);
  data.set(scaled([2, 4, 2], [100, 0, 50]), 0);
  data.set(scaled([1, 1, 1], [-30, 3, 400]), 16);
  const bounds = instanceBounds(data);
  assert.deepEqual(bounds.min, [-31, -4, 48]);
  assert.deepEqual(bounds.max, [102, 4, 401]);
});

test('a rotated instance still fits: extents sum the absolute matrix columns', () => {
  const quarterTurn = Float32Array.from([0, 0, -1, 0, 0, 1, 0, 0, 3, 0, 0, 0, 10, 0, 10, 1]);
  const bounds = instanceBounds(quarterTurn);
  assert.deepEqual(bounds.min, [7, -1, 9]);
  assert.deepEqual(bounds.max, [13, 1, 11]);
});

test('an empty batch has empty bounds at the origin', () => {
  assert.deepEqual(instanceBounds(new Float32Array(0)), { min: [0, 0, 0], max: [0, 0, 0] });
});
