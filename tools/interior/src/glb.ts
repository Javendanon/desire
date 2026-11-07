// Reads the JSON chunk of a binary glTF (GLB) file: enough to check node names, materials and the
// bounds glTF requires on every POSITION accessor, without a 3D library.

const MAGIC = 0x46546c67; // 'glTF'
const JSON_CHUNK = 0x4e4f534a; // 'JSON'
const HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
/** The chunk type follows its 4-byte length. */
const CHUNK_TYPE_OFFSET = HEADER_BYTES + 4;
const AXES = [0, 1, 2] as const;

interface Named {
  name?: string;
}

interface Attributes {
  POSITION: number;
  NORMAL?: number;
}

interface Primitive {
  attributes: Attributes;
}

interface BufferView {
  byteOffset?: number;
}

interface Accessor extends Partial<Bounds> {
  bufferView?: number;
  byteOffset?: number;
  count: number;
}

interface Mesh extends Named {
  primitives: Primitive[];
}

export interface Bounds {
  min: number[];
  max: number[];
}

export interface GltfJson {
  meshes?: Mesh[];
  materials?: Named[];
  accessors: Accessor[];
  bufferViews?: BufferView[];
}

export interface Glb {
  json: GltfJson;
  bin: Uint8Array;
}

/** Splits a GLB file into its JSON chunk and its binary chunk. */
export function readGlb(bytes: Uint8Array): Glb {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MAGIC) throw new Error('not a GLB file');
  const length = view.getUint32(HEADER_BYTES, true);
  if (view.getUint32(CHUNK_TYPE_OFFSET, true) !== JSON_CHUNK) throw new Error('GLB: no JSON chunk');
  const start = HEADER_BYTES + CHUNK_HEADER_BYTES;
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(start, start + length)));
  const binStart = start + length + CHUNK_HEADER_BYTES;
  return { json: json as GltfJson, bin: bytes.subarray(binStart) };
}

export function readGlbJson(bytes: Uint8Array): GltfJson {
  return readGlb(bytes).json;
}

/** The float VEC3 values of one accessor, e.g. positions or normals. O(count). */
export function vec3s({ json, bin }: Glb, index: number): [number, number, number][] {
  const accessor = json.accessors[index];
  const offset = (json.bufferViews?.[accessor.bufferView ?? 0]?.byteOffset ?? 0)
    + (accessor.byteOffset ?? 0);
  const floats = new Float32Array(bin.buffer.slice(bin.byteOffset + offset,
    bin.byteOffset + offset + accessor.count * AXES.length * Float32Array.BYTES_PER_ELEMENT));
  const stride = AXES.length;
  return Array.from({ length: accessor.count }, (_, i) => {
    const [x, y, z] = AXES.map((axis) => floats[stride * i + axis]);
    return [x, y, z];
  });
}

/** World bounds of the named mesh, from its POSITION accessors. */
export function meshBounds(gltf: GltfJson, name: string): Bounds {
  const mesh = gltf.meshes?.find((candidate) => candidate.name === name);
  if (!mesh) throw new Error(`GLB: no mesh ${name}`);
  const accessors = mesh.primitives.map(({ attributes }) => gltf.accessors[attributes.POSITION]);
  const component = (key: 'min' | 'max', index: number) =>
    accessors.map((accessor) => accessor[key]?.[index] ?? Number.NaN);
  const axis = (pick: (values: number[]) => number, key: 'min' | 'max') =>
    AXES.map((index) => pick(component(key, index)));
  return {
    min: axis((values) => Math.min(...values), 'min'),
    max: axis((values) => Math.max(...values), 'max'),
  };
}
