// What each house looks like, decided from its data and a seed. Pure, so it is tested without a
// GPU: storeys, jettied upper floors, roof type, dormer, chimney, and notable buildings, which
// the source map marks with red roofs.

import { createRandom } from '../engine/math/rng.ts';
import type { SliceHouse } from './slice-data.ts';

export const STOREY_M = 3.1;
const MAX_STOREYS = 4;
/** Upper floors of a timber house project this far over the street. */
const JETTY_M = 0.45;
const JETTY_SHARE = 0.55;
const HIP_SHARE = 0.3;
const STONE_SHARE = 0.22;
const CHIMNEY_SHARE = 0.55;
const DORMER_SHARE = 0.5;
/** Red over green and over blue on the sampled roof: the map's mark for notable buildings. */
const NOTABLE_RED_MARGIN = 45;

export type RoofType = 'gable' | 'hip';

export interface HousePlan {
  storeys: number;
  wallHeight: number;
  stone: boolean;
  jetty: number;
  roof: RoofType;
  dormer: boolean;
  chimney: boolean;
  notable: boolean;
}

function isNotable([r, g, b]: [number, number, number]): boolean {
  return r > g + NOTABLE_RED_MARGIN && r > b + NOTABLE_RED_MARGIN;
}

const storeysOf = (height: number) =>
  Math.min(MAX_STOREYS, Math.max(1, Math.round(height / STOREY_M)));

export function planHouse(house: SliceHouse, seed: number): HousePlan {
  const random = createRandom(seed);
  const notable = isNotable(house.roof_rgb);
  const storeys = Math.min(MAX_STOREYS, storeysOf(house.height_m) + (notable ? 1 : 0));
  const stone = notable || random() < STONE_SHARE;
  const roof: RoofType = notable || random() < HIP_SHARE ? 'hip' : 'gable';
  const jetty = !stone && storeys >= 2 && random() < JETTY_SHARE ? JETTY_M : 0;
  return {
    storeys,
    wallHeight: storeys * STOREY_M,
    stone,
    jetty,
    roof,
    dormer: roof === 'hip' && random() < DORMER_SHARE,
    chimney: random() < CHIMNEY_SHARE,
    notable,
  };
}
