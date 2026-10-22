import assert from 'node:assert/strict';
import test from 'node:test';

import {
  footprintBounds, footprintCorners, footprintCornersAlong, overlapsCell,
} from '../src/footprint.ts';

const square = { center: { x_m: 10, z_m: 10 }, width_m: 4, depth_m: 2, rotation_radians: 0 };
const cellAt = (x: number, z: number) => ({ min_x: x, max_x: x + 1, min_z: z, max_z: z + 1 });

test('an unrotated footprint has axis-aligned corners around its centre', () => {
  const corners = footprintCorners(square);
  assert.deepEqual(footprintBounds(corners), { min_x: 8, max_x: 12, min_z: 9, max_z: 11 });
});

test('a quarter turn swaps width and depth', () => {
  const turned = footprintCorners({ ...square, rotation_radians: Math.PI / 2 });
  const bounds = footprintBounds(turned);
  assert.ok(Math.abs(bounds.min_x - 9) < 1e-9 && Math.abs(bounds.max_x - 11) < 1e-9);
  assert.ok(Math.abs(bounds.min_z - 8) < 1e-9 && Math.abs(bounds.max_z - 12) < 1e-9);
});

// PlayCanvas (D13 `trs`) turns local +x toward (cos θ, -sin θ) in plan: north-east for π/4.
test('a diagonal footprint follows the engine rotation and skips its empty box corners', () => {
  const diagonal = footprintCorners({
    center: { x_m: 10, z_m: 10 }, width_m: 8, depth_m: 1, rotation_radians: Math.PI / 4,
  });
  assert.equal(overlapsCell(diagonal, cellAt(9.5, 9.5)), true, 'the centre cell is covered');
  assert.equal(overlapsCell(diagonal, cellAt(12.5, 7)), true, 'the north-east end is covered');
  assert.equal(overlapsCell(diagonal, cellAt(12.5, 12.5)), false, 'the south-east corner is free');
});

test('cells that only touch an edge are not blocked', () => {
  const corners = footprintCorners(square);
  assert.equal(overlapsCell(corners, cellAt(12, 9)), false);
  assert.equal(overlapsCell(corners, cellAt(11, 9)), true);
});

// A lot is laid along an edge: its rotation is atan2(−tz, tx) of the edge's unit tangent, so
// cos θ = tx and sin θ = −tz. Corners built from the tangent need no trigonometry at all.
test('corners along a unit tangent are the corners of the matching rotation', () => {
  for (const angle of [0, 0.3, 1.2, -2.5, Math.PI]) {
    const tangent = { x_m: Math.cos(angle), z_m: -Math.sin(angle) };
    const along = footprintCornersAlong({ center: { x_m: 3, z_m: 4 }, width_m: 6, depth_m: 9,
      tangent });
    const rotated = footprintCorners({ center: { x_m: 3, z_m: 4 }, width_m: 6, depth_m: 9,
      rotation_radians: Math.atan2(-tangent.z_m, tangent.x_m) });
    along.forEach((corner, index) => {
      assert.ok(Math.abs(corner.x_m - rotated[index].x_m) < 1e-12, `angle ${angle}`);
      assert.ok(Math.abs(corner.z_m - rotated[index].z_m) < 1e-12, `angle ${angle}`);
    });
  }
  const square = footprintCornersAlong({ center: { x_m: 10, z_m: 10 }, width_m: 4, depth_m: 2,
    tangent: { x_m: 1, z_m: 0 } });
  assert.deepEqual(footprintBounds(square), { min_x: 8, max_x: 12, min_z: 9, max_z: 11 });
});
