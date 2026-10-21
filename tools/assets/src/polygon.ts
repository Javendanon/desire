/** Plan polygons that may be concave: containment and overlap. Pure. */
import type { Plan } from './types.ts';

/** Even-odd containment. Points on the boundary may go either way. O(n). */
export function pointInRing(point: Plan, ring: Plan[]): boolean {
  let inside = false;
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index];
    const b = ring[(index + ring.length - 1) % ring.length];
    const crosses = (a.z_m > point.z_m) !== (b.z_m > point.z_m);
    if (crosses && point.x_m < ((b.x_m - a.x_m) * (point.z_m - a.z_m)) / (b.z_m - a.z_m) + a.x_m) {
      inside = !inside;
    }
  }
  return inside;
}

const cross = (o: Plan, a: Plan, b: Plan) =>
  (a.x_m - o.x_m) * (b.z_m - o.z_m) - (a.z_m - o.z_m) * (b.x_m - o.x_m);

/** Proper crossing of two segments. Touching endpoints and collinear overlaps do not count. */
function segmentsCross(a: Plan, b: Plan, c: Plan, d: Plan): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function edgesCross(first: Plan[], second: Plan[]): boolean {
  for (let i = 0; i < first.length; i += 1) {
    const a = first[i];
    const b = first[(i + 1) % first.length];
    for (let j = 0; j < second.length; j += 1) {
      if (segmentsCross(a, b, second[j], second[(j + 1) % second.length])) return true;
    }
  }
  return false;
}

const centroid = (ring: Plan[]): Plan => ({
  x_m: ring.reduce((sum, point) => sum + point.x_m, 0) / ring.length,
  z_m: ring.reduce((sum, point) => sum + point.z_m, 0) / ring.length,
});

/**
 * Interiors intersect: an edge crossing, or one ring's centre inside the other (containment).
 * Rings that only touch along an edge do not overlap. O(n · m).
 */
export function ringsOverlap(first: Plan[], second: Plan[]): boolean {
  if (edgesCross(first, second)) return true;
  return pointInRing(centroid(first), second) || pointInRing(centroid(second), first);
}
