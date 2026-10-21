// Where the camera rests for each zoom level and the path of the intro flight. Pure data from
// the city plan, so the viewer only eases toward whatever these return.

import type { IntroKey, Rig, Vec3Like } from '../math/camera-rig.ts';
import type { Point2 } from '../math/hex.ts';
import type { DistrictSeed } from '../plan/test-city.ts';

export type Level = 0 | 1 | 2;

export interface GoalContext {
  /** Centre of the scene deck, with its height. */
  spot: Point2 & { y: number };
  /** Districts of the city, for the district level. */
  districts: readonly DistrictSeed[];
  district: string;
  /** Position of the piece whose turn it is, if any. */
  focus: Vec3Like | null;
}

/** Fraction of the way from the deck centre toward the active piece. */
const FOCUS_PULL = 0.35;

function cityGoal(azimuth: number): Rig {
  return { target: { x: 0, y: 0, z: -4 }, radius: 118, polar: 0.98, azimuth };
}

function districtGoal(context: GoalContext, azimuth: number): Rig {
  const { districts, district } = context;
  const seed = districts.find((d) => d.id === district) ?? districts[0];
  return {
    target: { x: seed.center.x, y: 2, z: seed.center.z },
    radius: 48,
    polar: 1.02,
    azimuth,
  };
}

function sceneGoal(context: GoalContext, azimuth: number): Rig {
  const { spot, focus } = context;
  const x = focus ? focus.x * FOCUS_PULL + spot.x * (1 - FOCUS_PULL) : spot.x;
  const z = focus ? focus.z * FOCUS_PULL + spot.z * (1 - FOCUS_PULL) : spot.z;
  return { target: { x, y: spot.y + 1.3, z }, radius: 16, polar: 1.22, azimuth };
}

export function levelGoal(level: Level, context: GoalContext, azimuth: number): Rig {
  if (level === 0) return cityGoal(azimuth);
  if (level === 1) return districtGoal(context, azimuth);
  return sceneGoal(context, azimuth);
}

/** Low over the water toward the harbour, then up to the whole city. */
export function introKeys(spot: Point2, azimuth: number): IntroKey[] {
  const { x, z } = spot;
  return [
    { at: 0, target: { x: x - 4, y: 1.2, z: z + 26 }, radius: 34, polar: 1.42, azimuth: -0.35 },
    { at: 3.6, target: { x, y: 1.6, z: z + 6 }, radius: 30, polar: 1.26, azimuth: -0.15 },
    { at: 8.2, ...cityGoal(azimuth) },
  ];
}
