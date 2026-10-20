import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { readManifest } from '../src/io.ts';
import { validateManifest } from '../src/manifest.ts';
import { checkTextures } from '../src/textures.ts';
import { sampleManifestPath } from './helpers.js';

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

test('a rotated calibration is rejected until ground and grid rotate too', () => {
  const manifest = base();
  manifest.calibration.rotation_radians = Math.PI / 2;
  assert.match(errorsOf(manifest).join('\n'), /rotation_radians/);
});

test('a place outside the illustration frame is rejected', () => {
  const manifest = base();
  manifest.places[0].pixel = { u: 99999, v: 99999 };
  assert.match(errorsOf(manifest).join('\n'), /illustration frame/);
});

test('anchors outside the calibrated ground are rejected', () => {
  const manifest = base();
  manifest.spawn = { x_m: 99999, z_m: 99999 };
  manifest.waypoints[0] = { id: 'far', x_m: -5, z_m: 10 };
  const errors = errorsOf(manifest).join('\n');
  assert.match(errors, /spawn/);
  assert.match(errors, /waypoint far/);
});

test('a manifest without a reachable anchor or a solid cannot build', () => {
  const manifest = base();
  manifest.waypoints = [];
  for (const place of manifest.places) place.height_m = null;
  const errors = errorsOf(manifest).join('\n');
  assert.match(errors, /waypoints/);
  assert.match(errors, /declared height/);
});

test('malformed sections return errors instead of throwing', () => {
  const manifest = base();
  manifest.places = {};
  manifest.ground = undefined;
  const errors = errorsOf(manifest).join('\n');
  assert.match(errors, /places/);
  assert.match(errors, /ground/);
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

test('a manifest without a textures section is rejected', () => {
  const manifest = base();
  delete manifest.textures;
  assert.match(errorsOf(manifest).join('\n'), /textures must be an array/);
});

test('an anchor outside a shifted calibrated ground is rejected', () => {
  const manifest = base();
  manifest.calibration.origin_px_x = 2000;
  manifest.calibration.origin_px_y = 2000;
  const errors = errorsOf(manifest).join('\n');
  assert.match(errors, /spawn: outside the calibrated ground/);
});

test('malformed entries are reported instead of thrown', () => {
  const manifest = base();
  manifest.places = [null];
  manifest.materials = [null];
  manifest.textures = [null];
  manifest.scale_checks = [null];
  manifest.materials.push({ id: 'bad-color', base_color: 'abcd' });
  const errors = errorsOf(manifest).join('\n');
  assert.match(errors, /place: every entry must be an object/);
  assert.match(errors, /material: every entry must be an object/);
  assert.match(errors, /texture: every entry must be an object/);
  assert.match(errors, /scale_check: every entry must be an object/);
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

test('the sample texture passes the magic-byte and budget check', () => {
  const { manifest } = readManifest(sampleManifestPath());
  const [texture] = checkTextures(manifest, path.dirname(sampleManifestPath()));
  assert.equal(texture.id, 'paving-webp');
  assert.equal(texture.pass, true, texture.detail);
});

test('texture resolution metadata must match the compressed image', () => {
  const manifest = base();
  manifest.textures[0].width_px = 32;
  const [texture] = checkTextures(manifest, path.dirname(sampleManifestPath()));
  assert.equal(texture.pass, false);
  assert.match(texture.detail, /resolution mismatch/);
});

test('unsafe or oversized asset identities are rejected', () => {
  for (const id of ['../victim', 'x/../../victim', 'x\\\\victim', '', 'a'.repeat(65)]) {
    const manifest = base();
    manifest.id = id;
    assert.match(errorsOf(manifest).join('\n'), /filename-safe/);
  }
});

test('a texture over its byte budget fails the check', () => {
  const { manifest } = readManifest(sampleManifestPath());
  manifest.textures[0].max_bytes = 10;
  const [texture] = checkTextures(manifest, path.dirname(sampleManifestPath()));
  assert.equal(texture.pass, false);
  assert.equal(texture.bytes, 52);
});

test('a renamed file does not pass as compressed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desire-texture-'));
  fs.writeFileSync(path.join(dir, 'fake.webp'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const textures = [{ id: 'fake', path: 'fake.webp', mime: 'image/webp', max_bytes: 1024 }];
  const manifest = { textures };
  const [texture] = checkTextures(manifest, dir);
  assert.equal(texture.pass, false);
  assert.match(texture.detail, /not image\/webp/);
});
