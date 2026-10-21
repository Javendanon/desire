/** Scanline fill of pixel-space polygons into a mask (even-odd rule). Pure. */
import type { PixelPoint } from './polyline.ts';
import type { RasterSize } from './raster-ops.ts';

export type PixelRing = PixelPoint[];

/** x positions where the horizontal line `y` crosses the ring's edges. */
function crossings(ring: PixelRing, y: number): number[] {
  const xs: number[] = [];
  for (let index = 0; index < ring.length; index += 1) {
    const [ax, ay] = ring[index];
    const [bx, by] = ring[(index + 1) % ring.length];
    const crosses = (ay <= y && by > y) || (by <= y && ay > y);
    if (crosses) xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
  }
  return xs;
}

function fillRow(mask: Uint8Array, size: RasterSize, row: number, xs: number[]) {
  xs.sort((first, second) => first - second);
  for (let pair = 0; pair + 1 < xs.length; pair += 2) {
    const from = Math.max(0, Math.ceil(xs[pair] - 0.5));
    const to = Math.min(size.width - 1, Math.floor(xs[pair + 1] - 0.5));
    if (to >= from) mask.fill(1, row * size.width + from, row * size.width + to + 1);
  }
}

/** Sets every pixel whose centre is inside the union of rings. O(height · edges + area). */
export function fillPolygons(mask: Uint8Array, size: RasterSize, rings: PixelRing[]) {
  for (let row = 0; row < size.height; row += 1) {
    const xs = rings.flatMap((ring) => crossings(ring, row + 0.5));
    if (xs.length > 1) fillRow(mask, size, row, xs);
  }
  return mask;
}
