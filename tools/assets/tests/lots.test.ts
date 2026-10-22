import assert from 'node:assert/strict';
import test from 'node:test';

import { footprintCorners } from '../src/footprint.ts';
import { placeHouses, type LotRules } from '../src/lots.ts';
import { pointInRing, ringsOverlap } from '../src/polygon.ts';
import type { Plan } from '../src/types.ts';

const square = (size: number, x0 = 0, z0 = 0): Plan[] => [
  { x_m: x0, z_m: z0 }, { x_m: x0 + size, z_m: z0 },
  { x_m: x0 + size, z_m: z0 + size }, { x_m: x0, z_m: z0 + size },
];
const RULES: LotRules = { frontage: [5, 9], depth: [7, 12], seed: 42 };

const cornersOf = (house: ReturnType<typeof placeHouses>[number]) => footprintCorners({
  center: house.center, width_m: house.width_m, depth_m: house.depth_m,
  rotation_radians: house.rotation_radians,
});

test('houses line the block frontage, stay inside it and never overlap', () => {
  const houses = placeHouses({ outer: square(40), holes: [] }, RULES);
  assert.ok(houses.length >= 12, `only ${houses.length} houses on a 40 m block`);
  for (const [index, house] of houses.entries()) {
    for (const corner of cornersOf(house)) assert.ok(pointInRing(corner, square(40)), 'inside');
    for (const other of houses.slice(index + 1)) {
      assert.equal(ringsOverlap(cornersOf(house), cornersOf(other)), false, 'no overlap');
    }
  }
});

test('a frontage house faces its street: rotation follows the edge it stands on', () => {
  const houses = placeHouses({ outer: square(40), holes: [] }, RULES);
  const northRow = houses.filter((house) => house.center.z_m < 8);
  assert.ok(northRow.length > 0);
  for (const house of northRow) {
    const turns = house.rotation_radians / (Math.PI / 2);
    assert.ok(Math.abs(turns - Math.round(turns)) < 1e-9, `axis-aligned on an axis-aligned block`);
  }
});

test('courtyard holes stay free', () => {
  const hole = square(12, 14, 14);
  const houses = placeHouses({ outer: square(40), holes: [hole] }, RULES);
  for (const house of houses) {
    assert.equal(ringsOverlap(cornersOf(house), hole), false, 'no house in the courtyard');
  }
});

test('the built predicate keeps houses off ground the map draws as open', () => {
  const builtWestHalf = (point: Plan) => point.x_m < 20;
  const houses = placeHouses({ outer: square(40), holes: [] }, { ...RULES, isBuilt: builtWestHalf });
  assert.ok(houses.length > 0);
  for (const house of houses) {
    assert.ok(house.center.x_m < 20 + house.width_m / 2, `house at x ${house.center.x_m}`);
  }
});

test('placement is deterministic for a seed and varies across seeds', () => {
  const block = { outer: square(40), holes: [] };
  const first = JSON.stringify(placeHouses(block, RULES));
  assert.equal(JSON.stringify(placeHouses(block, RULES)), first);
  assert.notEqual(JSON.stringify(placeHouses(block, { ...RULES, seed: 7 })), first);
});

test('a block narrower than the shallowest lot gets no houses rather than overflowing', () => {
  const sliver: Plan[] = [
    { x_m: 0, z_m: 0 }, { x_m: 30, z_m: 0 }, { x_m: 30, z_m: 3 }, { x_m: 0, z_m: 3 },
  ];
  assert.deepEqual(placeHouses({ outer: sliver, holes: [] }, RULES), []);
});

test('a ridge line under the centre does not reject an otherwise built lot', () => {
  const ridgeFree = (point: Plan) => Math.abs(point.x_m - 20) > 0.4 && Math.abs(point.z_m - 20) > 0.4;
  const everywhere = placeHouses({ outer: square(40), holes: [] }, RULES).length;
  const withRidges = placeHouses({ outer: square(40), holes: [] }, { ...RULES, isBuilt: ridgeFree }).length;
  assert.ok(withRidges >= everywhere - 2, `${withRidges} of ${everywhere}`);
});

test('every lot carries the corners it was placed with, those of its footprint', () => {
  for (const house of placeHouses({ outer: square(40), holes: [] }, RULES)) {
    house.corners.forEach((corner, index) => {
      assert.ok(Math.abs(corner.x_m - cornersOf(house)[index].x_m) < 1e-9);
      assert.ok(Math.abs(corner.z_m - cornersOf(house)[index].z_m) < 1e-9);
    });
  }
});
