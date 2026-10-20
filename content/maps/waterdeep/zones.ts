// Ward zones for the scene. The boxes and centres are D05 calibration aids; density, colour and
// height ranges are D13's interpreted facades. Heights are never read from the source.

import type { Point2 } from '../../../src/lib/engine/math/hex.ts';
import type { SectorBounds } from '../../../src/lib/engine/plan/sectors.ts';
import { planMeters, WATERDEEP_REFERENCE } from './reference.ts';

export type ZoneKind = 'buildings' | 'tombs' | 'fields';

export interface ZoneProfile {
  /** Ground and roof tint multiplied over the procedural textures. */
  tint: string;
  /** Share of lots that keep a building. The rest stay as yards and small squares. */
  density: number;
  minHeight: number;
  maxHeight: number;
  /** Share of stone houses over timber-framed ones. */
  stone: number;
  /** Index into the renderer's roof palette. */
  roofTone: number;
  kind: ZoneKind;
}

export interface WaterdeepZone extends ZoneProfile {
  id: string;
  name: string;
  center: Point2;
  bounds: SectorBounds;
  readonly heightSource: 'interpreted';
}

/**
 * Interpreted urban character per D05 ward. Only the density order is grounded in the source
 * description (Dock Ward dense and low, Sea Ward tall stone), the metres are artistic choices.
 */
const PROFILES: Record<string, ZoneProfile> = {
  'Field Ward': {
    tint: '#8f9772', density: 0.3, minHeight: 5, maxHeight: 10,
    stone: 0.1, roofTone: 5, kind: 'fields',
  },
  'Castle Ward': {
    tint: '#c4bdb0', density: 0.78, minHeight: 9, maxHeight: 20,
    stone: 0.8, roofTone: 0, kind: 'buildings',
  },
  'Dock Ward': {
    tint: '#ad9b85', density: 0.86, minHeight: 5, maxHeight: 12,
    stone: 0.15, roofTone: 2, kind: 'buildings',
  },
  'North Ward': {
    tint: '#c2b39b', density: 0.74, minHeight: 10, maxHeight: 22,
    stone: 0.6, roofTone: 3, kind: 'buildings',
  },
  'Sea Ward': {
    tint: '#b8bbbf', density: 0.7, minHeight: 12, maxHeight: 26,
    stone: 0.9, roofTone: 1, kind: 'buildings',
  },
  'Southern Ward': {
    tint: '#c0a784', density: 0.7, minHeight: 6, maxHeight: 13,
    stone: 0.3, roofTone: 4, kind: 'buildings',
  },
  'Trades Ward': {
    tint: '#c8ad8d', density: 0.8, minHeight: 7, maxHeight: 16,
    stone: 0.35, roofTone: 3, kind: 'buildings',
  },
  'City of the Dead': {
    tint: '#8d9a76', density: 0.1, minHeight: 1.2, maxHeight: 2.2,
    stone: 1, roofTone: 5, kind: 'tombs',
  },
};

export function zoneId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function zoneBounds(name: string): SectorBounds {
  const ward = WATERDEEP_REFERENCE.wards.find((entry) => entry.name === name);
  if (!ward) throw new Error(`waterdeep zones: D05 has no ward named "${name}"`);
  const scale = WATERDEEP_REFERENCE.calibration.meters_per_pixel;
  const northWest = planMeters({ x: ward.bbox_pixel.min_x, y: ward.bbox_pixel.min_y }, scale);
  const southEast = planMeters({ x: ward.bbox_pixel.max_x, y: ward.bbox_pixel.max_y }, scale);
  return { minX: northWest.x_m, minZ: northWest.z_m, maxX: southEast.x_m, maxZ: southEast.z_m };
}

function zoneCenter(name: string): Point2 {
  const ward = WATERDEEP_REFERENCE.wards.find((entry) => entry.name === name);
  if (!ward) throw new Error(`waterdeep zones: D05 has no ward named "${name}"`);
  return { x: ward.centroid_plan_m.x_m, z: ward.centroid_plan_m.z_m };
}

export const WATERDEEP_ZONES: readonly WaterdeepZone[] = WATERDEEP_REFERENCE.wards.map((ward) => {
  const profile = PROFILES[ward.name];
  if (!profile) throw new Error(`waterdeep zones: no interpreted profile for "${ward.name}"`);
  return {
    id: zoneId(ward.name),
    name: ward.name,
    center: zoneCenter(ward.name),
    bounds: zoneBounds(ward.name),
    heightSource: 'interpreted' as const,
    ...profile,
  };
});

export function zoneForWard(ward: string | null): WaterdeepZone | null {
  if (!ward) return null;
  return WATERDEEP_ZONES.find((zone) => zone.name === ward) ?? null;
}
