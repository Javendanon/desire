import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { accessorFinding, uncoveredSolids } from '../src/check.ts';
import { encodeGlb } from '../src/glb.ts';
import { collisionBlockers, parseGlb, readAccessor } from '../src/gltf-read.ts';
import { readManifest } from '../src/io.ts';
import { buildScene } from '../src/scene.ts';
import { sampleManifestPath } from './helpers.js';

const build = () => {
  const { manifest } = readManifest(sampleManifestPath());
  const images = manifest.textures.map((texture) =>
    fs.readFileSync(path.join(path.dirname(sampleManifestPath()), texture.path)));
  return { manifest, gltf: parseGlb(encodeGlb(buildScene(manifest), manifest, images)) };
};

const nodeByName = (json, name) => json.nodes.find((node) => node.name === name);

test('the artifact is a glTF 2.0 binary with an embedded buffer', () => {
  const { gltf } = build();
  assert.equal(gltf.json.asset.version, '2.0');
  assert.equal(gltf.json.buffers[0].uri, undefined, 'no external buffer download');
  assert.ok(gltf.bin.length > 0);
  assert.ok(gltf.json.images.every((image) => image.bufferView !== undefined && !image.uri));
});

test('the default scene renders only ground and LOD0; auxiliary scenes are explicit', () => {
  const { gltf } = build();
  const json = gltf.json;
  const names = json.scenes[json.scene].nodes.map((index) => json.nodes[index].name);
  assert.equal(names.length, 9);
  assert.ok(names.every((name) => name === 'render/ground' || name.startsWith('render/lod0/')));
  const collision = json.scenes.find((scene) => scene.name === 'collision');
  assert.deepEqual(collision.nodes.map((index) => json.nodes[index].name), ['collision']);
  const lod1 = json.scenes.find((scene) => scene.name === 'lod1');
  assert.deepEqual(lod1.nodes.map((index) => json.nodes[index].name),
    ['render/ground', 'render/lod1']);
});

test('LOD0 and LOD1 apply the same base color exactly once', () => {
  const { manifest, gltf } = build();
  for (const mesh of gltf.json.meshes.filter((mesh) => mesh.name.startsWith('render/'))) {
    for (const primitive of mesh.primitives) {
      const material = gltf.json.materials[primitive.material];
      const input = manifest.materials.find((entry) => entry.id === material.name);
      assert.ok(input, `LOD material ${material.name} preserves its source factors`);
      assert.deepEqual(material.pbrMetallicRoughness.baseColorFactor, input.base_color);
      const colors = readAccessor(gltf, primitive.attributes.COLOR_0);
      assert.deepEqual([...colors.slice(0, 3)], [1, 1, 1], 'top color is not baked twice');
    }
  }
});

test('compressed textures have embedded images, real bindings, UVs and resolution metadata', () => {
  const { gltf } = build();
  const json = gltf.json;
  assert.ok(json.extensionsRequired.includes('EXT_texture_webp'));
  const material = json.materials.find((entry) => entry.name === 'paving');
  const binding = material.pbrMetallicRoughness.baseColorTexture;
  const imageIndex = json.textures[binding.index].extensions.EXT_texture_webp.source;
  const image = json.images[imageIndex];
  assert.equal(image.mimeType, 'image/webp');
  assert.deepEqual(image.extras, { width_px: 16, height_px: 16 });
  const view = json.bufferViews[image.bufferView];
  const embedded = gltf.bin.subarray(view.byteOffset, view.byteOffset + view.byteLength);
  assert.equal(embedded.toString('ascii', 8, 12), 'WEBP');
  const ground = nodeByName(json, 'render/ground');
  const primitive = json.meshes[ground.mesh].primitives[0];
  const uv = readAccessor(gltf, primitive.attributes.TEXCOORD_0);
  assert.deepEqual([...uv], [0, 0, 0, 1, 1, 1, 1, 0]);
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
  const blockers = collisionBlockers(gltf);
  const scene = buildScene(manifest);
  assert.deepEqual(uncoveredSolids(blockers, scene.solids), []);
});

test('coverage fails when a solid loses its collision box', () => {
  const { manifest, gltf } = build();
  const blockers = collisionBlockers(gltf);
  const scene = buildScene(manifest);
  const first = scene.solids[0];
  const kept = blockers.filter((blocker) => {
    return blocker.min_x > first.center.x_m + first.width_m / 2
      || blocker.max_x < first.center.x_m - first.width_m / 2;
  });
  assert.deepEqual(uncoveredSolids(kept, scene.solids), [first.id]);
});

test('an attribute with the wrong component type fails the accessor check', () => {
  const accessors = [
    { type: 'VEC3', count: 4 },
    { type: 'VEC4', count: 4 },
    { type: 'SCALAR', count: 6 },
  ];
  const gltf = {
    json: {
      accessors,
      meshes: [{ primitives: [{ attributes: { POSITION: 0, COLOR_0: 1 }, indices: 2 }] }],
    },
  };
  const result = accessorFinding(gltf);
  assert.equal(result.pass, false);
  assert.match(result.detail, /COLOR_0 type VEC4/);
});

test('non-scalar indices fail the accessor check', () => {
  const accessors = [
    { type: 'VEC3', count: 4 },
    { type: 'VEC3', count: 6 },
  ];
  const gltf = {
    json: {
      accessors,
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    },
  };
  const result = accessorFinding(gltf);
  assert.equal(result.pass, false);
  assert.match(result.detail, /indices type VEC3/);
});

test('every vertex attribute count is an integer and matches POSITION', () => {
  const { gltf } = build();
  for (const mesh of gltf.json.meshes) {
    for (const primitive of mesh.primitives) {
      const position = gltf.json.accessors[primitive.attributes.POSITION];
      for (const [name, index] of Object.entries(primitive.attributes)) {
        const accessor = gltf.json.accessors[index];
        assert.ok(Number.isInteger(accessor.count) && accessor.count > 0,
          `${name} count ${accessor.count} is not a positive integer`);
        assert.equal(accessor.count, position.count, `${name} count differs from POSITION`);
      }
    }
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
