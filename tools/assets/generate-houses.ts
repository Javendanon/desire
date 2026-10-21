#!/usr/bin/env node
/**
 * CLI: fill the traced blocks of a region with houses. Houses stand only where the source map
 * draws roofs, take their roof colour from the raster underneath and a height within the given
 * range. Writes houses in world metres (x east, z south from the raster's north-west corner).
 */
import fs from 'node:fs';

import sharp from 'sharp';

import { readFlags } from './src/flags.ts';
import { footprintCorners, footprintPoint } from './src/footprint.ts';
import { placeHouses, type House } from './src/lots.ts';
import { between, mulberry32 } from './src/random.ts';
import { simplifyRing } from './src/raster/simplify.ts';
import { Surface } from './src/raster/surface.ts';
import type { Plan } from './src/types.ts';

const EXIT_FAIL = 2;
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

type Region = [number, number, number, number];
type Options = {
  blocks: string;
  classes: string;
  map: string;
  region: Region;
  heights: [number, number];
  out: string;
};
type BlockJson = {
  id: number;
  outer: [number, number][];
  holes: [number, number][][];
};
type Raster = {
  rgb: Uint8Array;
  classes: Uint8Array;
  width: number;
  height: number;
  metresPerPixel: number;
};

function parseOptions(argv: string[]): Options {
  const { need, numbers } = readFlags(argv);
  return {
    blocks: need('--blocks'), classes: need('--classes'), map: need('--map'),
    region: numbers('--region', 4) as Region, heights: numbers('--heights', 2) as [number, number],
    out: need('--out'),
  };
}

const toPlan = ([x_m, z_m]: [number, number]): Plan => ({ x_m, z_m });
const lotRing = (ring: [number, number][]) =>
  simplifyRing(ring, LOT_OUTLINE_TOLERANCE_M).map(toPlan);

function pixelOf(raster: Raster, point: Plan) {
  const x = Math.round(point.x_m / raster.metresPerPixel);
  const y = Math.round(point.z_m / raster.metresPerPixel);
  if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) return -1;
  return y * raster.width + x;
}

function isBuilt(raster: Raster) {
  return (point: Plan) => {
    const index = pixelOf(raster, point);
    return index >= 0 && BUILT.has(raster.classes[index]);
  };
}

/** Mean raster colour over a 3 × 3 grid inside the footprint. */
function roofColour(raster: Raster, house: House): [number, number, number] {
  const corners = footprintCorners({
    center: house.center, width_m: house.width_m, depth_m: house.depth_m,
    rotation_radians: house.rotation_radians,
  });
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

function inRegion(raster: Raster, region: Region) {
  const [left, top, width, height] = region;
  return (point: Plan) => {
    const x = point.x_m / raster.metresPerPixel;
    const y = point.z_m / raster.metresPerPixel;
    return x >= left && y >= top && x < left + width && y < top + height;
  };
}

async function readRaster(options: Options, metresPerPixel: number): Promise<Raster> {
  const { data, info } = await sharp(options.map, { limitInputPixels: false })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const classes = new Uint8Array(fs.readFileSync(options.classes));
  if (classes.length !== info.width * info.height) {
    throw new Error(`classes hold ${classes.length} pixels, the map ${info.width * info.height}`);
  }
  const { width, height } = info;
  return { rgb: new Uint8Array(data), classes, width, height, metresPerPixel };
}

function housesOf(raster: Raster, block: BlockJson, options: Options) {
  const shape = { outer: lotRing(block.outer), holes: block.holes.map(lotRing) };
  const seed = SEED_BASE + block.id;
  const rules = { frontage: FRONTAGE_M, depth: DEPTH_M, seed, isBuilt: isBuilt(raster) };
  const random = mulberry32(SEED_BASE ^ block.id);
  return placeHouses(shape, rules).map((house) => ({
    ...house,
    height_m: Math.round(between(random, options.heights) * 10) / 10,
    roof_rgb: roofColour(raster, house),
    block: block.id,
  }));
}

async function main(argv: string[]) {
  const options = parseOptions(argv);
  const layer = JSON.parse(fs.readFileSync(options.blocks, 'utf8'));
  const raster = await readRaster(options, layer.metres_per_pixel);
  const inside = inRegion(raster, options.region);
  const blocks = (layer.blocks as BlockJson[]).filter((block) =>
    block.outer.some((point) => inside(toPlan(point))));
  const houses = blocks.flatMap((block) => housesOf(raster, block, options))
    .filter((house) => inside(house.center));
  const out = { metres_per_pixel: layer.metres_per_pixel, houses };
  fs.writeFileSync(options.out, `${JSON.stringify(out)}\n`);
  console.log(`${options.out}: ${houses.length} houses in ${blocks.length} blocks`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(`generate-houses: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = EXIT_FAIL;
});
