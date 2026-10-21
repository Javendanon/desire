/**
 * Measures the drawn width of a street on the raster from its vector centreline.
 *
 * At samples along the line, the street's own colour is the median of a 3 × 3 window on the
 * centreline. The walk along the normal stops when the colour leaves it for a few pixels in a
 * row. Comparing against the street's own colour works for any palette (light dirt lanes in Dock
 * Ward, dark brown streets in North Ward). The median over samples ignores junctions and squares.
 */
import type { PixelPoint } from './polyline.ts';

export type RgbRaster = {
  rgb: Uint8Array;
  width: number;
  height: number;
};
type Colour = [number, number, number];
type Walk = {
  raster: RgbRaster;
  origin: PixelPoint;
  normal: PixelPoint;
  reference: Colour;
};

const SAMPLE_STEP_PX = 4;
/** RGB distance beyond which a pixel no longer belongs to the street. */
const EDGE_DISTANCE = 40;
/** Consecutive off-street pixels needed to accept an edge. Pebbles are one or two pixels. */
const EDGE_RUN = 3;
/** Building outlines: darker than this on every channel (the `Outline` surface rule). */
const OUTLINE_MAX_CHANNEL = 50;
/** Outlines are 2 px wide at z18 and end the street even when the roof beyond matches it. */
const OUTLINE_RUN = 2;
const MAX_HALF_WIDTH_PX = 60;

function colourAt(raster: RgbRaster, x: number, y: number): Colour | null {
  const column = Math.round(x);
  const row = Math.round(y);
  if (column < 0 || row < 0 || column >= raster.width || row >= raster.height) return null;
  const offset = (row * raster.width + column) * 3;
  return [raster.rgb[offset], raster.rgb[offset + 1], raster.rgb[offset + 2]];
}

const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

function referenceColour(raster: RgbRaster, [x, y]: PixelPoint): Colour | null {
  const window: Colour[] = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const colour = colourAt(raster, x + dx, y + dy);
      if (colour) window.push(colour);
    }
  }
  if (window.length === 0) return null;
  return [0, 1, 2].map((channel) => median(window.map((colour) => colour[channel]))) as Colour;
}

const distance = (a: Colour, b: Colour) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

type Runs = {
  offStreet: number;
  outline: number;
};

/** Updates both runs for one pixel and returns the run length that ends the street, if any. */
function edgeRun(runs: Runs, colour: Colour, reference: Colour): number {
  runs.offStreet = distance(colour, reference) > EDGE_DISTANCE ? runs.offStreet + 1 : 0;
  runs.outline = Math.max(...colour) < OUTLINE_MAX_CHANNEL ? runs.outline + 1 : 0;
  if (runs.outline >= OUTLINE_RUN) return OUTLINE_RUN;
  return runs.offStreet >= EDGE_RUN ? EDGE_RUN : 0;
}

/** Pixels from the centreline to the street edge along one normal direction. */
function halfWidth({ raster, origin, normal, reference }: Walk): number {
  const runs = { offStreet: 0, outline: 0 };
  for (let step = 1; step <= MAX_HALF_WIDTH_PX; step += 1) {
    const colour = colourAt(raster, origin[0] + normal[0] * step, origin[1] + normal[1] * step);
    if (!colour) return step;
    const run = edgeRun(runs, colour, reference);
    if (run > 0) return step - run + 1;
  }
  return MAX_HALF_WIDTH_PX;
}

function segmentWidths(raster: RgbRaster, from: PixelPoint, to: PixelPoint): number[] {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (length < 1) return [];
  const tangent: PixelPoint = [(to[0] - from[0]) / length, (to[1] - from[1]) / length];
  const widths: number[] = [];
  for (let along = 0; along < length; along += SAMPLE_STEP_PX) {
    const origin: PixelPoint = [from[0] + tangent[0] * along, from[1] + tangent[1] * along];
    const reference = referenceColour(raster, origin);
    if (!reference) continue;
    const left = halfWidth({ raster, origin, normal: [-tangent[1], tangent[0]], reference });
    const right = halfWidth({ raster, origin, normal: [tangent[1], -tangent[0]], reference });
    widths.push(left + right);
  }
  return widths;
}

/** Median drawn width in pixels along a centreline, or 0 when no sample lies on the raster. */
export function measureStreetWidth(raster: RgbRaster, line: PixelPoint[]): number {
  const widths: number[] = [];
  for (let index = 0; index + 1 < line.length; index += 1) {
    widths.push(...segmentWidths(raster, line[index], line[index + 1]));
  }
  return widths.length === 0 ? 0 : median(widths);
}
