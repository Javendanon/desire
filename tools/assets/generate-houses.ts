#!/usr/bin/env node
/**
 * CLI: fill the traced blocks of a region with houses (src/houses.ts) and write them in world
 * metres (x east, z south from the raster's north-west corner).
 */
import fs from 'node:fs';

import sharp from 'sharp';

import { readFlags } from './src/flags.ts';
import {
  generateHouses, housesJson, type BlocksLayer, type HouseRaster, type Region,
} from './src/houses.ts';

const EXIT_FAIL = 2;

type Options = {
  blocks: string;
  classes: string;
  map: string;
  region: Region;
  heights: [number, number];
  out: string;
};

function parseOptions(argv: string[]): Options {
  const { need, numbers } = readFlags(argv);
  return {
    blocks: need('--blocks'), classes: need('--classes'), map: need('--map'),
    region: numbers('--region', 4) as Region, heights: numbers('--heights', 2) as [number, number],
    out: need('--out'),
  };
}

async function readRaster(options: Options, metresPerPixel: number): Promise<HouseRaster> {
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

async function main(argv: string[]) {
  const options = parseOptions(argv);
  const layer = JSON.parse(fs.readFileSync(options.blocks, 'utf8')) as BlocksLayer;
  const raster = await readRaster(options, layer.metres_per_pixel);
  const houses = generateHouses(raster, layer, options);
  fs.writeFileSync(options.out, housesJson(houses, layer.metres_per_pixel));
  console.log(`${options.out}: ${houses.length} houses`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(`generate-houses: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = EXIT_FAIL;
});
