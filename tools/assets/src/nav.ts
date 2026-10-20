/** Conservative walkability check over the scene ground; conservative means over-blocking. */

import type { Anchor, Blocker, Ground, Plan } from './types.ts';

type Grid = ReturnType<typeof gridOf>;
type Walk = { blocked: Uint8Array; grid: Grid; reached: Uint8Array };
type Navigation = { ground: Ground; blockers: Blocker[]; spawn: Plan;
  waypoints: Anchor[]; cell_m?: number };

export const DEFAULT_CELL_M = 1;
export const MAX_NAV_CELLS = 1_000_000;

/** Finite allocation budget, shared by manifest preflight and direct callers. */
export function gridFitsBudget(ground: Ground, cell = DEFAULT_CELL_M): boolean {
  const count = Math.ceil(ground.width_m / cell) * Math.ceil(ground.height_m / cell);
  return Number.isFinite(count) && count > 0 && count <= MAX_NAV_CELLS;
}
const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const PER_MILLE = 1000;

const cellColumn = (x: number, cell: number, origin: number) => Math.floor((x - origin) / cell);
const cellRow = (z: number, cell: number, origin: number) => Math.floor((z - origin) / cell);

function clamp(value: number, limit: number) {
  return Math.min(Math.max(value, 0), limit - 1);
}

function gridOf(ground: Ground, cell: number) {
  return {
    columns: Math.ceil(ground.width_m / cell),
    rows: Math.ceil(ground.height_m / cell),
    origin_x_m: ground.origin_x_m,
    origin_z_m: ground.origin_z_m,
    max_x_m: ground.origin_x_m + ground.width_m,
    max_z_m: ground.origin_z_m + ground.height_m,
  };
}

function markBlocker(spec: {
  blocked: Uint8Array; grid: Grid; blocker: Blocker; cell: number;
}) {
  const { blocked, grid, blocker, cell } = spec;
  const originX = grid.origin_x_m;
  const originZ = grid.origin_z_m;
  const firstColumn = clamp(cellColumn(blocker.min_x, cell, originX), grid.columns);
  const lastColumn = clamp(cellColumn(blocker.max_x, cell, originX), grid.columns);
  const firstRow = clamp(cellRow(blocker.min_z, cell, originZ), grid.rows);
  const lastRow = clamp(cellRow(blocker.max_z, cell, originZ), grid.rows);
  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      blocked[row * grid.columns + column] = 1;
    }
  }
}

function markBlocked(blockers: Blocker[], grid: Grid, cell: number) {
  const blocked = new Uint8Array(grid.columns * grid.rows);
  for (const blocker of blockers) markBlocker({ blocked, grid, blocker, cell });
  return blocked;
}

function nextCell(spec: Walk & { from: number; step: number[] }) {
  const { blocked, grid, reached, from, step } = spec;
  const column = (from % grid.columns) + step[0];
  const row = Math.floor(from / grid.columns) + step[1];
  if (column < 0 || row < 0 || column >= grid.columns || row >= grid.rows) return null;
  const next = row * grid.columns + column;
  if (blocked[next] === 1 || reached[next] === 1) return null;
  return next;
}

function spread(spec: Walk & { queue: number[] }) {
  const { blocked, grid, queue, reached } = spec;
  for (let head = 0; head < queue.length; head += 1) {
    for (const step of NEIGHBOURS) {
      const next = nextCell({ blocked, grid, reached, from: queue[head], step });
      if (next === null) continue;
      reached[next] = 1;
      queue.push(next);
    }
  }
  return reached;
}

type FloodSpec = Omit<Walk, 'reached'> & { start: number };

function flood({ blocked, grid, start }: FloodSpec) {
  const reached = new Uint8Array(grid.columns * grid.rows);
  if (blocked[start] === 1) return reached;
  reached[start] = 1;
  return spread({ blocked, grid, queue: [start], reached });
}

function pointInGrid(point: Plan, grid: Grid) {
  return point.x_m >= grid.origin_x_m && point.x_m <= grid.max_x_m
    && point.z_m >= grid.origin_z_m && point.z_m <= grid.max_z_m;
}

function waypointReached(spec: Pick<Walk, 'reached' | 'grid'> & { point: Plan; cell: number }) {
  const { reached, point, grid, cell } = spec;
  return pointInGrid(point, grid) && reached[spawnIndex(point, grid, cell)] === 1;
}

type WaypointSpec = Pick<Walk, 'reached' | 'grid'> & { waypoints: Anchor[]; cell: number };

function waypointResults(spec: WaypointSpec) {
  return spec.waypoints.map((waypoint) => ({
    id: waypoint.id,
    reachable: waypointReached({
      reached: spec.reached,
      point: waypoint,
      grid: spec.grid,
      cell: spec.cell,
    }),
  }));
}

function spawnIndex(spawn: Plan, grid: Grid, cell: number) {
  const column = clamp(cellColumn(spawn.x_m, cell, grid.origin_x_m), grid.columns);
  const row = clamp(cellRow(spawn.z_m, cell, grid.origin_z_m), grid.rows);
  return row * grid.columns + column;
}

function summarize(spec: Walk & { start: number; spawn: Plan; cell: number; waypoints: Anchor[] }) {
  const { grid, blocked, reached, start, spawn, cell, waypoints } = spec;
  const total = grid.columns * grid.rows;
  const blockedCount = blocked.reduce((sum, value) => sum + value, 0);
  const reachedCount = reached.reduce((sum, value) => sum + value, 0);
  const results = waypointResults({ reached, grid, cell, waypoints });
  return {
    cell_m: cell,
    columns: grid.columns,
    rows: grid.rows,
    origin_x_m: grid.origin_x_m,
    origin_z_m: grid.origin_z_m,
    total_cells: total,
    free_cells: total - blockedCount,
    blocked_cells: blockedCount,
    reachable_cells: reachedCount,
    reachable_ratio: total === 0 ? 0 : Math.round((reachedCount / total) * PER_MILLE) / PER_MILLE,
    spawn: { x_m: spawn.x_m, z_m: spawn.z_m, spawn_free: blocked[start] === 0 },
    waypoints: results,
    pass: blocked[start] === 0 && results.every((entry) => entry.reachable),
  };
}

/** Walks the free cells from the spawn and reports whether each waypoint is reachable. */
export function navigate(spec: Navigation) {
  const { ground, blockers, spawn, waypoints, cell_m = DEFAULT_CELL_M } = spec;
  if (!(ground.width_m > 0 && ground.height_m > 0)) {
    throw new Error('ground must have a positive size');
  }
  if (!Number.isFinite(cell_m) || cell_m <= 0 || !gridFitsBudget(ground, cell_m)) {
    throw new Error('navigation grid exceeds its cell budget or has invalid cell size');
  }
  const grid = gridOf(ground, cell_m);
  if (!pointInGrid(spawn, grid)) throw new Error('spawn is outside the navigation ground');
  const blocked = markBlocked(blockers, grid, cell_m);
  const start = spawnIndex(spawn, grid, cell_m);
  const reached = flood({ blocked, grid, start });
  return summarize({ grid, blocked, reached, start, spawn, cell: cell_m, waypoints });
}
