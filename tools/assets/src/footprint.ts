/**
 * Oriented building footprints in plan metres. Pure geometry, no engine.
 *
 * Rotation follows the engine (PlayCanvas `setFromEulerAngles(0, θ, 0)` in D13 `trs`): local +x,
 * the width axis, points to (cos θ, -sin θ) in plan, and local +z, the depth axis, to
 * (sin θ, cos θ).
 */
import type { Plan } from './types.ts';

export type Footprint = {
  center: Plan;
  width_m: number;
  depth_m: number;
  rotation_radians: number;
};
export type Bounds = {
  min_x: number;
  max_x: number;
  min_z: number;
  max_z: number;
};
type Axis = [number, number];

/** Overlaps thinner than this are edge contact, not blocking. */
const CONTACT_EPSILON_M = 1e-9;
const CELL_AXES: Axis[] = [[1, 0], [0, 1]];

function axesOf(rotation: number): Axis[] {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return [[cos, -sin], [sin, cos]];
}

type Box = {
  center: Plan;
  width_m: number;
  depth_m: number;
};

/** Corners in order around a box whose width and depth axes are given. */
function cornersOnAxes(box: Box, [width, depth]: Axis[]): Plan[] {
  const halfWidth = box.width_m / 2;
  const halfDepth = box.depth_m / 2;
  const signs: Axis[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  return signs.map(([along, across]) => ({
    x_m: box.center.x_m + along * halfWidth * width[0] + across * halfDepth * depth[0],
    z_m: box.center.z_m + along * halfWidth * width[1] + across * halfDepth * depth[1],
  }));
}

/** Corners in order around the footprint. */
export function footprintCorners(footprint: Footprint): Plan[] {
  return cornersOnAxes(footprint, axesOf(footprint.rotation_radians));
}

/**
 * The same corners for a footprint laid along a unit tangent: rotation atan2(−tz, tx), so the
 * width axis is the tangent and the depth axis (−tz, tx). No trigonometry, hence no last-bit
 * differences between JavaScript engines and other languages' math libraries.
 */
export function footprintCornersAlong(footprint: Box & { tangent: Plan }): Plan[] {
  const { x_m: tx, z_m: tz } = footprint.tangent;
  return cornersOnAxes(footprint, [[tx, tz], [-tz, tx]]);
}

export function footprintBounds(corners: Plan[]): Bounds {
  const xs = corners.map((corner) => corner.x_m);
  const zs = corners.map((corner) => corner.z_m);
  return {
    min_x: Math.min(...xs),
    max_x: Math.max(...xs),
    min_z: Math.min(...zs),
    max_z: Math.max(...zs),
  };
}

function cellCorners(cell: Bounds): Plan[] {
  return [
    { x_m: cell.min_x, z_m: cell.min_z },
    { x_m: cell.max_x, z_m: cell.min_z },
    { x_m: cell.max_x, z_m: cell.max_z },
    { x_m: cell.min_x, z_m: cell.max_z },
  ];
}

function project(points: Plan[], axis: Axis): [number, number] {
  const values = points.map((point) => point.x_m * axis[0] + point.z_m * axis[1]);
  return [Math.min(...values), Math.max(...values)];
}

function separated(first: Plan[], second: Plan[], axis: Axis): boolean {
  const [firstMin, firstMax] = project(first, axis);
  const [secondMin, secondMax] = project(second, axis);
  return firstMax <= secondMin + CONTACT_EPSILON_M || secondMax <= firstMin + CONTACT_EPSILON_M;
}

/** Separating-axis test between a footprint and an axis-aligned cell. O(1). */
export function overlapsCell(corners: Plan[], cell: Bounds): boolean {
  const square = cellCorners(cell);
  const edges: Axis[] = [
    [corners[1].x_m - corners[0].x_m, corners[1].z_m - corners[0].z_m],
    [corners[3].x_m - corners[0].x_m, corners[3].z_m - corners[0].z_m],
  ];
  const footprintAxes = edges.map(([x, z]): Axis => [x / Math.hypot(x, z), z / Math.hypot(x, z)]);
  return ![...CELL_AXES, ...footprintAxes].some((axis) => separated(corners, square, axis));
}

/** Point at fractions of a footprint: `u` along the width (corner 0 to 1), `v` along the depth. */
export function footprintPoint(corners: Plan[], u: number, v: number): Plan {
  const [origin, alongWidth, , alongDepth] = corners;
  return {
    x_m: origin.x_m + (alongWidth.x_m - origin.x_m) * u + (alongDepth.x_m - origin.x_m) * v,
    z_m: origin.z_m + (alongWidth.z_m - origin.z_m) * u + (alongDepth.z_m - origin.z_m) * v,
  };
}
