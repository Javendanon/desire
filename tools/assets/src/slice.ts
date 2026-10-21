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

/**
 * Ground palette: muted stone and earth. The golden-hour sun warms everything already, so the
 * albedo stays close to neutral (warm albedo under a warm sun reads orange).
 */
const ALBEDO: Record<number, Rgb> = {
  [Surface.Street]: [118, 114, 106],
  [Surface.Ground]: [100, 92, 80],
  [Surface.Roof]: [88, 80, 70],
  [Surface.RedRoof]: [88, 80, 70],
  [Surface.Outline]: [88, 80, 70],
  [Surface.Garden]: [86, 104, 66],
  [Surface.Pier]: [92, 82, 70],
  [Surface.Water]: [22, 50, 58],
};
const SHALLOW: Rgb = [62, 120, 118];
const FOAM: Rgb = [186, 204, 206];
/** Shallows fade over this many source pixels (about 19 m at z18). */
const SHALLOW_PX = 40;
const FOAM_PX = 2;
const UNREACHED = 0xffff;
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

/** One sweep of a two-pass city-block distance transform. */
function sweep(distance: Uint16Array, size: RasterSize, forward: boolean) {
  const { width } = size;
  const order = forward ? 1 : -1;
  const start = forward ? 0 : distance.length - 1;
  for (let step = 0; step < distance.length; step += 1) {
    const index = start + step * order;
    const x = index % width;
    const behindX = x - order >= 0 && x - order < width ? distance[index - order] : UNREACHED;
    const behindY = index - order * width;
    const above = behindY >= 0 && behindY < distance.length ? distance[behindY] : UNREACHED;
    distance[index] = Math.min(distance[index], behindX + 1, above + 1);
  }
}

/** City-block pixels from each water pixel to the nearest non-water pixel, 0 on land. O(pixels). */
export function shoreDistance(classes: Uint8Array, size: RasterSize): Uint16Array {
  const distance = Uint16Array.from(classes, (value) => (value === Surface.Water ? UNREACHED : 0));
  sweep(distance, size, true);
  sweep(distance, size, false);
  return distance;
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => a.map((value, index) =>
  value + (b[index] - value) * t) as Rgb;

/** Deep water, shallows toward the shore, foam at the waterline. */
function waterColour(distance: number): Rgb {
  if (distance <= FOAM_PX) return FOAM;
  const shallow = Math.max(0, 1 - distance / SHALLOW_PX);
  return mix(ALBEDO[Surface.Water], SHALLOW, shallow * shallow);
}

/** Stylised RGB albedo at the source resolution. O(pixels). */
export function paintAlbedo(spec: SliceSpec): Uint8Array {
  const { classes, size, seed } = spec;
  const shore = shoreDistance(classes, size);
  const rgb = new Uint8Array(classes.length * 3);
  for (let index = 0; index < classes.length; index += 1) {
    const x = index % size.width;
    const y = Math.floor(index / size.width);
    const noise = valueNoise({ x, y }, { cell: NOISE_CELL_PX, seed });
    const shade = (noise - 0.5) * 2 * NOISE_AMPLITUDE;
    const water = classes[index] === Surface.Water;
    const land = ALBEDO[classes[index]] ?? ALBEDO[Surface.Ground];
    const base = water ? waterColour(shore[index]) : land;
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
