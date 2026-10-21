/**
 * A diorama slice from the surface classes: a coarse height field and a stylised ground albedo.
 * The albedo is painted from classes with the design palette and value noise. It never copies
 * the source artwork's pixels. Pure.
 */
import type { RasterSize } from './raster/raster-ops.ts';
import { Surface } from './raster/surface.ts';

type Rgb = [number, number, number];
export type SliceSpec = {
  classes: Uint8Array;
  size: RasterSize;
  /** Source pixels per height-field cell. */
  cellPx: number;
  seed: number;
};

/** Heights in metres above the water plane. */
export const HEIGHT_M = { land: 1, pier: 0.8, seabed: -2.5 } as const;

/** Ground palette, warm dusk tones from the "Farol en la niebla" design canvas. */
const ALBEDO: Record<number, Rgb> = {
  [Surface.Street]: [122, 112, 98],
  [Surface.Ground]: [104, 88, 70],
  [Surface.Roof]: [86, 74, 62],
  [Surface.RedRoof]: [86, 74, 62],
  [Surface.Outline]: [86, 74, 62],
  [Surface.Garden]: [92, 112, 70],
  [Surface.Pier]: [96, 70, 48],
  [Surface.Water]: [24, 52, 60],
};
/** ± variation of the value noise on every channel. */
const NOISE_AMPLITUDE = 14;
const NOISE_CELL_PX = 6;

function hash(x: number, y: number, seed: number): number {
  let value = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2246822519);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 2 ** 32;
}

type Lattice = {
  cell: number;
  seed: number;
};
type Point = {
  x: number;
  y: number;
};

/** Smooth value noise in [0, 1) on a lattice of `cell` pixels. */
function valueNoise(point: Point, lattice: Lattice): number {
  const { x, y } = point;
  const { cell, seed } = lattice;
  const gx = Math.floor(x / cell);
  const gy = Math.floor(y / cell);
  const fx = x / cell - gx;
  const fy = y / cell - gy;
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const top = hash(gx, gy, seed) + (hash(gx + 1, gy, seed) - hash(gx, gy, seed)) * smooth(fx);
  const bottom = hash(gx, gy + 1, seed)
    + (hash(gx + 1, gy + 1, seed) - hash(gx, gy + 1, seed)) * smooth(fx);
  return top + (bottom - top) * smooth(fy);
}

/** Stylised RGB albedo at the source resolution. O(pixels). */
export function paintAlbedo(spec: SliceSpec): Uint8Array {
  const { classes, size, seed } = spec;
  const rgb = new Uint8Array(classes.length * 3);
  for (let index = 0; index < classes.length; index += 1) {
    const x = index % size.width;
    const y = Math.floor(index / size.width);
    const noise = valueNoise({ x, y }, { cell: NOISE_CELL_PX, seed });
    const shade = (noise - 0.5) * 2 * NOISE_AMPLITUDE;
    const base = ALBEDO[classes[index]] ?? ALBEDO[Surface.Ground];
    for (let channel = 0; channel < 3; channel += 1) {
      rgb[index * 3 + channel] = Math.max(0, Math.min(255, Math.round(base[channel] + shade)));
    }
  }
  return rgb;
}

type Cell = {
  column: number;
  row: number;
};

function cellHeight(spec: SliceSpec, cell: Cell) {
  const { classes, size, cellPx } = spec;
  const { column, row } = cell;
  let water = 0;
  let pier = 0;
  let total = 0;
  for (let y = row * cellPx; y < Math.min(size.height, (row + 1) * cellPx); y += 1) {
    for (let x = column * cellPx; x < Math.min(size.width, (column + 1) * cellPx); x += 1) {
      const value = classes[y * size.width + x];
      if (value === Surface.Water) water += 1;
      else if (value === Surface.Pier) pier += 1;
      total += 1;
    }
  }
  if (water * 2 > total) return HEIGHT_M.seabed;
  return pier * 2 > total ? HEIGHT_M.pier : HEIGHT_M.land;
}

/** Height field with one value per cell, row-major. O(pixels). */
export function heightField(spec: SliceSpec) {
  const { size, cellPx } = spec;
  const columns = Math.ceil(size.width / cellPx);
  const rows = Math.ceil(size.height / cellPx);
  const heights = new Float32Array(columns * rows);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      heights[row * columns + column] = cellHeight(spec, { column, row });
    }
  }
  return { columns, rows, heights };
}
