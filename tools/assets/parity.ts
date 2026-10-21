#!/usr/bin/env node
/**
 * CLI: reference results from the TypeScript pipeline, for the Rust port's parity tests
 * (crates/atlas/tests). Inputs are synthetic or exhaustive, never the licensed source map, so the
 * goldens can be committed. `--check` fails when the committed goldens differ from what the
 * TypeScript code now produces.
 */
import fs from 'node:fs';

import { classifyPixel, Surface } from './src/raster/surface.ts';

const GOLDEN = 'crates/atlas/tests/fixtures/parity.json';
const COLOURS = 1 << 24;
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a, 32 bits: the Rust tests hash the same way. */
export function fnv1a(bytes: Uint8Array): number {
  let hash = FNV_OFFSET;
  for (let index = 0; index < bytes.length; index += 1) {
    hash = Math.imul(hash ^ bytes[index], FNV_PRIME) >>> 0;
  }
  return hash;
}

/** Every 24-bit colour, in order `r << 16 | g << 8 | b`, classified. */
function classifyAllColours() {
  const table = new Uint8Array(COLOURS);
  for (let colour = 0; colour < COLOURS; colour += 1) {
    table[colour] = classifyPixel(colour >>> 16, (colour >>> 8) & 0xff, colour & 0xff);
  }
  const counts = Object.fromEntries(Object.entries(Surface).map(([name, value]) =>
    [name, table.reduce((sum, entry) => sum + (entry === value ? 1 : 0), 0)]));
  return { fnv1a: fnv1a(table), counts };
}

function goldens() {
  return { classify_all_colours: classifyAllColours() };
}

const text = `${JSON.stringify(goldens(), null, 2)}\n`;
if (process.argv.includes('--check')) {
  if (!fs.existsSync(GOLDEN) || fs.readFileSync(GOLDEN, 'utf8') !== text) {
    console.error(`parity: ${GOLDEN} is stale, run node tools/assets/parity.ts`);
    process.exitCode = 1;
  }
} else {
  fs.writeFileSync(GOLDEN, text);
  console.log(`${GOLDEN} written`);
}
