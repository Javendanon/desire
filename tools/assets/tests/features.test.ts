import assert from 'node:assert/strict';
import test from 'node:test';

import { findBerths, plantTrees } from '../src/features.ts';
import { Surface } from '../src/raster/surface.ts';

const size = { width: 160, height: 80 };
const SHIP = { lengthPx: 30, beamPx: 8, spacingPx: 36, seed: 5 };

/** Open water with a pier running east from the west edge, rows 38-41, columns 0-109. */
function harbour(): Uint8Array {
  const classes = new Uint8Array(size.width * size.height).fill(Surface.Water);
  for (let y = 38; y <= 41; y += 1) {
    for (let x = 0; x < 110; x += 1) classes[y * size.width + x] = Surface.Pier;
  }
  return classes;
}

test('ships moor alongside the pier, parallel to it, in open water', () => {
  const berths = findBerths(harbour(), size, SHIP);
  assert.ok(berths.length >= 4, `expected berths on both sides, got ${berths.length}`);
  for (const berth of berths) {
    assert.ok(Math.abs(Math.sin(berth.heading_radians)) > 0.99, 'keel runs east-west');
    const clearance = berth.y_px < 38 ? 38 - berth.y_px : berth.y_px - 41;
    assert.ok(clearance >= SHIP.beamPx / 2, `hull clear of the pier: ${JSON.stringify(berth)}`);
    assert.ok(clearance <= SHIP.beamPx, `moored close to the pier: ${JSON.stringify(berth)}`);
  }
  const sides = new Set(berths.map((berth) => berth.y_px < 38));
  assert.equal(sides.size, 2, 'both sides of the pier');
});

test('moored ships keep their spacing and stay inside the slice', () => {
  const berths = findBerths(harbour(), size, SHIP);
  for (const [index, a] of berths.entries()) {
    assert.ok(a.x_px - SHIP.lengthPx / 2 >= 0 && a.x_px + SHIP.lengthPx / 2 <= size.width);
    for (const b of berths.slice(index + 1)) {
      assert.ok(Math.hypot(a.x_px - b.x_px, a.y_px - b.y_px) >= SHIP.spacingPx);
    }
  }
});

test('no pier, no berths, and the same seed gives the same harbour', () => {
  const sea = new Uint8Array(size.width * size.height).fill(Surface.Water);
  assert.deepEqual(findBerths(sea, size, SHIP), []);
  assert.deepEqual(findBerths(harbour(), size, SHIP), findBerths(harbour(), size, SHIP));
});

test('trees grow on garden pixels only, about one per spacing square', () => {
  const classes = new Uint8Array(size.width * size.height).fill(Surface.Street);
  for (let y = 0; y < 40; y += 1) {
    for (let x = 0; x < 80; x += 1) classes[y * size.width + x] = Surface.Garden;
  }
  const trees = plantTrees(classes, size, { spacingPx: 10, seed: 2 });
  assert.ok(trees.length > 0 && trees.length <= (80 * 40) / 100, `${trees.length} trees`);
  for (const tree of trees) {
    const pixel = Math.floor(tree.y_px) * size.width + Math.floor(tree.x_px);
    assert.equal(classes[pixel], Surface.Garden, JSON.stringify(tree));
    assert.ok(tree.scale >= 0.8 && tree.scale <= 1.3);
  }
  assert.deepEqual(plantTrees(classes, size, { spacingPx: 10, seed: 2 }), trees);
});
