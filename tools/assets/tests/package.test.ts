import assert from 'node:assert/strict';
import test from 'node:test';

import { BLOCKED_CELL, PACKAGE_SCHEMA, SECTOR_SCHEMA } from '../src/map-types.ts';
import { buildPackage, chunkId } from '../src/package.ts';
import { buildScene } from '../src/scene.ts';
import { sampleManifest } from './helpers.ts';

const build = () => {
  const manifest = sampleManifest();
  return { manifest, ...buildPackage(buildScene(manifest), manifest) };
};

// The exact field set of D13 `MapBuilding` plus D18 evidence. Drift on either side fails here.
const MAP_BUILDING_KEYS = ['depth', 'height', 'roof', 'rotation', 'stone', 'tone', 'width', 'x', 'z'];
const EVIDENCE_KEYS = ['height_evidence', 'place_id', 'provenance'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test('every building carries the D13 MapBuilding fields plus its evidence, nothing else', () => {
  const { sectors } = build();
  const buildings = sectors.flatMap((sector) => sector.buildings);
  assert.equal(buildings.length, 8, 'one building per place with a declared height');
  for (const building of buildings) {
    assert.deepEqual(Object.keys(building).sort(), [...MAP_BUILDING_KEYS, ...EVIDENCE_KEYS].sort());
  }
});

test('buildings land in the D13 sector that contains their centre', () => {
  const { map, sectors } = build();
  const { grid } = map;
  assert.deepEqual(grid, { sizeM: 64, originX: 0, originZ: 0, columns: 4, rows: 3 });
  for (const sector of sectors) {
    assert.equal(sector.schema, SECTOR_SCHEMA);
    for (const building of sector.buildings) {
      const column = Math.floor((building.x - grid.originX) / grid.sizeM);
      const row = Math.floor((building.z - grid.originZ) / grid.sizeM);
      assert.equal(sector.index, row * grid.columns + column, building.place_id);
    }
  }
});

test('building rotation and style come from the manifest, never from a default', () => {
  const { sectors } = build();
  const byId = new Map(sectors.flatMap((sector) => sector.buildings)
    .map((building) => [building.place_id, building]));
  assert.equal(byId.get('ropewalk')?.rotation, 0.3);
  assert.equal(byId.get('watch-tower')?.rotation, 0);
  assert.deepEqual(
    [byId.get('watch-tower')?.stone, byId.get('fish-market')?.stone], [true, false]);
  assert.equal(byId.get('lighthouse')?.height_evidence, 'interpretation');
});

test('each non-empty sector is one D04 Chunk of the map version', () => {
  const { manifest, map, sectors } = build();
  assert.equal(map.schema, PACKAGE_SCHEMA);
  assert.deepEqual(map.chunks.map((chunk) => chunk.asset_uri),
    sectors.map((sector) => `sectors/${sector.index}.json`));
  for (const [position, chunk] of map.chunks.entries()) {
    const index = sectors[position].index;
    assert.match(chunk.id, UUID);
    assert.equal(chunk.id, chunkId(manifest.map_version.id, index), 'ids are deterministic');
    assert.equal(chunk.map_version_id, manifest.map_version.id);
    assert.equal(chunk.size_m, 64);
    const column = index % map.grid.columns;
    const row = Math.floor(index / map.grid.columns);
    assert.deepEqual(chunk.origin, { x_m: column * 64, y_m: 0, z_m: row * 64 });
  }
  assert.equal(new Set(map.chunks.map((chunk) => chunk.id)).size, map.chunks.length);
});

test('chunk ids are RFC 9562 name-based UUIDs, equal to Python uuid.uuid5', () => {
  // python3 -c "import uuid; print(uuid.uuid5(uuid.UUID('d1800000-...-000000000001'), 'chunk:6'))"
  assert.equal(chunkId('d1800000-0000-4000-8000-000000000001', 6), '6232a52e-af9b-5707-beb6-396e31d1045d');
});

test('places without a height stay places: listed, anchored and absent from the buildings', () => {
  const { map, sectors } = build();
  assert.deepEqual(map.unknown_places, ['chandlers-row', 'tide-stairs']);
  const ids = sectors.flatMap((sector) => sector.buildings.map((building) => building.place_id));
  assert.ok(!ids.includes('chandlers-row'));
  const unknown = map.places.find((place) => place.id === 'tide-stairs');
  assert.deepEqual(unknown?.at, { x_m: 15, z_m: 130 });
  assert.equal(unknown?.height_known, false);
});

test('the navigation grid is a D12 cost buffer that blocks every building centre', () => {
  const { map, costs, sectors } = build();
  assert.equal(map.nav.asset_uri, 'nav-costs.bin');
  assert.equal(map.nav.blocked_cell, BLOCKED_CELL);
  assert.equal(costs.length, map.nav.width * map.nav.height);
  for (const building of sectors.flatMap((sector) => sector.buildings)) {
    const column = Math.floor((building.x - map.nav.origin_x_m) / map.nav.cell_m);
    const row = Math.floor((building.z - map.nav.origin_z_m) / map.nav.cell_m);
    assert.equal(costs[row * map.nav.width + column], BLOCKED_CELL, building.place_id);
  }
});

test('the package records the map version and its calibration provenance', () => {
  const { map } = build();
  assert.equal(map.map_version.revision, 1);
  assert.match(map.map_version.id, UUID);
  assert.equal(map.map_version.calibration_provenance.evidence, 'synthetic');
  assert.equal(map.network_allowed, false);
});
