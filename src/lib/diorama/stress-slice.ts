// Stress mode for performance work (`?stress=5x4`): the slice repeated in a grid over an area the
// size of the whole city, so frame cost can be measured at city scale before the city's data
// exists. Houses, berths, trees and height cells are offset per tile; the terrain is drawn once
// per tile from the source slice. Pure.

import type { Slice, SliceMeta } from './slice-data.ts';

export interface StressGrid {
  columns: number;
  rows: number;
}

export interface TileOffset {
  x_m: number;
  z_m: number;
}

export interface TiledSlice {
  slice: Slice;
  source: Slice;
  offsets: TileOffset[];
}

const STRESS_PATTERN = /^(\d+)x(\d+)$/;

/** `5x4` → five columns by four rows. Null when absent or malformed. */
export function parseStress(value: string | null): StressGrid | null {
  const match = value ? STRESS_PATTERN.exec(value) : null;
  if (!match) return null;
  const [columns, rows] = [Number(match[1]), Number(match[2])];
  return columns > 0 && rows > 0 ? { columns, rows } : null;
}

function tileHeights(source: Slice, grid: StressGrid): Float32Array {
  const { columns, rows } = source.meta;
  const width = columns * grid.columns;
  const heights = new Float32Array(width * rows * grid.rows);
  for (let row = 0; row < rows * grid.rows; row += 1) {
    const from = (row % rows) * columns;
    for (let tile = 0; tile < grid.columns; tile += 1) {
      heights.set(source.heights.subarray(from, from + columns), row * width + tile * columns);
    }
  }
  return heights;
}

const shifted = <T extends { x_m: number, z_m: number }>(item: T, offset: TileOffset): T =>
  ({ ...item, x_m: item.x_m + offset.x_m, z_m: item.z_m + offset.z_m });

/** O(houses · tiles + cells · tiles). */
export function tileSlice(source: Slice, grid: StressGrid): TiledSlice {
  const { meta } = source;
  const offsets: TileOffset[] = [];
  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      offsets.push({ x_m: column * meta.width_m, z_m: row * meta.depth_m });
    }
  }
  const tiledMeta: SliceMeta = {
    ...meta,
    width_m: meta.width_m * grid.columns,
    depth_m: meta.depth_m * grid.rows,
    columns: meta.columns * grid.columns,
    rows: meta.rows * grid.rows,
  };
  const houses = offsets.flatMap((offset) => source.houses.map((house) =>
    ({ ...house, center: shifted(house.center, offset) })));
  const features = {
    berths: offsets.flatMap((offset) => source.features.berths.map((b) => shifted(b, offset))),
    trees: offsets.flatMap((offset) => source.features.trees.map((t) => shifted(t, offset))),
  };
  const heights = tileHeights(source, grid);
  const slice = { ...source, meta: tiledMeta, heights, houses, features };
  return { slice, source, offsets };
}
