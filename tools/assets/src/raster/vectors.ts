/** GeoJSON layers of the source map, projected into raster pixels. Pure: takes parsed JSON. */
import type { createMercatorFrame, LngLat } from './frame.ts';
import type { PixelPoint, PixelPolyline } from './polyline.ts';
import type { PixelRing } from './polygon-fill.ts';
import { measureStreetWidth, type RgbRaster } from './street-width.ts';

type Frame = ReturnType<typeof createMercatorFrame>;
export type LineFeature = {
  properties: {
    Name?: string | null;
    Type?: string | null;
  };
  geometry: {
    type: 'LineString';
    coordinates: LngLat[];
  };
};
export type PolygonFeature = {
  properties: {
    Name?: string | null;
  };
  geometry: {
    type: 'Polygon';
    coordinates: LngLat[][];
  };
};
export type StreetWidthPolicy = {
  /** Width used when a centreline cannot be measured (off the raster). */
  fallbackPx: Record<string, number>;
  defaultPx: number;
  minPx: number;
  maxPx: number;
};
/** A crop's top-left corner in full-raster pixels. */
export type Offset = PixelPoint;

const project = (frame: Frame, offset: Offset) => (point: LngLat): PixelPoint => {
  const [x, y] = frame.lngLatToPixel(point);
  return [x - offset[0], y - offset[1]];
};

/** Outer rings of polygon features (wards), in crop pixels. */
export function polygonRings(
  features: PolygonFeature[], frame: Frame, offset: Offset,
): PixelRing[] {
  return features.map((feature) => feature.geometry.coordinates[0].map(project(frame, offset)));
}

const clamp = (value: number, policy: StreetWidthPolicy) =>
  Math.min(policy.maxPx, Math.max(policy.minPx, value));

/** Street centrelines with widths measured on the full raster, expressed in crop pixels. */
export function measuredStreets(spec: {
  features: LineFeature[];
  frame: Frame;
  raster: RgbRaster;
  offset: Offset;
  policy: StreetWidthPolicy;
}): PixelPolyline[] {
  const { features, frame, raster, offset, policy } = spec;
  return features.map((feature) => {
    const full = feature.geometry.coordinates.map(project(frame, [0, 0]));
    const measured = measureStreetWidth(raster, full);
    const fallback = policy.fallbackPx[feature.properties.Type ?? ''] ?? policy.defaultPx;
    return {
      width: measured > 0 ? clamp(measured, policy) : fallback,
      points: full.map(([x, y]) => [x - offset[0], y - offset[1]] as PixelPoint),
    };
  });
}
