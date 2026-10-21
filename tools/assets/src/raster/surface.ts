/**
 * Per-pixel surface classes for an illustrated city raster. Pure, no image I/O.
 *
 * Thresholds were measured on the label-free Tych Maps Waterdeep raster (9 × 9 pixel means at
 * known points). Water is the only surface where green clearly dominates red while blue stays
 * near red. Vegetation is also green but has far less blue.
 */
export const Surface = {
  Ground: 0,
  Water: 1,
  Roof: 2,
  Street: 3,
  Outline: 4,
  RedRoof: 5,
  Pier: 6,
} as const;
export type SurfaceClass = (typeof Surface)[keyof typeof Surface];

const OUTLINE_MAX_CHANNEL = 50;
const WATER_GREEN_OVER_RED = 8;
const WATER_BLUE_BELOW_RED = 12;
const RED_ROOF_RED_OVER_GREEN = 35;
const RED_ROOF_RED_OVER_BLUE = 45;
const ROOF_RED_OVER_BLUE = 18;
const ROOF_RED_OVER_GREEN = 4;
const ROOF_MAX_CHANNEL = 125;
const STREET_MAX_SATURATION = 22;
const STREET_MIN_CHANNEL = 100;
const RGB = 3;

export function classifyPixel(r: number, g: number, b: number): SurfaceClass {
  const max = Math.max(r, g, b);
  const saturation = max - Math.min(r, g, b);
  if (max < OUTLINE_MAX_CHANNEL) return Surface.Outline;
  if (g > r + WATER_GREEN_OVER_RED && b >= r - WATER_BLUE_BELOW_RED) return Surface.Water;
  if (r > g + RED_ROOF_RED_OVER_GREEN && r > b + RED_ROOF_RED_OVER_BLUE) return Surface.RedRoof;
  if (r > b + ROOF_RED_OVER_BLUE && r > g + ROOF_RED_OVER_GREEN && max < ROOF_MAX_CHANNEL) {
    return Surface.Roof;
  }
  if (saturation < STREET_MAX_SATURATION && max > STREET_MIN_CHANNEL) return Surface.Street;
  return Surface.Ground;
}

/** Classifies a row-major RGB buffer of `pixels` pixels. O(pixels). */
export function classifyRgb(rgb: Uint8Array, pixels: number): Uint8Array {
  if (rgb.length !== pixels * RGB) {
    throw new Error(`classifyRgb needs 3 bytes per pixel: ${rgb.length} bytes for ${pixels}`);
  }
  const classes = new Uint8Array(pixels);
  for (let index = 0; index < pixels; index += 1) {
    const offset = index * RGB;
    classes[index] = classifyPixel(rgb[offset], rgb[offset + 1], rgb[offset + 2]);
  }
  return classes;
}
