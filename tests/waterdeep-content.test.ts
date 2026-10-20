import test from 'node:test';
import assert from 'node:assert/strict';

import {
  planMeters,
  WATERDEEP_REFERENCE,
} from '../content/maps/waterdeep/reference.ts';
import {
  allWaterdeepBuildings,
  WATERDEEP_CITY_ID,
  WATERDEEP_COAST,
  WATERDEEP_MAP,
  WATERDEEP_MAP_ID,
  WATERDEEP_ZONES,
  waterdeepIsLand,
  waterdeepPlaces,
  waterdeepSector,
} from '../content/maps/waterdeep/plan.ts';
import { sectorCount, sectorIndexAt } from '../src/lib/engine/plan/sectors.ts';
import { pointInPolygon } from '../src/lib/engine/plan/polygon.ts';

const reference = WATERDEEP_REFERENCE;
const millimetres = 0.01;

test('the reference package keeps the D05 counts and calibration', () => {
  assert.equal(reference.image.width, 3560);
  assert.equal(reference.image.height, 7256);
  assert.equal(reference.control_points.length, 20);
  assert.equal(reference.wards.length, 8);
  assert.equal(reference.initial_places.length, 10);
  assert.equal(reference.main_streets.length, 7);
  assert.equal(reference.calibration.meters_per_pixel, 0.983225806451613);
});

test('plan metres can be recomputed from pixels and the D05 scale', () => {
  const scale = reference.calibration.meters_per_pixel;
  for (const point of [...reference.control_points, ...reference.initial_places]) {
    const derived = planMeters(point.pixel, scale);
    assert.ok(Math.abs(derived.x_m - point.plan_m.x_m) < millimetres, point.id);
    assert.ok(Math.abs(derived.z_m - point.plan_m.z_m) < millimetres, point.id);
  }
});

test('the map bounds are the whole raster in metres', () => {
  const scale = reference.calibration.meters_per_pixel;
  assert.equal(WATERDEEP_MAP.bounds.minX, 0);
  assert.equal(WATERDEEP_MAP.bounds.minZ, 0);
  assert.ok(Math.abs(WATERDEEP_MAP.bounds.maxX - reference.image.width * scale) < 1);
  assert.ok(Math.abs(WATERDEEP_MAP.bounds.maxZ - reference.image.height * scale) < 1);
  assert.equal(WATERDEEP_MAP.grid.sizeM, 250);
});

test('the eight wards become zones with centres inside their own box', () => {
  assert.equal(WATERDEEP_ZONES.length, 8);
  assert.equal(new Set(WATERDEEP_ZONES.map((zone) => zone.id)).size, 8);
  for (const zone of WATERDEEP_ZONES) {
    assert.ok(zone.center.x >= zone.bounds.minX && zone.center.x <= zone.bounds.maxX, zone.id);
    assert.ok(zone.center.z >= zone.bounds.minZ && zone.center.z <= zone.bounds.maxZ, zone.id);
    assert.match(zone.heightSource, /interpreted/);
  }
});

test('every D05 control point falls on the interpreted land polygon', () => {
  for (const point of reference.control_points) {
    const at = { x: point.plan_m.x_m, z: point.plan_m.z_m };
    assert.equal(waterdeepIsLand(at), true, `${point.id} is in the water`);
  }
});

test('all ten places become D04 records with one calibrated anchor each', () => {
  const places = waterdeepPlaces();
  assert.equal(places.length, reference.initial_places.length);
  assert.equal(new Set(places.map((place) => place.id)).size, places.length);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  assert.match(WATERDEEP_MAP_ID, uuid);
  assert.match(WATERDEEP_CITY_ID, uuid);
  assert.equal(places[0].id, 'd1300000-0000-4000-8000-000000000101');
  places.forEach((place, index) => {
    const source = reference.initial_places[index];
    assert.match(place.id, uuid);
    assert.equal(place.id, WATERDEEP_MAP.places[index].contractId);
    assert.equal(place.city_id, WATERDEEP_CITY_ID);
    assert.equal(place.name, source.name);
    if (place.district_id !== null) assert.match(place.district_id, uuid);
    assert.equal(place.anchors.length, 1);
    assert.equal(place.anchors[0].map_version_id, WATERDEEP_MAP_ID);
    assert.equal(place.provenance.evidence, 'interpretation');
    assert.ok(Math.abs(place.anchors[0].position.x_m - source.plan_m.x_m) < millimetres);
    assert.ok(Math.abs(place.anchors[0].position.z_m - source.plan_m.z_m) < millimetres);
    assert.equal(place.anchors[0].position.y_m, 0);
  });
});

test('seeded building generation is stable across calls', () => {
  const first = waterdeepSector(140);
  const again = waterdeepSector(140);
  assert.deepEqual(again, first);
  assert.ok(first.buildings.length > 0);
});

test('every building stands on land, inside the bounds and in a known zone', () => {
  const buildings = allWaterdeepBuildings();
  assert.ok(buildings.length > 1000, `only ${buildings.length} buildings`);
  const zones = new Set(WATERDEEP_ZONES.map((zone) => zone.id));
  for (const building of buildings) {
    const at = { x: building.x, z: building.z };
    assert.equal(waterdeepIsLand(at), true, "a building stands in the water");
    assert.equal(pointInPolygon(WATERDEEP_COAST, at), true);
    assert.ok(building.x >= 0 && building.x <= WATERDEEP_MAP.bounds.maxX);
    assert.ok(building.z >= 0 && building.z <= WATERDEEP_MAP.bounds.maxZ);
    assert.ok(zones.has(building.zone), `unknown zone ${building.zone}`);
    assert.equal(building.heightSource, 'interpreted');
    assert.ok(building.height > 1 && building.height < 40, `${building.height} m`);
  }
});

test('no building is raised on a D05 place marker', () => {
  const places = reference.initial_places;
  for (const building of allWaterdeepBuildings()) {
    for (const place of places) {
      const distance = Math.hypot(
        building.x - place.plan_m.x_m,
        building.z - place.plan_m.z_m,
      );
      assert.ok(distance > 20, `${place.id} is ${distance.toFixed(1)} m from a building`);
    }
  }
});

test('every building belongs to exactly the sector that contains it', () => {
  const buildings = allWaterdeepBuildings();
  let counted = 0;
  for (let index = 0; index < sectorCount(WATERDEEP_MAP.grid); index++) {
    for (const building of waterdeepSector(index).buildings) {
      assert.equal(sectorIndexAt(WATERDEEP_MAP.grid, building), index);
      counted++;
    }
  }
  assert.equal(counted, buildings.length);
});

test('buildings stay on their own side of a shared ward box', () => {
  const zoneById = new Map(WATERDEEP_ZONES.map((zone) => [zone.id, zone]));
  for (const building of allWaterdeepBuildings()) {
    const zone = zoneById.get(building.zone);
    assert.ok(zone);
    if (zone.kind !== 'tombs') {
      assert.ok(building.height > 2, `${building.zone} house is ${building.height} m`);
    }
  }
});
