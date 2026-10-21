import assert from 'node:assert/strict';
import test from 'node:test';

import { blockMask, traceBlocks } from '../src/raster/blocks.ts';
import { simplifyRing } from '../src/raster/simplify.ts';
import { Surface } from '../src/raster/surface.ts';

/** Builds a mask from rows of '#' (set) and '.' (clear). */
function mask(rows: string[]) {
  const width = rows[0].length;
  const data = Uint8Array.from(rows.join('').split(''), (cell) => (cell === '#' ? 1 : 0));
  return { data, size: { width, height: rows.length } };
}

/** Shoelace area; positive for counter-clockwise in a y-down image means clockwise on screen. */
const signedArea = (ring: [number, number][]) =>
  ring.reduce((sum, [x, y], index) => {
    const [nx, ny] = ring[(index + 1) % ring.length];
    return sum + x * ny - nx * y;
  }, 0) / 2;

test('block land is the city between streets: courtyards stay inside their block', () => {
  const classes = Uint8Array.from([
    Surface.Roof, Surface.Ground, Surface.Street, Surface.Water,
    Surface.Pier, Surface.Garden, Surface.RedRoof, Surface.Outline,
  ]);
  const urban = Uint8Array.from([1, 1, 1, 1, 1, 1, 1, 0]);
  assert.deepEqual([...blockMask(classes, urban)], [1, 1, 0, 0, 0, 1, 1, 0]);
});

test('holes smaller than the threshold are noise and join their block', () => {
  const { data, size } = mask([
    '#######',
    '#.###.#',
    '###.###',
    '#######',
  ]);
  const options = { minAreaPx: 1, tolerancePx: 0.5, minHoleAreaPx: 2 };
  const [block] = traceBlocks(data, size, options);
  assert.deepEqual(block.holes, [], 'three one-pixel holes are dropped');
});

test('a rectangle becomes one block with a four-corner outer ring and no holes', () => {
  const { data, size } = mask([
    '......',
    '.####.',
    '.####.',
    '......',
  ]);
  const [block] = traceBlocks(data, size, { minAreaPx: 1, tolerancePx: 0.5 });
  assert.equal(block.outer.length, 4);
  assert.equal(Math.abs(signedArea(block.outer)), 8);
  assert.deepEqual(block.holes, []);
  assert.equal(block.areaPx, 8);
});

test('a courtyard becomes a hole of its block, wound opposite to the outer ring', () => {
  const { data, size } = mask([
    '#####',
    '#...#',
    '#...#',
    '#####',
  ]);
  const blocks = traceBlocks(data, size, { minAreaPx: 1, tolerancePx: 0.5 });
  assert.equal(blocks.length, 1);
  const [block] = blocks;
  assert.equal(block.holes.length, 1);
  assert.equal(Math.sign(signedArea(block.outer)), -Math.sign(signedArea(block.holes[0])));
  assert.equal(block.areaPx, 14);
});

test('separate components become separate blocks and tiny ones are dropped', () => {
  const { data, size } = mask([
    '##..###.#',
    '##..###..',
  ]);
  const blocks = traceBlocks(data, size, { minAreaPx: 2, tolerancePx: 0.5 });
  assert.deepEqual(blocks.map((block) => block.areaPx).sort(), [4, 6]);
});

test('diagonal neighbours are separate blocks (4-connectivity)', () => {
  const { data, size } = mask([
    '##..',
    '##..',
    '..##',
    '..##',
  ]);
  assert.equal(traceBlocks(data, size, { minAreaPx: 1, tolerancePx: 0.5 }).length, 2);
});

test('simplifyRing drops points closer than the tolerance to the chord', () => {
  const ring: [number, number][] = [[0, 0], [5, 0.2], [10, 0], [10, 10], [0, 10]];
  assert.deepEqual(simplifyRing(ring, 0.5), [[0, 0], [10, 0], [10, 10], [0, 10]]);
});
