import assert from 'node:assert/strict';
import test from 'node:test';

import { validateManifest } from '../src/manifest.ts';
import { sampleManifest } from './helpers.ts';

const base = sampleManifest;

/** Validation reads untrusted JSON, so malformed fixtures stay `unknown`. */
const errorsOf = (manifest: unknown) => validateManifest(manifest).errors;

test('the committed sample manifest is valid', () => {
  const manifest = base();
  assert.deepEqual(errorsOf(manifest), []);
  assert.equal(manifest.schema, 'desire.asset-scene/2');
});

test('a verified height needs a source reference', () => {
  const manifest = base();
  const place = { ...manifest.places[0], height_evidence: 'verified', source_ref: null };
  assert.match(errorsOf({ ...manifest, places: [place] }).join('\n'), /verified/);
});

test('an interpreted height needs a rationale', () => {
  const manifest = base();
  const place = manifest.places.find((entry) => entry.height_evidence === 'interpretation');
  assert.ok(place, 'the sample keeps an interpreted height');
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
  const errors = errorsOf({ ...manifest, places: {}, map_version: 'v1' }).join('\n');
  assert.match(errors, /places must be an array/);
  assert.match(errors, /map_version is required/);
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

test('an anchor outside a shifted calibrated ground is rejected', () => {
  const manifest = base();
  manifest.calibration.origin_px_x = 2000;
  manifest.calibration.origin_px_y = 2000;
  const errors = errorsOf(manifest).join('\n');
  assert.match(errors, /spawn: outside the calibrated ground/);
});

test('malformed entries are reported instead of thrown', () => {
  const manifest = base();
  const errors = errorsOf({
    ...manifest,
    places: [null],
    waypoints: [null],
    scale_checks: [null],
  }).join('\n');
  assert.match(errors, /place: every entry must be an object/);
  assert.match(errors, /waypoint: every entry must be an object/);
  assert.match(errors, /scale_check: every entry must be an object/);
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

test('unsafe or oversized asset identities are rejected', () => {
  for (const id of ['../victim', 'x/../../victim', 'x\\\\victim', '', 'a'.repeat(65)]) {
    const manifest = base();
    manifest.id = id;
    assert.match(errorsOf(manifest).join('\n'), /filename-safe/);
  }
});

test('a package needs a D04 map version with UUID ids and a positive revision', () => {
  const manifest = base();
  const errors = (version: unknown) => errorsOf({ ...manifest, map_version: version }).join('\n');
  assert.match(errors(undefined), /map_version is required/);
  assert.match(errors({ ...manifest.map_version, id: 'not-a-uuid' }), /id must be a lowercase UUID/);
  assert.match(errors({ ...manifest.map_version, revision: 0 }), /revision must be a positive u32/);
});

test('building style follows the engine kit: five roof tints, a tone and a wall material', () => {
  const manifest = base();
  const place = (style: unknown) => ({ ...manifest.places[0], style });
  const errors = (style: unknown) =>
    errorsOf({ ...manifest, places: [place(style)] }).join('\n');
  assert.match(errors(undefined), /style with roof, tone and stone is required/);
  assert.match(errors({ roof: 5, tone: 0, stone: true }), /style.roof must be an integer from 0 to 4/);
  assert.match(errors({ roof: 0, tone: -1, stone: true }), /style.tone/);
  assert.match(errors({ roof: 0, tone: 0, stone: 'yes' }), /style.stone must be boolean/);
});

test('building rotation must be a finite angle within one half turn', () => {
  const manifest = base();
  for (const rotation of [Number.NaN, 4, '0.3']) {
    const place = { ...manifest.places[0], rotation_radians: rotation };
    assert.match(errorsOf({ ...manifest, places: [place] }).join('\n'), /rotation_radians/);
  }
});

test('sector size and navigation cell size are bounded before allocation', () => {
  const manifest = base();
  assert.match(errorsOf({ ...manifest, sector_size_m: 0 }).join('\n'), /sector_size_m must be positive/);
  assert.match(errorsOf({ ...manifest, sector_size_m: 0.5 }).join('\n'), /over the budget/);
  assert.match(errorsOf({ ...manifest, nav_cell_m: 0.1 }).join('\n'), /raise nav_cell_m/);
});

test('version 1 manifests are rejected instead of being read as version 2', () => {
  const manifest = base();
  assert.match(errorsOf({ ...manifest, schema: 'desire.asset-scene/1' }).join('\n'),
    /schema must be desire.asset-scene\/2/);
});
