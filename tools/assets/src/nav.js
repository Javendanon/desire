/** Conservative walkability check over the scene ground; conservative means over-blocking. */

export const DEFAULT_CELL_M = 1;
export const ARRIVAL_RADIUS_M = 1.5;
const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const PER_MILLE = 1000;

const cellColumn = (x, cell) => Math.floor(x / cell);
const cellRow = (z, cell) => Math.floor(z / cell);
const cellCenterX = (column, cell) => (column + 0.5) * cell;
const cellCenterZ = (row, cell) => (row + 0.5) * cell;

function clamp(value, limit) {
  return Math.min(Math.max(value, 0), limit - 1);
}

function gridOf(ground, cell) {
  return {
    columns: Math.ceil(ground.width_m / cell),
    rows: Math.ceil(ground.height_m / cell),
  };
}

function markBlocker(spec) {
  const { blocked, grid, blocker, cell } = spec;
  const firstColumn = clamp(cellColumn(blocker.min_x, cell), grid.columns);
  const lastColumn = clamp(cellColumn(blocker.max_x, cell), grid.columns);
  const firstRow = clamp(cellRow(blocker.min_z, cell), grid.rows);
  const lastRow = clamp(cellRow(blocker.max_z, cell), grid.rows);
  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      blocked[row * grid.columns + column] = 1;
    }
  }
}

function markBlocked(blockers, grid, cell) {
  const blocked = new Uint8Array(grid.columns * grid.rows);
  for (const blocker of blockers) markBlocker({ blocked, grid, blocker, cell });
  return blocked;
}

function nextCell(spec) {
  const { blocked, grid, reached, from, step } = spec;
  const column = (from % grid.columns) + step[0];
  const row = Math.floor(from / grid.columns) + step[1];
  if (column < 0 || row < 0 || column >= grid.columns || row >= grid.rows) return null;
  const next = row * grid.columns + column;
  if (blocked[next] === 1 || reached[next] === 1) return null;
  return next;
}

function spread(spec) {
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

function flood({ blocked, grid, start }) {
  const reached = new Uint8Array(grid.columns * grid.rows);
  if (blocked[start] === 1) return reached;
  reached[start] = 1;
  return spread({ blocked, grid, queue: [start], reached });
}

function nearestReached(spec) {
  const { reached, point, grid, cell } = spec;
  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      if (reached[row * grid.columns + column] === 0) continue;
      const dx = cellCenterX(column, cell) - point.x_m;
      const dz = cellCenterZ(row, cell) - point.z_m;
      if (Math.hypot(dx, dz) <= ARRIVAL_RADIUS_M) return true;
    }
  }
  return false;
}

function waypointResults(spec) {
  return spec.waypoints.map((waypoint) => ({
    id: waypoint.id,
    reachable: nearestReached({
      reached: spec.reached,
      point: waypoint,
      grid: spec.grid,
      cell: spec.cell,
    }),
  }));
}

function spawnIndex(spawn, grid, cell) {
  const column = clamp(cellColumn(spawn.x_m, cell), grid.columns);
  const row = clamp(cellRow(spawn.z_m, cell), grid.rows);
  return row * grid.columns + column;
}

function summarize(spec) {
  const { grid, blocked, reached, start, spawn, cell, waypoints } = spec;
  const total = grid.columns * grid.rows;
  const blockedCount = blocked.reduce((sum, value) => sum + value, 0);
  const reachedCount = reached.reduce((sum, value) => sum + value, 0);
  const results = waypointResults({ reached, grid, cell, waypoints });
  return {
    cell_m: cell,
    columns: grid.columns,
    rows: grid.rows,
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
export function navigate(spec) {
  const { ground, blockers, spawn, waypoints, cell_m = DEFAULT_CELL_M } = spec;
  if (!(ground.width_m > 0 && ground.height_m > 0)) {
    throw new Error('ground must have a positive size');
  }
  const grid = gridOf(ground, cell_m);
  const blocked = markBlocked(blockers, grid, cell_m);
  const start = spawnIndex(spawn, grid, cell_m);
  const reached = flood({ blocked, grid, start });
  return summarize({ grid, blocked, reached, start, spawn, cell: cell_m, waypoints });
}
