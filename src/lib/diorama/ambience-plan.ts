// Where and how the slice's ambience moves, without a GPU: the life of a chimney smoke puff, the
// doors that carry a lantern, and the water cells that host drifting fog banks.

import { createRandom } from '../engine/math/rng.ts';

/** A puff climbs this far over its life. */
const PUFF_RISE_M = 7;
const PUFF_SIZE_M = 3.4;
/** Sideways drift per metre of rise: a light sea breeze. */
const WIND_SLANT = 0.55;
/** Shapes the fade: below 1 the puff stays full for most of its life. */
const PUFF_FADE_EXPONENT = 0.6;

export interface Puff {
  rise: number;
  drift: number;
  size: number;
}

export interface Spot {
  x: number;
  z: number;
}

export interface WaterSpotSpec {
  heights: Float32Array;
  meta: {
    columns: number;
    cell_m: number;
  };
  count: number;
  seed: number;
}

/** A puff at `age` in [0, 1]: it rises steadily, widens, and shrinks away at both ends. */
export function puffAt(age: number): Puff {
  const rise = PUFF_RISE_M * age;
  const alive = age > 0 && age < 1;
  const swell = alive ? Math.sin(Math.PI * age) ** PUFF_FADE_EXPONENT : 0;
  return { rise, drift: rise * WIND_SLANT, size: PUFF_SIZE_M * (0.35 + age) * swell };
}

export function everyNth<T>(items: readonly T[], step: number): T[] {
  return items.filter((_, index) => index % step === 0);
}

/** Random points inside cells below the waterline (negative height). Empty when none. */
export function waterSpots(spec: WaterSpotSpec): Spot[] {
  const { heights, meta, count, seed } = spec;
  const water: number[] = [];
  heights.forEach((height, index) => {
    if (height < 0) water.push(index);
  });
  if (water.length === 0) return [];
  const random = createRandom(seed);
  return Array.from({ length: count }, () => {
    const cell = water[Math.floor(random() * water.length)];
    const column = cell % meta.columns;
    const row = Math.floor(cell / meta.columns);
    return { x: (column + random()) * meta.cell_m, z: (row + random()) * meta.cell_m };
  });
}
