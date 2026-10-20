/** Reads back a .glb so acceptance checks inspect the artifact, not the plan. */

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const GLB_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
const COMPONENTS = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const ITEM_SIZES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function readChunks(buffer) {
  const chunks = {};
  let offset = GLB_HEADER_BYTES;
  while (offset + CHUNK_HEADER_BYTES <= buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const start = offset + CHUNK_HEADER_BYTES;
    chunks[type] = buffer.subarray(start, start + length);
    offset = start + length;
  }
  return chunks;
}

/** Validates the container and returns the parsed JSON chunk and the binary chunk. */
export function parseGlb(buffer) {
  if (buffer.length < GLB_HEADER_BYTES || buffer.readUInt32LE(0) !== GLB_MAGIC) {
    throw new Error('not a glb: bad magic');
  }
  const version = buffer.readUInt32LE(4);
  if (version !== GLB_VERSION) throw new Error(`unsupported glb version ${version}`);
  const declared = buffer.readUInt32LE(8);
  if (declared !== buffer.length) {
    throw new Error(`glb length mismatch: declared ${declared}, read ${buffer.length}`);
  }
  const chunks = readChunks(buffer);
  if (!chunks[JSON_CHUNK]) throw new Error('glb has no JSON chunk');
  const json = JSON.parse(chunks[JSON_CHUNK].toString('utf8'));
  return { json, bin: chunks[BIN_CHUNK] ?? Buffer.alloc(0) };
}

/** Returns one accessor as a typed array. */
export function readAccessor(gltf, index) {
  const accessor = gltf.json.accessors[index];
  const view = gltf.json.bufferViews[accessor.bufferView];
  const Type = COMPONENTS[accessor.componentType];
  const bytes = accessor.count * ITEM_SIZES[accessor.type] * Type.BYTES_PER_ELEMENT;
  const start = (view.byteOffset ?? 0);
  const copy = gltf.bin.subarray(start, start + bytes);
  return new Type(copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength));
}

/** Axis-aligned bounds of every primitive in a mesh, taken from the written accessors. */
export function nodeAabbs(gltf, meshIndex) {
  const mesh = gltf.json.meshes[meshIndex];
  return mesh.primitives.map((primitive) => {
    const accessor = gltf.json.accessors[primitive.attributes.POSITION];
    return { min: accessor.min, max: accessor.max };
  });
}

const FLOATS_PER_QUAD = 12;
const QUAD_X = [0, 3, 6, 9];
const QUAD_Z = [2, 5, 8, 11];

/** Plan-view bounds (x and z) of the collision quads, used as conservative blockers. */
export function collisionBlockers(gltf) {
  const node = gltf.json.nodes.find((entry) => entry.name === 'collision');
  if (!node) return [];
  const blockers = [];
  for (const primitive of gltf.json.meshes[node.mesh].primitives) {
    const positions = readAccessor(gltf, primitive.attributes.POSITION);
    for (let base = 0; base < positions.length; base += FLOATS_PER_QUAD) {
      const xs = QUAD_X.map((offset) => positions[base + offset]);
      const zs = QUAD_Z.map((offset) => positions[base + offset]);
      blockers.push({
        min_x: Math.min(...xs),
        max_x: Math.max(...xs),
        min_z: Math.min(...zs),
        max_z: Math.max(...zs),
      });
    }
  }
  return blockers;
}
