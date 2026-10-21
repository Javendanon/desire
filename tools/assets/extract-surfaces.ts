#!/usr/bin/env node
/**
 * CLI: classify the surfaces of a stitched Web Mercator city raster into water, streets, roofs,
 * landmark roofs, outlines, piers and ground, forcing streets from GeoJSON centrelines.
 * Writes a debug PNG and a summary. Source rasters stay outside the repository.
 */
import fs from 'node:fs';

import sharp from 'sharp';

import { createMercatorFrame } from './src/raster/frame.ts';
import type { PixelPolyline } from './src/raster/polyline.ts';
import type { RasterSize } from './src/raster/raster-ops.ts';
import { refineSurfaces } from './src/raster/refine.ts';
import { classifyRgb, Surface } from './src/raster/surface.ts';

const EXIT_FAIL = 2;
const MIN_WATER_FRACTION = 0.01;
/** Forced street widths at z18, narrower than the drawn street so buildings are never eaten. */
const STREET_WIDTH_PX: Record<string, number> = { Main: 24, Major: 12, Minor: 6 };
const DEFAULT_STREET_WIDTH_PX = 6;
const PALETTE: Record<number, [number, number, number]> = {
  [Surface.Ground]: [214, 196, 160],
  [Surface.Water]: [70, 140, 170],
  [Surface.Roof]: [150, 90, 60],
  [Surface.Street]: [240, 240, 232],
  [Surface.Outline]: [20, 20, 20],
  [Surface.RedRoof]: [220, 60, 40],
  [Surface.Pier]: [95, 60, 140],
};

type Options = {
  map: string;
  streets: string;
  zoom: number;
  west: number;
  north: number;
  crop: [number, number, number, number];
  out: string;
  pierRadius?: number;
};
type StreetFeature = {
  properties: { Type?: string | null };
  geometry: { coordinates: [number, number][] };
};

function parseOptions(argv: string[]): Options {
  const values = new Map<string, string>();
  for (let index = 0; index + 1 < argv.length; index += 2) values.set(argv[index], argv[index + 1]);
  const need = (flag: string) => {
    const value = values.get(flag);
    if (value === undefined) throw new Error(`missing ${flag}`);
    return value;
  };
  const crop = need('--crop').split(',').map(Number) as Options['crop'];
  if (crop.length !== 4 || crop.some((value) => !Number.isFinite(value))) {
    throw new Error('--crop must be left,top,width,height');
  }
  return {
    map: need('--map'), streets: need('--streets'), zoom: Number(need('--zoom')),
    west: Number(need('--west')), north: Number(need('--north')), crop, out: need('--out'),
    pierRadius: values.has('--pier-radius') ? Number(values.get('--pier-radius')) : undefined,
  };
}

function streetLines(options: Options): PixelPolyline[] {
  const frame = createMercatorFrame(options);
  const [left, top] = options.crop;
  const features = JSON.parse(fs.readFileSync(options.streets, 'utf8')).features as StreetFeature[];
  return features.map((feature) => ({
    width: STREET_WIDTH_PX[feature.properties.Type ?? ''] ?? DEFAULT_STREET_WIDTH_PX,
    points: feature.geometry.coordinates.map((point) => {
      const [x, y] = frame.lngLatToPixel(point);
      return [x - left, y - top] as [number, number];
    }),
  }));
}

async function writeDebug(classes: Uint8Array, size: RasterSize, out: string) {
  const rgb = Buffer.alloc(classes.length * 3);
  classes.forEach((value, index) => rgb.set(PALETTE[value], index * 3));
  await sharp(rgb, { raw: { ...size, channels: 3 } }).png().toFile(out);
}

async function main(argv: string[]) {
  const options = parseOptions(argv);
  const [left, top, width, height] = options.crop;
  const { data } = await sharp(options.map, { limitInputPixels: false })
    .extract({ left, top, width, height })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const size = { width, height };
  const classes = refineSurfaces({
    classes: classifyRgb(new Uint8Array(data), width * height),
    size,
    streets: streetLines(options),
    minWaterFraction: MIN_WATER_FRACTION,
    pierRadius: options.pierRadius,
  });
  await writeDebug(classes, size, options.out);
  const percent = (value: number) =>
    ((classes.filter((entry) => entry === value).length / classes.length) * 100).toFixed(1);
  const names = Object.entries(Surface).map(([name, value]) => `${name} ${percent(value)}%`);
  console.log(`${options.out}: ${names.join(' · ')}`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(`extract-surfaces: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = EXIT_FAIL;
});
