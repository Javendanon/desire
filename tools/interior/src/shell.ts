// The built shell of one floor: a slab per room rectangle and the walls the plan derives, with a
// lintel over each door and a sill, lintel and pane for each window.
import type { EdgeSide, Floor, FloorPlan } from '../../../src/generated/contracts.ts';
import { edgeKey } from '../../../src/lib/engine/math/square.ts';
import { floorEdges, type PlanEdge } from '../../../src/lib/engine/plan/floor-edges.ts';
import { standingBox, type Box, type Vec3 } from './shapes.ts';

const WALL_THICKNESS = 0.22;
const SLAB_THICKNESS = 0.18;
const DOOR_HEIGHT = 2.1;
const WINDOW_SILL = 0.9;
const WINDOW_TOP = 2.0;
const GLASS_THICKNESS = 0.03;

interface FloorFrame {
  floor: Floor;
  cell: number;
}

/** Where an edge runs in the world and which way it faces. */
interface EdgeLine {
  /** Midpoint on the floor surface. */
  at: Vec3;
  /** True for edges that run east-west. */
  alongX: boolean;
}

// The north edge of a cell runs along its top, the west edge along its left, and so on.
interface EdgeOffset {
  x: number;
  z: number;
  alongX: boolean;
}

const EDGE_OFFSET: Record<EdgeSide, EdgeOffset> = {
  n: { x: 0.5, z: 0, alongX: true },
  s: { x: 0.5, z: 1, alongX: true },
  w: { x: 0, z: 0.5, alongX: false },
  e: { x: 1, z: 0.5, alongX: false },
};

function edgeLine({ floor, cell }: FloorFrame, edge: PlanEdge): EdgeLine {
  const offset = EDGE_OFFSET[edge.side];
  return {
    at: [
      (floor.origin_x + edge.x + offset.x) * cell,
      floor.elevation_m,
      (floor.origin_y + edge.y + offset.z) * cell,
    ],
    alongX: offset.alongX,
  };
}

/** A slab of wall along `line`, from `from` to `to` metres above the floor. */
function wallPiece(line: EdgeLine, span: Span, cell: number) {
  const thickness = WALL_THICKNESS;
  const length = cell + thickness;
  const size: Vec3 = line.alongX
    ? [length, span.to - span.from, thickness]
    : [thickness, span.to - span.from, length];
  return { at: [line.at[0], line.at[1] + span.from, line.at[2]] as Vec3, size };
}

interface Span {
  from: number;
  to: number;
}

interface WallPart {
  name: string;
  material: string;
  span: Span;
}

function piece(part: WallPart, line: EdgeLine, cell: number): Box {
  const { at, size } = wallPiece(line, part.span, cell);
  return standingBox(part, at, size);
}

function glassPane(name: string, line: EdgeLine, cell: number): Box {
  const { at, size } = wallPiece(line, { from: WINDOW_SILL, to: WINDOW_TOP }, cell);
  const pane: Vec3 = line.alongX
    ? [size[0], size[1], GLASS_THICKNESS]
    : [GLASS_THICKNESS, size[1], size[2]];
  return standingBox({ name, material: 'glass' }, at, pane);
}

type EdgeBuilder = (edge: PlanEdge, id: string, frame: FloorFrame) => Box[];

// One builder per edge kind; a new kind is a new row, not another branch.
const EDGE_BUILDERS: Record<PlanEdge['kind'], EdgeBuilder> = {
  wall: (edge, id, frame) => [
    piece({ name: `muro-${id}`, material: edge.material,
      span: { from: 0, to: frame.floor.height_m } }, edgeLine(frame, edge), frame.cell),
  ],
  door: (edge, id, frame) => [
    piece({ name: `dintel-${id}`, material: edge.material,
      span: { from: DOOR_HEIGHT, to: frame.floor.height_m } }, edgeLine(frame, edge), frame.cell),
  ],
  window: (edge, id, frame) => {
    const line = edgeLine(frame, edge);
    const part = (name: string, from: number, to: number) =>
      piece({ name, material: edge.material, span: { from, to } }, line, frame.cell);
    return [
      part(`alfeizar-${id}`, 0, WINDOW_SILL),
      part(`dintel-${id}`, WINDOW_TOP, frame.floor.height_m),
      glassPane(`vidrio-${id}`, line, frame.cell),
    ];
  },
};

/** Edge key → id of the door or window on it, so built parts keep the plan's names. */
function markIds(floor: Floor): Map<string, string> {
  const marks = [...floor.doors, ...floor.windows];
  return new Map(marks.map((mark) => [edgeKey(mark.edge, mark.edge.side), mark.id]));
}

function walls(plan: FloorPlan, frame: FloorFrame): Box[] {
  const ids = markIds(frame.floor);
  return floorEdges(plan, frame.floor.id).flatMap((edge) => {
    const key = edgeKey(edge, edge.side);
    const id = ids.get(key) ?? key.replace(/[,:]/g, '-');
    return EDGE_BUILDERS[edge.kind](edge, id, frame);
  });
}

function slabs({ floor, cell }: FloorFrame): Box[] {
  return floor.rooms.flatMap((room) =>
    room.cells.map((rect, index) =>
      standingBox({ name: `suelo-${room.id}-${index}`, material: room.floor_material },
        [
          (floor.origin_x + rect.x + rect.w / 2) * cell,
          floor.elevation_m - SLAB_THICKNESS,
          (floor.origin_y + rect.y + rect.h / 2) * cell,
        ],
        [rect.w * cell, SLAB_THICKNESS, rect.h * cell],
      ),
    ),
  );
}

/** Slabs and walls of one floor. O(cells). */
export function floorShell(plan: FloorPlan, floor: Floor): Box[] {
  const frame = { floor, cell: plan.cell_size_m };
  return [...slabs(frame), ...walls(plan, frame)];
}
