// Roof tones for the town: k-means over the colours sampled from the map, each centre mixed with
// its nearest tint from the design canvas. A painted map colour is far darker than a daylight
// albedo; the mix keeps the ward's identity with the design's brightness. Pure.

import type { SliceHouse } from './slice-data.ts';

type Rgb = [number, number, number];

const ROOF_TONES = 6;
const KMEANS_ROUNDS = 12;
/** Roof tints of the design canvas ("Farol en la niebla"), as D13 uses them. */
const DESIGN_ROOFS: Rgb[] = [
  [124, 135, 146], [184, 113, 79], [95, 106, 116], [143, 135, 112], [163, 95, 69],
];
const DESIGN_SHARE = 0.55;

export interface RoofPalette {
  colours: string[];
  labels: number[];
}

const distance2 = (a: Rgb, b: Rgb) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

function nearest(colour: Rgb, centres: Rgb[]): number {
  let best = 0;
  centres.forEach((centre, index) => {
    if (distance2(colour, centre) < distance2(colour, centres[best])) best = index;
  });
  return best;
}

function mean(colours: Rgb[], fallback: Rgb): Rgb {
  if (colours.length === 0) return fallback;
  return [0, 1, 2].map((channel) =>
    colours.reduce((sum, colour) => sum + colour[channel], 0) / colours.length) as Rgb;
}

/** Hue-led match: colours compared with their brightness removed. */
function chroma(value: Rgb): Rgb {
  const sum = value[0] + value[1] + value[2] || 1;
  return value.map((channel) => (channel / sum) * 255) as Rgb;
}

function toHex(colour: Rgb): string {
  const tint = DESIGN_ROOFS[nearest(chroma(colour), DESIGN_ROOFS.map(chroma))];
  const mixed = colour.map((channel, index) =>
    channel * (1 - DESIGN_SHARE) + tint[index] * DESIGN_SHARE);
  return `#${mixed.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
}

/** Deterministic k-means seeded from evenly spaced houses. O(houses · tones · rounds). */
export function roofPalette(houses: SliceHouse[]): RoofPalette {
  const colours = houses.map((house) => house.roof_rgb);
  const count = Math.min(ROOF_TONES, colours.length);
  let centres: Rgb[] = Array.from({ length: count }, (_, index) =>
    colours[Math.floor((index * colours.length) / count)]);
  let labels = colours.map((colour) => nearest(colour, centres));
  for (let round = 0; round < KMEANS_ROUNDS; round += 1) {
    centres = centres.map((centre, tone) =>
      mean(colours.filter((_, house) => labels[house] === tone), centre));
    labels = colours.map((colour) => nearest(colour, centres));
  }
  return { colours: centres.map(toHex), labels };
}
