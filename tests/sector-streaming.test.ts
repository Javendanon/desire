import assert from 'node:assert/strict';
import test from 'node:test';

import { groundGeometry, planSectors } from '../src/lib/diorama/sector-streaming.ts';

const grid = { columns: 4, rows: 3, size_m: 100 };

// Reach is measured from the target to the nearest point of each sector's square.
test('sectors within reach of the camera target are wanted, nearest first', () => {
  const plan = planSectors({ grid, loaded: [], target: { x: 150, z: 150 }, reach_m: 60 });
  assert.deepEqual(plan.load, [5, 1, 4, 6, 9], 'the diagonal ones are 70.7 m away');
  assert.deepEqual(plan.unload, []);
});

test('loaded sectors stay until they fall beyond reach plus a margin, so edges do not flicker', () => {
  const plan = planSectors({ grid, loaded: [5, 0, 11], target: { x: 150, z: 150 }, reach_m: 60 });
  assert.ok(!plan.load.includes(5), 'already loaded');
  assert.deepEqual(plan.unload, [11], 'sector 0 is just past reach, inside the margin');
});

test('a target off the grid still loads the nearest edge sectors', () => {
  const plan = planSectors({ grid, loaded: [], target: { x: -40, z: -40 }, reach_m: 60 });
  assert.deepEqual(plan.load, [0]);
});

test('ground geometry puts vertices at cell centres with uvs across the tile texture', () => {
  const tile = { index: 5, width_px: 8, height_px: 8, cells_x: 2, cells_y: 2 };
  const ground = { tile_px: 8, cell_px: 4, metres_per_pixel: 0.5, columns: 4 };
  const heights = Int16Array.from([100, 100, 80, 100, -250, 80, 100, 100, 100]);
  const geometry = groundGeometry(tile, ground, heights);
  assert.equal(geometry.positions.length, 9 * 3);
  // Tile 5 is column 1, row 1: its first cell centre is at pixel (8 + 2, 8 + 2) = 5 m, 5 m.
  assert.deepEqual([...geometry.positions.slice(0, 3)], [5, 1, 5]);
  assert.deepEqual([...geometry.positions.slice(12, 15)], [7, -2.5, 7]);
  assert.deepEqual([...geometry.uvs.slice(0, 2)], [0.25, 0.25]);
  assert.equal(geometry.indices.length, 2 * 2 * 6);
});
