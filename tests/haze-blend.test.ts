import assert from 'node:assert/strict';
import test from 'node:test';

import { hazeBlend, landShare, perimeter } from '../src/lib/diorama/haze-blend.ts';

test('looking down, the flat haze ring frames the slice and the curtain is hidden', () => {
  assert.deepEqual(hazeBlend(0.5), { ring: 1, curtain: 0 });
});

test('looking low across the city, the standing curtain takes over', () => {
  assert.deepEqual(hazeBlend(1.32), { ring: 0, curtain: 1 });
});

test('in between, the two crossfade smoothly and always sum to one', () => {
  let previous = 1;
  for (let polar = 0.9; polar <= 1.3; polar += 0.02) {
    const { ring, curtain } = hazeBlend(polar);
    assert.ok(Math.abs(ring + curtain - 1) < 1e-9);
    assert.ok(ring <= previous + 1e-12, `ring fades monotonically at ${polar}`);
    previous = ring;
  }
});

test('the curtain walks the slice perimeter in even steps, corners included', () => {
  const meta = { width_m: 100, depth_m: 50, cell_m: 10, columns: 10, rows: 5 };
  const points = perimeter(meta, { outset: 0, step: 25 });
  assert.equal(points.length, 4 + 2 + 4 + 2);
  assert.deepEqual(points[0], [0, 0]);
  assert.deepEqual(points[4], [100, 0]);
  assert.deepEqual(points[6], [100, 50]);
});

test('land share is the part of the slice near a point that stands above the water', () => {
  const meta = { width_m: 40, depth_m: 20, cell_m: 10, columns: 4, rows: 2 };
  // West half sea, east half land.
  const heights = Float32Array.from([-2.5, -2.5, 1, 1, -2.5, -2.5, 1, 1]);
  const field = { heights, meta };
  assert.equal(landShare(field, [-15, 10], 10), 0, 'over the sea');
  assert.equal(landShare(field, [55, 10], 10), 1, 'past the land edge');
  assert.equal(landShare(field, [20, -15], 10), 0.5, 'where the shore meets the edge');
});
