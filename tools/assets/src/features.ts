/**
 * Point features of a slice, read from its surface classes: berths where ships moor alongside
 * piers, and trees in gardens. Pixel coordinates, which the export CLI converts to metres.
 */
import { between, mulberry32 } from './random.ts';
import type { RasterSize } from './raster/raster-ops.ts';
import { Surface } from './raster/surface.ts';
import { boxAround, SpatialGrid, type Box } from './spatial.ts';

export type Berth = {
  x_px: number;
  y_px: number;
  /** Keel direction for a rotation about +Y: local +Z maps to (sin θ, cos θ) in plan. */
  heading_radians: number;
};

export type Tree = {
  x_px: number;
  y_px: number;
  scale: number;
};

/** A caravel at z18: about 22 m long and 6.5 m in the beam, 26 m between moored bows. */
export const CARAVEL_Z18 = { lengthPx: 48, beamPx: 14, spacingPx: 56 } as const;
/** One tree per 12 px (about 5.6 m) square of garden at most. */
export const ORCHARD_Z18 = { spacingPx: 12 } as const;

export type ShipSpec = {
  lengthPx: number;
  beamPx: number;
  spacingPx: number;
  seed: number;
};

export type TreeSpec = {
  spacingPx: number;
  seed: number;
};

type Grid = {
  classes: Uint8Array;
  size: RasterSize;
};
type Hull = {
  x: number;
  y: number;
  /** Unit vector from the pier toward the ship. */
  out: [number, number];
};

const NEIGHBOURS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** Radius of the window that estimates a pier edge's outward normal. */
const NORMAL_RADIUS_PX = 6;
/** Gap between the pier edge and the hull. */
const FENDER_PX = 1;
const HULL_STEP_PX = 2;
/** Share of the hull's length that must lie alongside the pier. */
const ALONGSIDE_SHARE = 0.5;
/** Hulls further apart across the keel than this many beams never clash. */
const ABREAST_BEAMS = 1.5;
const TREE_SCALE: [number, number] = [0.8, 1.3];

function surfaceAt(grid: Grid, x: number, y: number): number {
  const column = Math.floor(x);
  const row = Math.floor(y);
  const { width, height } = grid.size;
  if (column < 0 || row < 0 || column >= width || row >= height) return -1;
  return grid.classes[row * width + column];
}

/** Samples along the keel, from bow to stern, inclusive. */
function keelSamples(lengthPx: number): number[] {
  const samples: number[] = [];
  for (let t = -lengthPx / 2; t < lengthPx / 2; t += HULL_STEP_PX) samples.push(t);
  samples.push(lengthPx / 2);
  return samples;
}

/** Whole hull on water, and the pier along at least half of its pierside flank. */
function mooringFits(grid: Grid, hull: Hull, ship: ShipSpec): boolean {
  const [ox, oy] = hull.out;
  const [ax, ay] = [-oy, ox];
  const half = ship.beamPx / 2;
  const keel = keelSamples(ship.lengthPx);
  let alongside = 0;
  for (const t of keel) {
    for (const s of [-half, 0, half]) {
      const x = hull.x + ax * t + ox * s;
      const y = hull.y + ay * t + oy * s;
      if (surfaceAt(grid, x, y) !== Surface.Water) return false;
    }
    const flank = -(half + FENDER_PX + 1);
    const pier = surfaceAt(grid, hull.x + ax * t + ox * flank, hull.y + ay * t + oy * flank);
    if (pier === Surface.Pier) alongside += 1;
  }
  return alongside >= keel.length * ALONGSIDE_SHARE;
}

/** Outward normal of the pier edge at (x, y): the mean offset of the water around it. */
function edgeNormal(grid: Grid, x: number, y: number): [number, number] | null {
  let nx = 0;
  let ny = 0;
  const r = NORMAL_RADIUS_PX;
  for (let dy = -r; dy <= r; dy += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      const inside = dx * dx + dy * dy <= r * r;
      if (inside && surfaceAt(grid, x + dx, y + dy) === Surface.Water) {
        nx += dx;
        ny += dy;
      }
    }
  }
  const length = Math.hypot(nx, ny);
  return length > 0 ? [nx / length, ny / length] : null;
}

/** The hull moored off the pier edge pixel at `index`, if that pixel touches water. */
function hullAt(grid: Grid, index: number, ship: ShipSpec): Hull | null {
  const x = (index % grid.size.width) + 0.5;
  const y = Math.floor(index / grid.size.width) + 0.5;
  const wet = NEIGHBOURS.some(([dx, dy]) => surfaceAt(grid, x + dx, y + dy) === Surface.Water);
  const out = wet ? edgeNormal(grid, x, y) : null;
  if (!out) return null;
  const offset = ship.beamPx / 2 + FENDER_PX;
  return { x: x + out[0] * offset, y: y + out[1] * offset, out };
}

/** Two moored hulls clash when they are both within `spacingPx` along the keel and abreast. */
function clashes(hull: Hull, other: Hull, ship: ShipSpec): boolean {
  const [ox, oy] = other.out;
  const dx = hull.x - other.x;
  const dy = hull.y - other.y;
  const along = Math.abs(dx * -oy + dy * ox);
  const across = Math.abs(dx * ox + dy * oy);
  return along < ship.spacingPx && across < ship.beamPx * ABREAST_BEAMS;
}

/** No hull clashes with one farther than this: the corner of the keel-by-abreast rectangle. */
const clashReach = (ship: ShipSpec) => Math.hypot(ship.spacingPx, ship.beamPx * ABREAST_BEAMS);

/**
 * Keeps hulls in order unless one already kept clashes. Kept hulls sit in a grid one clash reach
 * wide, so each is tested against its neighbours only. O(hulls · neighbours).
 */
function spaced(hulls: Hull[], ship: ShipSpec): Hull[] {
  const reach = clashReach(ship);
  const grid = new SpatialGrid(reach);
  const chosen: Hull[] = [];
  for (const hull of hulls) {
    const around: Box = { min: [hull.x - reach, hull.y - reach],
      max: [hull.x + reach, hull.y + reach] };
    const clash = [...grid.near(around)].some((other) => clashes(hull, chosen[other], ship));
    if (clash) continue;
    grid.insert(boxAround([[hull.x, hull.y]]), chosen.length);
    chosen.push(hull);
  }
  return chosen;
}

function shuffle<T>(items: T[], random: () => number): T[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [items[index], items[other]] = [items[other], items[index]];
  }
  return items;
}

/** Ships alongside pier edges, `spacingPx` apart along the keel. O(pier edge · hull samples). */
export function findBerths(classes: Uint8Array, size: RasterSize, ship: ShipSpec): Berth[] {
  const grid = { classes, size };
  const fits: Hull[] = [];
  classes.forEach((surface, index) => {
    const hull = surface === Surface.Pier ? hullAt(grid, index, ship) : null;
    if (hull && mooringFits(grid, hull, ship)) fits.push(hull);
  });
  const random = mulberry32(ship.seed);
  const chosen = spaced(shuffle(fits, random), ship);
  return chosen.map(({ x, y, out }) => ({
    x_px: x,
    y_px: y,
    heading_radians: Math.atan2(-out[1], out[0]) + (random() < 0.5 ? Math.PI : 0),
  }));
}

/** One tree per jittered grid cell whose random point falls on a garden. O(pixels / spacing²). */
export function plantTrees(classes: Uint8Array, size: RasterSize, spec: TreeSpec): Tree[] {
  const grid = { classes, size };
  const random = mulberry32(spec.seed);
  const trees: Tree[] = [];
  for (let top = 0; top < size.height; top += spec.spacingPx) {
    for (let left = 0; left < size.width; left += spec.spacingPx) {
      const x = left + random() * spec.spacingPx;
      const y = top + random() * spec.spacingPx;
      const scale = between(random, TREE_SCALE);
      if (surfaceAt(grid, x, y) === Surface.Garden) trees.push({ x_px: x, y_px: y, scale });
    }
  }
  return trees;
}

export type ClassRaster = {
  classes: Uint8Array;
  size: RasterSize;
};

/**
 * Berths for z18 caravels and garden trees, in map metres. Both exporters write features this
 * way, so a slice and the city's sectors agree. O(pier edge · hull samples + pixels / spacing²).
 */
export function featuresInMetres(raster: ClassRaster, metresPerPixel: number, seed: number) {
  const { classes, size } = raster;
  const berths = findBerths(classes, size, { ...CARAVEL_Z18, seed }).map((berth) => ({
    x_m: berth.x_px * metresPerPixel,
    z_m: berth.y_px * metresPerPixel,
    heading_radians: berth.heading_radians,
  }));
  const trees = plantTrees(classes, size, { ...ORCHARD_Z18, seed }).map((tree) => ({
    x_m: tree.x_px * metresPerPixel,
    z_m: tree.y_px * metresPerPixel,
    scale: tree.scale,
  }));
  return { berths, trees };
}
