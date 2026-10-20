// The tactical hex board laid on the scene deck. Pure: cells, placement, reach and approach.
// Movement range and enemy approach here are display helpers; rules belong to D16.

import { axialToWorld, hexDistance, nearestIndex, type Axial, type Point2 } from '../math/hex.ts';

export interface Cell extends Axial, Point2 {}

export interface BoardSpec {
  center: Point2;
  cellSize: number;
  halfWidth: number;
  halfDepth: number;
}

export const SCENE_BOARD = {
  cellSize: 1.65,
  halfWidth: 7.4,
  halfDepth: 5.2,
} as const;

/** Hex cells whose centres fit inside the deck rectangle. */
export function buildBoard(spec: BoardSpec): Cell[] {
  const cells: Cell[] = [];
  const range = Math.ceil(spec.halfWidth / spec.cellSize) + 2;
  for (let q = -range; q <= range; q++) {
    for (let r = -range; r <= range; r++) {
      const local = axialToWorld({ q, r }, spec.cellSize);
      if (Math.abs(local.x) > spec.halfWidth || Math.abs(local.z) > spec.halfDepth) continue;
      cells.push({
        q,
        r,
        x: spec.center.x + local.x,
        z: spec.center.z + local.z,
      });
    }
  }
  return cells;
}

export interface PreferredSpot {
  id: string;
  at: Point2;
}

/** Cells of the board and the cell each piece stands on. */
export interface BoardState {
  cells: readonly Cell[];
  placement: ReadonlyMap<string, number>;
}

/** A piece and how many cells it may cross this turn. */
export interface PieceMove {
  id: string;
  steps: number;
}

/** Puts each piece on the free cell nearest its preferred spot, in the given order. */
export function placePieces(
  cells: readonly Cell[],
  preferred: readonly PreferredSpot[],
): Map<string, number> {
  const taken = new Set<number>();
  const placement = new Map<string, number>();
  for (const piece of preferred) {
    const index = nearestIndex(cells, piece.at, taken);
    if (index < 0) throw new Error(`placePieces: no free cell left for ${piece.id}`);
    taken.add(index);
    placement.set(piece.id, index);
  }
  return placement;
}

export function occupiedExcept(placement: ReadonlyMap<string, number>, id: string): Set<number> {
  const busy = new Set<number>();
  placement.forEach((cell, other) => {
    if (other !== id) busy.add(cell);
  });
  return busy;
}

/** Free cells within `steps` of the piece, excluding its own cell. O(cells). */
export function reachableCells(board: BoardState, move: PieceMove): number[] {
  const { cells, placement } = board;
  const from = placement.get(move.id);
  if (from === undefined) return [];
  const busy = occupiedExcept(placement, move.id);
  const reach: number[] = [];
  cells.forEach((cell, index) => {
    const free = index !== from && !busy.has(index);
    if (free && hexDistance(cell, cells[from]) <= move.steps) reach.push(index);
  });
  return reach;
}

/** The free cell within `move.steps` closest to `goal`, or the current cell if none is better. */
export function stepToward(board: BoardState, move: PieceMove, goal: number): number {
  const { cells, placement } = board;
  const from = placement.get(move.id);
  if (from === undefined) throw new Error(`stepToward: ${move.id} is not on the board`);
  let best = from;
  let bestDistance = hexDistance(cells[from], cells[goal]);
  for (const index of reachableCells(board, move)) {
    const distance = hexDistance(cells[index], cells[goal]);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}
