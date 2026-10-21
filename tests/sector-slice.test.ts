import assert from 'node:assert/strict';
import test from 'node:test';

import type { Sector } from '../src/lib/map/sector-format.ts';
import { featuresInFrame, sectorsOverlapping } from '../src/lib/diorama/sector-slice.ts';

const grid = { columns: 3, rows: 2, size_m: 100 };
const frame = { x_m: 150, z_m: 50, width_m: 100, depth_m: 100 };

test('a frame overlaps the sectors its rectangle touches, inside the grid', () => {
  assert.deepEqual(sectorsOverlapping(grid, frame), [1, 2, 4, 5]);
  assert.deepEqual(sectorsOverlapping(grid, { x_m: -50, z_m: -50, width_m: 60, depth_m: 60 }), [0]);
  assert.deepEqual(sectorsOverlapping(grid, { x_m: 900, z_m: 0, width_m: 10, depth_m: 10 }), []);
});

test('features inside the frame keep their ids and move into frame metres', () => {
  const sector: Sector = {
    index: 4, origin_x_m: 100, origin_z_m: 100, size_m: 100,
    houses: [
      { id: 7, x_m: 160, z_m: 120, width_m: 4, depth_m: 6, rotation_radians: 0.5, height_m: 7,
        roof_rgb: [1, 2, 3], frontage: true },
      { id: 8, x_m: 140, z_m: 120, width_m: 4, depth_m: 6, rotation_radians: 0, height_m: 7,
        roof_rgb: [1, 2, 3], frontage: false },
    ],
    berths: [{ x_m: 200, z_m: 149, heading_radians: 1 }],
    trees: [{ x_m: 251, z_m: 60, scale: 1 }],
  };
  const inside = featuresInFrame([sector], frame);
  assert.deepEqual(inside.houses, [{ id: 7, center: { x_m: 10, z_m: 70 }, width_m: 4, depth_m: 6,
    rotation_radians: 0.5, height_m: 7, roof_rgb: [1, 2, 3], frontage: true }]);
  assert.deepEqual(inside.berths, [{ x_m: 50, z_m: 99, heading_radians: 1 }]);
  assert.deepEqual(inside.trees, []);
});
