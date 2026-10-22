import assert from 'node:assert/strict';
import test from 'node:test';

import { readFlags } from '../src/flags.ts';

test('flags come in --name value pairs, required or optional', () => {
  const flags = readFlags(['--out', 'dir', '--region', '1,2,3,4']);
  assert.equal(flags.need('--out'), 'dir');
  assert.equal(flags.optional('--crop'), undefined);
  assert.throws(() => flags.need('--map'), /missing --map/);
});

test('number lists are checked for count and finiteness', () => {
  const flags = readFlags(['--region', '1,2,3,4', '--heights', '5,x']);
  assert.deepEqual(flags.numbers('--region', 4), [1, 2, 3, 4]);
  assert.throws(() => flags.numbers('--region', 2), /--region needs 2 comma-separated numbers/);
  assert.throws(() => flags.numbers('--heights', 2), /--heights needs 2/);
});
