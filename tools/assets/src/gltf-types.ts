/** glTF subset emitted by this converter; binary resources are always embedded. */
import type { Provenance, Texture } from './types.ts';
import type { Scene } from './scene.ts';

export type Accessor = {
  bufferView: number;
  componentType: number;
  count: number;
  type: string;
  min?: number[];
  max?: number[];
};
export type BufferView = {
  buffer: number; byteOffset: number; byteLength: number; target?: number;
};
export type Primitive = { attributes: Record<string, number>; indices: number; material?: number };
export type GltfMesh = { name: string; primitives: Primitive[] };
export type GltfNode = {
  name: string;
  mesh: number;
  extras?: Record<string, unknown>;
};
export type GltfMaterial = {
  name: string;
  pbrMetallicRoughness: {
    baseColorFactor: number[];
    metallicFactor: number;
    roughnessFactor: number;
    baseColorTexture?: { index: number };
  };
};
export type GltfImage = {
  name: string;
  mimeType: string;
  bufferView: number;
  uri?: string;
  extras: { width_px: number; height_px: number };
};
/** Everything the writer records under `asset.extras.desire`. */
export type AssetExtras = {
  id: string;
  label: string;
  provenance: Provenance;
  calibration: Provenance & { meters_per_pixel: number; rotation_radians: number };
  fidelity: Scene['fidelity'];
  unknown_places: string[];
  textures: Pick<Texture, 'id' | 'mime' | 'max_bytes' | 'width_px' | 'height_px'>[];
  license: string;
  network_allowed: boolean;
};
export type GltfJson = {
  asset: { version: string; generator: string; extras: { desire: AssetExtras } };
  scene: number;
  scenes: { name: string; nodes: number[] }[];
  nodes: GltfNode[];
  meshes: GltfMesh[];
  materials: GltfMaterial[];
  accessors: Accessor[];
  bufferViews: BufferView[];
  buffers: { byteLength: number; uri?: string }[];
  images?: GltfImage[];
  textures?: { extensions: Record<string, { source: number }> }[];
  extensionsUsed?: string[];
  extensionsRequired?: string[];
};
export type Gltf = { json: GltfJson; bin: Buffer };
export type Builder = {
  bufferViews: BufferView[];
  accessors: Accessor[];
  chunks: Buffer[];
  bytes: number;
};
