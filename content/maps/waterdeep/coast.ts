// Interpreted shoreline and harbour basin for the scene. D05 has no vector coastline, so this
// polygon is a visual reading of the plan: it is labelled as interpretation and is not a claim
// about the exact shoreline. Control points and D05 ward boxes stay on land.

import type { Point2 } from '../../../src/lib/engine/math/hex.ts';
import {
  pointInPolygon,
  polygonSpans,
  type Polygon,
} from '../../../src/lib/engine/plan/polygon.ts';

/** West shore north-to-south, then the south shore west-to-east, then the east and north edges. */
export const WATERDEEP_COAST: Polygon = [
  { x: 290, z: 0 },
  { x: 380, z: 1730 },
  { x: 500, z: 4300 },
  { x: 500, z: 5111 },
  { x: 620, z: 5520 },
  { x: 1100, z: 5700 },
  { x: 1450, z: 5950 },
  { x: 1800, z: 6200 },
  { x: 2200, z: 6320 },
  { x: 2600, z: 6400 },
  { x: 3026, z: 6600 },
  { x: 3560, z: 6640 },
  { x: 3560, z: 0 },
];

/** Waterdeep Harbor, cut out of the south shore as an ellipse opening to the sea. */
const HARBOR_BASIN = { x: 1900, z: 5990, radiusX: 420, radiusZ: 300 } as const;

export function waterdeepIsLand(point: Point2): boolean {
  if (!pointInPolygon(WATERDEEP_COAST, point)) return false;
  const dx = (point.x - HARBOR_BASIN.x) / HARBOR_BASIN.radiusX;
  const dz = (point.z - HARBOR_BASIN.z) / HARBOR_BASIN.radiusZ;
  return dx * dx + dz * dz >= 1;
}

function basinSpan(z: number): [number, number] | null {
  const dz = (z - HARBOR_BASIN.z) / HARBOR_BASIN.radiusZ;
  if (Math.abs(dz) >= 1) return null;
  const half = HARBOR_BASIN.radiusX * Math.sqrt(1 - dz * dz);
  return [HARBOR_BASIN.x - half, HARBOR_BASIN.x + half];
}

/** Land runs at one z row, with the harbour gap removed. Used to build the ground mesh. */
export function waterdeepLandSpans(z: number): [number, number][] {
  const hole = basinSpan(z);
  const runs: [number, number][] = [];
  for (const [minX, maxX] of polygonSpans(WATERDEEP_COAST, z)) {
    if (!hole || maxX <= hole[0] || minX >= hole[1]) {
      runs.push([minX, maxX]);
      continue;
    }
    if (minX < hole[0]) runs.push([minX, hole[0]]);
    if (maxX > hole[1]) runs.push([hole[1], maxX]);
  }
  return runs;
}
