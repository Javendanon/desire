// Loads a diorama slice exported by tools/assets/export-slice.ts: meta, height field, houses,
// berths, trees and the stylised ground albedo. Metres, x east and z south from the slice corner.

import { readSector, type CentredHouse } from '../map/sector-format.ts';
import { featuresInFrame, sectorsOverlapping, type GridShape } from './sector-slice.ts';

export interface SliceMeta {
  width_m: number;
  depth_m: number;
  /** The slice's north-west corner in map metres. */
  origin_m: {
    x_m: number;
    z_m: number;
  };
  cell_m: number;
  columns: number;
  rows: number;
}

/** A house of the slice, centred in slice metres, with its stable id (block × 4096 + lot). */
export type SliceHouse = CentredHouse & {
  id: number;
};

/** A ship moored alongside a pier, keel along local +Z after a turn of `heading_radians`. */
export interface SliceBerth {
  x_m: number;
  z_m: number;
  heading_radians: number;
}

export interface SliceTree {
  x_m: number;
  z_m: number;
  scale: number;
}

export interface SliceFeatures {
  berths: SliceBerth[];
  trees: SliceTree[];
}

export interface Slice {
  meta: SliceMeta;
  /** City-wide roof tone centres, when the houses come from sectors (index.json). */
  roofCentres?: [number, number, number][];
  heights: Float32Array;
  houses: SliceHouse[];
  features: SliceFeatures;
  albedo: HTMLImageElement;
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const positive = (value: unknown) => finite(value) && value > 0;
const count = (value: unknown) => positive(value) && Number.isInteger(value);
function point(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const fields = value as Record<string, unknown>;
  return finite(fields.x_m) && finite(fields.z_m);
}

/** What each meta field must hold, and how a failure names it. */
const META_RULES: [keyof SliceMeta, (value: unknown) => boolean, string][] = [
  ['width_m', positive, 'a positive number'],
  ['depth_m', positive, 'a positive number'],
  ['cell_m', positive, 'a positive number'],
  ['columns', count, 'a positive whole number'],
  ['rows', count, 'a positive whole number'],
  ['origin_m', point, 'an { x_m, z_m } point'],
];

/** The slice's `meta.json`, checked field by field, so a bad file fails here by name. */
export function checkSliceMeta(meta: unknown): SliceMeta {
  if (typeof meta !== 'object' || meta === null) throw new Error('slice meta: not an object');
  const fields = meta as Record<string, unknown>;
  for (const [field, holds, what] of META_RULES) {
    if (!holds(fields[field])) throw new Error(`slice meta: ${field} must be ${what}`);
  }
  return meta as SliceMeta;
}

export async function fetchOk(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`slice file ${url}: HTTP ${response.status}`);
  return response;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`slice albedo ${url} could not be decoded`));
    image.src = url;
  });
}

export async function loadSlice(base: string): Promise<Slice> {
  const [meta, heights, houses, features, albedo] = await Promise.all([
    fetchOk(`${base}/meta.json`).then((response) => response.json()).then(checkSliceMeta),
    fetchOk(`${base}/heights.bin`).then((response) => response.arrayBuffer()),
    fetchOk(`${base}/houses.json`).then((response) => response.json() as Promise<SliceHouse[]>),
    fetchOk(`${base}/features.json`).then((response) =>
      response.json() as Promise<SliceFeatures>),
    loadImage(`${base}/albedo.png`),
  ]);
  const field = new Float32Array(heights);
  if (field.length !== meta.columns * meta.rows) {
    const expected = meta.columns * meta.rows;
    throw new Error(`slice heights hold ${field.length} cells, meta says ${expected}`);
  }
  return { meta, heights: field, houses, features, albedo };
}

/** index.json written by the sectors stage. */
export interface SectorIndex {
  format: string;
  grid: GridShape;
  roof_centres: [number, number, number][];
  sectors: { index: number }[];
}

export const SECTOR_FORMAT = 'desire.sector-render/1';

/**
 * The slice with its houses, berths and trees read from sector payloads (`dir`), and the
 * city-wide roof palette. Only the sectors that touch the slice are fetched. Terrain and albedo
 * stay the slice's own.
 */
export async function withSectorFeatures(slice: Slice, dir: string): Promise<Slice> {
  const index = await fetchOk(`${dir}/index.json`).then((response) =>
    response.json() as Promise<SectorIndex>);
  if (index.format !== SECTOR_FORMAT) throw new Error(`${dir}: format ${index.format}`);
  const frame = { x_m: slice.meta.origin_m.x_m, z_m: slice.meta.origin_m.z_m,
    width_m: slice.meta.width_m, depth_m: slice.meta.depth_m };
  const listed = new Set(index.sectors.map((entry) => entry.index));
  const wanted = sectorsOverlapping(index.grid, frame).filter((sector) => listed.has(sector));
  const sectors = await Promise.all(wanted.map((sector) =>
    fetchOk(`${dir}/${sector}.render.bin`)
      .then((response) => response.arrayBuffer())
      .then((buffer) => readSector(new Uint8Array(buffer)))));
  const { houses, berths, trees } = featuresInFrame(sectors, frame);
  return { ...slice, houses, features: { berths, trees }, roofCentres: index.roof_centres };
}
