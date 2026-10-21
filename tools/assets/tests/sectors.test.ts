import assert from 'node:assert/strict';
import test from 'node:test';

import { houseId, partitionSectors, sectorGrid } from '../src/sectors.ts';

const MPP = 0.5;

test('a house id packs its block and its lot within the block', () => {
  assert.equal(houseId(0, 0), 0);
  assert.equal(houseId(3, 2), 3 * 4096 + 2);
  assert.throws(() => houseId(1, 4096), /lot/);
});

test('the grid covers the map in squares of 1024 source pixels from the north-west corner', () => {
  const grid = sectorGrid({ width: 2500, height: 1100 }, MPP);
  assert.deepEqual(grid, { columns: 3, rows: 2, size_px: 1024, size_m: 512, metres_per_pixel: MPP });
});

test('features go to the sector holding their point; empty sectors are left out', () => {
  const grid = sectorGrid({ width: 2500, height: 1100 }, MPP);
  const houses = [
    { id: houseId(0, 0), block: 0, center: { x_m: 10, z_m: 10 } },
    { id: houseId(0, 1), block: 0, center: { x_m: 600, z_m: 10 } },
    { id: houseId(1, 0), block: 1, center: { x_m: 1100, z_m: 540 } },
    { id: houseId(1, 1), block: 1, center: { x_m: 1249.9, z_m: 549.9 } },
  ].map((house) => ({ ...house, width_m: 4, depth_m: 6, rotation_radians: 0.5, height_m: 7,
    roof_rgb: [90, 80, 70] as [number, number, number], frontage: true }));
  const berths = [{ x_m: 520, z_m: 30, heading_radians: 1 }];
  const sectors = partitionSectors({ grid, houses, berths, trees: [] });
  assert.deepEqual(sectors.map((sector) => sector.index), [0, 1, 5]);
  assert.deepEqual(sectors[1].houses.map((house) => house.id), [houseId(0, 1)]);
  assert.deepEqual(sectors[1].berths, berths);
  assert.deepEqual(sectors[2].houses.map((house) => house.id), [houseId(1, 0), houseId(1, 1)]);
  assert.deepEqual([sectors[2].origin_x_m, sectors[2].origin_z_m, sectors[2].size_m],
    [1024, 512, 512]);
});

test('houses keep the id their layer gave them, whichever houses are exported with them', () => {
  const grid = sectorGrid({ width: 2048, height: 1024 }, MPP);
  const house = (lot: number, x: number) => ({ id: houseId(2, lot), block: 2,
    center: { x_m: x, z_m: 1 }, width_m: 1, depth_m: 1, rotation_radians: 0, height_m: 3,
    roof_rgb: [1, 2, 3] as [number, number, number], frontage: false });
  const all = [house(0, 1), house(1, 600), house(2, 2)];
  const someDropped = [all[0], all[2]];
  const ids = (houses: typeof all) => partitionSectors({ grid, houses, berths: [], trees: [] })
    .flatMap((sector) => sector.houses.map((h) => h.id));
  assert.deepEqual(ids(all), [houseId(2, 0), houseId(2, 2), houseId(2, 1)]);
  assert.deepEqual(ids(someDropped), [houseId(2, 0), houseId(2, 2)], 'no renumbering');
});
