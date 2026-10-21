// Vertex-shader chunks that move the diorama's animated parts on the GPU. Each replaces
// PlayCanvas's `transformInstancingVS`: instead of reading a model matrix from the four instance
// attributes, `getModelMatrix()` builds one from static per-instance data and a clock uniform.
// The CPU only sets uniforms each frame. GLSL serves WebGL2, WGSL serves WebGPU. The constants
// come from the tested references (sea-swell.ts, ambience-plan.ts), so both sides share one
// formula. Pure: strings only.
//
// Instance data, packed in the four attributes:
// - smoke: line1 = chimney top xyz, phase; line2.x = puff share of the cycle
// - halo:  line1 = lantern xyz, lantern index
// - sea:   one identity instance; the vertex position drives the swell

import { HALO, PUFF } from './ambience-plan.ts';
import { SWELL } from './sea-swell.ts';

export interface Chunks {
  glsl: string;
  wgsl: string;
}

/** A float literal both languages accept: always with a decimal point. */
const f = (value: number) => {
  const text = String(Number(value.toPrecision(9)));
  return text.includes('.') || text.includes('e') ? text : `${text}.0`;
};

const PI = f(Math.PI);

const GLSL_ATTRIBUTES = [1, 2, 3, 4].map((line) => `attribute vec4 instance_line${line};`);
const WGSL_ATTRIBUTES = [1, 2, 3, 4].map((line) => `attribute instance_line${line}: vec4f;`);

/** Height and slope of the swell at `p` (plan x, z) and their matrix: column 1 is the normal. */
export function seaChunks(): Chunks {
  const { heightM, crossShare, waveX, waveZ, speedX, speedZ } = SWELL;
  const glsl = [
    ...GLSL_ATTRIBUTES,
    'uniform float swell_time;',
    'mat4 getModelMatrix() {',
    '  vec2 p = vertex_position.xz;',
    `  float phaseX = p.x * ${f(waveX)} + swell_time * ${f(speedX)};`,
    `  float phaseZ = p.y * ${f(waveZ)} + swell_time * ${f(speedZ)};`,
    `  float h = sin(phaseX) * ${f(heightM)} + cos(phaseZ) * ${f(heightM * crossShare)};`,
    `  float sx = cos(phaseX) * ${f(heightM * waveX)};`,
    `  float sz = -sin(phaseZ) * ${f(heightM * crossShare * waveZ)};`,
    '  vec3 n = normalize(vec3(-sx, 1.0, -sz));',
    '  return mat4(vec4(1.0, 0.0, 0.0, 0.0), vec4(n, 0.0), vec4(0.0, 0.0, 1.0, 0.0),',
    '    vec4(0.0, h, 0.0, 1.0));',
    '}',
  ];
  const wgsl = [
    ...WGSL_ATTRIBUTES,
    'uniform swell_time: f32;',
    'fn getModelMatrix() -> mat4x4f {',
    '  let p = vertex_position.xz;',
    `  let phaseX = p.x * ${f(waveX)} + uniform.swell_time * ${f(speedX)};`,
    `  let phaseZ = p.y * ${f(waveZ)} + uniform.swell_time * ${f(speedZ)};`,
    `  let h = sin(phaseX) * ${f(heightM)} + cos(phaseZ) * ${f(heightM * crossShare)};`,
    `  let sx = cos(phaseX) * ${f(heightM * waveX)};`,
    `  let sz = -sin(phaseZ) * ${f(heightM * crossShare * waveZ)};`,
    '  let n = normalize(vec3f(-sx, 1.0, -sz));',
    '  return mat4x4f(vec4f(1.0, 0.0, 0.0, 0.0), vec4f(n, 0.0), vec4f(0.0, 0.0, 1.0, 0.0),',
    '    vec4f(0.0, h, 0.0, 1.0));',
    '}',
  ];
  return { glsl: glsl.join('\n'), wgsl: wgsl.join('\n') };
}

const GLSL_BILLBOARD = [
  'uniform float ambience_time;',
  'uniform vec3 view_right;',
  'uniform vec3 view_up;',
  'mat4 billboard(vec3 at, float size) {',
  '  vec3 facing = cross(view_right, view_up);',
  '  return mat4(vec4(view_right * size, 0.0), vec4(facing * size, 0.0),',
  '    vec4(view_up * size, 0.0), vec4(at, 1.0));',
  '}',
];

const WGSL_BILLBOARD = [
  'uniform ambience_time: f32;',
  'uniform view_right: vec3f;',
  'uniform view_up: vec3f;',
  'fn billboard(at: vec3f, size: f32) -> mat4x4f {',
  '  let facing = cross(uniform.view_right, uniform.view_up);',
  '  return mat4x4f(vec4f(uniform.view_right * size, 0.0), vec4f(facing * size, 0.0),',
  '    vec4f(uniform.view_up * size, 0.0), vec4f(at, 1.0));',
  '}',
];

/** The puff curve of `puffAt`: rises, widens, and shrinks away at both ends of its life. */
export function smokeChunks(): Chunks {
  const { riseM, sizeM, lifeS, windSlant, windX, windZ, fadeExponent, birthShare } = PUFF;
  const glsl = [
    ...GLSL_ATTRIBUTES,
    ...GLSL_BILLBOARD,
    'mat4 getModelMatrix() {',
    `  float age = fract(ambience_time / ${f(lifeS)} + instance_line1.w + instance_line2.x);`,
    `  float rise = ${f(riseM)} * age;`,
    `  float drift = rise * ${f(windSlant)};`,
    `  float swell = age > 0.0 ? pow(sin(${PI} * age), ${f(fadeExponent)}) : 0.0;`,
    `  float size = ${f(sizeM)} * (${f(birthShare)} + age) * swell;`,
    `  vec3 at = instance_line1.xyz + vec3(${f(windX)} * drift, rise, ${f(windZ)} * drift);`,
    '  return billboard(at, size);',
    '}',
  ];
  const wgsl = [
    ...WGSL_ATTRIBUTES,
    ...WGSL_BILLBOARD,
    'fn getModelMatrix() -> mat4x4f {',
    `  let age = fract(uniform.ambience_time / ${f(lifeS)} + instance_line1.w + instance_line2.x);`,
    `  let rise = ${f(riseM)} * age;`,
    `  let drift = rise * ${f(windSlant)};`,
    `  let swell = select(0.0, pow(sin(${PI} * age), ${f(fadeExponent)}), age > 0.0);`,
    `  let size = ${f(sizeM)} * (${f(birthShare)} + age) * swell;`,
    `  let at = instance_line1.xyz + vec3f(${f(windX)} * drift, rise, ${f(windZ)} * drift);`,
    '  return billboard(at, size);',
    '}',
  ];
  return { glsl: glsl.join('\n'), wgsl: wgsl.join('\n') };
}

/** A lantern's glow: a camera-facing disc that flickers on its own phase. */
export function haloChunks(): Chunks {
  const { sizeM, flicker, flickerRate, phasePerLantern } = HALO;
  const phase = `${f(flickerRate)} + instance_line1.w * ${f(phasePerLantern)}`;
  const glsl = [
    ...GLSL_ATTRIBUTES,
    ...GLSL_BILLBOARD,
    'mat4 getModelMatrix() {',
    `  float size = ${f(sizeM)} * (1.0 + sin(ambience_time * ${phase}) * ${f(flicker)});`,
    '  return billboard(instance_line1.xyz, size);',
    '}',
  ];
  const wgsl = [
    ...WGSL_ATTRIBUTES,
    ...WGSL_BILLBOARD,
    'fn getModelMatrix() -> mat4x4f {',
    `  let size = ${f(sizeM)} * (1.0 + sin(uniform.ambience_time * ${phase}) * ${f(flicker)});`,
    '  return billboard(instance_line1.xyz, size);',
    '}',
  ];
  return { glsl: glsl.join('\n'), wgsl: wgsl.join('\n') };
}
