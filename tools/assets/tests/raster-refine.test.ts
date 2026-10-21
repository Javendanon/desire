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
  const refined = refineSurfaces({ classes, size, streets: [], minWaterFraction: 0.2 });
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
  const refined = refineSurfaces({ classes, size, streets, minWaterFraction: 0.1 });
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
  const refined = refineSurfaces({ classes, size, streets: [], minWaterFraction: 0.1, majorityRadius: 0 });
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
  const refined = refineSurfaces({ classes, size, streets: [], minWaterFraction: 0.1, majorityRadius: 0 });
  assert.equal(refined[2 * 12 + 8], R);
});
