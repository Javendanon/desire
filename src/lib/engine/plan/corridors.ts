// Shared corridor math for lot clearance and visible road strips. No city-specific geography.
import type { Point2 } from '../math/hex.ts';
import type { MapRoad } from './map-definition.ts';
import type { Polygon } from './polygon.ts';

function segmentDistance(a: Point2, b: Point2, point: Point2): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSquared = dx * dx + dz * dz;
  const along = lengthSquared === 0 ? 0 :
    Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSquared));
  return Math.hypot(point.x - a.x - along * dx, point.z - a.z - along * dz);
}

/** Closest distance to a polyline, including its endpoints. O(segments). */
export function distanceToPath(points: readonly Point2[], point: Point2): number {
  let distance = Infinity;
  for (let index = 1; index < points.length; index++) {
    distance = Math.min(distance, segmentDistance(points[index - 1], points[index], point));
  }
  return distance;
}

function segmentQuad(a: Point2, b: Point2, width: number): Polygon {
  const length = Math.hypot(b.x - a.x, b.z - a.z);
  if (length === 0) throw new Error('road corridor: consecutive points must differ');
  const dx = ((b.x - a.x) / length) * width / 2;
  const dz = ((b.z - a.z) / length) * width / 2;
  // Square extensions overlap at bends, avoiding cracks without a separate junction mesh.
  return [
    { x: a.x - dx - dz, z: a.z - dz + dx },
    { x: b.x + dx - dz, z: b.z + dz + dx },
    { x: b.x + dx + dz, z: b.z + dz - dx },
    { x: a.x - dx + dz, z: a.z - dz - dx },
  ];
}

/** One overlapping quad per segment. O(segments), independent of the sector grid. */
export function corridorQuads(road: MapRoad): Polygon[] {
  if (!(road.widthM > 0)) throw new Error(`road corridor ${road.id}: width must be positive`);
  return road.points.slice(1).map((point, index) =>
    segmentQuad(road.points[index], point, road.widthM));
}
