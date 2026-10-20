// Deterministic building lots for the Waterdeep scene. Positions come from the calibrated D05
// ward boxes; footprint, density and height are D13 interpretations, tagged as such. Nothing is
// generated outside land or on a D05 marker, so facades never move the geography.

import type { Point2 } from '../../../src/lib/engine/math/hex.ts';
import { between, createRandom } from '../../../src/lib/engine/math/rng.ts';
import type { MapBuilding, SectorContent } from '../../../src/lib/engine/plan/map-definition.ts';
import { sectorCount, sectorIndexAt } from '../../../src/lib/engine/plan/sectors.ts';
import { WATERDEEP_BOUNDS, WATERDEEP_GRID } from './bounds.ts';
import { waterdeepIsLand } from './coast.ts';
import { WATERDEEP_REFERENCE, type ReferencePlace } from './reference.ts';
import { waterdeepRoadClear } from './streets.ts';
import { WATERDEEP_ZONES, type WaterdeepZone } from './zones.ts';

export interface WaterdeepBuilding extends MapBuilding {
  zone: string;
  readonly heightSource: 'interpreted';
}

const LOT_STEP_M = 26;
const LOT_JITTER_M = 8;
const PLACE_CLEARANCE_M = 26;
const MIN_HEIGHT_M = 1.2;
const ROOF_TINTS = 5;
const ROTATION_STEPS = 8;

interface Clearance {
  at: Point2;
  radiusM: number;
}

function placeClearance(place: ReferencePlace): Clearance {
  return { at: { x: place.plan_m.x_m, z: place.plan_m.z_m }, radiusM: PLACE_CLEARANCE_M };
}

const CLEARANCES: readonly Clearance[] = WATERDEEP_REFERENCE.initial_places.map(placeClearance);

function cellSeed(zone: string, column: number, row: number): number {
  let hash = 2166136261;
  for (const char of zone) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash ^ Math.imul(column, 73856093) ^ Math.imul(row, 19349663)) >>> 0;
}

/** The ward whose box contains the point and whose centre is closest. */
function ownerZone(point: Point2): WaterdeepZone | null {
  let owner: WaterdeepZone | null = null;
  let best = Infinity;
  for (const zone of WATERDEEP_ZONES) {
    const { minX, maxX, minZ, maxZ } = zone.bounds;
    if (point.x < minX || point.x > maxX || point.z < minZ || point.z > maxZ) continue;
    const distance = Math.hypot(point.x - zone.center.x, point.z - zone.center.z);
    if (distance < best) {
      best = distance;
      owner = zone;
    }
  }
  return owner;
}

function isClear(point: Point2): boolean {
  return CLEARANCES.every((clearance) => {
    const distance = Math.hypot(point.x - clearance.at.x, point.z - clearance.at.z);
    return distance > clearance.radiusM;
  });
}

function buildingAt(
  zone: WaterdeepZone,
  point: Point2,
  random: () => number,
): WaterdeepBuilding {
  const height = between(random, zone.minHeight, zone.maxHeight);
  const small = zone.kind === 'tombs';
  return {
    x: point.x,
    z: point.z,
    width: between(random, small ? 1.2 : 6, small ? 2.6 : 16),
    depth: between(random, small ? 1.2 : 6, small ? 2.6 : 15),
    height: Math.max(MIN_HEIGHT_M, height),
    rotation: Math.floor(random() * ROTATION_STEPS) * (Math.PI / 4) + between(random, -0.1, 0.1),
    roof: Math.floor(random() * ROOF_TINTS),
    tone: zone.roofTone,
    stone: random() < zone.stone,
    zone: zone.id,
    heightSource: 'interpreted',
  };
}

function onMap(point: Point2): boolean {
  const { minX, maxX, minZ, maxZ } = WATERDEEP_BOUNDS;
  return point.x >= minX && point.x <= maxX && point.z >= minZ && point.z <= maxZ;
}

/** One lot of a zone, or null when it is water, another ward, reserved or left empty. */
function lotAt(zone: WaterdeepZone, column: number, row: number): WaterdeepBuilding | null {
  const random = createRandom(cellSeed(zone.id, column, row));
  const at = {
    x: zone.bounds.minX + (column + 0.5) * LOT_STEP_M,
    z: zone.bounds.minZ + (row + 0.5) * LOT_STEP_M,
  };
  at.x += between(random, -LOT_JITTER_M, LOT_JITTER_M);
  at.z += between(random, -LOT_JITTER_M, LOT_JITTER_M);
  if (!onMap(at) || !waterdeepIsLand(at) || !isClear(at)) return null;
  if (ownerZone(at)?.id !== zone.id || random() > zone.density) return null;
  const building = buildingAt(zone, at, random);
  const roofRadius = Math.hypot(building.width * 1.15, building.depth * 1.08) / 2;
  return waterdeepRoadClear(at, roofRadius) ? building : null;
}

function zoneBuildings(zone: WaterdeepZone): WaterdeepBuilding[] {
  const buildings: WaterdeepBuilding[] = [];
  const rows = Math.ceil((zone.bounds.maxZ - zone.bounds.minZ) / LOT_STEP_M);
  const columns = Math.ceil((zone.bounds.maxX - zone.bounds.minX) / LOT_STEP_M);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const building = lotAt(zone, column, row);
      if (building) buildings.push(building);
    }
  }
  return buildings;
}

let allBuildings: readonly WaterdeepBuilding[] | null = null;
const sectorContents = new Map<number, SectorContent>();

/** Every generated lot, in a stable order. O(lots) once, then cached. */
export function allWaterdeepBuildings(): readonly WaterdeepBuilding[] {
  if (allBuildings) return allBuildings;
  const generated: WaterdeepBuilding[] = [];
  for (const zone of WATERDEEP_ZONES) generated.push(...zoneBuildings(zone));
  allBuildings = generated;
  return generated;
}

function bucketBySector(buildings: readonly WaterdeepBuilding[]): WaterdeepBuilding[][] {
  const buckets: WaterdeepBuilding[][] = Array.from(
    { length: sectorCount(WATERDEEP_GRID) },
    () => [],
  );
  for (const building of buildings) {
    const index = sectorIndexAt(WATERDEEP_GRID, building);
    if (index === null) throw new Error(`waterdeep buildings: ${building.zone} lot is off the map`);
    buckets[index].push(building);
  }
  return buckets;
}

let buckets: WaterdeepBuilding[][] | null = null;

/** Buildings whose lot falls inside one sector. Cached per sector. */
export function waterdeepSector(index: number): SectorContent {
  if (!Number.isInteger(index) || index < 0 || index >= sectorCount(WATERDEEP_GRID)) {
    throw new Error(`waterdeep sector ${index} is not in the calibrated grid`);
  }
  buckets ??= bucketBySector(allWaterdeepBuildings());
  let content = sectorContents.get(index);
  if (!content) {
    content = { buildings: buckets[index] };
    sectorContents.set(index, content);
  }
  return content;
}

