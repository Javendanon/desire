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
  Garden: 7,
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
/** Yellow courtyards (North Ward): warm and bright, blue well below green. */
const GARDEN_MIN_RED = 140;
const GARDEN_MIN_GREEN = 130;
const GARDEN_BLUE_BELOW_GREEN = 35;
const STREET_MIN_CHANNEL = 100;
const RGB = 3;

type Pixel = {
  r: number;
  g: number;
  b: number;
  max: number;
  saturation: number;
};

/** Ordered rules: the first match wins, anything else is ground. */
const RULES: [SurfaceClass, (pixel: Pixel) => boolean][] = [
  [Surface.Outline, ({ max }) => max < OUTLINE_MAX_CHANNEL],
  [Surface.Water, ({ r, g, b }) => g > r + WATER_GREEN_OVER_RED && b >= r - WATER_BLUE_BELOW_RED],
  [Surface.RedRoof, ({ r, g, b }) =>
    r > g + RED_ROOF_RED_OVER_GREEN && r > b + RED_ROOF_RED_OVER_BLUE],
  [Surface.Roof, ({ r, g, b, max }) =>
    r > b + ROOF_RED_OVER_BLUE && r > g + ROOF_RED_OVER_GREEN && max < ROOF_MAX_CHANNEL],
  [Surface.Garden, ({ r, g, b }) =>
    r > GARDEN_MIN_RED && g > GARDEN_MIN_GREEN && b < g - GARDEN_BLUE_BELOW_GREEN],
  [Surface.Street, ({ max, saturation }) =>
    saturation < STREET_MAX_SATURATION && max > STREET_MIN_CHANNEL],
];

export function classifyPixel(r: number, g: number, b: number): SurfaceClass {
  const max = Math.max(r, g, b);
  const pixel = { r, g, b, max, saturation: max - Math.min(r, g, b) };
  return RULES.find(([, matches]) => matches(pixel))?.[0] ?? Surface.Ground;
}

const COLOURS = 1 << 24;
const UNSEEN = 0xff;

/**
 * Classifies a row-major RGB buffer of `pixels` pixels. O(pixels). The rules run once per
 * distinct colour: a 16 MB table keyed by the 24-bit colour remembers each answer, since a map
 * has far fewer colours than pixels.
 */
export function classifyRgb(rgb: Uint8Array, pixels: number): Uint8Array {
  if (rgb.length !== pixels * RGB) {
    throw new Error(`classifyRgb needs 3 bytes per pixel: ${rgb.length} bytes for ${pixels}`);
  }
  const known = new Uint8Array(COLOURS).fill(UNSEEN);
  const classes = new Uint8Array(pixels);
  for (let index = 0; index < pixels; index += 1) {
    const offset = index * RGB;
    const r = rgb[offset];
    const g = rgb[offset + 1];
    const b = rgb[offset + 2];
    const colour = (r << 16) | (g << 8) | b;
    if (known[colour] === UNSEEN) known[colour] = classifyPixel(r, g, b);
    classes[index] = known[colour];
  }
  return classes;
}
