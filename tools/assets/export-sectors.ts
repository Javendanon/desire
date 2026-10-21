#!/usr/bin/env node
/**
 * CLI: cut the whole map into sector payloads (docs/waterdeep-3d/sector-format.md). Writes
 * `<out>/<index>.render.bin` for every sector holding a house, berth or tree, and
 * `<out>/index.json` with the grid, the city-wide roof tone centres and per-sector counts.
 * Berths and trees are found over the full class raster. Output goes to an ignored directory:
 * it is derived from the source map.
 */
import fs from 'node:fs';
import path from 'node:path';

import { roofCentres } from '../../src/lib/diorama/roof-palette.ts';
import { writeSector } from '../../src/lib/map/sector-format.ts';
import { CARAVEL_Z18, findBerths, ORCHARD_Z18, plantTrees } from './src/features.ts';
import { readFlags } from './src/flags.ts';
import { partitionSectors, sectorGrid, type LayerHouse } from './src/sectors.ts';

const EXIT_FAIL = 2;
const FORMAT = 'desire.sector-render/1';
const SEED = 0xd0c4;

function parseOptions(argv: string[]) {
  const { need } = readFlags(argv);
  const width = Number(need('--map-width'));
  if (!Number.isInteger(width) || width <= 0) throw new Error('--map-width must be a pixel count');
  return { houses: need('--houses'), classes: need('--classes'), width, out: need('--out') };
}

function features(classes: Uint8Array, size: { width: number, height: number }, mpp: number) {
  const berths = findBerths(classes, size, { ...CARAVEL_Z18, seed: SEED }).map((berth) =>
    ({ x_m: berth.x_px * mpp, z_m: berth.y_px * mpp, heading_radians: berth.heading_radians }));
  const trees = plantTrees(classes, size, { ...ORCHARD_Z18, seed: SEED }).map((tree) =>
    ({ x_m: tree.x_px * mpp, z_m: tree.y_px * mpp, scale: tree.scale }));
  return { berths, trees };
}

function main(argv: string[]) {
  const options = parseOptions(argv);
  const classes = new Uint8Array(fs.readFileSync(options.classes));
  const size = { width: options.width, height: classes.length / options.width };
  if (!Number.isInteger(size.height)) throw new Error('classes length is not a multiple of width');
  const layer = JSON.parse(fs.readFileSync(options.houses, 'utf8'));
  const mpp: number = layer.metres_per_pixel;
  const grid = sectorGrid(size, mpp);
  const found = features(classes, size, mpp);
  const sectors = partitionSectors({ grid, houses: layer.houses as LayerHouse[], ...found });
  fs.mkdirSync(options.out, { recursive: true });
  const entries = sectors.map((sector) => {
    const bytes = writeSector(sector);
    fs.writeFileSync(path.join(options.out, `${sector.index}.render.bin`), bytes);
    const { index, houses, berths, trees } = sector;
    return { index, houses: houses.length, berths: berths.length, trees: trees.length,
      bytes: bytes.length };
  });
  // One palette for the whole city: a house's roof tone then depends on its own colour only.
  const roof_centres = roofCentres((layer.houses as LayerHouse[]).map((house) => house.roof_rgb))
    .map((centre) => centre.map((channel) => Math.round(channel)));
  const index = { format: FORMAT, grid, roof_centres, sectors: entries };
  fs.writeFileSync(path.join(options.out, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  const houses = entries.reduce((sum, entry) => sum + entry.houses, 0);
  console.log(`${options.out}: ${entries.length} sectors, ${houses} houses, `
    + `${found.berths.length} berths, ${found.trees.length} trees`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(`export-sectors: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = EXIT_FAIL;
}
