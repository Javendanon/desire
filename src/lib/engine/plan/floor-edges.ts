// The edges a model draws for one floor, derived from room boundaries: a wall where an indoor room
// meets anything else, with doors and windows cut into it. Two outdoor areas share no wall, and an
// opening between rooms is left empty. The renderer and the Blender build read only this.
import type {
  EdgeSide,
  FloorPlan,
  MaterialKind,
  Room,
} from '../../../generated/contracts.ts';
import { SIDES, edgeKey, rectCells, squareKey, step, type Cell } from '../math/square.ts';
import { roomCells } from './floor-index.ts';

export type EdgeKind = 'wall' | 'door' | 'window';

export interface PlanEdge extends Cell {
  side: EdgeSide;
  kind: EdgeKind;
  /** Wall finish of the indoor side. */
  material: MaterialKind;
}

export interface Boundary {
  inside: Room;
  outside: Room | undefined;
}

function isIndoors(room: Room | undefined): room is Room {
  return room?.kind === 'interior';
}

/** The indoor room that owns the wall, or null when no wall stands on this edge. */
export function wallOwner({ inside, outside }: Boundary): Room | null {
  if (outside?.id === inside.id) return null;
  if (isIndoors(inside)) return inside;
  return isIndoors(outside) ? outside : null;
}

function edgeKinds(floor: FloorPlan['floors'][number]): Map<string, EdgeKind | null> {
  const kinds = new Map<string, EdgeKind | null>();
  const mark = (marks: typeof floor.windows, kind: EdgeKind | null) => {
    for (const { edge } of marks) kinds.set(edgeKey(edge, edge.side), kind);
  };
  mark(floor.openings, null);
  mark(floor.windows, 'window');
  mark(floor.doors, 'door');
  return kinds;
}

interface EdgeContext {
  owners: ReadonlyMap<string, Room>;
  kinds: ReadonlyMap<string, EdgeKind | null>;
  room: Room;
}

/** The edge drawn on `side` of `cell`, or null where no wall stands or an opening is left. */
function edgeAt(cell: Cell, side: EdgeSide, context: EdgeContext): PlanEdge | null {
  const outside = context.owners.get(squareKey(step(cell, side)));
  const owner = wallOwner({ inside: context.room, outside });
  const kind = context.kinds.get(edgeKey(cell, side));
  if (!owner || kind === null) return null;
  return { ...cell, side, kind: kind ?? 'wall', material: owner.wall_material };
}

/** Keeps the first copy of each shared edge. O(edges). */
function uniqueEdges(candidates: readonly (PlanEdge | null)[]): PlanEdge[] {
  const byKey = new Map<string, PlanEdge>();
  for (const edge of candidates) {
    if (edge && !byKey.has(edgeKey(edge, edge.side))) byKey.set(edgeKey(edge, edge.side), edge);
  }
  return [...byKey.values()];
}

/** Every drawn edge of `floorId`, each shared edge once. O(cells). */
export function floorEdges(plan: FloorPlan, floorId: string): PlanEdge[] {
  const floor = plan.floors.find((candidate) => candidate.id === floorId);
  if (!floor) throw new Error(`floor plan ${plan.id}: no floor ${floorId}`);
  const shared = { owners: roomCells(floor), kinds: edgeKinds(floor) };
  const candidates = floor.rooms.flatMap((room) =>
    room.cells
      .flatMap(rectCells)
      .flatMap((cell) => SIDES.map((side) => edgeAt(cell, side, { ...shared, room }))),
  );
  return uniqueEdges(candidates);
}
