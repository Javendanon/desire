/**
 * Walkability as a D12 routing cost buffer over the scene ground, and the acceptance walk on it.
 *
 * A cell is blocked when any building footprint overlaps it (separating-axis test), so blocking
 * follows the real rotated footprint and never leaks through a thin wall.
 */
import { footprintBounds, footprintCorners, overlapsCell, type Footprint } from './footprint.ts';
import { BLOCKED_CELL, FREE_CELL_COST } from './map-types.ts';
import type { Anchor, Ground, Plan, Solid } from './types.ts';

export const DEFAULT_CELL_M = 1;
/** D12 `MAX_GRID_CELLS`: the largest grid the router accepts. Pinned by a parity test. */
export const MAX_NAV_CELLS = 1_048_576;

export type NavDims = {
  cell_m: number;
  origin_x_m: number;
  origin_z_m: number;
  width: number;
  height: number;
};
export type CostGrid = {
  dims: NavDims;
  costs: Uint32Array;
};
type CostSpec = {
  ground: Ground;
  solids: Solid[];
  cell_m?: number;
};
type WalkSpec = CostGrid & {
  spawn: Plan;
  waypoints: Anchor[];
};

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const PER_MILLE = 1000;

/** Finite allocation budget, shared by manifest preflight and direct callers. */
export function gridFitsBudget(ground: Ground, cell = DEFAULT_CELL_M): boolean {
  const count = Math.ceil(ground.width_m / cell) * Math.ceil(ground.height_m / cell);
  return Number.isFinite(count) && count > 0 && count <= MAX_NAV_CELLS;
}

function dimsOf(ground: Ground, cell: number): NavDims {
  return {
    cell_m: cell,
    origin_x_m: ground.origin_x_m,
    origin_z_m: ground.origin_z_m,
    width: Math.ceil(ground.width_m / cell),
    height: Math.ceil(ground.height_m / cell),
  };
}

const clamp = (value: number, limit: number) => Math.min(Math.max(value, 0), limit - 1);

/** Cell index holding a plan point. Boundary points select the last interior cell. */
export function cellIndex(dims: NavDims, point: Plan): number {
  const column = clamp(Math.floor((point.x_m - dims.origin_x_m) / dims.cell_m), dims.width);
  const row = clamp(Math.floor((point.z_m - dims.origin_z_m) / dims.cell_m), dims.height);
  return row * dims.width + column;
}

function cellBounds(dims: NavDims, column: number, row: number) {
  const min_x = dims.origin_x_m + column * dims.cell_m;
  const min_z = dims.origin_z_m + row * dims.cell_m;
  return { min_x, max_x: min_x + dims.cell_m, min_z, max_z: min_z + dims.cell_m };
}

/** Indices of the cells a footprint overlaps. O(cells in its bounding box). */
export function footprintCells(dims: NavDims, footprint: Footprint): number[] {
  const corners = footprintCorners(footprint);
  const bounds = footprintBounds(corners);
  const first = cellIndex(dims, { x_m: bounds.min_x, z_m: bounds.min_z });
  const last = cellIndex(dims, { x_m: bounds.max_x, z_m: bounds.max_z });
  const cells: number[] = [];
  for (let row = Math.floor(first / dims.width); row <= Math.floor(last / dims.width); row += 1) {
    for (let column = first % dims.width; column <= last % dims.width; column += 1) {
      const cell = row * dims.width + column;
      if (overlapsCell(corners, cellBounds(dims, column, row))) cells.push(cell);
    }
  }
  return cells;
}

/** Builds the D12 cost buffer: row-major, `FREE_CELL_COST` or `BLOCKED_CELL` per cell. */
export function buildCostGrid({ ground, solids, cell_m = DEFAULT_CELL_M }: CostSpec): CostGrid {
  if (!(ground.width_m > 0 && ground.height_m > 0)) {
    throw new Error('ground must have a positive size');
  }
  if (!Number.isFinite(cell_m) || cell_m <= 0 || !gridFitsBudget(ground, cell_m)) {
    throw new Error(`navigation grid exceeds its cell budget of ${MAX_NAV_CELLS} or has `
      + 'an invalid cell size');
  }
  const dims = dimsOf(ground, cell_m);
  const costs = new Uint32Array(dims.width * dims.height).fill(FREE_CELL_COST);
  for (const solid of solids) {
    for (const cell of footprintCells(dims, solid)) costs[cell] = BLOCKED_CELL;
  }
  return { dims, costs };
}

function neighbourCells(dims: NavDims, index: number): number[] {
  const column = index % dims.width;
  const row = Math.floor(index / dims.width);
  return NEIGHBOURS
    .map(([dx, dz]) => [column + dx, row + dz])
    .filter(([x, z]) => x >= 0 && z >= 0 && x < dims.width && z < dims.height)
    .map(([x, z]) => z * dims.width + x);
}

/** Breadth-first reach over free cells. O(cells). */
function flood(costs: Uint32Array, dims: NavDims, start: number) {
  const reached = new Uint8Array(costs.length);
  if (costs[start] === BLOCKED_CELL) return reached;
  reached[start] = 1;
  const queue = [start];
  for (let head = 0; head < queue.length; head += 1) {
    for (const next of neighbourCells(dims, queue[head])) {
      if (reached[next] === 1 || costs[next] === BLOCKED_CELL) continue;
      reached[next] = 1;
      queue.push(next);
    }
  }
  return reached;
}

function inside(dims: NavDims, point: Plan) {
  return point.x_m >= dims.origin_x_m && point.z_m >= dims.origin_z_m
    && point.x_m <= dims.origin_x_m + dims.width * dims.cell_m
    && point.z_m <= dims.origin_z_m + dims.height * dims.cell_m;
}

function countWhere(values: ArrayLike<number>, wanted: number): number {
  let total = 0;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === wanted) total += 1;
  }
  return total;
}

/** Four-neighbour walk from the spawn over the cost buffer. O(cells). */
export function walkCostGrid({ dims, costs, spawn, waypoints }: WalkSpec) {
  if (!inside(dims, spawn)) throw new Error('spawn is outside the navigation ground');
  const start = cellIndex(dims, spawn);
  const reached = flood(costs, dims, start);
  const results = waypoints.map((waypoint) => ({
    id: waypoint.id,
    reachable: inside(dims, waypoint) && reached[cellIndex(dims, waypoint)] === 1,
  }));
  const blocked = countWhere(costs, BLOCKED_CELL);
  const reachable = countWhere(reached, 1);
  const spawnFree = costs[start] !== BLOCKED_CELL;
  return {
    ...dims,
    total_cells: costs.length,
    free_cells: costs.length - blocked,
    blocked_cells: blocked,
    reachable_cells: reachable,
    reachable_ratio: Math.round((reachable / costs.length) * PER_MILLE) / PER_MILLE,
    spawn: { x_m: spawn.x_m, z_m: spawn.z_m, spawn_free: spawnFree },
    waypoints: results,
    pass: spawnFree && results.every((entry) => entry.reachable),
  };
}
