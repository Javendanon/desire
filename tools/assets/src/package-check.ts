/** Acceptance checks over a map package read back from disk. Pure: takes the parsed files. */
import { footprintBounds, footprintCorners, overlapsCell } from './footprint.ts';
import { BLOCKED_CELL, FREE_CELL_COST } from './map-types.ts';
import type { MapPackage, PackageBuilding, SectorFile } from './map-types.ts';
import { cellIndex, MAX_NAV_CELLS, type NavDims } from './nav.ts';
import { sectorIndexAt } from './package.ts';
import type { Scene } from './scene.ts';
import type { Finding } from './types.ts';

export type WrittenPackage = {
  map: MapPackage;
  sectors: SectorFile[];
  costs: Uint32Array;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const finding = (id: string, pass: boolean, detail: string): Finding => ({ id, pass, detail });

const buildingsOf = (sectors: SectorFile[]) => sectors.flatMap((sector) => sector.buildings);

const SAME_NUMBERS: (keyof PackageBuilding)[] = ['x', 'z', 'width', 'depth', 'height', 'rotation'];

function matchesSolid(building: PackageBuilding, scene: Scene): boolean {
  const solid = scene.solids.find((entry) => entry.id === building.place_id);
  if (!solid) return false;
  const expected = { x: solid.center.x_m, z: solid.center.z_m, width: solid.width_m,
    depth: solid.depth_m, height: solid.height_m, rotation: solid.rotation_radians };
  return SAME_NUMBERS.every((key) => building[key] === expected[key as keyof typeof expected]);
}

/** Every solid is written once, in its own sector, with the scene's numbers. O(solids²), small. */
function buildingsFinding(written: WrittenPackage, scene: Scene): Finding {
  const { map, sectors } = written;
  const misplaced = sectors.flatMap((sector) => sector.buildings
    .filter((building) => sectorIndexAt(map.grid, building.x, building.z) !== sector.index
      || !matchesSolid(building, scene))
    .map((building) => building.place_id));
  const ids = buildingsOf(sectors).map((building) => building.place_id);
  const unique = new Set(ids);
  const missing = scene.solids.filter((solid) => !unique.has(solid.id)).map((solid) => solid.id);
  const problems = [...misplaced, ...missing];
  const pass = problems.length === 0 && unique.size === ids.length;
  return finding('package.buildings', pass,
    pass ? `${ids.length} buildings in ${sectors.length} sectors`
      : `misplaced, changed or missing: ${problems.join(', ') || 'duplicate place ids'}`);
}

function chunkProblems(written: WrittenPackage): string[] {
  const { map, sectors } = written;
  const { grid } = map;
  if (map.chunks.length !== sectors.length) return ['one chunk per written sector'];
  return map.chunks.flatMap((chunk, position) => {
    const index = sectors[position].index;
    const column = index % grid.columns;
    const row = Math.floor(index / grid.columns);
    const origin = chunk.origin;
    const aligned = origin.x_m === grid.originX + column * grid.sizeM
      && origin.z_m === grid.originZ + row * grid.sizeM && origin.y_m === 0;
    const ok = UUID.test(chunk.id) && chunk.map_version_id === map.map_version.id
      && chunk.size_m === grid.sizeM && aligned && chunk.asset_uri === `sectors/${index}.json`;
    return ok ? [] : [`chunk for sector ${index}`];
  });
}

function chunksFinding(written: WrittenPackage): Finding {
  const problems = chunkProblems(written);
  const unique = new Set(written.map.chunks.map((chunk) => chunk.id)).size;
  const pass = problems.length === 0 && unique === written.map.chunks.length;
  return finding('package.chunks', pass,
    pass ? `${unique} D04 chunks of map version ${written.map.map_version.id}`
      : problems.join(', ') || 'duplicate chunk ids');
}

function footprintOf(building: PackageBuilding) {
  return {
    center: { x_m: building.x, z_m: building.z },
    width_m: building.width,
    depth_m: building.depth,
    rotation_radians: building.rotation,
  };
}

function cellAt(dims: NavDims, column: number, row: number) {
  const min_x = dims.origin_x_m + column * dims.cell_m;
  const min_z = dims.origin_z_m + row * dims.cell_m;
  return { min_x, max_x: min_x + dims.cell_m, min_z, max_z: min_z + dims.cell_m };
}

/** True when every cell the footprint overlaps is blocked. O(cells in its bounding box). */
function footprintBlocked(costs: Uint32Array, dims: NavDims, building: PackageBuilding) {
  const corners = footprintCorners(footprintOf(building));
  const bounds = footprintBounds(corners);
  const first = cellIndex(dims, { x_m: bounds.min_x, z_m: bounds.min_z });
  const last = cellIndex(dims, { x_m: bounds.max_x, z_m: bounds.max_z });
  for (let row = Math.floor(first / dims.width); row <= Math.floor(last / dims.width); row++) {
    for (let column = first % dims.width; column <= last % dims.width; column++) {
      const free = costs[row * dims.width + column] !== BLOCKED_CELL;
      if (free && overlapsCell(corners, cellAt(dims, column, row))) return false;
    }
  }
  return true;
}

/** Recomputes coverage from the written buildings alone, not from the scene. */
function uncoveredBuildings(written: WrittenPackage, dims: NavDims): string[] {
  return buildingsOf(written.sectors)
    .filter((building) => !footprintBlocked(written.costs, dims, building))
    .map((building) => building.place_id);
}

function navFinding(written: WrittenPackage): Finding {
  const { nav } = written.map;
  const { costs } = written;
  const shaped = costs.length === nav.width * nav.height && costs.length <= MAX_NAV_CELLS
    && nav.blocked_cell === BLOCKED_CELL && nav.free_cost === FREE_CELL_COST;
  const encoded = costs.every((value) => value === BLOCKED_CELL || value === FREE_CELL_COST);
  const uncovered = shaped ? uncoveredBuildings(written, nav) : [];
  const pass = shaped && encoded && uncovered.length === 0;
  const detail = !shaped ? 'cost buffer does not match its D12 header'
    : uncovered.length ? `footprints not blocked: ${uncovered.join(', ')}`
      : `${nav.width}x${nav.height} u32 cells at ${nav.cell_m} m, every footprint blocked`;
  return finding('nav.costs', pass, detail);
}

function provenanceFinding(written: WrittenPackage, scene: Scene): Finding {
  const { map } = written;
  const expected = scene.unknown.map((place) => place.id);
  const listed = JSON.stringify(map.unknown_places) === JSON.stringify(expected);
  const source = map.map_version.calibration_provenance?.source;
  const pass = listed && Boolean(source) && map.network_allowed === false;
  return finding('package.provenance', pass,
    `calibration ${source ?? 'missing'}, unknown places ${map.unknown_places.join(', ') || 'none'}`);
}

export function packageFindings(written: WrittenPackage, scene: Scene): Finding[] {
  return [
    buildingsFinding(written, scene),
    chunksFinding(written),
    navFinding(written),
    provenanceFinding(written, scene),
  ];
}
