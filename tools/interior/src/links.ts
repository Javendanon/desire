// Built pieces for the links between floors: a flight of steps for stairs, rails and rungs for a
// ladder, a hatch for the trapdoor, and the slide's path with the posts that hold it up.
import type { Floor, FloorCell, FloorLink, FloorPlan } from '../../../src/generated/contracts.ts';
import {
  standingBox,
  standingCylinder,
  type Box,
  type Cylinder,
  type Shape,
  type Vec3,
} from './shapes.ts';

const STEP_RISE = 0.2;
const RAIL_SIZE = 0.06;
const RUNG_SPACING = 0.3;
const LADDER_WIDTH = 0.5;
const HATCH_THICKNESS = 0.06;
/** The hatch leaves a frame of floor around it. */
const HATCH_SHARE = 0.8;
const POST_RADIUS = 0.07;
/** One post every this many path points keeps the spiral supported without a forest of poles. */
const POST_EVERY = 6;

export interface SlideSpec {
  name: string;
  points: Vec3[];
  posts: Cylinder[];
}

/** Built shapes of one link, filed under the floor whose model carries them. */
export interface LinkParts {
  floor: string;
  shapes: Shape[];
}

interface LinkEnd {
  floor: Floor;
  cell: FloorCell;
}

interface Ends {
  lower: LinkEnd;
  upper: LinkEnd;
  size: number;
}

function cellCorner({ floor, cell }: LinkEnd, size: number): Vec3 {
  return [(floor.origin_x + cell.x) * size, floor.elevation_m, (floor.origin_y + cell.y) * size];
}

function steps(link: FloorLink, ends: Ends): Shape[] {
  const rise = ends.upper.floor.elevation_m - ends.lower.floor.elevation_m;
  const count = Math.max(1, Math.round(rise / STEP_RISE));
  const corner = cellCorner(ends.lower, ends.size);
  const depth = ends.size / count;
  return Array.from({ length: count }, (_, index) =>
    standingBox({ name: `escalera-${link.id}-${index}`, material: 'trim' },
      [corner[0] + ends.size / 2, corner[1], corner[2] + depth * index + depth / 2],
      [ends.size, (rise * (index + 1)) / count, depth],
    ),
  );
}

function ladder(link: FloorLink, ends: Ends): Shape[] {
  const height = ends.upper.floor.elevation_m - ends.lower.floor.elevation_m;
  const corner = cellCorner(ends.lower, ends.size);
  const x = corner[0] + ends.size / 2;
  const z = corner[2] + ends.size / 2;
  const rail = (side: number): Box =>
    standingBox({ name: `escala-${link.id}-larguero-${side}`, material: 'trim' },
      [x + (side * LADDER_WIDTH) / 2, corner[1], z], [RAIL_SIZE, height, RAIL_SIZE]);
  const rungs = Array.from({ length: Math.floor(height / RUNG_SPACING) }, (_, index) =>
    standingBox({ name: `escala-${link.id}-peldano-${index}`, material: 'trim' },
      [x, corner[1] + RUNG_SPACING * (index + 1), z], [LADDER_WIDTH, RAIL_SIZE, RAIL_SIZE]),
  );
  return [rail(-1), rail(1), ...rungs];
}

function hatch(link: FloorLink, ends: Ends): Shape[] {
  const corner = cellCorner(ends.upper, ends.size);
  return [
    standingBox({ name: `portilla-${link.id}`, material: 'trim' },
      [corner[0] + ends.size / 2, corner[1], corner[2] + ends.size / 2],
      [ends.size * HATCH_SHARE, HATCH_THICKNESS, ends.size * HATCH_SHARE]),
  ];
}

type PartBuilder = (link: FloorLink, ends: Ends) => LinkParts[];

// Which floor model carries each kind of link; the slide is built on its own.
const PART_BUILDERS: Record<Exclude<FloorLink['kind'], 'slide'>, PartBuilder> = {
  stairs: (link, ends) => [{ floor: ends.lower.floor.id, shapes: steps(link, ends) }],
  ladder: (link, ends) => [{ floor: ends.lower.floor.id, shapes: ladder(link, ends) }],
  trapdoor: (link, ends) => [
    { floor: ends.upper.floor.id, shapes: hatch(link, ends) },
    { floor: ends.lower.floor.id, shapes: ladder(link, ends) },
  ],
};

function endsOf(plan: FloorPlan, link: FloorLink): Ends {
  const end = (cell: FloorCell) => {
    const floor = plan.floors.find((candidate) => candidate.id === cell.floor);
    if (!floor) throw new Error(`link ${link.id}: no floor ${cell.floor}`);
    return { floor, cell };
  };
  const [a, b] = [end(link.from), end(link.to)];
  const ordered = a.floor.elevation_m <= b.floor.elevation_m ? [a, b] : [b, a];
  return { lower: ordered[0], upper: ordered[1], size: plan.cell_size_m };
}

/** Stairs, ladders and trapdoors, filed by floor. O(links). */
export function linkParts(plan: FloorPlan): LinkParts[] {
  return plan.links
    .filter((link) => link.kind !== 'slide')
    .flatMap((link) => {
      const build = PART_BUILDERS[link.kind as keyof typeof PART_BUILDERS];
      return build(link, endsOf(plan, link));
    });
}

/** The slide's path and a post under every few points, standing on the ground. */
export function slideSpec(plan: FloorPlan): SlideSpec | null {
  const link = plan.links.find((candidate) => candidate.kind === 'slide');
  if (!link) return null;
  const points = link.path.map((point): Vec3 => [point.x, point.y, point.z]);
  const posts = points
    .filter((_, index) => index % POST_EVERY === 0)
    .map((point, index) =>
      standingCylinder({ name: `poste-${link.id}-${index}`, material: 'trim' },
        [point[0], 0, point[2]],
        { radius: POST_RADIUS, height: point[1] }),
    );
  return { name: link.id, points, posts };
}
