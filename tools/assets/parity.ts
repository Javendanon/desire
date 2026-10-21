#!/usr/bin/env node
/**
 * CLI: reference results from the TypeScript pipeline, for the Rust port's parity tests
 * (crates/atlas/tests). Inputs are synthetic or exhaustive, never the licensed source map, so the
 * goldens can be committed. `--check` fails when the committed goldens differ from what the
 * TypeScript code now produces.
 */
import fs from 'node:fs';

import { mulberry32 } from './src/random.ts';
import { components, dilate, erode, majority } from './src/raster/raster-ops.ts';
import { classifyPixel, Surface } from './src/raster/surface.ts';

const FIXTURES = 'crates/atlas/tests/fixtures';
const GOLDEN = `${FIXTURES}/parity.json`;
/** Synthetic class raster: odd sizes, so no operation can lean on powers of two. */
const RASTER = { width: 257, height: 131 };
const RASTER_FILE = `${FIXTURES}/classes-257x131.bin`;
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

/** Blobs of each class over noise: real shapes for components and morphology. */
function syntheticClasses(): Uint8Array {
  const random = mulberry32(0xa71a5);
  const { width, height } = RASTER;
  const classes = Uint8Array.from({ length: width * height }, () => Math.floor(random() * 8));
  for (let blob = 0; blob < 60; blob += 1) {
    const [cx, cy, r] = [random() * width, random() * height, 2 + random() * 14];
    const value = Math.floor(random() * 8);
    for (let index = 0; index < classes.length; index += 1) {
      const dx = (index % width) - cx;
      const dy = Math.floor(index / width) - cy;
      if (dx * dx + dy * dy < r * r) classes[index] = value;
    }
  }
  return classes;
}

const hashOf = (values: Uint8Array | Int32Array) =>
  fnv1a(new Uint8Array(values.buffer, values.byteOffset, values.byteLength));

function rasterOps(classes: Uint8Array) {
  const water = Uint8Array.from(classes, (value) => (value === Surface.Water ? 1 : 0));
  const { labels, sizes } = components(water, RASTER);
  return {
    majority_r2: hashOf(majority(classes, RASTER, 2)),
    majority_r5: hashOf(majority(classes, RASTER, 5)),
    dilate_r3: hashOf(dilate(water, RASTER, 3)),
    dilate_r40: hashOf(dilate(water, RASTER, 40)),
    erode_r2: hashOf(erode(water, RASTER, 2)),
    components_labels: hashOf(labels),
    components_count: sizes.length,
    components_largest: Math.max(...sizes),
  };
}

function goldens(classes: Uint8Array) {
  return { classify_all_colours: classifyAllColours(), raster_ops: rasterOps(classes) };
}

const classes = syntheticClasses();
const files: [string, string | Uint8Array][] = [
  [GOLDEN, `${JSON.stringify(goldens(classes), null, 2)}\n`],
  [RASTER_FILE, classes],
];
for (const [file, content] of files) {
  const current = fs.existsSync(file) ? fs.readFileSync(file) : undefined;
  const fresh = current !== undefined && Buffer.compare(current, Buffer.from(content)) === 0;
  if (process.argv.includes('--check')) {
    if (!fresh) {
      console.error(`parity: ${file} is stale, run node tools/assets/parity.ts`);
      process.exitCode = 1;
    }
  } else if (!fresh) {
    fs.writeFileSync(file, content);
    console.log(`${file} written`);
  }
}
