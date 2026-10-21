/**
 * Georeference of a stitched Web Mercator raster (slippy-map tiles of 256 px).
 *
 * World metres: x east and z south from the image's north-west corner. Ground metres per pixel
 * use the Mercator scale at the frame's north edge; over a city-sized frame the scale changes
 * by well under one percent, inside the registration residual.
 */
export type LngLat = [number, number];
export type MercatorFrameSpec = {
  zoom: number;
  west: number;
  north: number;
};

const EARTH_RADIUS_M = 6_378_137;
const TILE_PIXELS = 256;
const DEGREES_PER_TURN = 360;
const HALF_TURN_DEG = 180;

const toRadians = (degrees: number) => (degrees * Math.PI) / HALF_TURN_DEG;
const toDegrees = (radians: number) => (radians * HALF_TURN_DEG) / Math.PI;

function worldPixelX(lng: number, scale: number) {
  return ((lng + HALF_TURN_DEG) / DEGREES_PER_TURN) * scale;
}

function worldPixelY(lat: number, scale: number) {
  const radians = toRadians(lat);
  return ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * scale;
}

export function createMercatorFrame({ zoom, west, north }: MercatorFrameSpec) {
  const scale = TILE_PIXELS * 2 ** zoom;
  const originX = worldPixelX(west, scale);
  const originY = worldPixelY(north, scale);
  const metresPerPixel = ((2 * Math.PI * EARTH_RADIUS_M) / scale) * Math.cos(toRadians(north));
  return {
    metresPerPixel,
    lngLatToPixel([lng, lat]: LngLat): [number, number] {
      return [worldPixelX(lng, scale) - originX, worldPixelY(lat, scale) - originY];
    },
    pixelToLngLat([x, y]: [number, number]): LngLat {
      const lng = ((x + originX) / scale) * DEGREES_PER_TURN - HALF_TURN_DEG;
      const n = Math.PI - (2 * Math.PI * (y + originY)) / scale;
      return [lng, toDegrees(Math.atan(Math.sinh(n)))];
    },
    pixelToWorld([x, y]: [number, number]) {
      return { x_m: x * metresPerPixel, z_m: y * metresPerPixel };
    },
  };
}
