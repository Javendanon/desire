#!/usr/bin/env node
/**
 * CLI: cut the whole map into sector payloads (src/sector-export.ts). Writes
 * `<out>/<index>.render.bin` for every sector holding a house, berth or tree, and
 * `<out>/index.json`. Output goes to an ignored directory: it is derived from the source map.
 */
import fs from 'node:fs';
import path from 'node:path';

import { readFlags } from './src/flags.ts';
import { exportSectors, indexJson } from './src/sector-export.ts';
import type { LayerHouse } from './src/sectors.ts';

const EXIT_FAIL = 2;

function parseOptions(argv: string[]) {
  const { need } = readFlags(argv);
  const width = Number(need('--map-width'));
  if (!Number.isInteger(width) || width <= 0) throw new Error('--map-width must be a pixel count');
  return { houses: need('--houses'), classes: need('--classes'), width, out: need('--out') };
}

function main(argv: string[]) {
  const options = parseOptions(argv);
  const classes = new Uint8Array(fs.readFileSync(options.classes));
  const size = { width: options.width, height: classes.length / options.width };
  if (!Number.isInteger(size.height)) throw new Error('classes length is not a multiple of width');
  const layer = JSON.parse(fs.readFileSync(options.houses, 'utf8'));
  const houses = layer.houses as LayerHouse[];
  const { payloads, index } = exportSectors({ classes, size, houses,
    metresPerPixel: layer.metres_per_pixel });
  fs.mkdirSync(options.out, { recursive: true });
  for (const payload of payloads) {
    fs.writeFileSync(path.join(options.out, `${payload.index}.render.bin`), payload.bytes);
  }
  fs.writeFileSync(path.join(options.out, 'index.json'), indexJson(index));
  console.log(`${options.out}: ${payloads.length} sectors, ${houses.length} houses`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(`export-sectors: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = EXIT_FAIL;
}
