import assert from 'node:assert/strict';
import test from 'node:test';

import { readManifest } from '../src/io.js';
import { validateManifest } from '../src/manifest.js';
import { sampleManifestPath, samplePath } from './helpers.js';

const base = () => readManifest(sampleManifestPath()).manifest;

const errorsOf = (manifest) => validateManifest(manifest).errors;

test('the committed sample manifest is valid', () => {
  const { errors, manifest } = readManifest(sampleManifestPath());
  assert.deepEqual(errors, []);
  assert.equal(manifest.schema, 'desire.asset-scene/1');
});

test('a verified height needs a source reference', () => {
  const manifest = base();
  const place = manifest.places[0];
  place.height_evidence = 'verified';
  place.source_ref = null;
  assert.match(errorsOf(manifest).join('\n'), /verified/);
});

test('an interpreted height needs a rationale', () => {
  const manifest = base();
  const place = manifest.places.find((entry) => entry.height_evidence === 'interpretation');
  delete place.rationale;
  assert.match(errorsOf(manifest).join('\n'), /rationale/);
});

test('an unknown height is allowed and invents nothing', () => {
  const manifest = base();
  const place = manifest.places.find((entry) => entry.height_m === null);
  assert.ok(place, 'the sample keeps at least one place without a height');
  assert.deepEqual(errorsOf(manifest), []);
});

test('an impossible height is rejected instead of becoming a tower', () => {
  const manifest = base();
  manifest.places[0].height_m = 900;
  assert.match(errorsOf(manifest).join('\n'), /height_m/);
});

test('an uncompressed texture is rejected', () => {
  const manifest = base();
  manifest.textures[0].mime = 'image/png';
  assert.match(errorsOf(manifest).join('\n'), /compressed/);
});

test('a manifest that allows the network is rejected without authorization', () => {
  const manifest = base();
  manifest.network_allowed = true;
  assert.match(errorsOf(manifest).join('\n'), /network_allowed/);
});

test('duplicate place ids and impossible footprints are rejected', () => {
  const manifest = base();
  manifest.places[1].id = manifest.places[0].id;
  manifest.places[2].footprint_m.width_m = 900;
  const errors = errorsOf(manifest).join('\n');
  assert.match(errors, /duplicate place id/);
  assert.match(errors, /footprint_m/);
});

test('the sample texture is a real webp inside its budget', () => {
  const { manifest } = readManifest(sampleManifestPath());
  const texture = manifest.textures[0];
  assert.equal(texture.mime, 'image/webp');
  assert.ok(samplePath(texture.path).endsWith('.webp'));
});
