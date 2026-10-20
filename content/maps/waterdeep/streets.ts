// Raster-traced axes: the precise Market approach pilot, then one coarse axis per ward so the
// whole-city view keeps recognisable streets instead of a free block grid. Pixel checkpoints,
// tolerances and the residual scope are in docs/reports/d13-street-comparison.md.
import type { Point2 } from '../../../src/lib/engine/math/hex.ts';
import { distanceToPath } from '../../../src/lib/engine/plan/corridors.ts';
import type { MapRoad } from '../../../src/lib/engine/plan/map-definition.ts';
import { pointInPolygon } from '../../../src/lib/engine/plan/polygon.ts';
import { WATERDEEP_REFERENCE } from './reference.ts';

const SCALE = WATERDEEP_REFERENCE.calibration.meters_per_pixel;
type Pixel = readonly [number, number];

function fromPixel([x, y]: Pixel): Point2 {
  return { x: x * SCALE, z: y * SCALE };
}

export const WATERDEEP_ROAD_TRACES = [
  {
    id: 'traders-way', widthPx: 40,
    pixels: [[1200, 2545], [1280, 2580], [1400, 2585], [1800, 2585],
      [1980, 2585], [2040, 2610], [2080, 2650]],
  },
  {
    id: 'bazaar-street', widthPx: 34,
    pixels: [[1435, 2900], [1610, 2900], [1750, 2890], [1900, 2850],
      [2040, 2730], [2080, 2690]],
  },
  {
    id: 'the-high-road', widthPx: 42,
    pixels: [[2080, 2450], [2080, 2600], [2080, 2700], [2085, 2830], [2095, 3000]],
  },
  // From the North Gate south to the Market approach above; ends are pilot cut lines.
  {
    id: 'the-high-road-north', widthPx: 44,
    pixels: [[2160, 560], [2125, 700], [2085, 850], [2075, 1100],
      [2077, 1500], [2081, 1900], [2083, 2250], [2080, 2450]],
  },
  {
    id: 'julthoon-street', widthPx: 36,
    pixels: [[640, 2330], [1000, 2328], [1400, 2325], [1800, 2320], [2060, 2315]],
  },
  {
    id: 'waterdeep-way', widthPx: 38,
    pixels: [[1680, 4070], [1900, 4068], [2100, 4060], [2260, 4050]],
  },
  {
    id: 'the-way-of-the-dragon', widthPx: 40,
    pixels: [[2494, 4880], [2522, 5080], [2549, 5280], [2570, 5480],
      [2596, 5680], [2615, 5780]],
  },
  {
    id: 'dock-street', widthPx: 28,
    pixels: [[2150, 5538], [2110, 5573], [2070, 5606], [2030, 5635]],
  },
  {
    id: 'the-beaconmarch', widthPx: 22,
    pixels: [[2815, 2948], [2880, 3000], [2980, 3095], [2940, 3250],
      [2915, 3350], [2905, 3550]],
  },
] as const;

export const WATERDEEP_ROADS: readonly MapRoad[] = WATERDEEP_ROAD_TRACES.map((trace) => ({
  id: trace.id,
  widthM: trace.widthPx * SCALE,
  points: trace.pixels.map(fromPixel),
}));

// The square is open ground, not another circle around its D05 label point.
const MARKET_PIXELS: readonly Pixel[] = [
  [1410, 2675], [1670, 2660], [1940, 2650], [2000, 2690], [1910, 2750],
  [1790, 2790], [1630, 2795], [1495, 2820], [1390, 2770],
];
export const WATERDEEP_MARKET = MARKET_PIXELS.map(fromPixel);
const MARKET_BOUNDARY = [...WATERDEEP_MARKET, WATERDEEP_MARKET[0]];

/** O(traced segments). Circumscribed roofs also clear the square-ended render strips. */
export function waterdeepRoadClear(point: Point2, roofRadius: number): boolean {
  if (pointInPolygon(WATERDEEP_MARKET, point)) return false;
  if (distanceToPath(MARKET_BOUNDARY, point) <= roofRadius) return false;
  return WATERDEEP_ROADS.every((road) =>
    distanceToPath(road.points, point) > road.widthM / Math.SQRT2 + roofRadius);
}
