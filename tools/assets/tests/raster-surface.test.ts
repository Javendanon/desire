import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyPixel, classifyRgb, Surface } from '../src/raster/surface.ts';

// Colours measured on the Tych Waterdeep raster (9 × 9 means at known points).
const SAMPLES: [string, [number, number, number], number][] = [
  ['deep water', [35, 66, 77], Surface.Water],
  ['shallow water, blue equal to red', [134, 152, 130], Surface.Water],
  ['shallow water, blue below red', [130, 147, 128], Surface.Water],
  ['paved road', [142, 136, 130], Surface.Street],
  ['brown roof', [86, 73, 67], Surface.Roof],
  ['red landmark roof', [190, 70, 50], Surface.RedRoof],
  ['drawn outline', [26, 7, 2], Surface.Outline],
  ['vegetation is green but not water', [90, 120, 60], Surface.Ground],
];

for (const [name, [r, g, b], expected] of SAMPLES) {
  test(`classifies ${name}`, () => {
    assert.equal(classifyPixel(r, g, b), expected);
  });
}

// Colour alone cannot tell a dirt lane from a roof: both are warm, mid-dark and weakly saturated.
// Roofs differ by texture (ridge lines), which a per-pixel rule cannot see. Street centrelines
// resolve the lanes in refineSurfaces; this test pins the limitation so a threshold change that
// "fixes" it by breaking dark roofs is a conscious decision.
test('a dirt lane reads as roof by colour alone (resolved by street centrelines)', () => {
  assert.equal(classifyPixel(118, 108, 96), Surface.Roof);
  assert.equal(classifyPixel(73, 55, 48), Surface.Roof, 'a shaded roof is darker still');
});

test('classifyRgb labels every pixel of an RGB buffer in row-major order', () => {
  const rgb = Uint8Array.from([35, 66, 77, 86, 73, 67, 142, 136, 130, 26, 7, 2]);
  assert.deepEqual([...classifyRgb(rgb, 4)],
    [Surface.Water, Surface.Roof, Surface.Street, Surface.Outline]);
});

test('classifyRgb rejects a buffer that is not whole RGB pixels', () => {
  assert.throws(() => classifyRgb(Uint8Array.from([1, 2, 3, 4]), 2), /3 bytes per pixel/);
});
