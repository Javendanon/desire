import assert from 'node:assert/strict';
import test from 'node:test';

import { createMercatorFrame } from '../src/raster/frame.ts';

// Tych Waterdeep: z18 stitch whose top-left corner is the map's north-west bound.
const TYCH = { zoom: 18, west: -123.05626478690047, north: 38.33925568803595 };

test('the north-west bound maps to pixel (0, 0)', () => {
  const frame = createMercatorFrame(TYCH);
  const [x, y] = frame.lngLatToPixel([TYCH.west, TYCH.north]);
  assert.ok(Math.abs(x) < 1e-6 && Math.abs(y) < 1e-6, `${x}, ${y}`);
});

test('the south-east bound lands on the stitched image size (6319 × 9136)', () => {
  const frame = createMercatorFrame(TYCH);
  const [x, y] = frame.lngLatToPixel([-123.02236831237244, 38.30080507975201]);
  assert.equal(Math.round(x), 6319);
  assert.equal(Math.round(y), 9136);
});

test('pixel to lng/lat inverts lng/lat to pixel', () => {
  const frame = createMercatorFrame(TYCH);
  const point: [number, number] = [-123.04, 38.32];
  const [lng, lat] = frame.pixelToLngLat(frame.lngLatToPixel(point));
  assert.ok(Math.abs(lng - point[0]) < 1e-9 && Math.abs(lat - point[1]) < 1e-9);
});

test('ground metres per pixel follow the Mercator scale at the frame latitude', () => {
  const frame = createMercatorFrame(TYCH);
  // 2πR / (256 · 2^18) · cos(38.32°) ≈ 0.4684 m.
  assert.ok(Math.abs(frame.metresPerPixel - 0.4684) < 0.0005, `${frame.metresPerPixel}`);
});

test('pixels map to world metres: x east, z south, origin at the image corner', () => {
  const frame = createMercatorFrame(TYCH);
  assert.deepEqual(frame.pixelToWorld([0, 0]), { x_m: 0, z_m: 0 });
  const world = frame.pixelToWorld([100, 200]);
  assert.ok(Math.abs(world.x_m - 100 * frame.metresPerPixel) < 1e-9);
  assert.ok(Math.abs(world.z_m - 200 * frame.metresPerPixel) < 1e-9);
});
