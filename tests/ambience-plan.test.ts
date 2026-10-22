import assert from 'node:assert/strict';
import test from 'node:test';

import { puffAt, waterSpots } from '../src/lib/diorama/ambience-plan.ts';

test('a smoke puff rises steadily, grows, and vanishes at both ends of its life', () => {
  const ages = [0, 0.25, 0.5, 0.75, 1];
  const puffs = ages.map(puffAt);
  assert.equal(puffs[0].size, 0);
  assert.ok(Math.abs(puffs[4].size) < 1e-9, 'gone at the end of its life');
  for (let index = 1; index < puffs.length; index += 1) {
    assert.ok(puffs[index].rise > puffs[index - 1].rise, 'always rising');
  }
  assert.ok(puffs[3].size > puffs[1].size, 'older puffs are wider until they fade');
});

test('fog banks sit over water cells only, deterministically', () => {
  const meta = { columns: 4, rows: 2, cell_m: 10 };
  const heights = Float32Array.from([1, 1, -2.5, -2.5, 1, 1, 1, -2.5]);
  const spots = waterSpots({ heights, meta, count: 6, seed: 4 });
  assert.equal(spots.length, 6);
  const water = new Set(['2,0', '3,0', '3,1']);
  for (const spot of spots) {
    const cell = `${Math.floor(spot.x / 10)},${Math.floor(spot.z / 10)}`;
    assert.ok(water.has(cell), JSON.stringify(spot));
  }
  assert.deepEqual(waterSpots({ heights, meta, count: 6, seed: 4 }), spots);
});

test('no water means no fog banks', () => {
  const meta = { columns: 2, rows: 1, cell_m: 10 };
  assert.deepEqual(waterSpots({ heights: Float32Array.from([1, 1]), meta, count: 3, seed: 1 }), []);
});
