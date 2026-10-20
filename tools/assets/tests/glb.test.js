import assert from 'node:assert/strict';
import test from 'node:test';

import { encodeGlb } from '../src/glb.js';
import { nodeAabbs, parseGlb } from '../src/gltf-read.js';
import { readManifest } from '../src/io.js';
import { buildScene } from '../src/scene.js';
import { sampleManifestPath } from './helpers.js';

const build = () => {
  const { manifest } = readManifest(sampleManifestPath());
  return { manifest, gltf: parseGlb(encodeGlb(buildScene(manifest), manifest)) };
};

const nodeByName = (json, name) => json.nodes.find((node) => node.name === name);

test('the artifact is a glTF 2.0 binary with an embedded buffer', () => {
  const { gltf } = build();
  assert.equal(gltf.json.asset.version, '2.0');
  assert.equal(gltf.json.buffers[0].uri, undefined, 'no external buffer download');
  assert.ok(gltf.bin.length > 0);
  assert.equal(gltf.json.images, undefined, 'textures travel beside the manifest');
});

test('render, LOD and collision live in separate nodes', () => {
  const { gltf } = build();
  assert.ok(nodeByName(gltf.json, 'render/ground'));
  assert.ok(nodeByName(gltf.json, 'render/lod1'));
  assert.ok(nodeByName(gltf.json, 'collision'));
  const lod0 = gltf.json.nodes.filter((node) => node.name.startsWith('render/lod0/'));
  assert.equal(lod0.length, 8, 'one node per solid place');
});

test('collision geometry carries no material and no render children', () => {
  const { gltf } = build();
  const collision = nodeByName(gltf.json, 'collision');
  for (const index of collision.mesh === undefined ? [] : [collision.mesh]) {
    const mesh = gltf.json.meshes[index];
    for (const primitive of mesh.primitives) {
      assert.equal(primitive.material, undefined, 'collision must not be shaded');
    }
  }
  assert.equal(collision.children, undefined);
});

test('collision bounds cover every solid footprint', () => {
  const { manifest, gltf } = build();
  const boxes = nodeAabbs(gltf, nodeByName(gltf.json, 'collision').mesh);
  const scene = buildScene(manifest);
  for (const solid of scene.solids) {
    const covering = boxes.filter((box) => box.min[0] <= solid.center.x_m + solid.width_m / 2
      && box.max[0] >= solid.center.x_m - solid.width_m / 2);
    assert.ok(covering.length > 0, `collision misses ${solid.id}`);
  }
});

test('buffer views stay aligned and inside the binary chunk', () => {
  const { gltf } = build();
  for (const view of gltf.json.bufferViews) {
    assert.equal(view.byteOffset % 4, 0, 'buffer view must be 4-byte aligned');
    assert.ok(view.byteOffset + view.byteLength <= gltf.bin.length);
  }
  assert.equal(gltf.json.buffers[0].byteLength, gltf.bin.length);
});

test('the asset extras record provenance, fidelity and textures', () => {
  const { gltf } = build();
  const desire = gltf.json.asset.extras.desire;
  assert.equal(desire.id, 'sample-harbor');
  assert.match(desire.provenance.source, /synthetic/);
  assert.equal(desire.network_allowed, false);
  assert.equal(desire.fidelity.unknown, 2);
  assert.deepEqual(desire.textures.map((texture) => texture.mime), ['image/webp']);
});
