// Small building blocks over the PlayCanvas API: materials, meshes, instanced batches, parts.

import * as pc from 'playcanvas';

import { instanceBounds } from '../math/instance-bounds.ts';

export interface MaterialSpec {
  color?: string;
  map?: pc.Texture;
  emissive?: string;
  emissiveMap?: pc.Texture;
  emissiveIntensity?: number;
  gloss?: number;
  metalness?: number;
  twoSided?: boolean;
  /** Repeats of the diffuse map across the surface. */
  tiling?: number;
}

export function material(spec: MaterialSpec): pc.StandardMaterial {
  const m = new pc.StandardMaterial();
  m.diffuse = new pc.Color().fromString(spec.color ?? '#ffffff');
  if (spec.map) m.diffuseMap = spec.map;
  if (spec.tiling) m.diffuseMapTiling = new pc.Vec2(spec.tiling, spec.tiling);
  if (spec.emissive) m.emissive = new pc.Color().fromString(spec.emissive);
  if (spec.emissiveMap) m.emissiveMap = spec.emissiveMap;
  m.emissiveIntensity = spec.emissiveIntensity ?? 1;
  m.useMetalness = true;
  m.metalness = spec.metalness ?? 0;
  m.gloss = spec.gloss ?? 0.25;
  if (spec.twoSided) {
    m.cull = pc.CULLFACE_NONE;
    m.twoSidedLighting = true;
  }
  m.update();
  return m;
}

/** A gable roof: ridge along Z, eaves at y = 0, ridge at y = 1, footprint 1 × 1. */
export function gableMesh(device: pc.GraphicsDevice): pc.Mesh {
  const L = [-0.5, 0, -0.5];
  const L2 = [-0.5, 0, 0.5];
  const R = [0.5, 0, -0.5];
  const R2 = [0.5, 0, 0.5];
  const A = [0, 1, -0.5];
  const B = [0, 1, 0.5];
  const triangles = [
    [L2, L, A],
    [L2, A, B],
    [R, R2, B],
    [R, B, A],
    [L2, R2, B],
    [R, L, A],
  ];
  const uvs = [
    [1, 0, 0, 0, 0, 1],
    [1, 0, 0, 1, 1, 1],
    [0, 0, 1, 0, 1, 1],
    [0, 0, 1, 1, 0, 1],
    [0, 0, 1, 0, 0.5, 0.6],
    [0, 0, 1, 0, 0.5, 0.6],
  ];
  const positions = triangles.flat(2);
  const indices = Array.from({ length: positions.length / 3 }, (_, i) => i);
  const mesh = new pc.Mesh(device);
  mesh.setPositions(positions);
  mesh.setNormals(pc.calculateNormals(positions, indices));
  mesh.setUvs(0, uvs.flat());
  mesh.setIndices(indices);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  return mesh;
}

export function geometryMesh(device: pc.GraphicsDevice, geometry: pc.Geometry): pc.Mesh {
  return pc.Mesh.fromGeometry(device, geometry);
}

/**
 * One draw call for many copies of a mesh. Hardware instancing culls the batch as a whole,
 * so callers group copies by area or by material. The batch carries the bounds of its
 * instances: camera culling and the directional shadow fit both read them.
 */
export function instancedEntity(
  app: pc.AppBase,
  mesh: pc.Mesh,
  mat: pc.StandardMaterial,
  matrices: readonly pc.Mat4[],
): pc.Entity {
  const entity = new pc.Entity('instanced');
  if (matrices.length === 0) return entity;
  const data = new Float32Array(matrices.length * 16);
  matrices.forEach((m, i) => data.set(m.data, i * 16));
  const format = pc.VertexFormat.getDefaultInstancingFormat(app.graphicsDevice);
  const buffer = new pc.VertexBuffer(app.graphicsDevice, format, matrices.length, { data });
  const instance = new pc.MeshInstance(mesh, mat);
  const { min, max } = instanceBounds(data);
  const box = new pc.BoundingBox();
  box.setMinMax(new pc.Vec3(...min), new pc.Vec3(...max));
  instance.setInstancing(buffer, true);
  entity.addComponent('render', {
    meshInstances: [instance],
    castShadows: true,
    receiveShadows: true,
  });
  // The component hands its own bounds to its mesh instances, so they are set here.
  if (entity.render) entity.render.customAabb = box;
  return entity;
}

export type Triple = readonly [number, number, number];

/** Transform matrix from a position, a rotation around Y in radians and a scale. */
export function trs(position: Triple, rotY: number, scale: Triple): pc.Mat4 {
  const rotation = new pc.Quat().setFromEulerAngles(0, (rotY * 180) / Math.PI, 0);
  return new pc.Mat4().setTRS(new pc.Vec3(...position), rotation, new pc.Vec3(...scale));
}

export type PrimitiveType = 'box' | 'cylinder' | 'cone' | 'sphere' | 'capsule' | 'plane' | 'torus';

export interface PartSpec {
  type: PrimitiveType;
  material: pc.StandardMaterial;
  position: [number, number, number];
  scale?: [number, number, number];
  rotation?: [number, number, number];
}

/** A child entity rendering a built-in primitive. Rotation is in degrees. */
export function part(parent: pc.Entity, spec: PartSpec): pc.Entity {
  const entity = new pc.Entity(spec.type);
  entity.addComponent('render', {
    type: spec.type,
    castShadows: true,
    receiveShadows: true,
  });
  if (entity.render) entity.render.material = spec.material;
  entity.setLocalPosition(...spec.position);
  if (spec.scale) entity.setLocalScale(...spec.scale);
  if (spec.rotation) entity.setLocalEulerAngles(...spec.rotation);
  parent.addChild(entity);
  return entity;
}

/** A child entity rendering a custom mesh. */
export function meshPart(parent: pc.Entity, mesh: pc.Mesh, mat: pc.StandardMaterial): pc.Entity {
  const entity = new pc.Entity('mesh');
  entity.addComponent('render', {
    meshInstances: [new pc.MeshInstance(mesh, mat)],
    castShadows: true,
    receiveShadows: true,
  });
  parent.addChild(entity);
  return entity;
}
