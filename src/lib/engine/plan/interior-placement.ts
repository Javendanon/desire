// Where things of a FloorPlan stand in the world (x east, y up, z south, metres): square centres,
// the pose of a turned piece of furniture, the square under a point, and a point along the slide.
import type { Floor, FloorPlan, Point3, Prop } from '../../../generated/contracts.ts';
import type { Vec3Like } from '../math/camera-rig.ts';
import type { Cell } from '../math/square.ts';
import type { FloorCellRef } from './floor-index.ts';

export interface FurniturePose {
  /** Where the model's own origin (its unturned north-west corner) goes. */
  position: Vec3Like;
  /** Turn around +y. Negative, because a quarter turn clockwise seen from above is −90°. */
  yawDegrees: number;
}

const DEGREES = Math.PI / 180;
/** From a square's corner to its centre, in squares. */
const CENTRE = 0.5;

/** A piece of furniture with the floor it stands on and its catalogue entry. */
export interface PlacedPiece {
  floor: Floor;
  item: Floor['furniture'][number];
  prop: Prop;
}

export function floorById(plan: FloorPlan, id: string): Floor {
  const floor = plan.floors.find((candidate) => candidate.id === id);
  if (!floor) throw new Error(`floor plan ${plan.id}: no floor ${id}`);
  return floor;
}

export function cellCentre(plan: FloorPlan, cell: FloorCellRef): Vec3Like {
  const floor = floorById(plan, cell.floor);
  const size = plan.cell_size_m;
  return {
    x: (floor.origin_x + cell.x + CENTRE) * size,
    y: floor.elevation_m,
    z: (floor.origin_y + cell.y + CENTRE) * size,
  };
}

/** The square of `floorId` under a world point. */
export function worldToCell(plan: FloorPlan, floorId: string, point: Vec3Like): Cell {
  const floor = floorById(plan, floorId);
  const size = plan.cell_size_m;
  return {
    x: Math.floor(point.x / size - floor.origin_x),
    y: Math.floor(point.z / size - floor.origin_y),
  };
}

function turn(x: number, z: number, radians: number) {
  const [cos, sin] = [Math.cos(radians), Math.sin(radians)];
  return { x: x * cos + z * sin, z: -x * sin + z * cos };
}

/**
 * Pose of a piece whose model spans its unturned footprint from (0, 0): after turning it, shift it
 * so the turned footprint's north-west corner lands on the piece's square.
 */
export function furniturePose(plan: FloorPlan, { floor, item, prop }: PlacedPiece): FurniturePose {
  const size = plan.cell_size_m;
  const radians = -item.rotation * DEGREES;
  const corners = [
    turn(0, 0, radians),
    turn(prop.width * size, prop.depth * size, radians),
  ];
  const west = Math.min(...corners.map((corner) => corner.x));
  const north = Math.min(...corners.map((corner) => corner.z));
  return {
    position: {
      x: (floor.origin_x + item.x) * size - west,
      y: floor.elevation_m,
      z: (floor.origin_y + item.y) * size - north,
    },
    yawDegrees: -item.rotation,
  };
}

function distance(a: Point3, b: Point3): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

/** The point at fraction `t` of the slide's length, so a rider moves evenly. O(points). */
export function slidePoint(path: readonly Point3[], t: number): Vec3Like {
  const lengths = path.slice(1).map((point, index) => distance(path[index], point));
  let remaining = Math.min(1, Math.max(0, t)) * lengths.reduce((sum, length) => sum + length, 0);
  for (const [index, length] of lengths.entries()) {
    if (remaining <= length && length > 0) {
      const share = remaining / length;
      const [a, b] = [path[index], path[index + 1]];
      return {
        x: a.x + (b.x - a.x) * share,
        y: a.y + (b.y - a.y) * share,
        z: a.z + (b.z - a.z) * share,
      };
    }
    remaining -= length;
  }
  const end = path[path.length - 1];
  return { x: end.x, y: end.y, z: end.z };
}
