/** Rasterises polylines of a given pixel width into a mask. Pure. */
import type { RasterSize } from './raster-ops.ts';

export type PixelPoint = [number, number];
export type PixelPolyline = {
  points: PixelPoint[];
  /** Full width in pixels. Pixel centres within half of it are painted. */
  width: number;
};

type Segment = {
  from: PixelPoint;
  to: PixelPoint;
  half: number;
};

function paintSegment(mask: Uint8Array, size: RasterSize, segment: Segment) {
  const { from: [ax, ay], to: [bx, by], half } = segment;
  const dx = bx - ax;
  const dy = by - ay;
  const length2 = dx * dx + dy * dy || 1;
  const minX = Math.max(0, Math.floor(Math.min(ax, bx) - half));
  const maxX = Math.min(size.width - 1, Math.ceil(Math.max(ax, bx) + half));
  const minY = Math.max(0, Math.floor(Math.min(ay, by) - half));
  const maxY = Math.min(size.height - 1, Math.ceil(Math.max(ay, by) + half));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      const t = Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / length2));
      const distance2 = (cx - ax - t * dx) ** 2 + (cy - ay - t * dy) ** 2;
      if (distance2 <= half * half) mask[y * size.width + x] = 1;
    }
  }
}

/** Marks pixels whose centre lies within half the width of any segment. O(Σ segment area). */
export function paintPolylines(mask: Uint8Array, size: RasterSize, lines: PixelPolyline[]) {
  for (const line of lines) {
    for (let index = 0; index + 1 < line.points.length; index += 1) {
      const [from, to] = [line.points[index], line.points[index + 1]];
      paintSegment(mask, size, { from, to, half: line.width / 2 });
    }
  }
  return mask;
}
