// Loads a diorama slice exported by tools/assets/export-slice.ts: meta, height field, houses,
// berths, trees and the stylised ground albedo. Metres, x east and z south from the slice corner.

export interface SliceMeta {
  width_m: number;
  depth_m: number;
  cell_m: number;
  columns: number;
  rows: number;
}

export interface SliceHouse {
  center: {
    x_m: number;
    z_m: number;
  };
  width_m: number;
  depth_m: number;
  rotation_radians: number;
  height_m: number;
  roof_rgb: [number, number, number];
  frontage: boolean;
}

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
  heights: Float32Array;
  houses: SliceHouse[];
  features: SliceFeatures;
  albedo: HTMLImageElement;
}

async function fetchOk(url: string): Promise<Response> {
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
    fetchOk(`${base}/meta.json`).then((response) => response.json() as Promise<SliceMeta>),
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
