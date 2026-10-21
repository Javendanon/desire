import assert from 'node:assert/strict';
import test from 'node:test';

import { hazeBlend } from '../src/lib/diorama/haze-blend.ts';

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
