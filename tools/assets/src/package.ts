/** Scene to map package: D13 sector buildings, D04 chunks and the D12 cost grid. Pure. */
import { createHash } from 'node:crypto';

import { BLOCKED_CELL, FREE_CELL_COST, PACKAGE_SCHEMA, SECTOR_SCHEMA } from './map-types.ts';
import type {
  Chunk, MapPackage, PackageBuilding, PackagePlace, SectorFile, SectorGrid,
} from './map-types.ts';
import { buildCostGrid, DEFAULT_CELL_M } from './nav.ts';
import type { Scene } from './scene.ts';
import type { Ground, Manifest, Solid } from './types.ts';

export const NAV_ASSET = 'nav-costs.bin';
const UUID_VERSION_5 = 0x50;
const UUID_VARIANT = 0x80;
const UUID_BYTES = 16;

/** D13 `createGrid`: square sectors from the ground's north-west corner. */
export function createSectorGrid(ground: Ground, sizeM: number): SectorGrid {
  return {
    sizeM,
    originX: ground.origin_x_m,
    originZ: ground.origin_z_m,
    columns: Math.ceil(ground.width_m / sizeM),
    rows: Math.ceil(ground.height_m / sizeM),
  };
}

/** D13 `sectorIndexAt`, clamped so a centre on the far edge stays in the last sector. */
export function sectorIndexAt(grid: SectorGrid, x: number, z: number): number {
  const clamp = (value: number, limit: number) => Math.min(Math.max(value, 0), limit - 1);
  const column = clamp(Math.floor((x - grid.originX) / grid.sizeM), grid.columns);
  const row = clamp(Math.floor((z - grid.originZ) / grid.sizeM), grid.rows);
  return row * grid.columns + column;
}

/** Name-based UUID (v5) under the map version, so a rebuild keeps every chunk id. */
export function chunkId(mapVersionId: string, index: number): string {
  const namespace = Buffer.from(mapVersionId.replaceAll('-', ''), 'hex');
  const hash = createHash('sha1').update(namespace).update(`chunk:${index}`).digest();
  const bytes = hash.subarray(0, UUID_BYTES);
  bytes[6] = (bytes[6] & 0x0f) | UUID_VERSION_5;
  bytes[8] = (bytes[8] & 0x3f) | UUID_VARIANT;
  const hex = bytes.toString('hex');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)]
    .join('-');
}

function toBuilding(solid: Solid): PackageBuilding {
  return {
    x: solid.center.x_m,
    z: solid.center.z_m,
    width: solid.width_m,
    depth: solid.depth_m,
    height: solid.height_m,
    rotation: solid.rotation_radians,
    roof: solid.style.roof,
    tone: solid.style.tone,
    stone: solid.style.stone,
    place_id: solid.id,
    height_evidence: solid.height_evidence,
    provenance: solid.provenance,
  };
}

/** Non-empty sectors in index order. O(solids log sectors). */
function sectorFiles(grid: SectorGrid, solids: Solid[]): SectorFile[] {
  const bySector = Map.groupBy(solids, (solid) =>
    sectorIndexAt(grid, solid.center.x_m, solid.center.z_m));
  return [...bySector.keys()].sort((first, second) => first - second).map((index) => ({
    schema: SECTOR_SCHEMA,
    index,
    buildings: (bySector.get(index) ?? []).map(toBuilding),
  }));
}

function chunkOf(grid: SectorGrid, mapVersionId: string, index: number): Chunk {
  const column = index % grid.columns;
  const row = Math.floor(index / grid.columns);
  return {
    id: chunkId(mapVersionId, index),
    map_version_id: mapVersionId,
    origin: {
      x_m: grid.originX + column * grid.sizeM,
      y_m: 0,
      z_m: grid.originZ + row * grid.sizeM,
    },
    size_m: grid.sizeM,
    asset_uri: `sectors/${index}.json`,
  };
}

function packagePlaces(scene: Scene): PackagePlace[] {
  const solids = scene.solids.map((solid) => ({ ...solid, known: true }));
  const unknown = scene.unknown.map((place) => ({ ...place, known: false }));
  return [...solids, ...unknown].map((place) => ({
    id: place.id,
    name: place.name,
    at: place.center,
    height_known: place.known,
    provenance: place.provenance,
  }));
}

/** Builds every file of the package in memory. Writing and reading back is the pipeline's job. */
export function buildPackage(scene: Scene, manifest: Manifest) {
  const grid = createSectorGrid(scene.ground, manifest.sector_size_m);
  const sectors = sectorFiles(grid, scene.solids);
  const cell = manifest.nav_cell_m ?? DEFAULT_CELL_M;
  const { ground, solids } = scene;
  const { dims, costs } = buildCostGrid({ ground, solids, cell_m: cell });
  const versionId = manifest.map_version.id;
  const map: MapPackage = {
    schema: PACKAGE_SCHEMA,
    id: scene.id,
    label: scene.label,
    map_version: { ...manifest.map_version,
      calibration_provenance: manifest.calibration.provenance },
    grid,
    chunks: sectors.map((sector) => chunkOf(grid, versionId, sector.index)),
    places: packagePlaces(scene),
    unknown_places: scene.unknown.map((place) => place.id),
    nav: { asset_uri: NAV_ASSET, ...dims, blocked_cell: BLOCKED_CELL, free_cost: FREE_CELL_COST },
    network_allowed: false,
  };
  return { map, sectors, costs };
}
