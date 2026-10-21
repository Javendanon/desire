import assert from 'node:assert/strict';
import test from 'node:test';

import { Surface } from '../src/raster/surface.ts';
import { HEIGHT_M, heightField, paintAlbedo } from '../src/slice.ts';

const size = { width: 4, height: 2 };
const classes = Uint8Array.from([
  Surface.Water, Surface.Water, Surface.Street, Surface.Street,
  Surface.Water, Surface.Pier, Surface.Garden, Surface.Street,
]);

test('cells take the majority surface: seabed, pier deck or land', () => {
  const field = heightField({ classes, size, cellPx: 2, seed: 1 });
  assert.deepEqual([field.columns, field.rows], [2, 1]);
  assert.deepEqual([...field.heights], [HEIGHT_M.seabed, HEIGHT_M.land]);
});

test('the albedo is painted from classes, with noise but within the palette range', () => {
  const rgb = paintAlbedo({ classes, size, cellPx: 2, seed: 1 });
  assert.equal(rgb.length, 8 * 3);
  const garden = [...rgb.subarray(6 * 3, 6 * 3 + 3)];
  assert.ok(garden[1] > garden[0], 'gardens stay greener than red');
  const water = [...rgb.subarray(0, 3)];
  assert.ok(water[2] > water[0], 'the seabed stays blue-green');
});

test('the same seed paints the same ground', () => {
  const first = paintAlbedo({ classes, size, cellPx: 2, seed: 9 });
  assert.deepEqual(paintAlbedo({ classes, size, cellPx: 2, seed: 9 }), first);
});
