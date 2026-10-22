/**
 * House lots inside a city block: a row along every frontage, then the interior filled on a grid
 * aligned to the block's longest side. Seeded, so a block always gets the same houses. Pure.
 *
 * Rotation follows the engine convention (footprint.ts): the width axis, along the street, is
 * (cos θ, −sin θ) in plan.
 */
import { footprintCornersAlong, footprintPoint } from './footprint.ts';
import { pointInRing, ringsOverlap } from './polygon.ts';
import { boxAround, SpatialGrid } from './spatial.ts';
import { between, mulberry32 } from './random.ts';
import type { Plan } from './types.ts';

export type LotRules = {
  /** Street frontage of a house in metres, [min, max]. */
  frontage: [number, number];
  /** Depth from the street in metres, [min, max]. */
  depth: [number, number];
  seed: number;
  /**
   * False where the source map draws open ground. A house needs most of its sample points
   * (centre and four inner quarter points) on built ground, so a ridge line or an outline under
   * its centre does not reject it.
   */
  isBuilt?: (point: Plan) => boolean;
};
export type BlockShape = {
  outer: Plan[];
  holes: Plan[][];
};
export type House = {
  center: Plan;
  width_m: number;
  depth_m: number;
  rotation_radians: number;
  frontage: boolean;
};
/** A placed house with the corners it was placed with, built from its edge tangent. */
export type Lot = House & {
  corners: Plan[];
};
type Placement = {
  block: BlockShape;
  rules: LotRules;
  houses: Lot[];
  /** Where the placed lots are, so a candidate is tested only against its neighbours. */
  index: SpatialGrid;
  random: () => number;
};

/** Grid cell for placed lots: about one house wide, so a lot touches a few cells. */
const LOT_CELL_M = 16;

const lotBox = (corners: Plan[]) => boxAround(corners.map((corner) => [corner.x_m, corner.z_m]));
type Axis = {
  origin: Plan;
  tangent: Plan;
  normal: Plan;
};

/** Half a step back from the block edge, so a house never straddles it. */
const SETBACK_M = 0.3;
/** Search step along a frontage when a lot does not fit. */
const SEARCH_STEP_M = 1;
const INTERIOR_GAP_M = 0.6;
/** Centre plus the four points halfway to each corner. */
const BUILT_SAMPLES = [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75]];
const BUILT_MAJORITY = 3;
const offset = (point: Plan, direction: Plan, distance: number): Plan => ({
  x_m: point.x_m + direction.x_m * distance,
  z_m: point.z_m + direction.z_m * distance,
});

function onBuiltGround(rules: LotRules, corners: Plan[]): boolean {
  if (!rules.isBuilt) return true;
  const built = BUILT_SAMPLES.filter(([u, v]) => rules.isBuilt!(footprintPoint(corners, u, v)));
  return built.length >= BUILT_MAJORITY;
}

function fits(placement: Placement, corners: Plan[]): boolean {
  const { block, rules } = placement;
  if (!corners.every((corner) => pointInRing(corner, block.outer))) return false;
  if (block.holes.some((hole) => ringsOverlap(corners, hole))) return false;
  if (!onBuiltGround(rules, corners)) return false;
  for (const other of placement.index.near(lotBox(corners))) {
    if (ringsOverlap(corners, placement.houses[other].corners)) return false;
  }
  return true;
}

function tryPlace(placement: Placement, lot: Lot): boolean {
  if (!fits(placement, lot.corners)) return false;
  placement.index.insert(lotBox(lot.corners), placement.houses.length);
  placement.houses.push(lot);
  return true;
}

/** Unit tangent of an edge and the normal that points into the block. */
function edgeAxis(block: BlockShape, from: Plan, to: Plan): Axis | null {
  const length = Math.hypot(to.x_m - from.x_m, to.z_m - from.z_m);
  if (length === 0) return null;
  const tangent = { x_m: (to.x_m - from.x_m) / length, z_m: (to.z_m - from.z_m) / length };
  const left = { x_m: -tangent.z_m, z_m: tangent.x_m };
  const probe = offset(offset(from, tangent, length / 2), left, SETBACK_M);
  const normal = pointInRing(probe, block.outer) ? left : { x_m: -left.x_m, z_m: -left.z_m };
  return { origin: from, tangent, normal };
}

const rotationOf = (tangent: Plan) => Math.atan2(-tangent.z_m, tangent.x_m);

type Slot = {
  axis: Axis;
  along: number;
  frontage: boolean;
};

function lotAt(placement: Placement, slot: Slot): Lot {
  const { axis, along, frontage } = slot;
  const width = between(placement.random, placement.rules.frontage);
  const depth = between(placement.random, placement.rules.depth);
  const front = offset(axis.origin, axis.tangent, along + width / 2);
  const center = offset(front, axis.normal, SETBACK_M + depth / 2);
  const box = { center, width_m: width, depth_m: depth };
  return {
    ...box,
    rotation_radians: rotationOf(axis.tangent),
    frontage,
    corners: footprintCornersAlong({ ...box, tangent: axis.tangent }),
  };
}

/** One row of houses along an edge, searching forward when a lot does not fit. O(length). */
function lineFrontage(placement: Placement, from: Plan, to: Plan) {
  const axis = edgeAxis(placement.block, from, to);
  if (!axis) return;
  const length = Math.hypot(to.x_m - from.x_m, to.z_m - from.z_m);
  let along = 0;
  while (along + placement.rules.frontage[0] <= length) {
    const house = lotAt(placement, { axis, along, frontage: true });
    const fitsEdge = along + house.width_m <= length;
    along += fitsEdge && tryPlace(placement, house) ? house.width_m : SEARCH_STEP_M;
  }
}

function longestEdge(ring: Plan[]): [Plan, Plan] {
  let best: [Plan, Plan] = [ring[0], ring[1]];
  let bestLength = 0;
  ring.forEach((point, index) => {
    const next = ring[(index + 1) % ring.length];
    const length = Math.hypot(next.x_m - point.x_m, next.z_m - point.z_m);
    if (length > bestLength) {
      bestLength = length;
      best = [point, next];
    }
  });
  return best;
}

/** Grid over the block aligned to its longest side. O(cells · houses). */
function fillInterior(placement: Placement) {
  const [from, to] = longestEdge(placement.block.outer);
  const axis = edgeAxis(placement.block, from, to);
  if (!axis) return;
  const project = (point: Plan, direction: Plan) =>
    (point.x_m - from.x_m) * direction.x_m + (point.z_m - from.z_m) * direction.z_m;
  const alongs = placement.block.outer.map((point) => project(point, axis.tangent));
  const depths = placement.block.outer.map((point) => project(point, axis.normal));
  const stepAlong = placement.rules.frontage[1] + INTERIOR_GAP_M;
  const stepDepth = placement.rules.depth[1] + INTERIOR_GAP_M;
  for (let depth = Math.min(...depths); depth < Math.max(...depths); depth += stepDepth) {
    for (let along = Math.min(...alongs); along < Math.max(...alongs); along += stepAlong) {
      const row = { ...axis, origin: offset(from, axis.normal, depth) };
      tryPlace(placement, lotAt(placement, { axis: row, along, frontage: false }));
    }
  }
}

/** Houses for one block: frontage rows first, then the interior. */
export function placeHouses(block: BlockShape, rules: LotRules): Lot[] {
  const random = mulberry32(rules.seed);
  const placement: Placement = { block, rules, houses: [], index: new SpatialGrid(LOT_CELL_M),
    random };
  block.outer.forEach((point, index) => {
    lineFrontage(placement, point, block.outer[(index + 1) % block.outer.length]);
  });
  fillInterior(placement);
  return placement.houses;
}
