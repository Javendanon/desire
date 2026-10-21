// TypeScript reference for the routing core. It is deliberately simple and
// independent from the Rust implementation so route costs can be compared.

export interface ReferenceGrid {
  width: number;
  height: number;
  costs: Uint32Array;
}

export const BLOCKED_CELL = 0xffff_ffff;
export const REFERENCE_START = { x: 0, y: 0 };
export const REFERENCE_GOAL = { x: 5, y: 3 };

export const REFERENCE_GRID: ReferenceGrid = {
  width: 6,
  height: 4,
  costs: Uint32Array.from([
    1, 1, 1, BLOCKED_CELL, 1, 1,
    1, 9, 1, 9, 9, 1,
    1, 1, 0, 1, 1, 1,
    1, 9, 9, 9, 9, 1,
  ]),
};

function neighbors(index: number, grid: ReferenceGrid): number[] {
  const x = index % grid.width;
  const y = Math.floor(index / grid.width);
  const result: number[] = [];
  if (x > 0) result.push(index - 1);
  if (x + 1 < grid.width) result.push(index + 1);
  if (y > 0) result.push(index - grid.width);
  if (y + 1 < grid.height) result.push(index + grid.width);
  return result;
}

function takeCheapest(distance: number[], visited: boolean[]): number {
  let best = -1;
  for (let index = 0; index < distance.length; index += 1) {
    if (visited[index] || distance[index] === Number.POSITIVE_INFINITY) continue;
    if (best === -1 || distance[index] < distance[best]) best = index;
  }
  return best;
}

/** Dijkstra over four-neighbour cells. O(cells^2) is acceptable for a fixture. */
export function referenceRouteCost(grid: ReferenceGrid, startIndex = 0, goalIndex = -1): number {
  const cells = grid.width * grid.height;
  const target = goalIndex < 0 ? cells - 1 : goalIndex;
  const distance = new Array<number>(cells).fill(Number.POSITIVE_INFINITY);
  const visited = new Array<boolean>(cells).fill(false);
  distance[startIndex] = 0;
  for (;;) {
    const current = takeCheapest(distance, visited);
    if (current === -1 || current === target) break;
    visited[current] = true;
    for (const next of neighbors(current, grid)) {
      const cost = grid.costs[next];
      if (cost === BLOCKED_CELL) continue;
      distance[next] = Math.min(distance[next], distance[current] + cost);
    }
  }
  if (!Number.isFinite(distance[target])) {
    throw new Error(`reference route is unreachable at cell ${target}`);
  }
  return distance[target];
}

export function referenceFixtureCost(): number {
  return referenceRouteCost(REFERENCE_GRID);
}
