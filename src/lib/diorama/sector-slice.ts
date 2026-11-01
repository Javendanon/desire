// A slice's houses, berths and trees read from sector payloads instead of the slice's own files:
// which sectors a slice frame overlaps, and which of their features fall inside it, moved into
// the slice's metres. Features keep their stable ids, so they look the same as anywhere else.
// Pure.

import type { Sector, SectorHouse } from '../map/sector-format.ts';
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

/** A frame's extent along one axis, and the grid's cells along it. */
type Axis = {
  from: number;
  extent: number;
  cell: number;
  cells: number;
};

/** First and last cell an axis span touches, clipped to the grid. */
function span(axis: Axis): [number, number] {
  const first = Math.max(0, Math.floor(axis.from / axis.cell));
  const last = Math.min(axis.cells - 1, Math.floor((axis.from + axis.extent) / axis.cell));
  return [first, last];
}

/** Indices of the grid's sectors that the frame touches, in index order. */
export function sectorsOverlapping(grid: GridShape, frame: Frame): number[] {
  const cell = grid.size_m;
  const [left, right] = span({ from: frame.x_m, extent: frame.width_m, cell, cells: grid.columns });
  const [top, bottom] = span({ from: frame.z_m, extent: frame.depth_m, cell, cells: grid.rows });
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

/** Builds what a kept item becomes, given its point in the frame's metres. */
type Place<T, R> = (item: T, at: Point) => R;

/**
 * Items whose point lies in the frame (north and west edges inclusive), each built once in its
 * final shape at its point in the frame's metres.
 */
function within<T extends Point, R>(items: T[], frame: Frame, place: Place<T, R>): R[] {
  const kept: R[] = [];
  for (const item of items) {
    const at = { x_m: item.x_m - frame.x_m, z_m: item.z_m - frame.z_m };
    const inside = at.x_m >= 0 && at.x_m < frame.width_m && at.z_m >= 0 && at.z_m < frame.depth_m;
    if (inside) kept.push(place(item, at));
  }
  return kept;
}

const moved = <T extends Point>(item: T, at: Point): T => ({ ...item, ...at });

/** A payload house centred at a point, with its id, as the town builds it. */
function centredAt(house: SectorHouse, at: Point): SliceHouse {
  const { x_m: _x, z_m: _z, ...body } = house;
  return { ...body, center: at };
}

/** A payload house as the town builds it: centred where it stands, with its id. */
export const centred = (house: SectorHouse): SliceHouse =>
  centredAt(house, { x_m: house.x_m, z_m: house.z_m });

/** The sectors' features inside the frame, in frame metres, with their ids. O(features). */
export function featuresInFrame(sectors: Sector[], frame: Frame): FrameFeatures {
  return {
    houses: sectors.flatMap((sector) => within(sector.houses, frame, centredAt)),
    berths: sectors.flatMap((sector) => within(sector.berths, frame, moved)),
    trees: sectors.flatMap((sector) => within(sector.trees, frame, moved)),
  };
}
