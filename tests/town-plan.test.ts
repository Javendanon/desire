import assert from 'node:assert/strict';
import test from 'node:test';

import { planHouse } from '../src/lib/diorama/house-plan.ts';
import type { SliceHouse } from '../src/lib/diorama/slice-data.ts';
import { mergePlans, planTown } from '../src/lib/diorama/town-plan.ts';

const house = (id: number, rotation_radians = 0): SliceHouse => ({
  id, center: { x_m: 100, z_m: 200 }, width_m: 6, depth_m: 9, rotation_radians, height_m: 7,
  roof_rgb: [120, 90, 70], frontage: true,
});
const centres: [number, number, number][] = [[120, 90, 70], [60, 60, 60]];
const instances = (data: Float32Array | undefined) => (data?.length ?? 0) / 16;
const total = (batches: Record<string, Float32Array>) =>
  Object.values(batches).reduce((sum, data) => sum + instances(data), 0);

test('near detail builds every storey, the roof, and the chimney and dormer the plan asks for', () => {
  const one = house(4097);
  const plan = planHouse(one);
  const town = planTown([one], { roofCentres: centres, detail: 'near' });
  const wall = plan.stone ? 'stone' : 'timber';
  const dormer = Number(plan.dormer);
  assert.equal(instances(town.batches[wall]), plan.storeys + dormer);
  assert.equal(instances(town.batches[`${plan.roof}:0`]), 1 + (plan.roof === 'gable' ? dormer : 0));
  assert.equal(instances(town.batches.chimney), Number(plan.chimney));
  assert.equal(town.chimneyTops.length, Number(plan.chimney));
  assert.equal(town.fronts.length, 1, 'a frontage house gets a lantern by its door');
  assert.equal(town.tones.length, centres.length, 'one roof material per city-wide tone');
});

test('far detail is one wall box and one roof per house, with no markers', () => {
  const houses = [house(1), house(2), house(3), house(4)];
  const town = planTown(houses, { roofCentres: centres, detail: 'far' });
  assert.equal(total(town.batches), houses.length * 2);
  assert.equal(town.chimneyTops.length, 0);
  assert.equal(town.fronts.length, 0);
});

test('a far wall spans the full wall height, centred on it, turned with the house', () => {
  const one = house(7, Math.PI / 6);
  const plan = planHouse(one);
  const town = planTown([one], { roofCentres: centres, detail: 'far' });
  const wall = town.batches[plan.stone ? 'stone' : 'timber'];
  const [c, s] = [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)];
  const expected = [c * 6, 0, -s * 6, 0, 0, plan.wallHeight, 0, 0, s * 9, 0, c * 9, 0,
    100, 1 + plan.wallHeight / 2, 200, 1];
  [...wall].forEach((value, at) => assert.ok(Math.abs(value - expected[at]) < 1e-4,
    `element ${at}: ${value} vs ${expected[at]}`));
});

test('merging plans concatenates each batch in sector order', () => {
  const a = planTown([house(1)], { roofCentres: centres, detail: 'far' });
  const b = planTown([house(2), house(3)], { roofCentres: centres, detail: 'far' });
  const merged = mergePlans([a, b]);
  assert.equal(total(merged), 6);
  for (const [key, data] of Object.entries(merged)) {
    assert.equal(instances(data), instances(a.batches[key]) + instances(b.batches[key]));
    assert.deepEqual([...data.slice(0, a.batches[key]?.length ?? 0)], [...(a.batches[key] ?? [])]);
  }
});
