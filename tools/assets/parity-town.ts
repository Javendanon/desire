/**
 * The synthetic town for the Rust parity tests (crates/atlas/tests/town.rs): the refined test
 * raster placed in a larger, empty canvas so that it straddles the 1024-px sector lines, with
 * its own roof colours. Houses and sector payloads come from the same code as the CLIs.
 * `parity.ts` writes and checks these files with the rest.
 */
import { generateHouses, type BlocksLayer, type Region } from './src/houses.ts';
import type { Block } from './src/raster/blocks.ts';
import type { RasterSize } from './src/raster/raster-ops.ts';
import { exportSectors, indexJson } from './src/sector-export.ts';

const FIXTURES = 'crates/atlas/tests/fixtures';
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

/** The refined test raster the town is made of. */
export type Tile = {
  classes: Uint8Array;
  size: RasterSize;
};

type Hash = (bytes: Uint8Array) => number;
/** Roof-like colours that vary across the tile, so roof sampling and tones are exercised. */
function townColours(tile: Tile): Uint8Array {
  return Uint8Array.from({ length: tile.size.width * tile.size.height * 3 }, (_, at) => {
    const [pixel, channel] = [Math.floor(at / 3), at % 3];
    const [x, y] = [pixel % tile.size.width, Math.floor(pixel / tile.size.width)];
    return (60 + channel * 40 + x * (3 - channel) + y * (channel + 1)) % 256;
  });
}

/** A tile-sized buffer copied into the empty town canvas at the offset. */
function onCanvas(tile: Tile, buffer: Uint8Array, channels: number): Uint8Array {
  const { canvas, offset } = TOWN;
  const out = new Uint8Array(canvas.width * canvas.height * channels);
  for (let row = 0; row < tile.size.height; row += 1) {
    const from = row * tile.size.width * channels;
    const to = ((offset.y + row) * canvas.width + offset.x) * channels;
    out.set(buffer.subarray(from, from + tile.size.width * channels), to);
  }
  return out;
}

/** The synthetic blocks moved onto the canvas, in metres, as `blocks.json` holds them. */
function townLayer(blocks: Block[]): BlocksLayer {
  const { offset, metres_per_pixel: mpp } = TOWN;
  const metres = ([x, y]: number[]): [number, number] =>
    [(x + offset.x) * mpp, (y + offset.y) * mpp];
  const metresBlocks = blocks.map((block, id) => ({ id,
    outer: block.outer.map(metres), holes: block.holes.map((hole) => hole.map(metres)) }));
  return { metres_per_pixel: mpp, blocks: metresBlocks };
}

/** Houses and sector payloads of the synthetic town, from the same code as the CLIs. */
function townGolden(tile: Tile, blocks: Block[], hash: Hash) {
  const { canvas, metres_per_pixel: mpp } = TOWN;
  const raster = { rgb: onCanvas(tile, townColours(tile), 3),
    classes: onCanvas(tile, tile.classes, 1), width: canvas.width, height: canvas.height,
    metresPerPixel: mpp };
  const houses = generateHouses(raster, townLayer(blocks), TOWN);
  const { payloads, index } = exportSectors({ classes: raster.classes, size: canvas, houses,
    metresPerPixel: mpp });
  const text = Buffer.from(indexJson(index));
  return {
    houses,
    payloads: payloads.map(({ index: sector, bytes }) =>
      ({ index: sector, fnv1a: hash(bytes), bytes: bytes.length })),
    index_fnv1a: hash(text),
    index_bytes: text.length,
  };
}

/** The town's fixtures and golden, as `parity.ts` writes them. */
export type FixtureFile = [string, string | Uint8Array];

export function townFiles(tile: Tile, blocks: Block[], hash: Hash): FixtureFile[] {
  return [
    [TOWN_CLASSES, tile.classes],
    [TOWN_RGB, townColours(tile)],
    [TOWN_INPUT, `${JSON.stringify({ ...TOWN, ...townLayer(blocks) })}\n`],
    [TOWN_GOLDEN, `${JSON.stringify(townGolden(tile, blocks, hash))}\n`],
  ];
}
