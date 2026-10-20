import test from 'node:test';
import assert from 'node:assert/strict';

import {
  activeSectors,
  createGrid,
  detailFor,
  residentBytes,
  sectorBounds,
  sectorCenter,
  sectorCount,
  sectorIndexAt,
} from '../src/lib/engine/plan/sectors.ts';
import { pointInPolygon, polygonSpans } from '../src/lib/engine/plan/polygon.ts';

const grid = createGrid(250, { minX: 0, minZ: 0, maxX: 1000, maxZ: 2000 });

test('the sector grid counts whole squares over the map bounds', () => {
  assert.equal(grid.columns, 4);
  assert.equal(grid.rows, 8);
  assert.equal(sectorCount(grid), 32);
});

test('a point maps to one sector and the same point maps back to the same square', () => {
  assert.equal(sectorIndexAt(grid, { x: 125, z: 125 }), 0);
  assert.equal(sectorIndexAt(grid, { x: 625, z: 625 }), 2 * grid.columns + 2);
  assert.equal(sectorIndexAt(grid, { x: 999, z: 1999 }), 31);
});

test('points outside the map have no sector, never a clamped edge one', () => {
  assert.equal(sectorIndexAt(grid, { x: -1, z: 10 }), null);
  assert.equal(sectorIndexAt(grid, { x: 10, z: -1 }), null);
  assert.equal(sectorIndexAt(grid, { x: 1001, z: 10 }), null);
  assert.equal(sectorIndexAt(grid, { x: 10, z: 2001 }), null);
});

test('sector bounds and centres agree with the index', () => {
  const index = 2 * grid.columns + 2;
  assert.deepEqual(sectorBounds(grid, index), {
    minX: 500,
    maxX: 750,
    minZ: 500,
    maxZ: 750,
  });
  assert.deepEqual(sectorCenter(grid, index), { x: 625, z: 625 });
});

test('an out-of-range sector index is an explicit error', () => {
  assert.throws(() => sectorBounds(grid, 32), /sector 32/);
  assert.throws(() => sectorCenter(grid, -1), /sector -1/);
});

test('the resident set always contains the focus sector and respects the cap', () => {
  const active = activeSectors(grid, { x: 625, z: 625 }, { radiusM: 400, limit: 5 });
  assert.equal(active.length, 5);
  assert.equal(active[0], 10);
  assert.equal(new Set(active).size, active.length);
});

test('the resident set is ordered by distance and includes every sector in range', () => {
  const active = activeSectors(grid, { x: 625, z: 625 }, { radiusM: 400, limit: 100 });
  const centres = active.map((index) => sectorCenter(grid, index));
  for (let i = 1; i < active.length; i++) {
    const previous = Math.hypot(centres[i - 1].x - 625, centres[i - 1].z - 625);
    const current = Math.hypot(centres[i].x - 625, centres[i].z - 625);
    assert.ok(current >= previous, `sector ${active[i]} is closer than ${active[i - 1]}`);
  }
  assert.equal(active.length, 9);
});

test('the focus sector is resident for any focus point inside the map', () => {
  const points = [
    { x: 10, z: 1990 },
    { x: 999, z: 10 },
    { x: 501, z: 1499 },
  ];
  for (const point of points) {
    const index = sectorIndexAt(grid, point);
    assert.notEqual(index, null);
    const active = activeSectors(grid, point, { radiusM: 1, limit: 1 });
    assert.deepEqual(active, [index]);
  }
});

test('a focus outside the map keeps no sectors resident instead of guessing', () => {
  assert.deepEqual(activeSectors(grid, { x: -500, z: 0 }, { radiusM: 400, limit: 9 }), []);
});

test('a cap below one sector is an explicit error', () => {
  assert.throws(
    () => activeSectors(grid, { x: 10, z: 10 }, { radiusM: 100, limit: 0 }),
    /limit/,
  );
});

test('detail falls with distance and rejects inverted thresholds', () => {
  const thresholds = { nearM: 120, midM: 360 };
  assert.equal(detailFor(0, thresholds), 2);
  assert.equal(detailFor(120, thresholds), 2);
  assert.equal(detailFor(121, thresholds), 1);
  assert.equal(detailFor(360, thresholds), 1);
  assert.equal(detailFor(361, thresholds), 0);
  assert.throws(() => detailFor(10, { nearM: 400, midM: 100 }), /threshold/);
});

test('resident memory grows with sectors and buildings', () => {
  const small = residentBytes(2, 10);
  const bigger = residentBytes(2, 200);
  const moreSectors = residentBytes(10, 10);
  assert.ok(bigger > small);
  assert.ok(moreSectors > small);
});

test('point in polygon handles inside, outside and the boundary', () => {
  const square = [
    { x: 0, z: 0 },
    { x: 100, z: 0 },
    { x: 100, z: 100 },
    { x: 0, z: 100 },
  ];
  assert.equal(pointInPolygon(square, { x: 50, z: 50 }), true);
  assert.equal(pointInPolygon(square, { x: 150, z: 50 }), false);
  assert.equal(pointInPolygon(square, { x: 0, z: 50 }), true);
  assert.equal(pointInPolygon(square, { x: 100, z: 50 }), true);
});

test('scanline spans are the x runs of land at one z', () => {
  const square = [
    { x: 0, z: 0 },
    { x: 100, z: 0 },
    { x: 100, z: 100 },
    { x: 0, z: 100 },
  ];
  assert.deepEqual(polygonSpans(square, 50), [[0, 100]]);
  assert.deepEqual(polygonSpans(square, 150), []);
});
