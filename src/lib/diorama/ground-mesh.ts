// A ground tile's mesh and water, from its i16 height tile (`desire.ground-tiles/1`). Pure, so
// the loader Worker builds it and the frame loop only uploads. Vertices sit at the centres of
// the tile's cells plus the neighbour's first row and column, so tiles meet without a gap.
// Normals are one-sided at a tile's edge, so neighbours may shade the shared vertex a hair apart.

import type { WaterField } from './ambience-plan.ts';

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

const CENTIMETRES = 100;
const FLOATS_PER_VERTEX = 3;
const UV_FLOATS = 2;
/** Two triangles per grid square. */
const INDICES_PER_SQUARE = 6;

type Grid = GridSize & {
  positions: Float32Array;
};

/** Component `axis` of position `to` minus position `from`. */
const delta = (grid: Grid, from: number, to: number, axis: number) =>
  grid.positions[to * FLOATS_PER_VERTEX + axis] - grid.positions[from * FLOATS_PER_VERTEX + axis];

/** Neighbours of a vertex along both axes, one-sided at the grid's edges. */
function neighbours(grid: Grid, vertex: number): [number, number, number, number] {
  const { across, down } = grid;
  const [i, j] = [vertex % across, Math.floor(vertex / across)];
  const row = j * across;
  return [row + Math.max(i - 1, 0), row + Math.min(i + 1, across - 1),
    Math.max(j - 1, 0) * across + i, Math.min(j + 1, down - 1) * across + i];
}

/** Writes the unit normal south × east (up for rows along +z) of one vertex. */
function writeNormal(normals: Float32Array, grid: Grid, vertex: number) {
  const [west, east, north, south] = neighbours(grid, vertex);
  const ex = delta(grid, west, east, 0);
  const ey = delta(grid, west, east, 1);
  const ez = delta(grid, west, east, 2);
  const sx = delta(grid, north, south, 0);
  const sy = delta(grid, north, south, 1);
  const sz = delta(grid, north, south, 2);
  const nx = sy * ez - sz * ey;
  const ny = sz * ex - sx * ez;
  const nz = sx * ey - sy * ex;
  const length = Math.hypot(nx, ny, nz);
  const at = vertex * FLOATS_PER_VERTEX;
  normals[at] = nx / length;
  normals[at + 1] = ny / length;
  normals[at + 2] = nz / length;
}

/**
 * Per-vertex normals of a height grid, row-major positions. Smooth across cells and cheaper than
 * averaging face normals over an index list. O(vertices).
 */
export function gridNormals(positions: Float32Array, size: GridSize): Float32Array {
  const grid = { ...size, positions };
  const normals = new Float32Array(positions.length);
  const vertices = positions.length / FLOATS_PER_VERTEX;
  for (let vertex = 0; vertex < vertices; vertex += 1) writeNormal(normals, grid, vertex);
  return normals;
}

/** Two triangles per grid square, wound so their faces point up for rows along +z. */
export function gridIndices(across: number, down: number): Uint32Array {
  const indices = new Uint32Array((across - 1) * (down - 1) * INDICES_PER_SQUARE);
  let at = 0;
  for (let row = 0; row + 1 < down; row += 1) {
    for (let column = 0; column + 1 < across; column += 1) {
      const a = row * across + column;
      indices.set([a, a + across, a + 1, a + 1, a + across, a + across + 1], at);
      at += INDICES_PER_SQUARE;
    }
  }
  return indices;
}

/** A tile's north-west corner in map metres. */
export function tileOrigin(ground: GroundGrid, index: number) {
  const metres = ground.tile_px * ground.metres_per_pixel;
  const [column, row] = [index % ground.columns, Math.floor(index / ground.columns)];
  return { x_m: column * metres, z_m: row * metres };
}

/**
 * The tile's own cells as fog placement reads them (water below zero), at its corner: the shared
 * row and column belong to the neighbour, which counts them. A vertex's height stands for its
 * cell, so placing spots inside the cell needs no half-cell offset.
 */
export function tileWater(tile: GroundTile, ground: GroundGrid, heights: Int16Array): WaterField {
  const across = tile.cells_x + 1;
  const own = new Int16Array(tile.cells_x * tile.cells_y);
  for (let row = 0; row < tile.cells_y; row += 1) {
    own.set(heights.subarray(row * across, row * across + tile.cells_x), row * tile.cells_x);
  }
  return {
    heights: own,
    meta: { columns: tile.cells_x, cell_m: ground.cell_px * ground.metres_per_pixel },
    origin: tileOrigin(ground, tile.index),
  };
}

type Placement = {
  tile: GroundTile;
  ground: GroundGrid;
  heights: Int16Array;
  /** The tile's north-west corner in source pixels. */
  originX: number;
  originY: number;
};

/** Writes one vertex's position (map metres, height from centimetres) and its UV. */
function writeVertex(geometry: GroundGeometry, placement: Placement, vertex: number) {
  const { tile, ground } = placement;
  const across = tile.cells_x + 1;
  const dx = ((vertex % across) + 0.5) * ground.cell_px;
  const dy = (Math.floor(vertex / across) + 0.5) * ground.cell_px;
  const at = vertex * FLOATS_PER_VERTEX;
  geometry.positions[at] = (placement.originX + dx) * ground.metres_per_pixel;
  geometry.positions[at + 1] = placement.heights[vertex] / CENTIMETRES;
  geometry.positions[at + 2] = (placement.originY + dy) * ground.metres_per_pixel;
  geometry.uvs[vertex * UV_FLOATS] = dx / tile.width_px;
  geometry.uvs[vertex * UV_FLOATS + 1] = dy / tile.height_px;
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
  const vertices = across * down;
  const placement = { tile, ground, heights,
    originX: (tile.index % ground.columns) * ground.tile_px,
    originY: Math.floor(tile.index / ground.columns) * ground.tile_px };
  const positions = new Float32Array(vertices * FLOATS_PER_VERTEX);
  const uvs = new Float32Array(vertices * UV_FLOATS);
  const geometry = { positions, normals: positions, uvs, indices: gridIndices(across, down) };
  for (let vertex = 0; vertex < vertices; vertex += 1) writeVertex(geometry, placement, vertex);
  return { ...geometry, normals: gridNormals(positions, { across, down }) };
}
