#!/usr/bin/env node
/**
 * CLI: classify the surfaces of a stitched Web Mercator city raster into water, streets, roofs,
 * landmark roofs, outlines, piers, gardens and ground. Streets come from GeoJSON centrelines with
 * widths measured on the raster. Ward polygons bound the city. Writes a debug PNG and a summary.
 * Source rasters and layers stay outside the repository.
 */
import fs from 'node:fs';

import sharp from 'sharp';

import { createMercatorFrame } from './src/raster/frame.ts';
import { fillPolygons } from './src/raster/polygon-fill.ts';
import type { RasterSize } from './src/raster/raster-ops.ts';
import { refineSurfaces } from './src/raster/refine.ts';
import type { RgbRaster } from './src/raster/street-width.ts';
import { classifyRgb, Surface } from './src/raster/surface.ts';
import { measuredStreets, polygonRings, type StreetWidthPolicy } from './src/raster/vectors.ts';

const EXIT_FAIL = 2;
/** Measured on the full raster: the sea is the largest water component by far. */
const MIN_WATER_SHARE_OF_SEA = 0.05;
const STREET_POLICY: StreetWidthPolicy = {
  fallbackPx: { Main: 40, Major: 30, Minor: 20 },
  defaultPx: 20,
  minPx: 6,
  maxPx: 90,
};
const PALETTE: Record<number, [number, number, number]> = {
  [Surface.Ground]: [214, 196, 160],
  [Surface.Water]: [70, 140, 170],
  [Surface.Roof]: [150, 90, 60],
  [Surface.Street]: [240, 240, 232],
  [Surface.Outline]: [20, 20, 20],
  [Surface.RedRoof]: [220, 60, 40],
  [Surface.Pier]: [95, 60, 140],
  [Surface.Garden]: [120, 170, 90],
};

type Crop = [number, number, number, number];
type Options = {
  map: string;
  streets: string;
  wards: string;
  zoom: number;
  west: number;
  north: number;
  crop?: Crop;
  out: string;
  pierRadius?: number;
};

function flagValues(argv: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index + 1 < argv.length; index += 2) values.set(argv[index], argv[index + 1]);
  return values;
}

function parseCrop(text: string | undefined): Crop | undefined {
  if (text === undefined) return undefined;
  const crop = text.split(',').map(Number);
  if (crop.length !== 4 || crop.some((value) => !Number.isFinite(value))) {
    throw new Error('--crop must be left,top,width,height');
  }
  return crop as Crop;
}

function parseOptions(argv: string[]): Options {
  const values = flagValues(argv);
  const need = (flag: string) => {
    const value = values.get(flag);
    if (value === undefined) throw new Error(`missing ${flag}`);
    return value;
  };
  const radius = values.get('--pier-radius');
  return {
    map: need('--map'), streets: need('--streets'), wards: need('--wards'),
    zoom: Number(need('--zoom')), west: Number(need('--west')), north: Number(need('--north')),
    crop: parseCrop(values.get('--crop')), out: need('--out'),
    pierRadius: radius === undefined ? undefined : Number(radius),
  };
}

async function readRaster(file: string): Promise<RgbRaster> {
  const { data, info } = await sharp(file, { limitInputPixels: false })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { rgb: new Uint8Array(data), width: info.width, height: info.height };
}

/** Copies a crop out of a row-major one-byte-per-pixel grid. */
function cropGrid(grid: Uint8Array, width: number, crop: Crop) {
  const [left, top, cropWidth, cropHeight] = crop;
  const out = new Uint8Array(cropWidth * cropHeight);
  for (let row = 0; row < cropHeight; row += 1) {
    const start = (top + row) * width + left;
    out.set(grid.subarray(start, start + cropWidth), row * cropWidth);
  }
  return out;
}

async function writeDebug(classes: Uint8Array, size: RasterSize, out: string) {
  const rgb = Buffer.alloc(classes.length * 3);
  classes.forEach((value, index) => rgb.set(PALETTE[value], index * 3));
  await sharp(rgb, { raw: { ...size, channels: 3 } }).png().toFile(out);
}

const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));

/** Classifies the whole raster: open water is judged against the sea, never a crop. */
function classifyMap(options: Options, raster: RgbRaster): Uint8Array {
  const size = { width: raster.width, height: raster.height };
  const frame = createMercatorFrame(options);
  const rings = polygonRings(readJson(options.wards).features, frame, [0, 0]);
  return refineSurfaces({
    classes: classifyRgb(raster.rgb, size.width * size.height),
    size,
    streets: measuredStreets({
      features: readJson(options.streets).features,
      frame,
      raster,
      offset: [0, 0],
      policy: STREET_POLICY,
    }),
    urban: fillPolygons(new Uint8Array(size.width * size.height), size, rings),
    minWaterShareOfSea: MIN_WATER_SHARE_OF_SEA,
    pierRadius: options.pierRadius,
  });
}

async function main(argv: string[]) {
  const options = parseOptions(argv);
  const raster = await readRaster(options.map);
  const full = classifyMap(options, raster);
  const crop = options.crop ?? [0, 0, raster.width, raster.height];
  const classes = cropGrid(full, raster.width, crop);
  await writeDebug(classes, { width: crop[2], height: crop[3] }, options.out);
  const percent = (value: number) =>
    ((classes.filter((entry) => entry === value).length / classes.length) * 100).toFixed(1);
  const names = Object.entries(Surface).map(([name, value]) => `${name} ${percent(value)}%`);
  console.log(`${options.out}: ${names.join(' · ')}`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(`extract-surfaces: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = EXIT_FAIL;
});
