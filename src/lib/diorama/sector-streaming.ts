// What the city viewer keeps loaded, and the geometry of a ground tile. Pure: the streamer and
// the tile builder only turn these plans into GPU objects.
//
// Sectors within reach of the camera target load nearest first. Loaded ones stay until they fall
// past reach plus a margin (hysteresis), so a camera resting near a boundary does not load and
// drop the same sector over and over.

import type { WaterField } from './ambience-plan.ts';

export interface GridShape {
  columns: number;
  rows: number;
  size_m: number;
}

/** The camera target on the ground plane. */
export interface Target {
  x: number;
  z: number;
}

export interface PlanSpec {
  grid: GridShape;
  loaded: number[];
  target: Target;
  reach_m: number;
}

export interface SectorPlan {
  load: number[];
  unload: number[];
}

/** Loaded sectors are dropped only past this share of reach beyond it. */
const KEEP_MARGIN = 0.5;

/** Distance from the target to the nearest point of a sector's square. */
export function sectorDistance(grid: GridShape, index: number, target: Target): number {
  const x0 = (index % grid.columns) * grid.size_m;
  const z0 = Math.floor(index / grid.columns) * grid.size_m;
  const dx = Math.max(x0 - target.x, 0, target.x - (x0 + grid.size_m));
  const dz = Math.max(z0 - target.z, 0, target.z - (z0 + grid.size_m));
  return Math.hypot(dx, dz);
}

/** Sectors to load (nearest first) and to drop. O(sectors · log sectors). */
export function planSectors(spec: PlanSpec): SectorPlan {
  const loaded = new Set(spec.loaded);
  const all = Array.from({ length: spec.grid.columns * spec.grid.rows }, (_, index) => ({
    index,
    distance: sectorDistance(spec.grid, index, spec.target),
  }));
  const load = all
    .filter(({ index, distance }) => distance <= spec.reach_m && !loaded.has(index))
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .map(({ index }) => index);
  const keep = spec.reach_m * (1 + KEEP_MARGIN);
  const far = (index: number) => sectorDistance(spec.grid, index, spec.target) > keep;
  const unload = spec.loaded.filter(far);
  return { load, unload };
}

/** Shadows reach this far from the target, plus a share of the camera distance. */
const SHADOW_REACH_M = 250;
const SHADOW_PER_RADIUS = 0.5;

export interface ShadowSpec {
  /** From the camera target to the sector. */
  distance_m: number;
  /** Camera distance from its target. */
  radius_m: number;
}

/**
 * Whether a sector's houses and ships cast shadows. Far ones would only blur into the shadow
 * map's low texel density at that zoom, yet cost a second draw of every house.
 */
export function castsShadows(spec: ShadowSpec): boolean {
  return spec.distance_m <= SHADOW_REACH_M + spec.radius_m * SHADOW_PER_RADIUS;
}

/** A near sector stays near until it falls past this share of the reach beyond it. */
const DETAIL_KEEP_MARGIN = 0.25;

export type SectorDetail = 'near' | 'far';

export interface DetailSpec extends ShadowSpec {
  current: SectorDetail;
}

/**
 * Full detail within the shadow reach, the far level past it. Near sectors keep their detail a
 * little further, so a camera resting at the boundary does not rebuild them every plan.
 */
export function sectorDetail(spec: DetailSpec): SectorDetail {
  const keep = spec.current === 'near' ? 1 + DETAIL_KEEP_MARGIN : 1;
  const reach = { ...spec, distance_m: spec.distance_m / keep };
  return castsShadows(reach) ? 'near' : 'far';
}

/** One tile of `ground.json`. */
export interface GroundTile {
  index: number;
  width_px: number;
  height_px: number;
  cells_x: number;
  cells_y: number;
}

/** The grid-wide part of `ground.json` a tile's geometry needs. */
export interface GroundGrid {
  tile_px: number;
  cell_px: number;
  metres_per_pixel: number;
  columns: number;
}

export interface GroundGeometry {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

/** Vertices of a grid along x (across) and z (down). */
export interface GridSize {
  across: number;
  down: number;
}

type Vector = [number, number, number];
type Grid = GridSize & {
  positions: Float32Array;
};

function difference(grid: Grid, from: number, to: number): Vector {
  const p = grid.positions;
  const [a, b] = [from * 3, to * 3];
  return [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
}

/** Unit normal from the tangents to the vertex's neighbours, one-sided at the grid's edges. */
function normalAt(grid: Grid, vertex: number): Vector {
  const { across, down } = grid;
  const [i, j] = [vertex % across, Math.floor(vertex / across)];
  const row = j * across;
  const east = difference(grid, row + Math.max(i - 1, 0), row + Math.min(i + 1, across - 1));
  const south = difference(grid, Math.max(j - 1, 0) * across + i,
    Math.min(j + 1, down - 1) * across + i);
  // south × east: up for a grid whose rows run along +z.
  const normal: Vector = [south[1] * east[2] - south[2] * east[1],
    south[2] * east[0] - south[0] * east[2], south[0] * east[1] - south[1] * east[0]];
  const length = Math.hypot(...normal);
  return [normal[0] / length, normal[1] / length, normal[2] / length];
}

/**
 * Per-vertex normals of a height grid, row-major positions. Smooth across cells and cheaper than
 * averaging face normals over an index list. O(vertices).
 */
export function gridNormals(positions: Float32Array, size: GridSize): Float32Array {
  const grid = { ...size, positions };
  const normals = new Float32Array(positions.length);
  for (let vertex = 0; vertex * 3 < positions.length; vertex += 1) {
    normals.set(normalAt(grid, vertex), vertex * 3);
  }
  return normals;
}

const CENTIMETRES = 100;

/** A tile's north-west corner in map metres. */
export function tileOrigin(ground: GroundGrid, index: number) {
  const metres = ground.tile_px * ground.metres_per_pixel;
  const [column, row] = [index % ground.columns, Math.floor(index / ground.columns)];
  return { x_m: column * metres, z_m: row * metres };
}

/** A tile's vertex heights as fog placement reads them (water below zero), at its corner. */
export function tileWater(tile: GroundTile, ground: GroundGrid, heights: Int16Array): WaterField {
  return {
    heights,
    meta: { columns: tile.cells_x + 1, cell_m: ground.cell_px * ground.metres_per_pixel },
    origin: tileOrigin(ground, tile.index),
  };
}

/**
 * Vertices at the centres of the tile's cells plus its shared row and column, in map metres,
 * heights from centimetres. UVs span the tile's own texture. O(cells).
 */
export function groundGeometry(
  tile: GroundTile,
  ground: GroundGrid,
  heights: Int16Array,
): GroundGeometry {
  const [across, down] = [tile.cells_x + 1, tile.cells_y + 1];
  const origin = [(tile.index % ground.columns) * ground.tile_px,
    Math.floor(tile.index / ground.columns) * ground.tile_px];
  const positions = new Float32Array(across * down * 3);
  const uvs = new Float32Array(across * down * 2);
  for (let j = 0; j < down; j += 1) {
    for (let i = 0; i < across; i += 1) {
      const vertex = j * across + i;
      const px = origin[0] + (i + 0.5) * ground.cell_px;
      const py = origin[1] + (j + 0.5) * ground.cell_px;
      positions.set([px * ground.metres_per_pixel, heights[vertex] / CENTIMETRES,
        py * ground.metres_per_pixel], vertex * 3);
      uvs.set([(px - origin[0]) / tile.width_px, (py - origin[1]) / tile.height_px], vertex * 2);
    }
  }
  const normals = gridNormals(positions, { across, down });
  return { positions, normals, uvs, indices: gridIndices(across, down) };
}

/** Two triangles per grid square, wound like the slice terrain. */
function gridIndices(across: number, down: number): Uint32Array {
  const indices = new Uint32Array((across - 1) * (down - 1) * 6);
  let at = 0;
  for (let row = 0; row + 1 < down; row += 1) {
    for (let column = 0; column + 1 < across; column += 1) {
      const a = row * across + column;
      indices.set([a, a + across, a + 1, a + 1, a + across, a + across + 1], at);
      at += 6;
    }
  }
  return indices;
}
