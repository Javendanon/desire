#!/usr/bin/env node
/**
 * CLI: export a diorama slice for the viewer: stylised ground albedo (PNG), height field
 * (Float32, row-major), houses re-centred on the slice origin, ship berths and garden trees
 * (features.json) and meta.json. Region in source pixels. Output goes to an ignored directory:
 * it is derived from the source map.
 */
import fs from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';

import { readFlags } from './src/flags.ts';
import { featuresInMetres } from './src/features.ts';
import { heightField, paintAlbedo } from './src/slice.ts';

const EXIT_FAIL = 2;
/** Height-field cell: 4 source pixels, about 1.9 m at z18. */
const CELL_PX = 4;
const SEED = 0xd0c4;

type Region = [number, number, number, number];
type House = {
  block: number;
  center: {
    x_m: number;
    z_m: number;
  };
  [key: string]: unknown;
};

function parseOptions(argv: string[]) {
  const { need, numbers } = readFlags(argv);
  const region = numbers('--region', 4);
  if (region.some((value) => !Number.isInteger(value))) {
    throw new Error('--region must be left,top,width,height in source pixels');
  }
  return {
    classes: need('--classes'), houses: need('--houses'), width: Number(need('--map-width')),
    region: region as Region, out: need('--out'),
  };
}

function cropClasses(classes: Uint8Array, mapWidth: number, region: Region) {
  const [left, top, width, height] = region;
  const out = new Uint8Array(width * height);
  for (let row = 0; row < height; row += 1) {
    const start = (top + row) * mapWidth + left;
    out.set(classes.subarray(start, start + width), row * width);
  }
  return out;
}

type Layer = {
  metres_per_pixel: number;
  houses: House[];
};

/** Everything the viewer loads for one slice, computed from the classes and the house layer. */
function buildSlice(classes: Uint8Array, layer: Layer, region: Region) {
  const [left, top, width, height] = region;
  const size = { width, height };
  const mpp = layer.metres_per_pixel;
  const field = heightField({ classes, size, cellPx: CELL_PX, seed: SEED });
  const origin = { x_m: left * mpp, z_m: top * mpp };
  const houses = layer.houses.map((house) => ({
    ...house,
    center: { x_m: house.center.x_m - origin.x_m, z_m: house.center.z_m - origin.z_m },
  }));
  const meta = {
    width_m: width * mpp, depth_m: height * mpp, cell_m: CELL_PX * mpp,
    columns: field.columns, rows: field.rows, metres_per_pixel: mpp, origin_m: origin,
    houses: houses.length,
  };
  return {
    size,
    albedo: paintAlbedo({ classes, size, cellPx: CELL_PX, seed: SEED }),
    heights: field.heights,
    houses,
    features: featuresInMetres({ classes, size }, mpp, SEED),
    meta,
  };
}

type Slice = ReturnType<typeof buildSlice>;

async function writeSlice(out: string, slice: Slice) {
  fs.mkdirSync(out, { recursive: true });
  await sharp(Buffer.from(slice.albedo), { raw: { ...slice.size, channels: 3 } })
    .png()
    .toFile(path.join(out, 'albedo.png'));
  fs.writeFileSync(path.join(out, 'heights.bin'), Buffer.from(slice.heights.buffer));
  fs.writeFileSync(path.join(out, 'houses.json'), JSON.stringify(slice.houses));
  fs.writeFileSync(path.join(out, 'features.json'), JSON.stringify(slice.features));
  fs.writeFileSync(path.join(out, 'meta.json'), `${JSON.stringify(slice.meta, null, 2)}\n`);
}

async function main(argv: string[]) {
  const options = parseOptions(argv);
  const all = new Uint8Array(fs.readFileSync(options.classes));
  const layer: Layer = JSON.parse(fs.readFileSync(options.houses, 'utf8'));
  const slice = buildSlice(cropClasses(all, options.width, options.region), layer, options.region);
  await writeSlice(options.out, slice);
  const { houses, features: { berths, trees }, meta } = slice;
  const counts = `${houses.length} houses, ${berths.length} berths, ${trees.length} trees`;
  console.log(`${options.out}: ${counts}, ${meta.columns}×${meta.rows} cells`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(`export-slice: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = EXIT_FAIL;
});
