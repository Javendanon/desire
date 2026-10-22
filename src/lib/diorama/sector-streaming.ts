// What the city viewer keeps loaded and at which detail. Pure: the streamer only turns these
// plans into requests to the Worker and changes to what is on stage.
//
// Sectors within reach of the camera target load nearest first. Loaded ones stay until they fall
// past reach plus a margin (hysteresis), so a camera resting near a boundary does not load and
// drop the same sector over and over.

export interface GridShape {
  columns: number;
  rows: number;
  size_m: number;
}

/** The camera target on the ground plane. */
export interface Target {
  x: number;
  z: number;
}

export interface PlanSpec {
  grid: GridShape;
  loaded: number[];
  target: Target;
  reach_m: number;
}

export interface SectorPlan {
  load: number[];
  unload: number[];
}

/** Loaded sectors are dropped only past this share of reach beyond it. */
const KEEP_MARGIN = 0.5;

/** Distance from the target to the nearest point of a sector's square. */
export function sectorDistance(grid: GridShape, index: number, target: Target): number {
  const x0 = (index % grid.columns) * grid.size_m;
  const z0 = Math.floor(index / grid.columns) * grid.size_m;
  const dx = Math.max(x0 - target.x, 0, target.x - (x0 + grid.size_m));
  const dz = Math.max(z0 - target.z, 0, target.z - (z0 + grid.size_m));
  return Math.hypot(dx, dz);
}

/** Sectors to load (nearest first) and to drop. O(sectors · log sectors). */
export function planSectors(spec: PlanSpec): SectorPlan {
  const loaded = new Set(spec.loaded);
  const all = Array.from({ length: spec.grid.columns * spec.grid.rows }, (_, index) => ({
    index,
    distance: sectorDistance(spec.grid, index, spec.target),
  }));
  const load = all
    .filter(({ index, distance }) => distance <= spec.reach_m && !loaded.has(index))
    .sort((a, b) => a.distance - b.distance || a.index - b.index)
    .map(({ index }) => index);
  const keep = spec.reach_m * (1 + KEEP_MARGIN);
  const far = (index: number) => sectorDistance(spec.grid, index, spec.target) > keep;
  const unload = spec.loaded.filter(far);
  return { load, unload };
}

/** Shadows reach this far from the target, plus a share of the camera distance. */
const SHADOW_REACH_M = 250;
const SHADOW_PER_RADIUS = 0.5;

export interface ShadowSpec {
  /** From the camera target to the sector. */
  distance_m: number;
  /** Camera distance from its target. */
  radius_m: number;
}

/**
 * Whether a sector's houses and ships cast shadows. Far ones would only blur into the shadow
 * map's low texel density at that zoom, yet cost a second draw of every house.
 */
export function castsShadows(spec: ShadowSpec): boolean {
  return spec.distance_m <= SHADOW_REACH_M + spec.radius_m * SHADOW_PER_RADIUS;
}

/** A near sector stays near until it falls past this share of the reach beyond it. */
const DETAIL_KEEP_MARGIN = 0.25;

export type SectorDetail = 'near' | 'far';

export interface DetailSpec extends ShadowSpec {
  current: SectorDetail;
}

/**
 * Full detail within the shadow reach, the far level past it. Near sectors keep their detail a
 * little further, so a camera resting at the boundary does not rebuild them every plan.
 */
export function sectorDetail(spec: DetailSpec): SectorDetail {
  const keep = spec.current === 'near' ? 1 + DETAIL_KEEP_MARGIN : 1;
  const reach = { ...spec, distance_m: spec.distance_m / keep };
  return castsShadows(reach) ? 'near' : 'far';
}
