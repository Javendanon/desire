// Puts a material's per-instance motion on the GPU: its `transformInstancingVS` chunk becomes one
// of shaders.ts, and the four instance attributes are bound by hand, because PlayCanvas only
// binds them itself while the default chunk is in place.

import * as pc from 'playcanvas';

import type { Chunks } from './shaders.ts';

/** Engine version the chunks are written against (PlayCanvas asks for major.minor). */
const CHUNKS_VERSION = '2.23';
/** Semantics of `VertexFormat.getDefaultInstancingFormat`, line by line. */
const INSTANCE_SEMANTICS = [
  pc.SEMANTIC_ATTR11, pc.SEMANTIC_ATTR12, pc.SEMANTIC_ATTR14, pc.SEMANTIC_ATTR15,
];

export function useInstanceChunks(material: pc.StandardMaterial, chunks: Chunks): void {
  material.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set('transformInstancingVS', chunks.glsl);
  material.getShaderChunks(pc.SHADERLANGUAGE_WGSL).set('transformInstancingVS', chunks.wgsl);
  material.shaderChunksVersion = CHUNKS_VERSION;
  INSTANCE_SEMANTICS.forEach((semantic, line) =>
    material.setAttribute(`instance_line${line + 1}`, semantic));
  material.update();
}

export interface Reach {
  side: number;
  below: number;
  above: number;
}

/** World box around points, grown by `reach` sideways, below and above. */
/** A point in world space. */
export type Point3 = {
  x: number;
  y: number;
  z: number;
};

export function boundsAround(points: Point3[], reach: Reach): pc.BoundingBox {
  const min = new pc.Vec3(Infinity, Infinity, Infinity);
  const max = new pc.Vec3(-Infinity, -Infinity, -Infinity);
  for (const point of points) {
    min.set(Math.min(min.x, point.x), Math.min(min.y, point.y), Math.min(min.z, point.z));
    max.set(Math.max(max.x, point.x), Math.max(max.y, point.y), Math.max(max.z, point.z));
  }
  const box = new pc.BoundingBox();
  if (points.length === 0) return box;
  box.setMinMax(new pc.Vec3(min.x - reach.side, min.y - reach.below, min.z - reach.side),
    new pc.Vec3(max.x + reach.side, max.y + reach.above, max.z + reach.side));
  return box;
}
