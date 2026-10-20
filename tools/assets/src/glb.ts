/** Writes glTF 2.0 binary: render LODs plus a separate, unshaded collision mesh. */
import { buildBox, buildGround, mergeMeshes } from './geometry.ts';
import type { Manifest, Mesh } from './types.ts';
import type { Scene } from './scene.ts';
import type {
  Accessor, Builder, GltfJson, GltfMaterial, GltfMesh, GltfNode, Primitive,
} from './gltf-types.ts';

type MeshSpec = { builder: Builder; scene: Scene; manifest: Manifest;
  materialById: Map<string, number> };
type Writer = ReturnType<typeof createNodeWriter>;
type NodeOptions = { material?: number; extras?: Record<string, unknown> };
type NumericArray = Float32Array | Uint32Array;

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const FLOAT = 5126;
const UINT32 = 5125;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const ITEM_TYPES: Record<number, string> = { 1: 'SCALAR', 2: 'VEC2', 3: 'VEC3' };
const SCALAR_SIZE = 1;
const VEC3_SIZE = 3;
const GLB_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
const WHITE = [1, 1, 1, 1];

const align4 = (value: number) => (value + 3) & ~3;

function createBuilder(): Builder {
  return { bufferViews: [], accessors: [], chunks: [], bytes: 0 };
}

function writeBufferView(builder: Builder, values: NumericArray | Buffer, target?: number) {
  const source = Buffer.from(values.buffer, values.byteOffset, values.byteLength);
  builder.bufferViews.push({
    buffer: 0,
    byteOffset: builder.bytes,
    byteLength: source.length,
    target,
  });
  builder.chunks.push(source);
  builder.bytes += align4(source.length);
  return builder.bufferViews.length - 1;
}

function boundsOf(values: NumericArray, itemSize: number) {
  const min = Array.from({ length: itemSize }, () => Number.POSITIVE_INFINITY);
  const max = Array.from({ length: itemSize }, () => Number.NEGATIVE_INFINITY);
  for (let index = 0; index < values.length; index += 1) {
    const slot = index % itemSize;
    min[slot] = Math.min(min[slot], values[index]);
    max[slot] = Math.max(max[slot], values[index]);
  }
  return { min, max };
}

function pushAccessor(builder: Builder, values: NumericArray, spec: {
  itemSize: number; componentType: number; target: number; withBounds?: boolean;
}) {
  const { itemSize, componentType, target, withBounds = false } = spec;
  const view = writeBufferView(builder, values, target);
  const accessor: Accessor = {
    bufferView: view,
    componentType,
    count: values.length / itemSize,
    type: ITEM_TYPES[itemSize],
  };
  if (withBounds) Object.assign(accessor, boundsOf(values, itemSize));
  builder.accessors.push(accessor);
  return builder.accessors.length - 1;
}

function pushVector(builder: Builder, values: Float32Array, withBounds: boolean) {
  return pushAccessor(builder, values, {
    itemSize: VEC3_SIZE,
    componentType: FLOAT,
    target: ARRAY_BUFFER,
    withBounds,
  });
}

function pushIndices(builder: Builder, values: Uint32Array) {
  return pushAccessor(builder, values, {
    itemSize: SCALAR_SIZE,
    componentType: UINT32,
    target: ELEMENT_ARRAY_BUFFER,
  });
}

function addPrimitive(builder: Builder, mesh: Mesh, material?: number): Primitive {
  const attributes = {
    POSITION: pushVector(builder, new Float32Array(mesh.positions), true),
    NORMAL: pushVector(builder, new Float32Array(mesh.normals), false),
    COLOR_0: pushVector(builder, new Float32Array(mesh.colors), false),
    TEXCOORD_0: pushAccessor(builder, new Float32Array(mesh.uvs), {
      itemSize: 2, componentType: FLOAT, target: ARRAY_BUFFER,
    }),
  };
  const indices = pushIndices(builder, new Uint32Array(mesh.indices));
  const primitive: Primitive = { attributes, indices };
  if (material !== undefined) primitive.material = material;
  return primitive;
}

function buildMaterials(manifest: Manifest): GltfMaterial[] {
  const materials = manifest.materials.map((material) => {
    const entry: GltfMaterial = {
      name: material.id,
      pbrMetallicRoughness: {
        baseColorFactor: material.base_color,
        metallicFactor: material.metallic,
        roughnessFactor: material.roughness,
      },
    };
    if (material.texture) {
      entry.pbrMetallicRoughness.baseColorTexture = {
        index: manifest.textures.findIndex((texture) => texture.id === material.texture),
      };
    }
    return entry;
  });
  return materials;
}

function assetExtras(scene: Scene, manifest: Manifest) {
  return {
    id: scene.id,
    label: scene.label,
    provenance: manifest.illustration.provenance,
    calibration: {
      ...manifest.calibration.provenance,
      meters_per_pixel: manifest.calibration.meters_per_pixel,
      rotation_radians: manifest.calibration.rotation_radians,
    },
    fidelity: scene.fidelity,
    unknown_places: scene.unknown.map((place) => place.id),
    textures: manifest.textures.map(({ id, mime, max_bytes, width_px, height_px }) =>
      ({ id, mime, max_bytes, width_px, height_px })),
    license: manifest.illustration.license,
    network_allowed: false,
  };
}

function createNodeWriter(spec: Pick<MeshSpec, 'builder'>) {
  const { builder } = spec;
  const meshes: GltfMesh[] = [];
  const nodes: GltfNode[] = [];
  const pushNode = (name: string, mesh: Mesh, options: NodeOptions = {}) => {
    meshes.push({ name, primitives: [addPrimitive(builder, mesh, options.material)] });
    const node: GltfNode = { name, mesh: meshes.length - 1 };
    if (options.extras) node.extras = options.extras;
    nodes.push(node);
  };
  return { meshes, nodes, pushNode };
}

function addSolidNodes(spec: Omit<MeshSpec, 'builder'> & Pick<Writer, 'pushNode'>) {
  const { pushNode, scene, manifest, materialById } = spec;
  for (const solid of scene.solids) {
    pushNode(`render/lod0/${solid.id}`, buildBox(solid, WHITE), {
      material: materialById.get(solid.material),
      extras: {
        desire: {
          place_id: solid.id,
          height_evidence: solid.height_evidence,
          provenance: solid.provenance,
        },
      },
    });
  }
}

function addMergedNodes(spec: Omit<MeshSpec, 'manifest'> & { writer: Writer }) {
  const { writer, builder, scene, materialById } = spec;
  const groups = Map.groupBy(scene.solids, (solid) => solid.material);
  const primitives = [...groups].map(([id, solids]) => {
    const mesh = mergeMeshes(solids.map((solid) => buildBox(solid, WHITE)));
    return addPrimitive(builder, mesh, materialById.get(id));
  });
  writer.meshes.push({ name: 'render/lod1', primitives });
  writer.nodes.push({ name: 'render/lod1', mesh: writer.meshes.length - 1 });
  const collision = scene.solids.map((solid) => buildBox(solid, WHITE));
  writer.pushNode('collision', mergeMeshes(collision), { extras: { role: 'collision' } });
}

function addMeshes(spec: MeshSpec) {
  const { scene, manifest, materialById } = spec;
  const writer = createNodeWriter(spec);
  const { pushNode } = writer;
  pushNode('render/ground', buildGround(scene.ground, WHITE), {
    material: materialById.get(scene.ground.material),
  });
  addSolidNodes({ pushNode, scene, manifest, materialById });
  addMergedNodes({ writer, builder: spec.builder, scene, materialById });
  return { meshes: writer.meshes, nodes: writer.nodes };
}

function u32(value: number) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
}

function padTo(source: Buffer, fill: number) {
  const padded = Buffer.alloc(align4(source.length), fill);
  source.copy(padded);
  return padded;
}

function packGlb(json: GltfJson, bin: Buffer) {
  const jsonBytes = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPadded = padTo(jsonBytes, 0x20);
  const binPadded = padTo(bin, 0);
  const length = GLB_HEADER_BYTES + 2 * CHUNK_HEADER_BYTES
    + jsonPadded.length + binPadded.length;
  const header = Buffer.concat([u32(GLB_MAGIC), u32(GLB_VERSION), u32(length)]);
  const jsonChunk = Buffer.concat([u32(jsonPadded.length), u32(JSON_CHUNK), jsonPadded]);
  const binChunk = Buffer.concat([u32(binPadded.length), u32(BIN_CHUNK), binPadded]);
  return Buffer.concat([header, jsonChunk, binChunk]);
}

function sceneSelections(id: string, nodes: GltfNode[]) {
  const indices = nodes.map((_, index) => index);
  return [
    { name: id, nodes: indices.filter((index) => nodes[index].name === 'render/ground'
      || nodes[index].name.startsWith('render/lod0/')) },
    { name: 'lod1', nodes: indices.filter((index) => ['render/ground', 'render/lod1']
      .includes(nodes[index].name)) },
    { name: 'collision', nodes: indices.filter((index) => nodes[index].name === 'collision') },
  ];
}

function textureResources(builder: Builder, manifest: Manifest, images: Buffer[]) {
  if (images.length !== manifest.textures.length) throw new Error('texture buffers are required');
  if (images.length === 0) return {};
  if (manifest.textures.some((texture) => texture.mime !== 'image/webp')) {
    throw new Error('only decoded WebP textures are supported; BasisU is not verified');
  }
  const extensions = manifest.textures.map(() => 'EXT_texture_webp');
  return {
    extensionsUsed: [...new Set(extensions)],
    extensionsRequired: [...new Set(extensions)],
    textures: extensions.map((extension, index) => ({
      extensions: { [extension]: { source: index } },
    })),
    images: manifest.textures.map((texture, index) => ({
      name: texture.id,
      mimeType: texture.mime,
      bufferView: writeBufferView(builder, images[index], undefined),
      extras: { width_px: texture.width_px, height_px: texture.height_px },
    })),
  };
}

function binaryChunk(builder: Builder) {
  return Buffer.concat(builder.chunks.map((chunk) => padTo(chunk, 0)));
}

/** Encodes geometry and compressed images; consumers must support the required extensions. */
export function encodeGlb(scene: Scene, manifest: Manifest, images: Buffer[] = []): Buffer {
  const builder = createBuilder();
  const materials = buildMaterials(manifest);
  const materialById = new Map(materials.map((material, index) => [material.name, index]));
  const { meshes, nodes } = addMeshes({ builder, scene, manifest, materialById });
  const resources = textureResources(builder, manifest, images);
  const bin = binaryChunk(builder);
  const json: GltfJson = {
    asset: {
      version: '2.0',
      generator: 'desire-asset-pipeline/1',
      extras: { desire: assetExtras(scene, manifest) },
    },
    scene: 0,
    scenes: sceneSelections(scene.id, nodes),
    nodes,
    meshes,
    materials,
    accessors: builder.accessors,
    bufferViews: builder.bufferViews,
    buffers: [{ byteLength: bin.length }],
    ...resources,
  };
  return packGlb(json, bin);
}
