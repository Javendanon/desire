/**
 * Fills traced blocks with houses. Houses stand only where the source map draws roofs, take
 * their roof colour from the raster underneath and a height within the given range, in world
 * metres (x east, z south from the raster's north-west corner). Pure: the CLI
 * (generate-houses.ts) reads and writes the files. The Rust twin is crates/atlas/src/houses.rs.
 */
import { footprintPoint } from './footprint.ts';
import { placeHouses } from './lots.ts';
import { between, mulberry32 } from './random.ts';
import { simplifyRing } from './raster/simplify.ts';
import { Surface } from './raster/surface.ts';
import { houseId } from './sectors.ts';
import type { Plan } from './types.ts';

/** Tych scale: narrow medieval frontages, deeper plots. */
const FRONTAGE_M: [number, number] = [4.5, 8.5];
const DEPTH_M: [number, number] = [6.5, 11];
const BUILT = new Set<number>([Surface.Roof, Surface.RedRoof, Surface.Outline]);
const SEED_BASE = 0x5eed;
const ROOF_SAMPLES = 9;
/**
 * Lots are laid out along a block outline simplified to ~2.5 m: traced outlines follow every
 * building corner, and sides shorter than one frontage would get no houses.
 */
const LOT_OUTLINE_TOLERANCE_M = 2.5;

/** `left, top, width, height` in source pixels. */
export type Region = [number, number, number, number];

export type BlockJson = {
  id: number;
  outer: [number, number][];
  holes: [number, number][][];
};

/** `blocks.json`: traced blocks in metres. */
export type BlocksLayer = {
  metres_per_pixel: number;
  blocks: BlockJson[];
};

/** The source raster the houses read: classes for built ground, colours for roofs. */
export type HouseRaster = {
  rgb: Uint8Array;
  classes: Uint8Array;
  width: number;
  height: number;
  metresPerPixel: number;
};

export type HouseSpec = {
  region: Region;
  heights: [number, number];
};

const toPlan = ([x_m, z_m]: [number, number]): Plan => ({ x_m, z_m });
const lotRing = (ring: [number, number][]) =>
  simplifyRing(ring, LOT_OUTLINE_TOLERANCE_M).map(toPlan);

function pixelOf(raster: HouseRaster, point: Plan) {
  const x = Math.round(point.x_m / raster.metresPerPixel);
  const y = Math.round(point.z_m / raster.metresPerPixel);
  if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) return -1;
  return y * raster.width + x;
}

function isBuilt(raster: HouseRaster) {
  return (point: Plan) => {
    const index = pixelOf(raster, point);
    return index >= 0 && BUILT.has(raster.classes[index]);
  };
}

/** Mean raster colour over a 3 × 3 grid inside the footprint, from the lot's own corners. */
function roofColour(raster: HouseRaster, corners: Plan[]): [number, number, number] {
  const total = [0, 0, 0];
  let count = 0;
  for (let index = 0; index < ROOF_SAMPLES; index += 1) {
    const u = ((index % 3) + 1) / 4;
    const v = (Math.floor(index / 3) + 1) / 4;
    const pixel = pixelOf(raster, footprintPoint(corners, u, v));
    if (pixel < 0) continue;
    for (let channel = 0; channel < 3; channel += 1) {
      total[channel] += raster.rgb[pixel * 3 + channel];
    }
    count += 1;
  }
  return total.map((sum) => Math.round(sum / Math.max(1, count))) as [number, number, number];
}

function inRegion(raster: HouseRaster, region: Region) {
  const [left, top, width, height] = region;
  return (point: Plan) => {
    const x = point.x_m / raster.metresPerPixel;
    const y = point.z_m / raster.metresPerPixel;
    return x >= left && y >= top && x < left + width && y < top + height;
  };
}

function housesOf(raster: HouseRaster, block: BlockJson, heights: [number, number]) {
  const shape = { outer: lotRing(block.outer), holes: block.holes.map(lotRing) };
  const seed = SEED_BASE + block.id;
  const rules = { frontage: FRONTAGE_M, depth: DEPTH_M, seed, isBuilt: isBuilt(raster) };
  const random = mulberry32(SEED_BASE ^ block.id);
  // The id comes from the lot's place in its block, before the region filter drops any lot.
  return placeHouses(shape, rules).map(({ corners, ...house }, lot) => ({
    ...house,
    height_m: Math.round(between(random, heights) * 10) / 10,
    roof_rgb: roofColour(raster, corners),
    block: block.id,
    id: houseId(block.id, lot),
  }));
}

/** Houses of every block touching the region, kept when their centre is inside it. */
export function generateHouses(raster: HouseRaster, layer: BlocksLayer, spec: HouseSpec) {
  const inside = inRegion(raster, spec.region);
  const blocks = layer.blocks.filter((block) => block.outer.some((point) => inside(toPlan(point))));
  return blocks.flatMap((block) => housesOf(raster, block, spec.heights))
    .filter((house) => inside(house.center));
}

export type GeneratedHouse = ReturnType<typeof generateHouses>[number];

/** The houses layer file, as written. */
export const housesJson = (houses: GeneratedHouse[], metresPerPixel: number) =>
  `${JSON.stringify({ metres_per_pixel: metresPerPixel, houses })}\n`;
