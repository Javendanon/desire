#!/usr/bin/env node
/**
 * CLI: reference results from the TypeScript pipeline, for the Rust port's parity tests
 * (crates/atlas/tests). Inputs are synthetic or exhaustive, never the licensed source map, so the
 * goldens can be committed. `--check` fails when the committed goldens differ from what the
 * TypeScript code now produces.
 */
import fs from 'node:fs';

import { mulberry32 } from './src/random.ts';
import { createMercatorFrame, type LngLat } from './src/raster/frame.ts';
import { fillPolygons, type PixelRing } from './src/raster/polygon-fill.ts';
import { paintPolylines, type PixelPolyline } from './src/raster/polyline.ts';
import { components, dilate, erode, majority } from './src/raster/raster-ops.ts';
import { refineSurfaces } from './src/raster/refine.ts';
import { measureStreetWidth } from './src/raster/street-width.ts';
import { classifyPixel, Surface } from './src/raster/surface.ts';

const FIXTURES = 'crates/atlas/tests/fixtures';
const GOLDEN = `${FIXTURES}/parity.json`;
/** Synthetic class raster: odd sizes, so no operation can lean on powers of two. */
const RASTER = { width: 257, height: 131 };
const RASTER_FILE = `${FIXTURES}/classes-257x131.bin`;
const VECTOR_INPUT = `${FIXTURES}/vectors-input.json`;
const STREETS_RGB = `${FIXTURES}/streets-301x203.rgb`;
const STREETS = { width: 301, height: 203 };
/** The Tych z18 frame of Waterdeep. */
const TYCH = { zoom: 18, west: -123.05626478690047, north: 38.33925568803595 };
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

/** Points across and beyond the map, including the frame's corner and its far edge. */
function framePoints(): LngLat[] {
  const random = mulberry32(0xf4a3e);
  const points: LngLat[] = [[TYCH.west, TYCH.north], [-123.03, 38.33], [-123.0, 38.25]];
  for (let point = 0; point < 40; point += 1) {
    points.push([TYCH.west + random() * 0.04 - 0.005, TYCH.north - random() * 0.05 + 0.005]);
  }
  return points;
}

/** Rings with fractional corners: concave, overlapping, crossing the image edge. */
function syntheticRings(): PixelRing[] {
  return [
    [[10.3, 12.7], [120.5, 8.1], [95.25, 60.5], [140.9, 110.2], [20.1, 95.6]],
    [[80.5, 40.5], [190.2, 45.7], [205.4, 160.3], [70.6, 140.1]],
    [[-15.2, 100.4], [40.8, 130.9], [5.5, 170.2]],
  ];
}

function syntheticLines(): PixelPolyline[] {
  return [
    { width: 6.5, points: [[5.2, 5.7], [190.4, 30.1], [150.8, 120.6]] },
    { width: 13, points: [[20.5, 140.5], [20.5, 60.5]] },
    { width: 2.2, points: [[-10, 75.3], [215.6, 80.9]] },
  ];
}

/** Light streets with dark 2 px outlines over brown ground, plus deterministic speckle. */
function syntheticStreets(): Uint8Array {
  const { width, height } = STREETS;
  const random = mulberry32(0x57ee7);
  const rgb = new Uint8Array(width * height * 3);
  const paint = (inside: (x: number, y: number) => boolean, colour: number[]) => {
    for (let index = 0; index < width * height; index += 1) {
      if (inside(index % width, Math.floor(index / width))) rgb.set(colour, index * 3);
    }
  };
  paint(() => true, [120, 96, 70]);
  paint((_, y) => y >= 38 && y <= 59, [30, 20, 15]);
  paint((_, y) => y >= 40 && y <= 57, [150, 144, 136]);
  paint((x, y) => Math.abs(x - y * 0.8 - 90) <= 6, [30, 20, 15]);
  paint((x, y) => Math.abs(x - y * 0.8 - 90) <= 4, [140, 132, 120]);
  for (let index = 0; index < width * height; index += 1) {
    if (random() < 0.01) rgb.set([200, 30, 30], index * 3);
  }
  return rgb;
}

const STREET_LINES: [number, number][][] = [
  [[0, 48.5], [300, 48.5]],
  [[90, 0], [250, 200]],
  [[-50, 10], [-10, 10]],
  [[150, 100], [150.4, 100.3]],
];

function vectorGoldens() {
  const frame = createMercatorFrame(TYCH);
  const size = { width: 200, height: 150 };
  const filled = fillPolygons(new Uint8Array(size.width * size.height), size, syntheticRings());
  const painted = paintPolylines(new Uint8Array(size.width * size.height), size, syntheticLines());
  const raster = { rgb: syntheticStreets(), ...STREETS };
  return {
    frame_metres_per_pixel: frame.metresPerPixel,
    frame_pixels: framePoints().map((point) => frame.lngLatToPixel(point)),
    fill_fnv1a: hashOf(filled),
    fill_count: filled.reduce((sum, value) => sum + value, 0),
    paint_fnv1a: hashOf(painted),
    paint_count: painted.reduce((sum, value) => sum + value, 0),
    street_widths: STREET_LINES.map((line) => measureStreetWidth(raster, line)),
  };
}

/** Refinement of the synthetic raster, with parameters scaled to its size. */
const REFINE = {
  streets: [
    { width: 5, points: [[0, 20.5], [256, 30.5]] },
    { width: 3, points: [[128.5, 0], [100.5, 130]] },
  ] as PixelPolyline[],
  urban: [[30.5, 10.5], [240.5, 15.5], [230.5, 120.5], [20.5, 110.5]] as PixelRing,
  params: { majorityRadius: 1, minSquarePx: 25, pierRadius: 3, pierGapPixels: 1,
    pierWetShare: 0.4, minWaterShareOfSea: 0.05 },
};

function refineGolden(classes: Uint8Array) {
  const urban = fillPolygons(new Uint8Array(classes.length), RASTER, [REFINE.urban]);
  const refined = refineSurfaces({ classes, size: RASTER, streets: REFINE.streets, urban,
    ...REFINE.params });
  const counts = Object.fromEntries(Object.entries(Surface).map(([name, value]) =>
    [name, refined.reduce((sum, entry) => sum + (entry === value ? 1 : 0), 0)]));
  return { fnv1a: hashOf(refined), counts };
}

function goldens(classes: Uint8Array) {
  return {
    classify_all_colours: classifyAllColours(),
    raster_ops: rasterOps(classes),
    vectors: vectorGoldens(),
    refine: refineGolden(classes),
  };
}

const classes = syntheticClasses();
const files: [string, string | Uint8Array][] = [
  [GOLDEN, `${JSON.stringify(goldens(classes), null, 2)}\n`],
  [RASTER_FILE, classes],
  [VECTOR_INPUT, `${JSON.stringify({ frame: TYCH, frame_points: framePoints(),
    rings: syntheticRings(), lines: syntheticLines(), street_lines: STREET_LINES,
    refine: REFINE }, null, 2)}\n`],
  [STREETS_RGB, syntheticStreets()],
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
