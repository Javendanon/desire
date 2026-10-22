// Where and how the slice's ambience moves, without a GPU: the life of a chimney smoke puff, the
// doors that carry a lantern and the chimneys that smoke (by house id, so the choice never
// depends on what else is loaded), and the water cells that host drifting fog banks.

import { between, createRandom, shareOf } from '../engine/math/rng.ts';

/** The life of a chimney smoke puff. The vertex shader (shaders.ts) uses these same values. */
export const PUFF = {
  /** A puff climbs this far over its life... */
  riseM: 7,
  sizeM: 3.4,
  lifeS: 9,
  /** ...drifting sideways this much per metre of rise: a light sea breeze... */
  windSlant: 0.55,
  /** ...along this plan direction (onshore, from the sea in the west), normalised. */
  windX: 1 / Math.hypot(1, 0.35),
  windZ: -0.35 / Math.hypot(1, 0.35),
  /** Shapes the fade: below 1 the puff stays full for most of its life. */
  fadeExponent: 0.6,
  /** Size at birth as a share of the full size. */
  birthShare: 0.35,
} as const;

/** Lantern halos: size and flicker. */
export const HALO = {
  sizeM: 2.2,
  flicker: 0.06,
  flickerRate: 7,
  phasePerLantern: 3,
} as const;

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
  /** Any unit: only the sign matters. */
  heights: ArrayLike<number>;
  meta: {
    columns: number;
    cell_m: number;
  };
  count: number;
  seed: number;
}

/** A puff at `age` in [0, 1]: it rises steadily, widens, and shrinks away at both ends. */
export function puffAt(age: number): Puff {
  const rise = PUFF.riseM * age;
  const alive = age > 0 && age < 1;
  const swell = alive ? Math.sin(Math.PI * age) ** PUFF.fadeExponent : 0;
  return { rise, drift: rise * PUFF.windSlant, size: PUFF.sizeM * (PUFF.birthShare + age) * swell };
}

/** Share of street doors that carry a lantern, and of chimneys that smoke. */
const LANTERN_SHARE = 1 / 3;
const SMOKE_SHARE = 0.3;
/** Salts that keep each per-house choice independent of the others. */
const SALT = { lantern: 0x1a73, smoke: 0x5e07, phase: 0x9a5e } as const;

/** Whether a house's street door carries a lantern, chosen by its id. */
export const hasLantern = (id: number) => shareOf(id, SALT.lantern) < LANTERN_SHARE;

/** Whether a house's chimney smokes, and the phase of its puffs in [0, 1), by its id. */
export function chimneySmoke(id: number) {
  return { smokes: shareOf(id, SALT.smoke) < SMOKE_SHARE, phase: shareOf(id, SALT.phase) };
}

/** Indices of the cells below the waterline (negative height). O(cells). */
export function wetCells(heights: ArrayLike<number>): number[] {
  const water: number[] = [];
  for (let index = 0; index < heights.length; index += 1) if (heights[index] < 0) water.push(index);
  return water;
}

/** Random points inside the given wet cells. */
function spotsAmong(water: number[], spec: WaterSpotSpec): Spot[] {
  const { meta, count, seed } = spec;
  if (water.length === 0) return [];
  const random = createRandom(seed);
  return Array.from({ length: count }, () => {
    const cell = water[Math.floor(random() * water.length)];
    const column = cell % meta.columns;
    const row = Math.floor(cell / meta.columns);
    return { x: (column + random()) * meta.cell_m, z: (row + random()) * meta.cell_m };
  });
}

/** Random points inside cells below the waterline (negative height). Empty when none. */
export const waterSpots = (spec: WaterSpotSpec): Spot[] => spotsAmong(wetCells(spec.heights), spec);

/** Height cells where fog may lie (below zero is water), placed at `origin` in map metres. */
export interface WaterField {
  /** Any unit: only the sign matters. */
  heights: ArrayLike<number>;
  meta: {
    columns: number;
    cell_m: number;
  };
  origin: {
    x_m: number;
    z_m: number;
  };
}

/** A fog bank: its centre in map metres, height, extent and sway phase. */
export type FogBank = Spot & {
  y: number;
  width: number;
  depth: number;
  phase: number;
};

/**
 * Open water per fog bank: the Dock Ward slice's 88 000 m² of water held 14 banks, and a
 * streamed sector keeps that density over whatever water it has.
 */
const FOG_WATER_M2_PER_BANK = 6300;
export const FOG_SIZE_M: [number, number] = [70, 170];
const FOG_HEIGHT_M: [number, number] = [2.5, 7];
const FOG_SEED = 0x5e7;

/** A field's seed follows its origin, so its banks stay put whatever else is loaded. */
const seedOf = (water: WaterField) =>
  (FOG_SEED ^ Math.round(water.origin.x_m * 7 + water.origin.z_m * 13)) >>> 0;

/** Fog banks over one field's water, at the slice's density per area. O(cells). */
export function fogBanks(water: WaterField): FogBank[] {
  const seed = seedOf(water);
  const random = createRandom(seed + 1);
  const wet = wetCells(water.heights);
  const count = Math.round((wet.length * water.meta.cell_m ** 2) / FOG_WATER_M2_PER_BANK);
  const spots = spotsAmong(wet, { heights: water.heights, meta: water.meta, count, seed });
  return spots.map((spot) => ({
    x: spot.x + water.origin.x_m,
    z: spot.z + water.origin.z_m,
    y: between(random, ...FOG_HEIGHT_M),
    width: between(random, ...FOG_SIZE_M),
    depth: between(random, ...FOG_SIZE_M) * 0.6,
    phase: random() * Math.PI * 2,
  }));
}
