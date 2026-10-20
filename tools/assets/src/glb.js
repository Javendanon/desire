/** Writes glTF 2.0 binary: render LODs plus a separate, unshaded collision mesh. */
import { buildBox, buildGround, mergeMeshes } from './geometry.js';

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const FLOAT = 5126;
const UINT32 = 5125;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const ITEM_TYPES = { 1: 'SCALAR', 3: 'VEC3' };
const SCALAR_SIZE = 1;
const VEC3_SIZE = 3;
const GLB_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
const LOD_MATERIAL = 'lod-merged';
const LOD_ROUGHNESS = 0.9;
const WHITE = [1, 1, 1, 1];

const align4 = (value) => (value + 3) & ~3;

function createBuilder() {
  return { bufferViews: [], accessors: [], chunks: [], bytes: 0 };
}

function writeBufferView(builder, values, target) {
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

function boundsOf(values, itemSize) {
  const min = Array.from({ length: itemSize }, () => Number.POSITIVE_INFINITY);
  const max = Array.from({ length: itemSize }, () => Number.NEGATIVE_INFINITY);
  for (let index = 0; index < values.length; index += 1) {
    const slot = index % itemSize;
    min[slot] = Math.min(min[slot], values[index]);
    max[slot] = Math.max(max[slot], values[index]);
  }
  return { min, max };
}

function pushAccessor(builder, values, spec) {
  const { itemSize, componentType, target, withBounds = false } = spec;
  const view = writeBufferView(builder, values, target);
  const accessor = {
    bufferView: view,
    componentType,
    count: values.length / itemSize,
    type: ITEM_TYPES[itemSize],
  };
  if (withBounds) Object.assign(accessor, boundsOf(values, itemSize));
  builder.accessors.push(accessor);
  return builder.accessors.length - 1;
}

function pushVector(builder, values, withBounds) {
  return pushAccessor(builder, values, {
    itemSize: VEC3_SIZE,
    componentType: FLOAT,
    target: ARRAY_BUFFER,
    withBounds,
  });
}

function pushIndices(builder, values) {
  return pushAccessor(builder, values, {
    itemSize: SCALAR_SIZE,
    componentType: UINT32,
    target: ELEMENT_ARRAY_BUFFER,
  });
}

function addPrimitive(builder, mesh, material) {
  const attributes = {
    POSITION: pushVector(builder, new Float32Array(mesh.positions), true),
    NORMAL: pushVector(builder, new Float32Array(mesh.normals), false),
    COLOR_0: pushVector(builder, new Float32Array(mesh.colors), false),
  };
  const indices = pushIndices(builder, new Uint32Array(mesh.indices));
  const primitive = { attributes, indices };
  if (material !== undefined) primitive.material = material;
  return primitive;
}

function buildMaterials(manifest) {
  const materials = manifest.materials.map((material) => {
    const entry = {
      name: material.id,
      pbrMetallicRoughness: {
        baseColorFactor: material.base_color,
        metallicFactor: material.metallic,
        roughnessFactor: material.roughness,
      },
    };
    if (material.texture) entry.extras = { desire: { texture: material.texture } };
    return entry;
  });
  materials.push({
    name: LOD_MATERIAL,
    pbrMetallicRoughness: {
      baseColorFactor: WHITE,
      metallicFactor: 0,
      roughnessFactor: LOD_ROUGHNESS,
    },
  });
  return materials;
}

function colorById(manifest, id) {
  return manifest.materials.find((material) => material.id === id)?.base_color ?? WHITE;
}

function assetExtras(scene, manifest) {
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
    textures: manifest.textures.map(({ id, mime, max_bytes }) => ({ id, mime, max_bytes })),
    network_allowed: false,
  };
}

function createNodeWriter(spec) {
  const { builder } = spec;
  const meshes = [];
  const nodes = [];
  const pushNode = (name, mesh, options = {}) => {
    meshes.push({ name, primitives: [addPrimitive(builder, mesh, options.material)] });
    const node = { name, mesh: meshes.length - 1 };
    if (options.extras) node.extras = options.extras;
    nodes.push(node);
  };
  return { meshes, nodes, pushNode };
}

function addSolidNodes(spec) {
  const { pushNode, scene, manifest, materialById } = spec;
  for (const solid of scene.solids) {
    pushNode(`render/lod0/${solid.id}`, buildBox(solid, colorById(manifest, solid.material)), {
      material: materialById.get(solid.material),
      extras: { desire: { place_id: solid.id, height_evidence: solid.height_evidence } },
    });
  }
}

function addMergedNodes(spec) {
  const { pushNode, scene, manifest, materialById } = spec;
  const boxes = scene.solids.map((solid) => buildBox(solid, colorById(manifest, solid.material)));
  pushNode('render/lod1', mergeMeshes(boxes), { material: materialById.get(LOD_MATERIAL) });
  const collision = scene.solids.map((solid) => buildBox(solid, WHITE));
  pushNode('collision', mergeMeshes(collision), { extras: { role: 'collision' } });
}

function addMeshes(spec) {
  const { scene, manifest, materialById } = spec;
  const writer = createNodeWriter(spec);
  const { pushNode } = writer;
  pushNode('render/ground', buildGround(scene.ground, colorById(manifest, scene.ground.material)), {
    material: materialById.get(scene.ground.material),
  });
  addSolidNodes({ pushNode, scene, manifest, materialById });
  addMergedNodes({ pushNode, scene, manifest, materialById });
  return { meshes: writer.meshes, nodes: writer.nodes };
}

function u32(value) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
}

function padTo(source, fill) {
  const padded = Buffer.alloc(align4(source.length), fill);
  source.copy(padded);
  return padded;
}

function packGlb(json, bin) {
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

/** Encodes the metric scene as a single .glb buffer. */
export function encodeGlb(scene, manifest) {
  const builder = createBuilder();
  const materials = buildMaterials(manifest);
  const materialById = new Map(materials.map((material, index) => [material.name, index]));
  const { meshes, nodes } = addMeshes({ builder, scene, manifest, materialById });
  const bin = Buffer.concat(builder.chunks.map((chunk) => {
    const padded = Buffer.alloc(align4(chunk.length), 0);
    chunk.copy(padded);
    return padded;
  }));
  const json = {
    asset: {
      version: '2.0',
      generator: 'desire-asset-pipeline/1',
      extras: { desire: assetExtras(scene, manifest) },
    },
    scene: 0,
    scenes: [{ name: scene.id, nodes: nodes.map((_, index) => index) }],
    nodes,
    meshes,
    materials,
    accessors: builder.accessors,
    bufferViews: builder.bufferViews,
    buffers: [{ byteLength: bin.length }],
  };
  return packGlb(json, bin);
}
