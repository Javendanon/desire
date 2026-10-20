// D13 corridor tracing is checked against independent pixels, never street-label anchors.
import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceToPath, corridorQuads } from '../src/lib/engine/plan/corridors.ts';
import { WATERDEEP_ROADS, WATERDEEP_MARKET } from '../content/maps/waterdeep/streets.ts';
import { WATERDEEP_MAP, allWaterdeepBuildings } from '../content/maps/waterdeep/plan.ts';
import { WATERDEEP_REFERENCE } from '../content/maps/waterdeep/reference.ts';
import { pointInPolygon } from '../src/lib/engine/plan/polygon.ts';

const scale = WATERDEEP_REFERENCE.calibration.meters_per_pixel;
const at = (x: number, z: number) => ({ x: x * scale, z: z * scale });

test('path distance handles endpoints, corners and degenerate segments', () => {
  const path = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }];
  assert.equal(distanceToPath(path, { x: 5, z: 4 }), 4);
  assert.equal(distanceToPath(path, { x: -3, z: -4 }), 5);
  assert.equal(distanceToPath([{ x: 0, z: 0 }, { x: 0, z: 0 }], { x: 3, z: 4 }), 5);
  assert.equal(distanceToPath([], { x: 0, z: 0 }), Infinity);
});

test('Market corridors follow independent raster checkpoints within 12 pixels', () => {
  const checkpoints = [
    ['traders-way', 1510, 2585],
    ['traders-way', 1940, 2585],
    ['bazaar-street', 1690, 2895],
    ['bazaar-street', 1990, 2780],
    ['the-high-road', 2080, 2550],
    ['the-high-road', 2090, 2910],
  ] as const;
  assert.equal(WATERDEEP_MAP.roads, WATERDEEP_ROADS);
  for (const [id, x, z] of checkpoints) {
    const road = WATERDEEP_ROADS.find((entry) => entry.id === id);
    assert.ok(road, id);
    assert.ok(distanceToPath(road.points, at(x, z)) <= 12 * scale, `${id} at ${x}, ${z}`);
  }
  assert.ok(pointInPolygon(WATERDEEP_MARKET, at(1548, 2719)));
});

test('roof footprints leave the traced corridors and Market square unobstructed', () => {
  const closedMarket = [...WATERDEEP_MARKET, WATERDEEP_MARKET[0]];
  for (const building of allWaterdeepBuildings()) {
    const point = { x: building.x, z: building.z };
    const roofRadius = Math.hypot(building.width * 1.15, building.depth * 1.08) / 2;
    assert.equal(pointInPolygon(WATERDEEP_MARKET, point), false);
    assert.ok(distanceToPath(closedMarket, point) > roofRadius);
    for (const road of WATERDEEP_ROADS) {
      assert.ok(distanceToPath(road.points, point) > road.widthM / 2 + roofRadius, road.id);
    }
  }
});

test('roof circles clear rendered strips including their square end caps', () => {
  const surfaces = WATERDEEP_ROADS.flatMap(corridorQuads).map((quad) => ({
    quad, boundary: [...quad, quad[0]],
  }));
  // O(lots * pilot segments). The pilot has only 15 segments, not a full-city network.
  for (const building of allWaterdeepBuildings()) {
    const radius = Math.hypot(building.width * 1.15, building.depth * 1.08) / 2;
    for (const { quad, boundary } of surfaces) {
      assert.equal(pointInPolygon(quad, building), false);
      assert.ok(distanceToPath(boundary, building) > radius);
    }
  }
});

test('corridor surfaces are continuous quads with nonzero width at sector crossings', () => {
  assert.throws(() => corridorQuads({ id: 'invalid', widthM: 0, points: [] }), /positive/);
  assert.throws(() => corridorQuads({ id: 'duplicate', widthM: 2,
    points: [{ x: 0, z: 0 }, { x: 0, z: 0 }] }), /differ/);
  for (const road of WATERDEEP_ROADS) {
    const quads = corridorQuads(road);
    assert.equal(quads.length, road.points.length - 1);
    for (const quad of quads) {
      assert.equal(quad.length, 4);
      assert.ok(Math.abs(Math.hypot(quad[0].x - quad[3].x, quad[0].z - quad[3].z) -
        road.widthM) < 1e-6);
    }
  }
});
