import assert from 'node:assert/strict';
import test from 'node:test';

import { refineSurfaces } from '../src/raster/refine.ts';
import { Surface } from '../src/raster/surface.ts';

const W = Surface.Water;
const R = Surface.Roof;
const G = Surface.Ground;
const O = Surface.Outline;

/** Builds a class grid from rows of single-letter codes. */
function grid(rows: string[]) {
  const codes: Record<string, number> = { W, R, G, O, S: Surface.Street };
  const width = rows[0].length;
  const classes = Uint8Array.from(rows.join('').split('').map((code) => codes[code]));
  return { classes, size: { width, height: rows.length } };
}

const rowsOf = (classes: Uint8Array, width: number) =>
  Array.from({ length: classes.length / width }, (_, y) => [...classes.subarray(y * width, (y + 1) * width)]);

test('small isolated water patches inland become ground', () => {
  const { classes, size } = grid([
    'WWWWWWGGGG',
    'WWWWWWGGWG',
    'WWWWWWGGGG',
  ]);
  const refined = refineSurfaces({ classes, size, streets: [], minWaterShareOfSea: 0.2, pierRadius: 1 });
  assert.equal(refined[1 * 10 + 8], G, 'the inland puddle is not sea');
  assert.equal(refined[0], W, 'open water stays water');
});

test('street centrelines force street pixels on land but never on water', () => {
  const { classes, size } = grid([
    'WWRRRRRRRR',
    'WWRRRRRRRR',
    'WWRRRRRRRR',
  ]);
  const streets = [{ points: [[0.5, 1.5], [9.5, 1.5]] as [number, number][], width: 1 }];
  const refined = refineSurfaces({ classes, size, streets, minWaterShareOfSea: 0.1 });
  assert.deepEqual(rowsOf(refined, 10)[1],
    [W, W, Surface.Street, Surface.Street, Surface.Street, Surface.Street,
      Surface.Street, Surface.Street, Surface.Street, Surface.Street]);
});

test('a roof-coloured strip ringed by an outline and surrounded by water is a pier', () => {
  const { classes, size } = grid([
    'WWWWWWWWWWWW',
    'WWOOOOOOOWWW',
    'WWORRRRRROWW',
    'WWOOOOOOOWWW',
    'WWWWWWWWWWWW',
  ]);
  const refined = refineSurfaces({
    classes, size, streets: [], minWaterShareOfSea: 0.1, majorityRadius: 0, pierRadius: 2,
  });
  assert.equal(refined[2 * 12 + 5], Surface.Pier);
});

test('a roof block on land with one side to the water stays a roof', () => {
  const { classes, size } = grid([
    'WWWWGGGGGGGG',
    'WWWWGRRRRRRG',
    'WWWWGRRRRRRG',
    'WWWWGRRRRRRG',
    'WWWWGGGGGGGG',
  ]);
  const refined = refineSurfaces({
    classes, size, streets: [], minWaterShareOfSea: 0.1, majorityRadius: 0, pierRadius: 2,
  });
  assert.equal(refined[2 * 12 + 8], R);
});

test('a narrow pier attached to a coastal block is split off by the opening', () => {
  const { classes, size } = grid([
    'WWWWWWWWWWWWWW',
    'WWWWWWWWWWWWWW',
    'WWRRRRRRRRRRSS',
    'WWWWWWRRRRRRSS',
    'WWWWWWRRRRRRSS',
    'WWWWWWRRRRRRSS',
    'WWWWWWRRRRRRSS',
    'WWWWWWSSSSSSSS',
  ]);
  const refined = refineSurfaces({
    classes, size, streets: [], minWaterShareOfSea: 0.1, majorityRadius: 0, pierRadius: 1,
    pierGapPixels: 1,
  });
  assert.equal(refined[2 * 14 + 3], Surface.Pier, 'the one-pixel strip reaching into the water');
  assert.equal(refined[5 * 14 + 9], R, 'the coastal block, with streets on its land sides');
});

test('a wide crossing of two piers is a pier junction, not a building', () => {
  const { classes, size } = grid([
    'WWWWWWWWWWWWWW',
    'WWWWWRRRRWWWWW',
    'WRRRRRRRRRRRRW',
    'WRRRRRRRRRRRRW',
    'WWWWWRRRRWWWWW',
    'WWWWWWWWWWWWWW',
  ]);
  const refined = refineSurfaces({
    classes, size, streets: [], minWaterShareOfSea: 0.1, majorityRadius: 0, pierRadius: 1,
  });
  assert.equal(refined[2 * 14 + 6], Surface.Pier, 'the junction');
  assert.equal(refined[2 * 14 + 1], Surface.Pier, 'an arm');
});

test('outside the urban mask, roof-coloured fields are terrain', () => {
  const { classes, size } = grid([
    'RRRRRR',
    'RRRRRR',
  ]);
  const urban = Uint8Array.from([1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0]);
  const refined = refineSurfaces({ classes, size, streets: [], minWaterShareOfSea: 0.5, urban });
  assert.deepEqual([...refined.subarray(0, 6)], [R, R, R, G, G, G]);
});

test('small green patches inside the city are gardens, not water', () => {
  const { classes, size } = grid([
    'WWWWWWWWWWGGGG',
    'WWWWWWWWWWGWGG',
    'WWWWWWWWWWGGGG',
  ]);
  const urban = new Uint8Array(42).fill(1);
  const refined = refineSurfaces({
    classes, size, streets: [], minWaterShareOfSea: 0.3, urban, pierRadius: 1, majorityRadius: 0,
  });
  assert.equal(refined[1 * 14 + 11], Surface.Garden);
  assert.equal(refined[0], W);
});

test('a large green forest outside the city and away from the sea is terrain', () => {
  const { classes, size } = grid([
    'WWWWWWWWWWWWWWWWWWWWGGGGGGGGGG',
    'WWWWWWWWWWWWWWWWWWWWGGGWWWWGGG',
    'WWWWWWWWWWWWWWWWWWWWGGGWWWWGGG',
    'WWWWWWWWWWWWWWWWWWWWGGGGGGGGGG',
  ]);
  const refined = refineSurfaces({
    classes, size, streets: [], minWaterShareOfSea: 0.5, majorityRadius: 0, pierRadius: 1,
    urban: new Uint8Array(120),
  });
  assert.equal(refined[1 * 30 + 24], G, 'eight green pixels against an 80-pixel sea');
  assert.equal(refined[0], W);
});

test('street-coloured roof facets are block land; a square touching the streets stays street', () => {
  const { classes, size } = grid([
    'RRRRRRRRRRRR',
    'RSSRRRRSSSSR',
    'RSSRRRRSSSSR',
    'RRRRRRRSSSSR',
    'RRRRRRRRRRRR',
    'RRRRRRRRRRRR',
  ]);
  const streets = [{ points: [[0, 4.5], [12, 4.5]] as [number, number][], width: 1 }];
  const refined = refineSurfaces({
    classes, size, streets, minWaterShareOfSea: 0.1, majorityRadius: 0, pierRadius: 1,
    minSquarePx: 6,
  });
  assert.equal(refined[1 * 12 + 1], Surface.Ground, 'a 4-pixel facet away from any street');
  assert.equal(refined[2 * 12 + 9], Surface.Street, 'a 10-pixel square that reaches the street');
});
