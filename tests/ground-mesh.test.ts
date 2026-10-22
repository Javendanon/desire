import assert from 'node:assert/strict';
import test from 'node:test';

import { fogBanks } from '../src/lib/diorama/ambience-plan.ts';
import { gridIndices, gridNormals, tileOrigin, tileWater } from '../src/lib/diorama/ground-mesh.ts';

const ground = { tile_px: 8, cell_px: 4, metres_per_pixel: 0.5, columns: 3 };

test('a tile sits at its column and row of the grid, in metres', () => {
  assert.deepEqual(tileOrigin(ground, 4), { x_m: 4, z_m: 4 });
});

// The last row and column of a height tile belong to the neighbour: fog counts them there.
test('a tile water field holds its own cells only, at the tile corner', () => {
  const tile = { index: 4, width_px: 8, height_px: 8, cells_x: 2, cells_y: 2 };
  const heights = Int16Array.from([-1, -2, 9, -3, -4, 9, 9, 9, 9]);
  const water = tileWater(tile, ground, heights);
  assert.deepEqual([...Array.from(water.heights)], [-1, -2, -3, -4]);
  assert.deepEqual(water.meta, { columns: 2, cell_m: 2 });
  assert.deepEqual(water.origin, { x_m: 4, z_m: 4 });
});

test('fog banks follow the water area, sit over it, and stay put for the same field', () => {
  const columns = 100;
  const heights = Float32Array.from({ length: columns * columns }, (_, cell) =>
    (cell % columns < 50 ? -1 : 1));
  const water = { heights, meta: { columns, cell_m: 10 }, origin: { x_m: 1000, z_m: 2000 } };
  const banks = fogBanks(water);
  // 50 × 100 wet cells of 100 m² = 500 000 m², one bank per 6300 m².
  assert.equal(banks.length, Math.round(500_000 / 6300));
  for (const bank of banks) {
    assert.ok(bank.x >= 1000 && bank.x < 1500, `x ${bank.x} over the wet half`);
    assert.ok(bank.z >= 2000 && bank.z < 3000, `z ${bank.z}`);
  }
  assert.deepEqual(fogBanks(water), banks);
});

test('a dry field has no fog', () => {
  const water = { heights: new Float32Array(16).fill(1), meta: { columns: 4, cell_m: 10 },
    origin: { x_m: 0, z_m: 0 } };
  assert.deepEqual(fogBanks(water), []);
});

test('grid normals lean away from a slope along z too', () => {
  // Three vertices across, three down, 2 m apart; height rises 1 m per metre southward (+z).
  const positions = Float32Array.from({ length: 27 }, (_, at) => {
    const [vertex, axis] = [Math.floor(at / 3), at % 3];
    const [x, z] = [(vertex % 3) * 2, Math.floor(vertex / 3) * 2];
    return [x, z, z][axis];
  });
  const normals = gridNormals(positions, { across: 3, down: 3 });
  for (let vertex = 0; vertex < 9; vertex += 1) {
    const [x, y, z] = normals.slice(vertex * 3, vertex * 3 + 3);
    assert.ok(Math.abs(x) < 1e-6 && Math.abs(y - Math.SQRT1_2) < 1e-6
      && Math.abs(z + Math.SQRT1_2) < 1e-6, `vertex ${vertex}: ${x} ${y} ${z}`);
  }
});

test('grid indices make two triangles per square, wound the same everywhere', () => {
  assert.deepEqual([...gridIndices(3, 2)], [0, 3, 1, 1, 3, 4, 1, 4, 2, 2, 4, 5]);
});
