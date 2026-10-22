// What the city viewer keeps loaded, and the geometry of a ground tile. Pure: the streamer and
// the tile builder only turn these plans into GPU objects.
//
// Sectors within reach of the camera target load nearest first. Loaded ones stay until they fall
// past reach plus a margin (hysteresis), so a camera resting near a boundary does not load and
// drop the same sector over and over.

export interface GridShape {
  columns: number;
  rows: number;
  size_m: number;
}

export interface PlanSpec {
  grid: GridShape;
  loaded: number[];
  target: {
    x: number;
    z: number;
  };
  reach_m: number;
}

export interface SectorPlan {
  load: number[];
  unload: number[];
}

/** Loaded sectors are dropped only past this share of reach beyond it. */
const KEEP_MARGIN = 0.5;

/** Distance from the target to the nearest point of a sector's square. */
function distanceTo(spec: PlanSpec, index: number): number {
  const { grid, target } = spec;
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
    distance: distanceTo(spec, index),
  }));
  const load = all
    .filter(({ index, distance }) => distance <= spec.reach_m && !loaded.has(index))
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .map(({ index }) => index);
  const keep = spec.reach_m * (1 + KEEP_MARGIN);
  const unload = spec.loaded.filter((index) => distanceTo(spec, index) > keep);
  return { load, unload };
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
  uvs: Float32Array;
  indices: Uint32Array;
}

const CENTIMETRES = 100;

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
  return { positions, uvs, indices: gridIndices(across, down) };
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
