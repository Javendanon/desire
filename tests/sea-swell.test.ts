import assert from 'node:assert/strict';
import test from 'node:test';

import { swellHeight, swellNormal, writeSwell } from '../src/lib/diorama/sea-swell.ts';

test('the swell normal is a unit vector pointing up', () => {
  for (const [x, z, t] of [[0, 0, 0], [13.5, -40, 2.2], [500, 800, 31]]) {
    const [nx, ny, nz] = swellNormal(x, z, t);
    assert.ok(Math.abs(Math.hypot(nx, ny, nz) - 1) < 1e-9);
    assert.ok(ny > 0.9);
  }
});

test('the swell normal is perpendicular to the surface it shades', () => {
  const step = 1e-4;
  for (const [x, z, t] of [[3, 7, 0.5], [120, -60, 9]]) {
    const [nx, ny, nz] = swellNormal(x, z, t);
    const slopeX = (swellHeight(x + step, z, t) - swellHeight(x - step, z, t)) / (2 * step);
    const slopeZ = (swellHeight(x, z + step, t) - swellHeight(x, z - step, t)) / (2 * step);
    assert.ok(Math.abs(nx + slopeX * ny) < 1e-6, 'tangent along x');
    assert.ok(Math.abs(nz + slopeZ * ny) < 1e-6, 'tangent along z');
  }
});

test('writing the whole swell grid at once matches the formula at every vertex', () => {
  const xs = Float32Array.from([-40, 0, 12.5, 300]);
  const zs = Float32Array.from([-7, 55, 900]);
  const positions = new Float32Array(xs.length * zs.length * 3);
  const normals = new Float32Array(positions.length);
  writeSwell({ xs, zs }, 4.2, { positions, normals });
  zs.forEach((z, row) => xs.forEach((x, column) => {
    const index = (row * xs.length + column) * 3;
    assert.ok(Math.abs(positions[index + 1] - swellHeight(x, z, 4.2)) < 1e-5);
    const normal = swellNormal(x, z, 4.2);
    for (let axis = 0; axis < 3; axis += 1) {
      assert.ok(Math.abs(normals[index + axis] - normal[axis]) < 1e-5);
    }
  }));
});
