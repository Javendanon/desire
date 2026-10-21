// How the slice's edge is hidden at each camera tilt. Seen from above, a flat haze ring frames
// it. Seen low, that ring is a grey slab across the sea, so a standing curtain of mist at the
// edge takes over, dense only where the edge cuts through land. Pure.

import type { SliceMeta } from './slice-data.ts';

/** Polar angle (radians from straight down) where the crossfade starts and ends. */
const LOW_FROM = 0.95;
const LOW_TO = 1.2;

export interface HazeBlend {
  ring: number;
  curtain: number;
}

export function hazeBlend(polar: number): HazeBlend {
  const t = Math.min(1, Math.max(0, (polar - LOW_FROM) / (LOW_TO - LOW_FROM)));
  const curtain = t * t * (3 - 2 * t);
  return { ring: 1 - curtain, curtain };
}

export type PlanPoint = [number, number];

export interface Spacing {
  outset: number;
  step: number;
}

export interface HeightField {
  heights: Float32Array;
  meta: SliceMeta;
}

/** Points around the slice rectangle grown by `outset`, `step` apart, corners included. */
export function perimeter(meta: SliceMeta, spacing: Spacing): PlanPoint[] {
  const { outset, step } = spacing;
  const east = meta.width_m + outset;
  const south = meta.depth_m + outset;
  const corners: PlanPoint[] = [
    [-outset, -outset], [east, -outset], [east, south], [-outset, south],
  ];
  return corners.flatMap(([x, z], index) => {
    const [nx, nz] = corners[(index + 1) % 4];
    const segments = Math.max(1, Math.round(Math.hypot(nx - x, nz - z) / step));
    return Array.from({ length: segments }, (_, k): PlanPoint =>
      [x + ((nx - x) * k) / segments, z + ((nz - z) * k) / segments]);
  });
}

type Axis = {
  radius: number;
  cell: number;
  count: number;
};

/** Cells along one axis whose centres lie within `radius` of `at`. */
function cellRange(at: number, axis: Axis) {
  const from = Math.max(0, Math.ceil((at - axis.radius) / axis.cell - 0.5));
  const to = Math.min(axis.count - 1, Math.floor((at + axis.radius) / axis.cell - 0.5));
  return { from, to };
}

/**
 * Share of land cells (height at or above the water plane) within `radius` metres of the point,
 * after clamping it onto the slice. O(cells in the window).
 */
export function landShare(field: HeightField, point: PlanPoint, radius: number): number {
  const { heights, meta } = field;
  const x = Math.min(meta.width_m, Math.max(0, point[0]));
  const z = Math.min(meta.depth_m, Math.max(0, point[1]));
  const rows = cellRange(z, { radius, cell: meta.cell_m, count: meta.rows });
  const columns = cellRange(x, { radius, cell: meta.cell_m, count: meta.columns });
  let land = 0;
  for (let row = rows.from; row <= rows.to; row += 1) {
    for (let column = columns.from; column <= columns.to; column += 1) {
      if (heights[row * meta.columns + column] >= 0) land += 1;
    }
  }
  const cells = (rows.to - rows.from + 1) * (columns.to - columns.from + 1);
  return cells > 0 ? land / cells : 0;
}
