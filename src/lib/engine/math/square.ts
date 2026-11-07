// Square cells for interiors: 1 square = 5 ft, x grows east and y grows south, as on the plan.
import type { CellRect, EdgeSide } from '../../../generated/contracts.ts';

export interface Cell {
  x: number;
  y: number;
}

/** One step across each side of a cell. */
export const SIDE_STEP: Readonly<Record<EdgeSide, Cell>> = {
  n: { x: 0, y: -1 },
  e: { x: 1, y: 0 },
  s: { x: 0, y: 1 },
  w: { x: -1, y: 0 },
};

export const SIDES = Object.keys(SIDE_STEP) as EdgeSide[];

/** A diagonal step is two sides crossed together. */
export const DIAGONALS: readonly (readonly [EdgeSide, EdgeSide])[] = [
  ['n', 'e'],
  ['s', 'e'],
  ['s', 'w'],
  ['n', 'w'],
];

// Every edge has two names (the north side of one cell is the south side of the next); the
// canonical name keeps only north and west so a shared edge is stored once.
const CANONICAL: Readonly<Record<EdgeSide, (cell: Cell) => [Cell, EdgeSide]>> = {
  n: (cell) => [cell, 'n'],
  w: (cell) => [cell, 'w'],
  s: (cell) => [step(cell, 's'), 'n'],
  e: (cell) => [step(cell, 'e'), 'w'],
};

export function step(cell: Cell, side: EdgeSide): Cell {
  const delta = SIDE_STEP[side];
  return { x: cell.x + delta.x, y: cell.y + delta.y };
}

export function squareKey(cell: Cell): string {
  return `${cell.x},${cell.y}`;
}

/** Stable identity of the edge on `side` of `cell`, shared by both cells that touch it. */
export function edgeKey(cell: Cell, side: EdgeSide): string {
  const [owner, canonical] = CANONICAL[side](cell);
  return `${squareKey(owner)}:${canonical}`;
}

/** Every cell of a rectangle, row by row. O(w·h). */
export function rectCells(rect: CellRect): Cell[] {
  const cells: Cell[] = [];
  for (let y = rect.y; y < rect.y + rect.h; y += 1) {
    for (let x = rect.x; x < rect.x + rect.w; x += 1) cells.push({ x, y });
  }
  return cells;
}

/** Cells covered by a footprint at `origin`, turned in quarter turns. O(w·d). */
export function footprintCells(origin: Cell, size: Cell, rotation: number): Cell[] {
  const quarterTurned = rotation % 180 !== 0;
  const w = quarterTurned ? size.y : size.x;
  const h = quarterTurned ? size.x : size.y;
  return rectCells({ x: origin.x, y: origin.y, w, h, chamfer: false });
}
