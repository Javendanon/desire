import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BLOCKED_CELL,
  REFERENCE_GRID,
  referenceFixtureCost,
  referenceRouteCost,
} from '../tools/routing/reference.ts';

test('reference fixture cost matches the Rust core expectation', () => {
  assert.equal(referenceFixtureCost(), 7);
});

test('reference rejects an unreachable goal', () => {
  const blocked = {
    width: 3,
    height: 1,
    costs: Uint32Array.from([1, BLOCKED_CELL, 1]),
  };
  assert.throws(() => referenceRouteCost(blocked), /unreachable/);
});

test('reference route stays independent of the Rust implementation', () => {
  const open = {
    width: 3,
    height: 3,
    costs: new Uint32Array(9).fill(1),
  };
  assert.equal(referenceRouteCost(open), 4);
});
