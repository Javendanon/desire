import assert from 'node:assert/strict';
import test from 'node:test';

import { components, dilate, majority } from '../src/raster/raster-ops.ts';
import { paintPolylines } from '../src/raster/polyline.ts';

const size = { width: 5, height: 3 };

test('components labels 4-connected regions and reports their sizes', () => {
  const mask = Uint8Array.from([
    1, 1, 0, 1, 1,
    0, 1, 0, 0, 1,
    1, 0, 0, 0, 0,
  ]);
  const { labels, sizes } = components(mask, size);
  assert.deepEqual(sizes, [3, 3, 1]);
  assert.equal(labels[0], labels[6], 'vertical neighbours join');
  assert.notEqual(labels[0], labels[3], 'a gap separates regions');
  assert.equal(labels[2], -1, 'background is unlabelled');
  assert.notEqual(labels[10], labels[6], 'diagonal neighbours stay apart');
});

test('dilate grows a mask by a square radius and stays inside the image', () => {
  const mask = new Uint8Array(15);
  mask[7] = 1;
  const grown = dilate(mask, size, 1);
  assert.deepEqual([...grown], [
    0, 1, 1, 1, 0,
    0, 1, 1, 1, 0,
    0, 1, 1, 1, 0,
  ]);
});

test('majority keeps the most frequent class in each window, removing speckle', () => {
  const classes = Uint8Array.from([
    2, 2, 2, 2, 2,
    2, 2, 4, 2, 2,
    2, 2, 2, 2, 2,
  ]);
  assert.deepEqual([...majority(classes, size, 1)], new Array(15).fill(2));
});

test('paintPolylines marks every pixel within half the width of a segment', () => {
  const mask = new Uint8Array(7 * 5);
  paintPolylines(mask, { width: 7, height: 5 }, [{ points: [[0.5, 2.5], [6.5, 2.5]], width: 3 }]);
  const row = (y: number) => [...mask.subarray(y * 7, y * 7 + 7)];
  assert.deepEqual(row(0), [0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(row(1), [1, 1, 1, 1, 1, 1, 1]);
  assert.deepEqual(row(2), [1, 1, 1, 1, 1, 1, 1]);
  assert.deepEqual(row(4), [0, 0, 0, 0, 0, 0, 0]);
});
