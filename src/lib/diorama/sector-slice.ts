// A slice's houses, berths and trees read from sector payloads instead of the slice's own files:
// which sectors a slice frame overlaps, and which of their features fall inside it, moved into
// the slice's metres. Features keep their stable ids, so they look the same as anywhere else.
// Pure.

import type { Sector } from '../map/sector-format.ts';
import type { SliceBerth, SliceHouse, SliceTree } from './slice-data.ts';

export interface GridShape {
  columns: number;
  rows: number;
  size_m: number;
}

/** A rectangle in absolute map metres: north-west corner and extent. */
export interface Frame {
  x_m: number;
  z_m: number;
  width_m: number;
  depth_m: number;
}

export interface FrameFeatures {
  houses: SliceHouse[];
  berths: SliceBerth[];
  trees: SliceTree[];
}

function span(from: number, extent: number, size: number, count: number): [number, number] {
  const first = Math.max(0, Math.floor(from / size));
  const last = Math.min(count - 1, Math.floor((from + extent) / size));
  return [first, last];
}

/** Indices of the grid's sectors that the frame touches, in index order. */
export function sectorsOverlapping(grid: GridShape, frame: Frame): number[] {
  const [left, right] = span(frame.x_m, frame.width_m, grid.size_m, grid.columns);
  const [top, bottom] = span(frame.z_m, frame.depth_m, grid.size_m, grid.rows);
  const indices: number[] = [];
  for (let row = top; row <= bottom; row += 1) {
    for (let column = left; column <= right; column += 1) indices.push(row * grid.columns + column);
  }
  return indices;
}

type Point = {
  x_m: number;
  z_m: number;
};

/** Items whose point lies in the frame (north and west edges inclusive), moved into its metres. */
function within<T extends Point>(items: T[], frame: Frame): T[] {
  const kept: T[] = [];
  for (const item of items) {
    const x_m = item.x_m - frame.x_m;
    const z_m = item.z_m - frame.z_m;
    if (x_m >= 0 && x_m < frame.width_m && z_m >= 0 && z_m < frame.depth_m) {
      kept.push({ ...item, x_m, z_m });
    }
  }
  return kept;
}

/** The sectors' features inside the frame, in frame metres, with their ids. O(features). */
export function featuresInFrame(sectors: Sector[], frame: Frame): FrameFeatures {
  const houses = sectors.flatMap((sector) => within(sector.houses, frame));
  return {
    houses: houses.map(({ x_m, z_m, ...house }) => ({ ...house, center: { x_m, z_m } })),
    berths: sectors.flatMap((sector) => within(sector.berths, frame)),
    trees: sectors.flatMap((sector) => within(sector.trees, frame)),
  };
}
