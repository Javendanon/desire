#!/usr/bin/env node
/**
 * CLI: reference results from the TypeScript pipeline, for the Rust port's parity tests
 * (crates/atlas/tests). Inputs are synthetic or exhaustive, never the licensed source map, so the
 * goldens can be committed. `--check` fails when the committed goldens differ from what the
 * TypeScript code now produces.
 */
import fs from 'node:fs';

import { findBerths, plantTrees } from './src/features.ts';
import { generateHouses, type BlocksLayer, type Region } from './src/houses.ts';
import { placeHouses } from './src/lots.ts';
import { mulberry32 } from './src/random.ts';
import { createMercatorFrame, type LngLat } from './src/raster/frame.ts';
import { fillPolygons, type PixelRing } from './src/raster/polygon-fill.ts';
import { paintPolylines, type PixelPolyline } from './src/raster/polyline.ts';
import { components, dilate, erode, majority } from './src/raster/raster-ops.ts';
import { blockMask, traceBlocks } from './src/raster/blocks.ts';
import { refineSurfaces } from './src/raster/refine.ts';
import { measureStreetWidth } from './src/raster/street-width.ts';
import { heightField, paintAlbedo, shoreDistance } from './src/slice.ts';
import { classifyPixel, Surface } from './src/raster/surface.ts';
import { exportSectors, indexJson } from './src/sector-export.ts';

const FIXTURES = 'crates/atlas/tests/fixtures';
const GOLDEN = `${FIXTURES}/parity.json`;
/** Synthetic class raster: odd sizes, so no operation can lean on powers of two. */
const RASTER = { width: 257, height: 131 };
const RASTER_FILE = `${FIXTURES}/classes-257x131.bin`;
const VECTOR_INPUT = `${FIXTURES}/vectors-input.json`;
const BLOCKS_GOLDEN = `${FIXTURES}/blocks-golden.json`;
const LOTS_GOLDEN = `${FIXTURES}/lots-golden.json`;
const FEATURES_GOLDEN = `${FIXTURES}/features-golden.json`;
/** Ship and orchard scaled to the synthetic raster's small piers and gardens. */
const SMALL_SHIP = { lengthPx: 12, beamPx: 4, spacingPx: 14, seed: 0xd0c4 };
const SMALL_ORCHARD = { spacingPx: 6, seed: 0xd0c4 };
/** The z18 lot rules of generate-houses. */
type Range = [number, number];
const LOT_RULES = { frontage: [4.5, 8.5] as Range, depth: [6.5, 11] as Range };
/** Open ground in the synthetic lots: a disc, so some lots are rejected and others shift. */
const OPEN = { x_m: 50, z_m: 40, radius_m: 12 };
/** Scaled to the synthetic raster: small blocks kept, 1.5 px tolerance as on the map. */
const TRACE = { minAreaPx: 30, tolerancePx: 1.5, minHoleAreaPx: 6 };
const STREETS_RGB = `${FIXTURES}/streets-301x203.rgb`;
/**
 * The synthetic town: the refined raster placed in a larger, empty canvas so that it straddles
 * the 1024-px sector lines, with its own roof colours. Houses and sector payloads come from it.
 */
const TOWN = {
  canvas: { width: 1300, height: 1100 },
  offset: { x: 900, y: 950 },
  metres_per_pixel: 0.4683867315551439,
  region: [880, 940, 240, 150] as Region,
  heights: [5, 9] as [number, number],
};
const TOWN_CLASSES = `${FIXTURES}/town-classes-257x131.bin`;
const TOWN_RGB = `${FIXTURES}/town-257x131.rgb`;
const TOWN_INPUT = `${FIXTURES}/town-input.json`;
const TOWN_GOLDEN = `${FIXTURES}/town-golden.json`;
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

function refinedSynthetic(classes: Uint8Array) {
  const urban = fillPolygons(new Uint8Array(classes.length), RASTER, [REFINE.urban]);
  const refined = refineSurfaces({ classes, size: RASTER, streets: REFINE.streets, urban,
    ...REFINE.params });
  return { refined, urban };
}

/** Blocks traced from the refined synthetic raster. */
function syntheticBlocks(classes: Uint8Array) {
  const { refined, urban } = refinedSynthetic(classes);
  return traceBlocks(blockMask(refined, urban), RASTER, TRACE);
}

/** Berths and trees found on the refined synthetic raster. */
function syntheticFeatures(classes: Uint8Array) {
  const { refined } = refinedSynthetic(classes);
  return {
    ship: SMALL_SHIP,
    orchard: SMALL_ORCHARD,
    berths: findBerths(refined, RASTER, SMALL_SHIP),
    trees: plantTrees(refined, RASTER, SMALL_ORCHARD),
  };
}

const plan = ([x_m, z_m]: [number, number]) => ({ x_m, z_m });

/** A 30° rotated rectangle, an L-shaped block, and a block with a courtyard hole. */
function lotBlocks() {
  const turn = (x: number, z: number): [number, number] => {
    const [c, s] = [Math.sqrt(3) / 2, 0.5];
    return [20 + x * c - z * s, 15 + x * s + z * c];
  };
  return [
    { outer: [turn(0, 0), turn(60, 0), turn(60, 25), turn(0, 25)], holes: [] },
    { outer: [[100, 10], [160, 10], [160, 30], [125, 30], [125, 70], [100, 70]], holes: [] },
    { outer: [[10, 90], [90, 90], [90, 150], [10, 150]],
      holes: [[[35, 110], [65, 110], [65, 130], [35, 130]]] },
  ].map((block, index) => ({
    seed: 0x5eed + index,
    outer: block.outer.map((point) => plan(point as [number, number])),
    holes: block.holes.map((hole) => hole.map((point) => plan(point as [number, number]))),
  }));
}

function lotGolden() {
  const isBuilt = ({ x_m, z_m }: { x_m: number, z_m: number }) =>
    Math.hypot(x_m - OPEN.x_m, z_m - OPEN.z_m) >= OPEN.radius_m;
  return lotBlocks().map((block) => ({
    seed: block.seed,
    outer: block.outer,
    holes: block.holes,
    houses: placeHouses(block, { ...LOT_RULES, seed: block.seed, isBuilt }),
  }));
}

/** Ground of the refined synthetic raster: shore distance, albedo and a 4-px height field. */
function groundGolden(classes: Uint8Array) {
  const { refined } = refinedSynthetic(classes);
  const spec = { classes: refined, size: RASTER, cellPx: 4, seed: 0xd0c4 };
  const shore = shoreDistance(refined, RASTER);
  const field = heightField(spec);
  return {
    shore_fnv1a: hashOf(new Uint8Array(shore.buffer)),
    albedo_fnv1a: hashOf(paintAlbedo(spec)),
    heights_fnv1a: hashOf(new Uint8Array(field.heights.buffer)),
    columns: field.columns,
    rows: field.rows,
  };
}

/** Roof-like colours that vary across the tile, so roof sampling and tones are exercised. */
function townColours(): Uint8Array {
  return Uint8Array.from({ length: RASTER.width * RASTER.height * 3 }, (_, at) => {
    const [pixel, channel] = [Math.floor(at / 3), at % 3];
    const [x, y] = [pixel % RASTER.width, Math.floor(pixel / RASTER.width)];
    return (60 + channel * 40 + x * (3 - channel) + y * (channel + 1)) % 256;
  });
}

/** A tile-sized buffer copied into the empty town canvas at the offset. */
function onCanvas(tile: Uint8Array, channels: number): Uint8Array {
  const { canvas, offset } = TOWN;
  const out = new Uint8Array(canvas.width * canvas.height * channels);
  for (let row = 0; row < RASTER.height; row += 1) {
    const from = row * RASTER.width * channels;
    const to = ((offset.y + row) * canvas.width + offset.x) * channels;
    out.set(tile.subarray(from, from + RASTER.width * channels), to);
  }
  return out;
}

/** The synthetic blocks moved onto the canvas, in metres, as `blocks.json` holds them. */
function townLayer(classes: Uint8Array): BlocksLayer {
  const { offset, metres_per_pixel: mpp } = TOWN;
  const metres = ([x, y]: number[]): [number, number] =>
    [(x + offset.x) * mpp, (y + offset.y) * mpp];
  const blocks = syntheticBlocks(classes).map((block, id) => ({ id,
    outer: block.outer.map(metres), holes: block.holes.map((hole) => hole.map(metres)) }));
  return { metres_per_pixel: mpp, blocks };
}

/** Houses and sector payloads of the synthetic town, from the same code as the CLIs. */
function townGolden(classes: Uint8Array) {
  const { refined } = refinedSynthetic(classes);
  const { canvas, metres_per_pixel: mpp } = TOWN;
  const raster = { rgb: onCanvas(townColours(), 3), classes: onCanvas(refined, 1),
    width: canvas.width, height: canvas.height, metresPerPixel: mpp };
  const houses = generateHouses(raster, townLayer(classes), TOWN);
  const { payloads, index } = exportSectors({ classes: raster.classes, size: canvas, houses,
    metresPerPixel: mpp });
  const text = Buffer.from(indexJson(index));
  return {
    houses,
    payloads: payloads.map(({ index: sector, bytes }) =>
      ({ index: sector, fnv1a: fnv1a(bytes), bytes: bytes.length })),
    index_fnv1a: fnv1a(text),
    index_bytes: text.length,
  };
}

function goldens(classes: Uint8Array) {
  return {
    classify_all_colours: classifyAllColours(),
    raster_ops: rasterOps(classes),
    vectors: vectorGoldens(),
    refine: refineGolden(classes),
    ground: groundGolden(classes),
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
  [BLOCKS_GOLDEN, `${JSON.stringify({ trace: TRACE, blocks: syntheticBlocks(classes) })}\n`],
  [LOTS_GOLDEN, `${JSON.stringify({ rules: LOT_RULES, open: OPEN, blocks: lotGolden() })}\n`],
  [FEATURES_GOLDEN, `${JSON.stringify(syntheticFeatures(classes))}\n`],
  [TOWN_CLASSES, refinedSynthetic(classes).refined],
  [TOWN_RGB, townColours()],
  [TOWN_INPUT, `${JSON.stringify({ ...TOWN, ...townLayer(classes) })}\n`],
  [TOWN_GOLDEN, `${JSON.stringify(townGolden(classes))}\n`],
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
