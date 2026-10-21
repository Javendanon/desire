import assert from 'node:assert/strict';
import test from 'node:test';

import type { Slice } from '../src/lib/diorama/slice-data.ts';
import { parseStress, tileSlice } from '../src/lib/diorama/stress-slice.ts';

function tinySlice(): Slice {
  return {
    meta: { width_m: 20, depth_m: 10, cell_m: 10, columns: 2, rows: 1 },
    heights: Float32Array.from([1, -2.5]),
    houses: [{ center: { x_m: 5, z_m: 5 }, width_m: 4, depth_m: 6, rotation_radians: 0,
      height_m: 6, roof_rgb: [90, 80, 70], frontage: true }],
    features: { berths: [{ x_m: 15, z_m: 5, heading_radians: 1 }], trees: [] },
    albedo: {} as HTMLImageElement,
  };
}

test('a stress grid repeats the slice: extent, height cells, houses and berths', () => {
  const tiled = tileSlice(tinySlice(), { columns: 3, rows: 2 });
  const { meta, heights, houses, features } = tiled.slice;
  assert.deepEqual([meta.width_m, meta.depth_m, meta.columns, meta.rows], [60, 20, 6, 2]);
  assert.deepEqual([...heights], [1, -2.5, 1, -2.5, 1, -2.5, 1, -2.5, 1, -2.5, 1, -2.5]);
  assert.equal(houses.length, 6);
  assert.deepEqual(houses.map((house) => [house.center.x_m, house.center.z_m]),
    [[5, 5], [25, 5], [45, 5], [5, 15], [25, 15], [45, 15]]);
  assert.deepEqual(features.berths.at(-1), { x_m: 55, z_m: 15, heading_radians: 1 });
  assert.deepEqual(tiled.offsets.at(-1), { x_m: 40, z_m: 10 });
  assert.equal(tiled.source.houses.length, 1, 'the source slice is untouched');
});

test('one by one is the slice itself, and the URL spelling is columns x rows', () => {
  const tiled = tileSlice(tinySlice(), { columns: 1, rows: 1 });
  assert.deepEqual(tiled.offsets, [{ x_m: 0, z_m: 0 }]);
  assert.deepEqual(parseStress('5x4'), { columns: 5, rows: 4 });
  assert.equal(parseStress(null), null);
  assert.equal(parseStress('0x3'), null);
  assert.equal(parseStress('lots'), null);
});
