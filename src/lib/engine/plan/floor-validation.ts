// Checks a FloorPlan against its prop catalogue before anything renders or moves on it. Each rule
// returns readable problems naming the offending id; an empty list means the plan is usable.
import type {
  CellEdge,
  EdgeMark,
  Floor,
  FloorPlan,
  Prop,
  PropCatalog,
  Room,
} from '../../../generated/contracts.ts';
import { edgeKey, rectCells, squareKey, step } from '../math/square.ts';
import { buildFloorBoard, isWalkable } from './floor-board.ts';
import { wallOwner } from './floor-edges.ts';
import { furnitureCells, indexFloor, propsByKind, roomCells } from './floor-index.ts';

interface Context {
  plan: FloorPlan;
  catalog: PropCatalog;
  props: ReadonlyMap<string, Prop>;
}

interface Sides {
  inside: Room | undefined;
  outside: Room | undefined;
}

type FloorRule = (floor: Floor, context: Context) => string[];
type PlanRule = (context: Context) => string[];

function duplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  return ids.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
}

const overlappingRooms: FloorRule = (floor) => {
  const owners = roomCells(floor);
  return floor.rooms
    .filter((room) =>
      room.cells.flatMap(rectCells).some((cell) => owners.get(squareKey(cell))?.id !== room.id),
    )
    .map((room) => `${floor.id}: la sala ${room.id} se superpone con otra`);
};

function sidesOf(owners: ReadonlyMap<string, Room>, edge: CellEdge): Sides {
  return {
    inside: owners.get(squareKey(edge)),
    outside: owners.get(squareKey(step(edge, edge.side))),
  };
}

/** A door or window needs a wall to sit in, from whichever side the edge was named. */
function hasWall({ inside, outside }: Sides): boolean {
  const room = inside ?? outside;
  const other = inside ? outside : undefined;
  return room !== undefined && wallOwner({ inside: room, outside: other }) !== null;
}

function joinsTwoRooms({ inside, outside }: Sides): boolean {
  return inside !== undefined && outside !== undefined && inside.id !== outside.id;
}

// Where each kind of edge mark is allowed, and what the message says it needs.
interface MarkRule {
  marks: (floor: Floor) => EdgeMark[];
  fits: (sides: Sides) => boolean;
  needs: string;
}

const MARK_RULES: readonly MarkRule[] = [
  { marks: (floor) => floor.doors, fits: hasWall, needs: 'un muro donde ponerse' },
  { marks: (floor) => floor.windows, fits: hasWall, needs: 'un muro donde ponerse' },
  { marks: (floor) => floor.openings, fits: joinsTwoRooms, needs: 'unir dos salas distintas' },
];

const marksInWalls: FloorRule = (floor) => {
  const owners = roomCells(floor);
  return MARK_RULES.flatMap(({ marks, fits, needs }) =>
    marks(floor)
      .filter(({ edge }) => !fits(sidesOf(owners, edge)))
      .map((mark) => `${floor.id}: ${mark.id} necesita ${needs}`),
  );
};

/** Blocking furniture on either side of a door would seal it. */
const doorsClear: FloorRule = (floor, { props }) => {
  const { blocked } = indexFloor(floor, props);
  const sealed = (edge: CellEdge) =>
    blocked.has(squareKey(edge)) || blocked.has(squareKey(step(edge, edge.side)));
  return floor.doors
    .filter(({ edge }) => sealed(edge))
    .map((door) => `${floor.id}: un mueble tapa ${door.id}`);
};

function furnitureProblem(item: Floor['furniture'][number], floor: Floor, context: Context) {
  const prop = context.props.get(item.kind);
  if (!prop) return `${floor.id}: ${item.id} usa el tipo desconocido ${item.kind}`;
  if (!prop.variants.some((variant) => variant.id === item.variant)) {
    return `${floor.id}: ${item.id} usa la variante desconocida ${item.variant}`;
  }
  const owners = roomCells(floor);
  const rooms = new Set(furnitureCells(item, context.props).map((c) => owners.get(squareKey(c))));
  const inside = rooms.size === 1 && !rooms.has(undefined);
  return inside ? null : `${floor.id}: ${item.id} no cabe dentro de una sola sala`;
}

const furnitureFits: FloorRule = (floor, context) =>
  floor.furniture
    .map((item) => furnitureProblem(item, floor, context))
    .filter((problem): problem is string => problem !== null);

/** Two pieces that block movement cannot stand on the same square. */
const furnitureApart: FloorRule = (floor, { props }) => {
  const blocking = floor.furniture.filter((item) => props.get(item.kind)?.blocks);
  const squares = blocking.flatMap((item) =>
    furnitureCells(item, props).map((cell) => ({ id: item.id, key: squareKey(cell) })),
  );
  const crowded = new Set(duplicates(squares.map((square) => square.key)));
  const ids = new Set(squares.filter((square) => crowded.has(square.key)).map((s) => s.id));
  return [...ids].map((id) => `${floor.id}: ${id} se superpone con otro mueble`);
};

const uniqueFloorIds: FloorRule = (floor) => {
  const ids = [...floor.rooms, ...floor.doors, ...floor.windows, ...floor.openings,
    ...floor.furniture].map((item) => item.id);
  const marks = [...floor.doors, ...floor.windows, ...floor.openings];
  const edges = marks.map(({ edge }) => edgeKey(edge, edge.side));
  return [
    ...duplicates(ids).map((id) => `${floor.id}: id repetido ${id}`),
    ...duplicates(edges).map((edge) => `${floor.id}: el borde ${edge} tiene dos marcas`),
  ];
};

/** Both ends of a link must exist and stay walkable once furniture is placed. */
const linksLand: PlanRule = ({ plan, catalog }) => {
  const board = buildFloorBoard(plan, catalog);
  const floors = new Set(plan.floors.map((floor) => floor.id));
  const problem = (link: FloorPlan['links'][number]) => {
    const missing = [link.from.floor, link.to.floor].find((floor) => !floors.has(floor));
    if (missing) return `${link.id} apunta al piso inexistente ${missing}`;
    const usable = isWalkable(board, link.from) && isWalkable(board, link.to);
    return usable ? null : `${link.id} une casillas que no existen o están ocupadas`;
  };
  return plan.links.map(problem).filter((message): message is string => message !== null);
};

const uniquePlanIds: PlanRule = ({ plan }) =>
  duplicates([...plan.floors.map((f) => f.id), ...plan.links.map((l) => l.id)]).map(
    (id) => `id repetido ${id}`,
  );

const FLOOR_RULES: readonly FloorRule[] = [
  overlappingRooms,
  marksInWalls,
  doorsClear,
  furnitureFits,
  furnitureApart,
  uniqueFloorIds,
];
const PLAN_RULES: readonly PlanRule[] = [linksLand, uniquePlanIds];

/** Every problem in the plan. O(floors · cells + furniture · footprint). */
export function validateFloorPlan(plan: FloorPlan, catalog: PropCatalog): string[] {
  const context = { plan, catalog, props: propsByKind(catalog) };
  const perFloor = plan.floors.flatMap((floor) => FLOOR_RULES.flatMap((r) => r(floor, context)));
  return [...perFloor, ...PLAN_RULES.flatMap((rule) => rule(context))];
}
