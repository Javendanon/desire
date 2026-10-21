import assert from 'node:assert/strict';
import test from 'node:test';

import { FREE_CELL_COST } from '../src/map-types.ts';
import { packageFindings, type WrittenPackage } from '../src/package-check.ts';
import { buildPackage } from '../src/package.ts';
import { buildScene } from '../src/scene.ts';
import { sampleManifest } from './helpers.ts';

/** A valid package, deep-copied so each test can damage it independently. */
function sample() {
  const manifest = sampleManifest();
  const scene = buildScene(manifest);
  const built = buildPackage(scene, manifest);
  const written: WrittenPackage = {
    map: structuredClone(built.map),
    sectors: structuredClone(built.sectors),
    costs: built.costs.slice(),
  };
  return { scene, written };
}

function failing(written: WrittenPackage, scene: ReturnType<typeof buildScene>) {
  return packageFindings(written, scene).filter((check) => !check.pass).map((check) => check.id);
}

test('an untouched package passes every package check', () => {
  const { scene, written } = sample();
  assert.deepEqual(failing(written, scene), []);
});

test('a building moved into the wrong sector fails package.buildings', () => {
  const { scene, written } = sample();
  const [first, second] = written.sectors;
  second.buildings.push(first.buildings.pop()!);
  assert.deepEqual(failing(written, scene), ['package.buildings']);
});

test('a building whose numbers drift from the scene fails package.buildings', () => {
  const { scene, written } = sample();
  written.sectors[0].buildings[0].height += 1;
  assert.deepEqual(failing(written, scene), ['package.buildings']);
});

test('a missing or duplicated building fails package.buildings', () => {
  const missing = sample();
  missing.written.sectors[0].buildings = [];
  assert.ok(failing(missing.written, missing.scene).includes('package.buildings'));
  const duplicated = sample();
  const sector = duplicated.written.sectors[0];
  sector.buildings.push({ ...sector.buildings[0] });
  assert.ok(failing(duplicated.written, duplicated.scene).includes('package.buildings'));
});

test('misaligned, foreign or duplicated chunks fail package.chunks', () => {
  const edits: ((written: WrittenPackage) => void)[] = [
    (written) => { written.map.chunks[0].origin.x_m += 1; },
    (written) => { written.map.chunks[0].map_version_id = 'd1800000-0000-4000-8000-0000000000ff'; },
    (written) => { written.map.chunks[0].asset_uri = 'sectors/99.json'; },
    (written) => { written.map.chunks[1].id = written.map.chunks[0].id; },
    (written) => { written.map.chunks.pop(); },
  ];
  for (const edit of edits) {
    const { scene, written } = sample();
    edit(written);
    assert.ok(failing(written, scene).includes('package.chunks'), edit.toString());
  }
});

test('a footprint cell left free fails nav.costs, recomputed from the written buildings', () => {
  const { scene, written } = sample();
  const building = written.sectors[0].buildings[0];
  const { nav } = written.map;
  const column = Math.floor((building.x - nav.origin_x_m) / nav.cell_m);
  const row = Math.floor((building.z - nav.origin_z_m) / nav.cell_m);
  written.costs[row * nav.width + column] = FREE_CELL_COST;
  const navCheck = packageFindings(written, scene).find((check) => check.id === 'nav.costs');
  assert.equal(navCheck?.pass, false);
  assert.match(navCheck?.detail ?? '', new RegExp(building.place_id));
});

test('a cost buffer that disagrees with its header or encoding fails nav.costs', () => {
  const short = sample();
  short.written.costs = short.written.costs.slice(1);
  assert.ok(failing(short.written, short.scene).includes('nav.costs'));
  const foreign = sample();
  foreign.written.costs[0] = 7;
  assert.ok(failing(foreign.written, foreign.scene).includes('nav.costs'));
});

test('lost provenance or a dropped unknown place fails package.provenance', () => {
  const unlisted = sample();
  unlisted.written.map.unknown_places = [];
  assert.deepEqual(failing(unlisted.written, unlisted.scene), ['package.provenance']);
  const unsourced = sample();
  unsourced.written.map.map_version.calibration_provenance.source = '';
  assert.deepEqual(failing(unsourced.written, unsourced.scene), ['package.provenance']);
});
