// Loads a diorama slice exported by tools/assets/export-slice.ts: meta, height field, houses and
// the stylised ground albedo. Coordinates are metres, x east and z south from the slice corner.

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

export interface Slice {
  meta: SliceMeta;
  heights: Float32Array;
  houses: SliceHouse[];
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
  const [meta, heights, houses, albedo] = await Promise.all([
    fetchOk(`${base}/meta.json`).then((response) => response.json() as Promise<SliceMeta>),
    fetchOk(`${base}/heights.bin`).then((response) => response.arrayBuffer()),
    fetchOk(`${base}/houses.json`).then((response) => response.json() as Promise<SliceHouse[]>),
    loadImage(`${base}/albedo.png`),
  ]);
  const field = new Float32Array(heights);
  if (field.length !== meta.columns * meta.rows) {
    const expected = meta.columns * meta.rows;
    throw new Error(`slice heights hold ${field.length} cells, meta says ${expected}`);
  }
  return { meta, heights: field, houses, albedo };
}
