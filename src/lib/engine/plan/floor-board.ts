// Movement on a FloorPlan: square steps (diagonals count as one, as in D&D), blocked by walls,
// closed doors and blocking furniture, plus links that change floor (stairs, ladders, trapdoors
// and the one-way slide).
import type { EdgeSide, FloorPlan, PropCatalog, Room } from '../../../generated/contracts.ts';
import { DIAGONALS, SIDES, edgeKey, squareKey, step, type Cell } from '../math/square.ts';
import { cellKey, indexPlan, type FloorCellRef, type FloorIndex } from './floor-index.ts';

export type { FloorCellRef } from './floor-index.ts';

export interface FloorBoard {
  floors: ReadonlyMap<string, FloorIndex>;
  /** Cell key → cells a link reaches from there in one move. */
  links: ReadonlyMap<string, FloorCellRef[]>;
}

interface Crossing {
  index: FloorIndex;
  edge: string;
  from: Room;
  to: Room;
}

// Any one of these makes an edge between two walkable cells passable.
const CROSSINGS: readonly ((crossing: Crossing) => boolean)[] = [
  ({ from, to }) => from.id === to.id,
  ({ from, to }) => from.kind === 'exterior' && to.kind === 'exterior',
  ({ index, edge }) => index.openings.has(edge),
  ({ index, edge }) => index.doorAt.get(edge)?.open === true,
];

function roomOf(index: FloorIndex, cell: Cell): Room | undefined {
  const key = squareKey(cell);
  return index.blocked.has(key) ? undefined : index.roomAt.get(key);
}

function canCross(index: FloorIndex, cell: Cell, side: EdgeSide): boolean {
  const from = roomOf(index, cell);
  const to = roomOf(index, step(cell, side));
  if (!from || !to) return false;
  const crossing = { index, edge: edgeKey(cell, side), from, to };
  return CROSSINGS.some((rule) => rule(crossing));
}

/** A diagonal is legal only when both orthogonal detours are, so it never cuts a wall corner. */
function canCrossDiagonal(index: FloorIndex, cell: Cell, [a, b]: readonly [EdgeSide, EdgeSide]) {
  return (
    canCross(index, cell, a) &&
    canCross(index, step(cell, a), b) &&
    canCross(index, cell, b) &&
    canCross(index, step(cell, b), a)
  );
}

function linkTable(plan: FloorPlan): Map<string, FloorCellRef[]> {
  const table = new Map<string, FloorCellRef[]>();
  const add = (from: FloorCellRef, to: FloorCellRef) => {
    table.set(cellKey(from), [...(table.get(cellKey(from)) ?? []), to]);
  };
  for (const link of plan.links) {
    add(link.from, link.to);
    if (link.two_way) add(link.to, link.from);
  }
  return table;
}

export function buildFloorBoard(plan: FloorPlan, catalog: PropCatalog): FloorBoard {
  return { floors: indexPlan(plan, catalog), links: linkTable(plan) };
}

export function isWalkable(board: FloorBoard, cell: FloorCellRef): boolean {
  const index = board.floors.get(cell.floor);
  return index !== undefined && roomOf(index, cell) !== undefined;
}

/** Cells one move away: orthogonal, diagonal and linked. O(1) per cell. */
export function neighbours(board: FloorBoard, cell: FloorCellRef): FloorCellRef[] {
  const index = board.floors.get(cell.floor);
  if (!index) return [];
  const on = (next: Cell): FloorCellRef => ({ floor: cell.floor, x: next.x, y: next.y });
  const straight = SIDES.filter((side) => canCross(index, cell, side)).map((side) =>
    on(step(cell, side)),
  );
  const diagonal = DIAGONALS.filter((pair) => canCrossDiagonal(index, cell, pair)).map(
    ([a, b]) => on(step(step(cell, a), b)),
  );
  const linked = (board.links.get(cellKey(cell)) ?? []).filter((to) => isWalkable(board, to));
  return [...straight, ...diagonal, ...linked];
}

interface Walk {
  board: FloorBoard;
  distance: Map<string, number>;
  parent: Map<string, FloorCellRef>;
}

interface Hop {
  from: FloorCellRef;
  to: FloorCellRef;
}

/** Records the hop's target as reached, or returns false when it was already reached. */
function visit(walk: Walk, { from, to }: Hop, moves: number): boolean {
  if (walk.distance.has(cellKey(to))) return false;
  walk.distance.set(cellKey(to), moves);
  walk.parent.set(cellKey(to), from);
  return true;
}

/** The ring of cells one move beyond `frontier`. */
function expand(walk: Walk, frontier: FloorCellRef[], moves: number): FloorCellRef[] {
  const next: FloorCellRef[] = [];
  for (const from of frontier) {
    for (const to of neighbours(walk.board, from)) {
      if (visit(walk, { from, to }, moves)) next.push(to);
    }
  }
  return next;
}

/** Breadth-first walk from `from` that visits each cell once. O(cells reached). */
function walk(board: FloorBoard, from: FloorCellRef, limit: number): Walk {
  const state: Walk = { board, distance: new Map([[cellKey(from), 0]]), parent: new Map() };
  let frontier = [from];
  for (let moves = 1; moves <= limit && frontier.length > 0; moves += 1) {
    frontier = expand(state, frontier, moves);
  }
  return state;
}

/** Cell key → moves needed, for every cell within `moves` of `from` (itself at 0). */
export function reachable(board: FloorBoard, from: FloorCellRef, moves: number) {
  return walk(board, from, moves).distance;
}

/** Shortest route from `from` to `to`, both included, or null when there is none. */
export function findPath(
  board: FloorBoard,
  from: FloorCellRef,
  to: FloorCellRef,
): FloorCellRef[] | null {
  const { parent, distance } = walk(board, from, Number.POSITIVE_INFINITY);
  if (!distance.has(cellKey(to))) return null;
  const route = [to];
  for (let cell = parent.get(cellKey(to)); cell; cell = parent.get(cellKey(cell))) {
    route.unshift(cell);
  }
  return route;
}
