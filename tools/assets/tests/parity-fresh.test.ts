import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { parityDrift } from '../src/parity-fresh.ts';

const GOLDEN = 'crates/atlas/tests/fixtures/parity.json';
/** linux/amd64 Node 24.18.0, against the arm64-generated golden. About 3.7e-9 px, 2048 ulps. */
const AMD64_FRAME_Y = 8718.56422610581;

const text = (value: unknown) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

const sample = () => ({
  vectors: {
    frame_metres_per_pixel: 0.4683867315551439,
    frame_pixels: [[1.25, 2.5], [3625.57707118243, 8718.564226109535]],
    fill_fnv1a: 3594746260,
  },
  refine: { fnv1a: 7 },
});

test('byte-identical goldens are fresh', () => {
  const bytes = text(sample());
  assert.equal(parityDrift(bytes, bytes), null);
});

test('a Mercator pixel inside 1e-6 px is fresh', () => {
  const committed = sample();
  const generated = sample();
  generated.vectors.frame_pixels[1][1] += 1e-9;
  assert.equal(parityDrift(text(committed), text(generated)), null);
});

test('a Mercator pixel past 1e-6 px is stale', () => {
  const committed = sample();
  const generated = sample();
  generated.vectors.frame_pixels[1][1] += 2e-6;
  assert.equal(parityDrift(text(committed), text(generated)), 'vectors.frame_pixels.1');
});

test('any other field is exact', () => {
  const committed = sample();
  const generated = sample();
  generated.vectors.fill_fnv1a += 1;
  assert.equal(parityDrift(text(committed), text(generated)), 'vectors.fill_fnv1a');
});

test('metres per pixel stay exact even inside the frame tolerance', () => {
  const generated = sample();
  generated.vectors.frame_metres_per_pixel += 1e-9;
  assert.equal(
    parityDrift(text(sample()), text(generated)),
    'vectors.frame_metres_per_pixel',
  );
});

test('a missing key is stale', () => {
  const generated = { vectors: sample().vectors };
  assert.equal(parityDrift(text(sample()), text(generated)), 'root');
});

test('json that does not parse is stale', () => {
  const reason = parityDrift(Buffer.from('{'), Buffer.from('{}'));
  assert.ok(reason);
  assert.match(reason, /JSON/);
});

test('the committed golden accepts the amd64 Mercator pixel that failed CI', () => {
  const committed = fs.readFileSync(GOLDEN);
  const generated = JSON.parse(committed.toString('utf8')) as {
    vectors: { frame_pixels: number[][] };
  };
  const committedY = generated.vectors.frame_pixels[41][1];
  assert.notEqual(committedY, AMD64_FRAME_Y);
  generated.vectors.frame_pixels[41][1] = AMD64_FRAME_Y;
  assert.equal(parityDrift(committed, text(generated)), null);
  generated.vectors.frame_pixels[41][1] = committedY + 2e-6;
  assert.equal(parityDrift(committed, text(generated)), 'vectors.frame_pixels.41');
});
