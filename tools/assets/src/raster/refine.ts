/**
 * Turns raw per-pixel classes into surfaces: open water only, streets forced from vector
 * centrelines, piers told apart from roofs. Pure.
 */
import { paintPolylines, type PixelPolyline } from './polyline.ts';
import { components, dilate, erode, majority, neighbours4, type RasterSize } from './raster-ops.ts';
import { Surface } from './surface.ts';

export type RefineSpec = {
  classes: Uint8Array;
  size: RasterSize;
  streets: PixelPolyline[];
  /** Water components smaller than this fraction of the image are inland noise. */
  minWaterFraction: number;
  /** 1 inside the city. Outside it, roof browns are fields and terrain. Omitted: all urban. */
  urban?: Uint8Array;
  majorityRadius?: number;
  /** Land narrower than twice this radius is a pier candidate (morphological opening). */
  pierRadius?: number;
  /** Drawn outlines ring every pier. Water is dilated by this much to bridge them. */
  pierGapPixels?: number;
  /** A candidate is a pier when more than this share of its border is near water. */
  pierWetShare?: number;
};

const DEFAULT_MAJORITY_RADIUS = 2;
const DEFAULT_PIER_RADIUS = 20;
const DEFAULT_PIER_GAP = 3;
const DEFAULT_PIER_WET_SHARE = 0.4;
/**
 * A roof patch bordered mostly by water or pier is a pier junction, not a building. Measured on
 * Dock Ward: the cross-pier junction scores 0.77, the most exposed coastal block 0.44.
 */
const PIER_JUNCTION_SHARE = 0.6;
const PIER_SOURCES = new Set<number>([Surface.Roof, Surface.Outline, Surface.Ground]);

const maskOf = (classes: Uint8Array, wanted: number) =>
  Uint8Array.from(classes, (value) => (value === wanted ? 1 : 0));

/** Keeps only water components large enough to be sea. The rest becomes ground. O(pixels). */
function openWater(classes: Uint8Array, size: RasterSize, minFraction: number): Uint8Array {
  const { labels, sizes } = components(maskOf(classes, Surface.Water), size);
  const minimum = minFraction * classes.length;
  return Uint8Array.from(labels, (label) => (label >= 0 && sizes[label] >= minimum ? 1 : 0));
}

/** Land that a morphological opening removes: protrusions narrower than the radius. */
function narrowLand(water: Uint8Array, size: RasterSize, radius: number): Uint8Array {
  const land = Uint8Array.from(water, (value) => (value === 0 ? 1 : 0));
  const opened = dilate(erode(land, size, radius), size, radius);
  return Uint8Array.from(land, (value, index) => (value === 1 && opened[index] === 0 ? 1 : 0));
}

type Tally = {
  border: Float64Array;
  wet: Float64Array;
};

type BorderSpec = {
  labels: Int32Array;
  size: RasterSize;
  near: Uint8Array;
  tally: Tally;
};

function tallyPixel({ labels, size, near, tally }: BorderSpec, index: number) {
  const label = labels[index];
  for (const next of neighbours4(index, size)) {
    if (labels[next] === label) continue;
    tally.border[label] += 1;
    if (near[next] === 1) tally.wet[label] += 1;
  }
}

function tallyBorder(spec: BorderSpec) {
  for (let index = 0; index < spec.labels.length; index += 1) {
    if (spec.labels[index] >= 0) tallyPixel(spec, index);
  }
}

/** Share of each candidate component's border that touches `near`. O(pixels). */
function wetShares(candidates: Uint8Array, size: RasterSize, near: Uint8Array) {
  const { labels, sizes } = components(candidates, size);
  const tally = { border: new Float64Array(sizes.length), wet: new Float64Array(sizes.length) };
  tallyBorder({ labels, size, near, tally });
  const shares = Array.from(tally.border, (count, label) =>
    (count > 0 ? tally.wet[label] / count : 0));
  return { labels, shares };
}

function markPiers(classes: Uint8Array, spec: RefineSpec, water: Uint8Array) {
  const narrow = narrowLand(water, spec.size, spec.pierRadius ?? DEFAULT_PIER_RADIUS);
  const candidates = Uint8Array.from(narrow, (value, index) =>
    (value === 1 && PIER_SOURCES.has(classes[index]) ? 1 : 0));
  const near = dilate(water, spec.size, spec.pierGapPixels ?? DEFAULT_PIER_GAP);
  const { labels, shares } = wetShares(candidates, spec.size, near);
  const threshold = spec.pierWetShare ?? DEFAULT_PIER_WET_SHARE;
  for (let index = 0; index < classes.length; index += 1) {
    if (labels[index] >= 0 && shares[labels[index]] > threshold) classes[index] = Surface.Pier;
  }
  markPierJunctions(classes, spec, water);
}

/** Wide pier crossings survive the opening. They are roof patches ringed by water and pier. */
function markPierJunctions(classes: Uint8Array, spec: RefineSpec, water: Uint8Array) {
  const wetOrPier = Uint8Array.from(water, (value, index) =>
    (value === 1 || classes[index] === Surface.Pier ? 1 : 0));
  const near = dilate(wetOrPier, spec.size, spec.pierGapPixels ?? DEFAULT_PIER_GAP);
  const { labels, shares } = wetShares(maskOf(classes, Surface.Roof), spec.size, near);
  for (let index = 0; index < classes.length; index += 1) {
    const junction = labels[index] >= 0 && shares[labels[index]] > PIER_JUNCTION_SHARE;
    if (junction) classes[index] = Surface.Pier;
  }
}

const ROOFS = new Set<number>([Surface.Roof, Surface.RedRoof]);

/** Green that is not open water is vegetation: a garden in the city, terrain outside. */
function settleLand(classes: Uint8Array, index: number, urban: boolean) {
  if (classes[index] === Surface.Water) classes[index] = urban ? Surface.Garden : Surface.Ground;
  else if (!urban && ROOFS.has(classes[index])) classes[index] = Surface.Ground;
}

/** Refines raw classes. Order: speckle filter, open water, land, forced streets, piers. */
export function refineSurfaces(spec: RefineSpec): Uint8Array {
  const { size } = spec;
  const classes = majority(spec.classes, size, spec.majorityRadius ?? DEFAULT_MAJORITY_RADIUS);
  const water = openWater(classes, size, spec.minWaterFraction);
  const streets = paintPolylines(new Uint8Array(classes.length), size, spec.streets);
  for (let index = 0; index < classes.length; index += 1) {
    if (water[index] === 1) classes[index] = Surface.Water;
    else settleLand(classes, index, (spec.urban?.[index] ?? 1) === 1);
    if (streets[index] === 1 && water[index] === 0) classes[index] = Surface.Street;
  }
  markPiers(classes, spec, water);
  return classes;
}
