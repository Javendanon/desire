// Lookup tables for one floor of a FloorPlan: which room owns a cell, what sits on each edge and
// which cells furniture fills. Movement, walls and validation all read the plan through this.
import type {
  Door,
  Floor,
  FloorPlan,
  Prop,
  PropCatalog,
  Room,
} from '../../../generated/contracts.ts';
import { edgeKey, footprintCells, rectCells, squareKey, type Cell } from '../math/square.ts';

export interface FloorCellRef extends Cell {
  floor: string;
}

export interface FloorIndex {
  floor: Floor;
  /** Cell key → owning room. The first room wins and validation reports overlaps. */
  roomAt: ReadonlyMap<string, Room>;
  doorAt: ReadonlyMap<string, Door>;
  openings: ReadonlySet<string>;
  windows: ReadonlySet<string>;
  /** Cell keys filled by furniture that blocks movement. */
  blocked: ReadonlySet<string>;
}

export function cellKey(cell: FloorCellRef): string {
  return `${cell.floor}:${squareKey(cell)}`;
}

export function propsByKind(catalog: PropCatalog): Map<string, Prop> {
  return new Map(catalog.props.map((prop) => [prop.kind, prop]));
}

/** Cells a piece of furniture covers, or none when its kind is unknown. */
export function furnitureCells(
  item: Floor['furniture'][number],
  props: ReadonlyMap<string, Prop>,
): Cell[] {
  const prop = props.get(item.kind);
  if (!prop) return [];
  return footprintCells(item, { x: prop.width, y: prop.depth }, item.rotation);
}

/** Room ownership of every cell. O(cells). */
export function roomCells(floor: Floor): Map<string, Room> {
  const owners = new Map<string, Room>();
  for (const room of floor.rooms) {
    for (const cell of room.cells.flatMap(rectCells)) {
      const key = squareKey(cell);
      if (!owners.has(key)) owners.set(key, room);
    }
  }
  return owners;
}

function blockedCells(floor: Floor, props: ReadonlyMap<string, Prop>): Set<string> {
  const blocking = floor.furniture.filter((item) => props.get(item.kind)?.blocks);
  return new Set(blocking.flatMap((item) => furnitureCells(item, props)).map(squareKey));
}

function edgeSet(marks: Floor['windows']): Set<string> {
  return new Set(marks.map((mark) => edgeKey(mark.edge, mark.edge.side)));
}

/** Index one floor. O(cells + edges + furniture). */
export function indexFloor(floor: Floor, props: ReadonlyMap<string, Prop>): FloorIndex {
  return {
    floor,
    roomAt: roomCells(floor),
    doorAt: new Map(floor.doors.map((door) => [edgeKey(door.edge, door.edge.side), door])),
    openings: edgeSet(floor.openings),
    windows: edgeSet(floor.windows),
    blocked: blockedCells(floor, props),
  };
}

/** Every floor of a plan, by id. */
export function indexPlan(plan: FloorPlan, catalog: PropCatalog): Map<string, FloorIndex> {
  const props = propsByKind(catalog);
  return new Map(plan.floors.map((floor) => [floor.id, indexFloor(floor, props)]));
}
