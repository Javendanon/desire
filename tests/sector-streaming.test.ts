import assert from 'node:assert/strict';
import test from 'node:test';

import { gridNormals, groundGeometry } from '../src/lib/diorama/ground-mesh.ts';
import {
  castsShadows, planSectors, sectorDetail, sectorDistance,
} from '../src/lib/diorama/sector-streaming.ts';

const grid = { columns: 4, rows: 3, size_m: 100 };

// Reach is measured from the target to the nearest point of each sector's square.
test('sectors within reach of the camera target are wanted, nearest first', () => {
  const plan = planSectors({ grid, loaded: [], target: { x: 150, z: 150 }, reach_m: 60 });
  assert.deepEqual(plan.load, [5, 1, 4, 6, 9], 'the diagonal ones are 70.7 m away');
  assert.deepEqual(plan.unload, []);
});

test('loaded sectors stay until past reach plus a margin, so edges do not flicker', () => {
  const target = { x: 150, z: 150 };
  const plan = planSectors({ grid, loaded: [5, 0, 11], target, reach_m: 60 });
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

const near = (actual: Iterable<number>, expected: number[]) => {
  [...actual].forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-6,
    `component ${index}: ${value} vs ${expected[index]}`));
};

/** A 3 × 3 grid of vertices 2 m apart with heights from `height(x, z)`. */
const grid3 = (height: (x: number, z: number) => number) => Float32Array.from(
  { length: 27 }, (_, at) => {
    const [vertex, axis] = [Math.floor(at / 3), at % 3];
    const [x, z] = [(vertex % 3) * 2, Math.floor(vertex / 3) * 2];
    return [x, height(x, z), z][axis];
  });

test('grid normals point straight up over flat ground', () => {
  const normals = gridNormals(grid3(() => 1), { across: 3, down: 3 });
  assert.equal(normals.length, 27);
  for (let vertex = 0; vertex < 9; vertex += 1) {
    near(normals.slice(vertex * 3, vertex * 3 + 3), [0, 1, 0]);
  }
});

test('grid normals lean away from the slope, at the edges too', () => {
  // Rising 1 m per metre eastward: the normal is (-1, 1, 0) / √2 everywhere.
  const normals = gridNormals(grid3((x) => x), { across: 3, down: 3 });
  for (let vertex = 0; vertex < 9; vertex += 1) {
    near(normals.slice(vertex * 3, vertex * 3 + 3), [-Math.SQRT1_2, Math.SQRT1_2, 0]);
  }
});

test('ground geometry carries unit normals per vertex', () => {
  const tile = { index: 0, width_px: 8, height_px: 8, cells_x: 2, cells_y: 2 };
  const ground = { tile_px: 8, cell_px: 4, metres_per_pixel: 0.5, columns: 1 };
  const geometry = groundGeometry(tile, ground, new Int16Array(9).fill(100));
  near(geometry.normals, Array.from({ length: 27 }, (_, at) => Number(at % 3 === 1)));
});

test('sector distance is zero inside the square and grows from its nearest edge', () => {
  assert.equal(sectorDistance(grid, 5, { x: 150, z: 150 }), 0);
  assert.equal(sectorDistance(grid, 6, { x: 150, z: 150 }), 50);
  assert.equal(sectorDistance(grid, 0, { x: 130, z: 140 }), 50);
});

// Far shadows are invisible at that zoom but cost a second draw of every house in the shadow pass.
test('only sectors near the target cast shadows, and more of them when zoomed out', () => {
  assert.ok(castsShadows({ distance_m: 0, radius_m: 900 }));
  assert.ok(castsShadows({ distance_m: 200, radius_m: 60 }), 'street zoom still shades its block');
  assert.ok(!castsShadows({ distance_m: 1200, radius_m: 900 }), 'a kilometre out at city zoom');
  assert.ok(castsShadows({ distance_m: 400, radius_m: 900 }));
  assert.ok(!castsShadows({ distance_m: 400, radius_m: 200 }));
});

// Near sectors get full detail; far ones a box and a roof per house, merged city-wide.
test('sectors switch detail with hysteresis, so a boundary does not flip every frame', () => {
  const radius_m = 200;
  assert.equal(sectorDetail({ distance_m: 300, radius_m, current: 'far' }), 'near');
  assert.equal(sectorDetail({ distance_m: 380, radius_m, current: 'far' }), 'far');
  assert.equal(sectorDetail({ distance_m: 380, radius_m, current: 'near' }), 'near', 'kept');
  assert.equal(sectorDetail({ distance_m: 600, radius_m, current: 'near' }), 'far');
});
