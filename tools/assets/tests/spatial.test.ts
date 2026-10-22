import assert from 'node:assert/strict';
import test from 'node:test';

import { SpatialGrid, type Box } from '../src/spatial.ts';

const square = (x: number, z: number, side: number): Box =>
  ({ min: [x, z], max: [x + side, z + side] });
const near = (grid: SpatialGrid, box: Box) => [...new Set(grid.near(box))].sort((a, b) => a - b);

test('a query finds overlapping and touching boxes but not far ones', () => {
  const grid = new SpatialGrid(10);
  grid.insert(square(0, 0, 5), 0);
  grid.insert(square(5, 0, 5), 1);
  grid.insert(square(100, 100, 5), 2);
  grid.insert(square(-30, -30, 4), 3);
  assert.deepEqual(near(grid, square(2, 2, 1)), [0, 1]);
  assert.deepEqual(near(grid, square(10, 0, 1)), [1], 'touching box 1 at x = 10');
  assert.deepEqual(near(grid, square(-27, -27, 1)), [3], 'negative cells');
});

test('every pair the grid skips is disjoint', () => {
  const boxes = Array.from({ length: 400 }, (_, i) =>
    square((i * 37 % 211) * 0.73, (i * 91 % 197) * 0.61, 1 + (i % 7)));
  const grid = new SpatialGrid(6);
  boxes.forEach((box, id) => grid.insert(box, id));
  boxes.forEach((box, id) => {
    const found = new Set(grid.near(box));
    boxes.forEach((other, index) => {
      const meet = [0, 1].every((axis) => box.min[axis] <= other.max[axis]
        && other.min[axis] <= box.max[axis]);
      assert.ok(!meet || found.has(index), `${id} meets ${index} but was pruned`);
    });
  });
});
