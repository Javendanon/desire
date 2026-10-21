/**
 * The map package written for the engine (D13) and the router (D12). Data only, no geometry.
 *
 * `MapBuilding` and `SectorGrid` mirror `src/lib/engine/plan/map-definition.ts` and
 * `plan/sectors.ts` from D13 field for field. They are copied, not imported, until D13 is on
 * main; `tests/package.test.ts` pins the exact keys so drift fails the suite.
 */
import type { Evidence, MapVersionRef, Plan, Provenance } from './types.ts';

export const PACKAGE_SCHEMA = 'desire.map-package/1';
export const SECTOR_SCHEMA = 'desire.map-sector/1';
/** D12 `BLOCKED_CELL`: an obstacle in the routing cost buffer. */
export const BLOCKED_CELL = 0xffff_ffff;
/** Cost of one free cell. Uniform until a manifest declares terrain costs. */
export const FREE_CELL_COST = 1;

/** D13 `MapBuilding`: one building lot in plan metres. */
export type MapBuilding = {
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  rotation: number;
  roof: number;
  tone: number;
  stone: boolean;
};

/** A building plus the evidence that says what is measured and what is interpreted. */
export type PackageBuilding = MapBuilding & {
  place_id: string;
  height_evidence: Evidence;
  provenance: string[];
};

/** D13 `SectorGrid`: square sectors from the ground's north-west corner, row-major. */
export type SectorGrid = {
  sizeM: number;
  originX: number;
  originZ: number;
  columns: number;
  rows: number;
};

/** D04 `Chunk`: one sector file of one map version. */
export type Chunk = {
  id: string;
  map_version_id: string;
  origin: { x_m: number; y_m: number; z_m: number };
  size_m: number;
  asset_uri: string;
};

export type SectorFile = {
  schema: typeof SECTOR_SCHEMA;
  index: number;
  buildings: PackageBuilding[];
};

/** Row-major `u32` little-endian costs over the ground, ready for a D12 `RoutingGrid`. */
export type NavGrid = {
  asset_uri: string;
  cell_m: number;
  origin_x_m: number;
  origin_z_m: number;
  width: number;
  height: number;
  blocked_cell: number;
  free_cost: number;
};

export type PackagePlace = {
  id: string;
  name: string;
  at: Plan;
  height_known: boolean;
  provenance: string[];
};

export type MapPackage = {
  schema: typeof PACKAGE_SCHEMA;
  id: string;
  label: string;
  map_version: MapVersionRef & { calibration_provenance: Provenance };
  grid: SectorGrid;
  chunks: Chunk[];
  places: PackagePlace[];
  unknown_places: string[];
  nav: NavGrid;
  network_allowed: false;
};
