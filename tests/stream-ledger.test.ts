import assert from 'node:assert/strict';
import test from 'node:test';

import {
  busy, capacity, claim, createLedger, place, release, settle,
} from '../src/lib/diorama/stream-ledger.ts';

const MAX = 4;

test('a dropped request keeps its Worker slot until the Worker answers', () => {
  const ledger = createLedger();
  const generation = claim(ledger, 7);
  release(ledger, 7);
  assert.equal(capacity(ledger, MAX), MAX - 1, 'still running in the Worker');
  assert.equal(settle(ledger, { index: 7, generation, ok: true, now: 0 }), 'discard');
  assert.equal(capacity(ledger, MAX), MAX);
  assert.deepEqual(busy(ledger, 0), []);
});

test('a stale failure does not undo a newer request for the same sector', () => {
  const ledger = createLedger();
  const first = claim(ledger, 7);
  release(ledger, 7);
  const second = claim(ledger, 7);
  assert.equal(settle(ledger, { index: 7, generation: first, ok: false, now: 0 }), 'discard');
  assert.deepEqual(busy(ledger, 0), [7], 'the newer request is still wanted');
  assert.equal(settle(ledger, { index: 7, generation: second, ok: true, now: 0 }), 'build');
  assert.ok(place(ledger, 7, second));
  assert.deepEqual(busy(ledger, 0), []);
});

test('an arrival placed after its sector was dropped is refused', () => {
  const ledger = createLedger();
  const generation = claim(ledger, 3);
  assert.equal(settle(ledger, { index: 3, generation, ok: true, now: 0 }), 'build');
  release(ledger, 3);
  assert.ok(!place(ledger, 3, generation));
});

test('a failed sector is left alone for a while, then requested again', () => {
  const ledger = createLedger();
  const generation = claim(ledger, 5);
  settle(ledger, { index: 5, generation, ok: false, now: 10 });
  assert.deepEqual(busy(ledger, 11), [5], 'counts as loaded, so it is not re-requested at once');
  assert.deepEqual(busy(ledger, 60), [], 'retried after the back-off');
});
