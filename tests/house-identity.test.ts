// A house looks the same whatever else is loaded: everything about its look comes from its id
// and from data fixed for the whole city, never from its position in a list. Streaming sectors
// depends on this.
import assert from 'node:assert/strict';
import test from 'node:test';

import { chimneySmoke, hasLantern } from '../src/lib/diorama/ambience-plan.ts';
import { planHouse } from '../src/lib/diorama/house-plan.ts';
import { roofTones } from '../src/lib/diorama/roof-palette.ts';
import { hashId, shareOf } from '../src/lib/engine/math/rng.ts';

const house = (id: number, rgb: [number, number, number]) => ({
  id, center: { x_m: id % 97, z_m: id % 89 }, width_m: 6, depth_m: 8, rotation_radians: 0,
  height_m: 3 + (id % 7), roof_rgb: rgb, frontage: true,
});

const houses = Array.from({ length: 400 }, (_, index) => {
  const id = (index % 40) * 4096 + Math.floor(index / 40);
  return house(id, [80 + (index * 37) % 90, 70 + (index * 13) % 60, 60 + (index * 7) % 50]);
});

test('the id hash is deterministic, spreads evenly and differs by salt', () => {
  assert.equal(hashId(12345, 1), hashId(12345, 1));
  assert.notEqual(hashId(12345, 1), hashId(12345, 2));
  const thirds = houses.filter((h) => hashId(h.id, 3) % 3 === 0).length / houses.length;
  assert.ok(Math.abs(thirds - 1 / 3) < 0.06, `share ${thirds}`);
  for (const h of houses) {
    const share = shareOf(h.id, 9);
    assert.ok(share >= 0 && share < 1);
  }
});

test('plan, lantern, smoke and roof tone of a house do not depend on the loaded set', () => {
  const palette = [[90, 80, 70], [120, 100, 90], [150, 110, 80]] as [number, number, number][];
  const look = (list: typeof houses) => {
    const tones = roofTones(list, palette);
    return new Map(list.map((h, index) => [h.id, JSON.stringify({
      plan: planHouse(h), lantern: hasLantern(h.id), smoke: chimneySmoke(h.id),
      tone: tones.labels[index],
    })]));
  };
  const full = look(houses);
  const shuffled = [...houses].reverse().filter((_, index) => index % 3 !== 0);
  for (const [id, seen] of look(shuffled)) assert.equal(seen, full.get(id), `house ${id}`);
});

test('about a third of the doors carry a lantern and of the chimneys smoke', () => {
  const lanterns = houses.filter((h) => hasLantern(h.id)).length / houses.length;
  const smoking = houses.filter((h) => chimneySmoke(h.id).smokes).length / houses.length;
  assert.ok(Math.abs(lanterns - 1 / 3) < 0.07, `lanterns ${lanterns}`);
  assert.ok(Math.abs(smoking - 0.3) < 0.07, `smoke ${smoking}`);
});
