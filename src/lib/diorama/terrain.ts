// Ground of the slice: one mesh over the height field, textured with the stylised albedo.
// Heights are softened with their neighbours so the shore slopes instead of stepping. A tiled
// cobble texture overlays the albedo, so the ground holds detail at street zoom.

import * as pc from 'playcanvas';

import { gridNormals } from './sector-streaming.ts';
import type { Slice } from './slice-data.ts';

const SMOOTH_PASSES = 2;
/** One repeat of the cobble detail texture covers this many metres. */
const DETAIL_TILE_M = 3;

type Field = {
  values: Float32Array;
  columns: number;
  rows: number;
};

/** Mean of the 3 × 3 neighbourhood of cell `index`, clipped at the field's edge. */
function neighbourMean(field: Field, index: number): number {
  const { values, columns, rows } = field;
  const row = Math.floor(index / columns);
  const column = index % columns;
  let sum = 0;
  let count = 0;
  for (let r = Math.max(0, row - 1); r <= Math.min(rows - 1, row + 1); r += 1) {
    for (let c = Math.max(0, column - 1); c <= Math.min(columns - 1, column + 1); c += 1) {
      sum += values[r * columns + c];
      count += 1;
    }
  }
  return sum / count;
}

/** Box-blurred heights, `SMOOTH_PASSES` times. O(cells · passes). */
function smoothed(slice: Slice): Float32Array {
  const { columns, rows } = slice.meta;
  let values = slice.heights;
  for (let pass = 0; pass < SMOOTH_PASSES; pass += 1) {
    const field = { values, columns, rows };
    values = Float32Array.from(values, (_, index) => neighbourMean(field, index));
  }
  return values;
}

/** Vertex at the centre of every cell, in metres. */
function gridGeometry(slice: Slice) {
  const { columns, rows, cell_m: cell } = slice.meta;
  const heights = smoothed(slice);
  const positions = new Float32Array(columns * rows * 3);
  const uvs = new Float32Array(columns * rows * 2);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      positions.set([(column + 0.5) * cell, heights[index], (row + 0.5) * cell], index * 3);
      uvs.set([(column + 0.5) / columns, (row + 0.5) / rows], index * 2);
    }
  }
  const indices: number[] = [];
  for (let row = 0; row + 1 < rows; row += 1) {
    for (let column = 0; column + 1 < columns; column += 1) {
      const a = row * columns + column;
      indices.push(a, a + columns, a + 1, a + 1, a + columns, a + columns + 1);
    }
  }
  return { positions, normals: gridNormals(positions, { across: columns, down: rows }), uvs,
    indices };
}

/** WebGPU takes canvases but not every image element as a texture source, as D11 found. */
function canvasOf(image: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('slice albedo: no 2D canvas context to upload the ground texture');
  context.drawImage(image, 0, 0);
  return canvas;
}

/** An albedo the GPU accepts: decoded bitmaps go as they are, image elements through a canvas. */
export type AlbedoSource = HTMLImageElement | ImageBitmap;

function albedoTexture(device: pc.GraphicsDevice, image: AlbedoSource): pc.Texture {
  const source = image instanceof ImageBitmap ? image : canvasOf(image);
  const texture = new pc.Texture(device, {
    name: 'ground-albedo',
    width: source.width,
    height: source.height,
    format: pc.PIXELFORMAT_SRGBA8,
    mipmaps: true,
    addressU: pc.ADDRESS_CLAMP_TO_EDGE,
    addressV: pc.ADDRESS_CLAMP_TO_EDGE,
    minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
    magFilter: pc.FILTER_LINEAR,
    anisotropy: 8,
  });
  // The engine uploads ImageBitmap directly; its typings only list DOM elements.
  texture.setSource(source as HTMLCanvasElement);
  return texture;
}

/** A ground mesh: positions, UVs over its albedo, triangle indices. */
export interface GroundMesh {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: number[] | Uint32Array;
}

/** What a ground patch is drawn with, and how far it spans for the detail tiling. */
export interface GroundLook {
  albedo: AlbedoSource;
  detail: pc.Texture;
  extent_m: [number, number];
}

/** A ground patch: mesh, albedo and the cobble detail overlay (3 m repeat). */
export function groundEntity(app: pc.AppBase, geometry: GroundMesh, look: GroundLook): pc.Entity {
  const mesh = new pc.Mesh(app.graphicsDevice);
  mesh.setPositions(geometry.positions);
  mesh.setNormals(geometry.normals);
  mesh.setUvs(0, geometry.uvs);
  mesh.setIndices(geometry.indices);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  const ground = new pc.StandardMaterial();
  ground.diffuseMap = albedoTexture(app.graphicsDevice, look.albedo);
  ground.diffuseDetailMap = look.detail;
  ground.diffuseDetailMode = pc.DETAILMODE_OVERLAY;
  const [width, depth] = look.extent_m;
  ground.diffuseDetailMapTiling = new pc.Vec2(width / DETAIL_TILE_M, depth / DETAIL_TILE_M);
  ground.useMetalness = true;
  ground.metalness = 0;
  ground.gloss = 0.12;
  ground.update();
  const entity = new pc.Entity('ground');
  entity.addComponent('render', {
    meshInstances: [new pc.MeshInstance(mesh, ground)],
    receiveShadows: true,
    castShadows: false,
  });
  return entity;
}

/** The slice's ground as one patch. */
export function buildTerrain(app: pc.AppBase, slice: Slice, detail: pc.Texture): pc.Entity {
  const look = { albedo: slice.albedo, detail, extent_m: [slice.meta.width_m,
    slice.meta.depth_m] as [number, number] };
  const entity = groundEntity(app, gridGeometry(slice), look);
  entity.name = 'terrain';
  return entity;
}
