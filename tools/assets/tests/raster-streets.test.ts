import assert from 'node:assert/strict';
import test from 'node:test';

import { fillPolygons } from '../src/raster/polygon-fill.ts';
import { measureStreetWidth, type RgbRaster } from '../src/raster/street-width.ts';

const STREET: [number, number, number] = [88, 78, 69];
const SLATE: [number, number, number] = [64, 67, 73];
const OUTLINE: [number, number, number] = [26, 7, 2];

/**
 * A synthetic North Ward raster: a horizontal street band of `band` rows centred vertically,
 * then the 2 px black outline Tych draws around every building, then slate roofs. Street and
 * slate are only 27 apart in RGB, so the outline is what ends the walk, as on the real map.
 */
function streetRaster(width: number, height: number, band: number): RgbRaster {
  const rgb = new Uint8Array(width * height * 3);
  const top = Math.floor(height / 2 - band / 2);
  const bottom = top + band;
  for (let y = 0; y < height; y += 1) {
    const outline = (y >= top - 2 && y < top) || (y >= bottom && y < bottom + 2);
    const colour = y >= top && y < bottom ? STREET : outline ? OUTLINE : SLATE;
    for (let x = 0; x < width; x += 1) rgb.set(colour, (y * width + x) * 3);
  }
  return { rgb, width, height };
}

test('measures the drawn width of a street from its centreline, whatever its colour', () => {
  const raster = streetRaster(80, 60, 20);
  const width = measureStreetWidth(raster, [[5, 30], [75, 30]]);
  assert.ok(Math.abs(width - 20) <= 2, `measured ${width}`);
});

test('pebble noise inside the street does not stop the walk', () => {
  const raster = streetRaster(80, 60, 20);
  for (const [x, y] of [[40, 34], [41, 26], [20, 33]]) raster.rgb.set([200, 200, 200], (y * 80 + x) * 3);
  const width = measureStreetWidth(raster, [[5, 30], [75, 30]]);
  assert.ok(Math.abs(width - 20) <= 2, `measured ${width}`);
});

test('the median ignores a junction where one side opens onto a square', () => {
  const raster = streetRaster(80, 60, 12);
  for (let y = 0; y < 60; y += 1) {
    for (let x = 30; x < 40; x += 1) raster.rgb.set(STREET, (y * 80 + x) * 3);
  }
  const width = measureStreetWidth(raster, [[5, 30], [75, 30]]);
  assert.ok(Math.abs(width - 12) <= 2, `measured ${width}`);
});

test('fillPolygons sets pixels whose centre lies inside any polygon (even-odd)', () => {
  const mask = new Uint8Array(6 * 4);
  fillPolygons(mask, { width: 6, height: 4 }, [[[1, 1], [5, 1], [5, 3], [1, 3]]]);
  const rows = Array.from({ length: 4 }, (_, y) => [...mask.subarray(y * 6, y * 6 + 6)]);
  assert.deepEqual(rows, [
    [0, 0, 0, 0, 0, 0],
    [0, 1, 1, 1, 1, 0],
    [0, 1, 1, 1, 1, 0],
    [0, 0, 0, 0, 0, 0],
  ]);
});
