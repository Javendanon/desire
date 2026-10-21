import assert from 'node:assert/strict';
import test from 'node:test';

import { haloChunks, seaChunks, smokeChunks } from '../src/lib/diorama/shaders.ts';

const all = { sea: seaChunks(), smoke: smokeChunks(), halo: haloChunks() };

test('every effect has a GLSL and a WGSL model-matrix chunk', () => {
  for (const [name, chunks] of Object.entries(all)) {
    assert.match(chunks.glsl, /mat4 getModelMatrix\(\)/, `${name} GLSL`);
    assert.match(chunks.wgsl, /fn getModelMatrix\(\) -> mat4x4f/, `${name} WGSL`);
    for (const line of [1, 2, 3, 4]) {
      assert.ok(chunks.glsl.includes(`instance_line${line}`), `${name} GLSL keeps the attributes`);
      assert.ok(chunks.wgsl.includes(`instance_line${line}`), `${name} WGSL keeps the attributes`);
    }
  }
});

test('the effects read their clock and the camera axes as uniforms', () => {
  assert.match(all.sea.glsl, /uniform float swell_time;/);
  assert.match(all.sea.wgsl, /uniform swell_time: f32;/);
  for (const chunks of [all.smoke, all.halo]) {
    assert.match(chunks.glsl, /uniform float ambience_time;/);
    assert.match(chunks.glsl, /uniform vec3 view_right;/);
    assert.match(chunks.wgsl, /uniform view_up: vec3f;/);
  }
});

test('constants are written as float literals, never NaN or bare integers', () => {
  for (const chunks of Object.values(all)) {
    for (const code of [chunks.glsl, chunks.wgsl]) {
      assert.ok(!code.includes('NaN') && !code.includes('undefined'));
      const expressions = code.split('\n').filter((line) => !/attribute|uniform/.test(line));
      for (const line of expressions) {
        assert.doesNotMatch(line, /[^\w.]\d+(?![\w.\d])/, `integer literal in: ${line.trim()}`);
      }
    }
  }
});
