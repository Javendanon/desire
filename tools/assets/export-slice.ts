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

import { findBerths, plantTrees, type Berth, type Tree } from './src/features.ts';
import { heightField, paintAlbedo } from './src/slice.ts';

const EXIT_FAIL = 2;
/** Height-field cell: 4 source pixels, about 1.9 m at z18. */
const CELL_PX = 4;
const SEED = 0xd0c4;
/** A caravel at z18: about 22 m long and 6.5 m in the beam, 26 m between moored bows. */
const SHIP = { lengthPx: 48, beamPx: 14, spacingPx: 56, seed: SEED };
/** One tree per 12 px (about 5.6 m) square of garden at most. */
const TREES = { spacingPx: 12, seed: SEED };

type Region = [number, number, number, number];
type House = {
  center: {
    x_m: number;
    z_m: number;
  };
  [key: string]: unknown;
};

function parseOptions(argv: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index + 1 < argv.length; index += 2) values.set(argv[index], argv[index + 1]);
  const need = (flag: string) => {
    const value = values.get(flag);
    if (value === undefined) throw new Error(`missing ${flag}`);
    return value;
  };
  const region = need('--region').split(',').map(Number);
  if (region.length !== 4 || region.some((value) => !Number.isInteger(value))) {
    throw new Error('--region must be left,top,width,height in source pixels');
  }
  return {
    classes: need('--classes'), houses: need('--houses'), width: Number(need('--map-width')),
    region: region as Region, out: need('--out'),
  };
}

function cropClasses(classes: Uint8Array, mapWidth: number, [left, top, width, height]: Region) {
  const out = new Uint8Array(width * height);
  for (let row = 0; row < height; row += 1) {
    const start = (top + row) * mapWidth + left;
    out.set(classes.subarray(start, start + width), row * width);
  }
  return out;
}

function features(classes: Uint8Array, size: { width: number, height: number }, mpp: number) {
  const metres = ({ x_px, y_px }: Berth | Tree) => ({ x_m: x_px * mpp, z_m: y_px * mpp });
  return {
    berths: findBerths(classes, size, SHIP).map((berth) =>
      ({ ...metres(berth), heading_radians: berth.heading_radians })),
    trees: plantTrees(classes, size, TREES).map((tree) => ({ ...metres(tree), scale: tree.scale })),
  };
}

async function main(argv: string[]) {
  const options = parseOptions(argv);
  const [left, top, width, height] = options.region;
  const all = new Uint8Array(fs.readFileSync(options.classes));
  const classes = cropClasses(all, options.width, options.region);
  const size = { width, height };
  const albedo = paintAlbedo({ classes, size, cellPx: CELL_PX, seed: SEED });
  const field = heightField({ classes, size, cellPx: CELL_PX, seed: SEED });
  const layer = JSON.parse(fs.readFileSync(options.houses, 'utf8'));
  const mpp: number = layer.metres_per_pixel;
  const origin = { x_m: left * mpp, z_m: top * mpp };
  const houses = (layer.houses as House[]).map((house) => ({
    ...house,
    center: { x_m: house.center.x_m - origin.x_m, z_m: house.center.z_m - origin.z_m },
  }));
  fs.mkdirSync(options.out, { recursive: true });
  await sharp(Buffer.from(albedo), { raw: { width, height, channels: 3 } })
    .png()
    .toFile(path.join(options.out, 'albedo.png'));
  fs.writeFileSync(path.join(options.out, 'heights.bin'), Buffer.from(field.heights.buffer));
  fs.writeFileSync(path.join(options.out, 'houses.json'), JSON.stringify(houses));
  const found = features(classes, size, mpp);
  fs.writeFileSync(path.join(options.out, 'features.json'), JSON.stringify(found));
  const meta = {
    width_m: width * mpp, depth_m: height * mpp, cell_m: CELL_PX * mpp,
    columns: field.columns, rows: field.rows, metres_per_pixel: mpp, origin_m: origin,
    houses: houses.length,
  };
  fs.writeFileSync(path.join(options.out, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  const { berths, trees } = found;
  const counts = `${houses.length} houses, ${berths.length} berths, ${trees.length} trees`;
  console.log(`${options.out}: ${counts}, ${field.columns}×${field.rows} cells`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(`export-slice: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = EXIT_FAIL;
});
