import assert from 'node:assert/strict';
import test from 'node:test';

import { planHouse, STOREY_M } from '../src/lib/diorama/house-plan.ts';
import type { SliceHouse } from '../src/lib/diorama/slice-data.ts';

const house = (overrides: Partial<SliceHouse> = {}): SliceHouse => ({
  center: { x_m: 10, z_m: 20 },
  width_m: 6,
  depth_m: 9,
  rotation_radians: 0,
  height_m: 7,
  roof_rgb: [86, 73, 67],
  frontage: true,
  ...overrides,
});

test('storeys follow the height, at least one, at most four', () => {
  assert.equal(planHouse(house({ height_m: 2 }), 1).storeys, 1);
  assert.equal(planHouse(house({ height_m: 6.4 }), 1).storeys, 2);
  assert.equal(planHouse(house({ height_m: 30 }), 1).storeys, 4);
});

test('wall height is whole storeys, so window rows line up between neighbours', () => {
  const plan = planHouse(house({ height_m: 7 }), 3);
  assert.equal(plan.wallHeight, plan.storeys * STOREY_M);
});

test('a red roof from the map is a notable stone building with a hip roof and one more storey', () => {
  const plain = planHouse(house(), 5);
  const notable = planHouse(house({ roof_rgb: [180, 70, 50] }), 5);
  assert.equal(notable.notable, true);
  assert.equal(notable.stone, true);
  assert.equal(notable.roof, 'hip');
  assert.equal(notable.storeys, Math.min(4, plain.storeys + 1));
});

test('only timber houses of two or more storeys jetty their upper floors', () => {
  for (let seed = 0; seed < 200; seed += 1) {
    const plan = planHouse(house({ height_m: seed % 2 === 0 ? 3 : 9 }), seed);
    if (plan.jetty > 0) {
      assert.equal(plan.stone, false, `seed ${seed}`);
      assert.ok(plan.storeys >= 2, `seed ${seed}`);
    }
  }
});

test('dormers appear only on hip roofs, facing the street', () => {
  let dormers = 0;
  for (let seed = 0; seed < 300; seed += 1) {
    const plan = planHouse(house({ width_m: 8 }), seed);
    if (plan.dormer) {
      dormers += 1;
      assert.equal(plan.roof, 'hip', `seed ${seed}`);
    }
  }
  assert.ok(dormers > 0, 'some hip roofs carry a dormer');
});

test('the same house and seed always give the same plan', () => {
  assert.deepEqual(planHouse(house(), 42), planHouse(house(), 42));
});

test('every roof type and both wall materials occur across a street', () => {
  const plans = Array.from({ length: 200 }, (_, seed) => planHouse(house(), seed));
  assert.deepEqual([...new Set(plans.map((plan) => plan.roof))].sort(), ['gable', 'hip']);
  assert.deepEqual([...new Set(plans.map((plan) => plan.stone))].sort(), [false, true]);
});
