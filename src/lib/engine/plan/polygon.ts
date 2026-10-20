// Point-in-polygon and scanline spans for land areas. Pure, map-agnostic geometry.

import type { Point2 } from '../math/hex.ts';

export type Polygon = readonly Point2[];

const EPSILON = 1e-9;

function onSegment(a: Point2, b: Point2, point: Point2): boolean {
  const cross = (b.x - a.x) * (point.z - a.z) - (b.z - a.z) * (point.x - a.x);
  if (Math.abs(cross) > EPSILON) return false;
  const minX = Math.min(a.x, b.x) - EPSILON;
  const maxX = Math.max(a.x, b.x) + EPSILON;
  const minZ = Math.min(a.z, b.z) - EPSILON;
  const maxZ = Math.max(a.z, b.z) + EPSILON;
  return point.x >= minX && point.x <= maxX && point.z >= minZ && point.z <= maxZ;
}

/** Even-odd test. The boundary counts as inside so a gate on the shore is never lost. */
export function pointInPolygon(polygon: Polygon, point: Point2): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (onSegment(a, b, point)) return true;
    if (a.z > point.z === b.z > point.z) continue;
    const x = ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z) + a.x;
    if (point.x < x) inside = !inside;
  }
  return inside;
}

/** The x runs of `polygon` at one z. O(edges log edges). */
export function polygonSpans(polygon: Polygon, z: number): [number, number][] {
  const crossings: number[] = [];
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const crosses = a.z <= z !== b.z <= z;
    if (!crosses) continue;
    crossings.push(((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x);
  }
  crossings.sort((left, right) => left - right);
  const spans: [number, number][] = [];
  for (let i = 0; i + 1 < crossings.length; i += 2) {
    spans.push([crossings[i], crossings[i + 1]]);
  }
  return spans;
}
