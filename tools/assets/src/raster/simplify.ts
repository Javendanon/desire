/** Douglas–Peucker simplification for open polylines and closed rings. Pure. */
import type { PixelPoint } from './polyline.ts';

function distanceToChord([px, py]: PixelPoint, [ax, ay]: PixelPoint, [bx, by]: PixelPoint) {
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy);
  if (length === 0) return Math.hypot(px - ax, py - ay);
  return Math.abs(dy * px - dx * py + bx * ay - by * ax) / length;
}

/** Keeps both ends and every point farther than `tolerance` from its chord. O(n log n) typical. */
export function simplifyLine(points: PixelPoint[], tolerance: number): PixelPoint[] {
  if (points.length <= 2) return points.slice();
  let farthest = 0;
  let farthestIndex = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = distanceToChord(points[index], points[0], points[points.length - 1]);
    if (distance > farthest) {
      farthest = distance;
      farthestIndex = index;
    }
  }
  if (farthest <= tolerance) return [points[0], points[points.length - 1]];
  const head = simplifyLine(points.slice(0, farthestIndex + 1), tolerance);
  const tail = simplifyLine(points.slice(farthestIndex), tolerance);
  return [...head.slice(0, -1), ...tail];
}

/** Simplifies a closed ring (first point not repeated) split at the point farthest from start. */
export function simplifyRing(ring: PixelPoint[], tolerance: number): PixelPoint[] {
  if (ring.length <= 3) return ring.slice();
  let split = 1;
  for (let index = 2; index < ring.length; index += 1) {
    const [x, y] = ring[index];
    const [sx, sy] = ring[split];
    if (Math.hypot(x - ring[0][0], y - ring[0][1]) > Math.hypot(sx - ring[0][0], sy - ring[0][1])) {
      split = index;
    }
  }
  const first = simplifyLine(ring.slice(0, split + 1), tolerance);
  const second = simplifyLine([...ring.slice(split), ring[0]], tolerance);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}
