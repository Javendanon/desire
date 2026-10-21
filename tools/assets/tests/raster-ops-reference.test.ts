// Characterisation of the raster operations against brute-force references, on random rasters
// with edge cases (radius 0, radius past the image, single rows and columns). The fast versions
// must give exactly the reference result.
import assert from 'node:assert/strict';
import test from 'node:test';

import { mulberry32 } from '../src/random.ts';
import { components, dilate, erode, majority } from '../src/raster/raster-ops.ts';

type Size = { width: number, height: number };

const SIZES: Size[] = [
  { width: 1, height: 1 }, { width: 1, height: 9 }, { width: 13, height: 1 },
  { width: 17, height: 11 }, { width: 40, height: 23 },
];
const RADII = [0, 1, 2, 5, 30];

function randomRaster(size: Size, values: number, seed: number): Uint8Array {
  const random = mulberry32(seed);
  return Uint8Array.from({ length: size.width * size.height }, () => Math.floor(random() * values));
}

/** Clustered mask, so components and morphology meet real shapes, not noise only. */
function blobs(size: Size, seed: number): Uint8Array {
  const random = mulberry32(seed);
  const centres = Array.from({ length: 4 }, () =>
    [random() * size.width, random() * size.height, 1 + random() * 6]);
  return Uint8Array.from({ length: size.width * size.height }, (_, index) => {
    const [x, y] = [index % size.width, Math.floor(index / size.width)];
    return centres.some(([cx, cy, r]) => Math.hypot(x - cx, y - cy) < r) ? 1 : 0;
  });
}

function window(size: Size, index: number, radius: number): number[] {
  const x = index % size.width;
  const y = Math.floor(index / size.width);
  const cells: number[] = [];
  for (let row = Math.max(0, y - radius); row <= Math.min(size.height - 1, y + radius); row += 1) {
    for (let col = Math.max(0, x - radius); col <= Math.min(size.width - 1, x + radius); col += 1) {
      cells.push(row * size.width + col);
    }
  }
  return cells;
}

function majorityReference(classes: Uint8Array, size: Size, radius: number): Uint8Array {
  return classes.map((centre, index) => {
    const counts = new Map<number, number>();
    for (const cell of window(size, index, radius)) {
      counts.set(classes[cell], (counts.get(classes[cell]) ?? 0) + 1);
    }
    let best = centre;
    for (const [value, count] of counts) {
      const bestCount = counts.get(best) ?? 0;
      if (count > bestCount || (count === bestCount && value < best)) best = value;
    }
    return best;
  });
}

const dilateReference = (mask: Uint8Array, size: Size, radius: number) =>
  mask.map((_, index) => (window(size, index, radius).some((cell) => mask[cell]) ? 1 : 0));

const erodeReference = (mask: Uint8Array, size: Size, radius: number) =>
  mask.map((_, index) => (window(size, index, radius).every((cell) => mask[cell]) ? 1 : 0));

test('majority equals the brute-force window vote, ties to the lower class', () => {
  SIZES.forEach((size, s) => RADII.forEach((radius) => {
    for (const values of [2, 3, 8]) {
      const classes = randomRaster(size, values, s * 97 + radius * 7 + values);
      assert.deepEqual(majority(classes, size, radius), majorityReference(classes, size, radius),
        `${size.width}x${size.height} r=${radius} values=${values}`);
    }
  }));
});

test('majority accepts class ids past the usual eight', () => {
  const size = { width: 12, height: 7 };
  const classes = randomRaster(size, 200, 5);
  assert.deepEqual(majority(classes, size, 2), majorityReference(classes, size, 2));
});

test('dilate and erode equal the brute-force square window', () => {
  SIZES.forEach((size, s) => RADII.forEach((radius) => {
    for (const mask of [randomRaster(size, 2, s + radius), blobs(size, s * 3 + radius)]) {
      assert.deepEqual(dilate(mask, size, radius), dilateReference(mask, size, radius),
        `dilate ${size.width}x${size.height} r=${radius}`);
      assert.deepEqual(erode(mask, size, radius), erodeReference(mask, size, radius),
        `erode ${size.width}x${size.height} r=${radius}`);
    }
  }));
});

test('components label in scan order with exact sizes', () => {
  SIZES.forEach((size, s) => {
    const mask = blobs(size, s + 11);
    const { labels, sizes } = components(mask, size);
    const seen = new Map<number, number>();
    labels.forEach((label, index) => {
      assert.equal(label >= 0, mask[index] === 1);
      if (label < 0) return;
      if (!seen.has(label)) assert.equal(label, seen.size, 'labels appear in scan order');
      seen.set(label, (seen.get(label) ?? 0) + 1);
      const x = index % size.width;
      if (x > 0 && mask[index - 1]) assert.equal(labels[index - 1], label);
      if (index >= size.width && mask[index - size.width]) {
        assert.equal(labels[index - size.width], label);
      }
    });
    assert.deepEqual(sizes, [...seen.values()]);
  });
});
