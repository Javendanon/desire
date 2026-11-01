import assert from 'node:assert/strict';
import test from 'node:test';

import { checkSliceMeta } from '../src/lib/diorama/slice-data.ts';

const META = {
  width_m: 655.7, depth_m: 421.5, cell_m: 1.87, columns: 350, rows: 225,
  metres_per_pixel: 0.468, origin_m: { x_m: 1264.6, z_m: 2950.8 }, houses: 1065,
};

test('a well-formed slice meta passes through typed', () => {
  assert.deepEqual(checkSliceMeta(META), META);
});

test('a malformed meta names what is wrong instead of failing later as NaN', () => {
  assert.throws(() => checkSliceMeta({ ...META, cell_m: '1.87' }), /cell_m/);
  assert.throws(() => checkSliceMeta({ ...META, columns: 0 }), /columns/);
  assert.throws(() => checkSliceMeta({ ...META, rows: 2.5 }), /rows/);
  assert.throws(() => checkSliceMeta({ ...META, origin_m: { x_m: 1 } }), /origin_m/);
  assert.throws(() => checkSliceMeta(null), /meta/);
});
