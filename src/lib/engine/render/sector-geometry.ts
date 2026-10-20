// Geometry builders for the streamed map sectors: instance matrices, instanced batches and the
// land mesh. Pure PlayCanvas construction, no streaming state.

import * as pc from 'playcanvas';

import type { MapBuilding, MapDefinition } from '../plan/map-definition.ts';
import { sectorCount } from '../plan/sectors.ts';
import { corridorQuads } from '../plan/corridors.ts';
import { flatMesh, trs, type Triple } from './kit.ts';

export interface Batch {
  entity: pc.Entity;
  buffer: pc.VertexBuffer | null;
}

export interface BatchSpec {
  mesh: pc.Mesh;
  material: pc.StandardMaterial;
  matrices: readonly pc.Mat4[];
}

export const FAR_SHRINK = 0.88;
export const GROUND_STEP_M = 8;
const UV_METRES = 48;

export function wallsMatrix(building: MapBuilding): pc.Mat4 {
  const scale = [building.width, building.height, building.depth] as const;
  return trsAt(building, building.height / 2, scale);
}

export function farMatrix(building: MapBuilding): pc.Mat4 {
  const scale = [
    building.width * FAR_SHRINK,
    building.height * FAR_SHRINK,
    building.depth * FAR_SHRINK,
  ] as const;
  return trsAt(building, (building.height * FAR_SHRINK) / 2, scale);
}

export function gableMatrix(building: MapBuilding): pc.Mat4 {
  const scale = [
    building.width * 1.15,
    0.9 + building.width * 0.35,
    building.depth * 1.08,
  ] as const;
  return trsAt(building, building.height, scale);
}

export function flatRoofMatrix(building: MapBuilding): pc.Mat4 {
  const scale = [building.width * 1.08, 0.3, building.depth * 1.08] as const;
  return trsAt(building, building.height + 0.15, scale);
}

function trsAt(building: MapBuilding, y: number, scale: Triple): pc.Mat4 {
  return trs([building.x, y, building.z], building.rotation, scale);
}

/** One draw call for many copies of a mesh. Returns the instance buffer so unload can free it. */
export function batch(device: pc.GraphicsDevice, spec: BatchSpec): Batch {
  const { mesh, material: mat, matrices } = spec;
  const entity = new pc.Entity('batch');
  if (matrices.length === 0) return { entity, buffer: null };
  const data = new Float32Array(matrices.length * 16);
  matrices.forEach((matrix, index) => data.set(matrix.data, index * 16));
  const format = pc.VertexFormat.getDefaultInstancingFormat(device);
  const buffer = new pc.VertexBuffer(device, format, matrices.length, { data });
  const instance = new pc.MeshInstance(mesh, mat);
  instance.setInstancing(buffer, false);
  entity.addComponent('render', {
    meshInstances: [instance],
    castShadows: true,
    receiveShadows: true,
  });
  return { entity, buffer };
}

/** All lots of the map grouped by roof tone, in stable tone order. */
export function groupByTone(map: MapDefinition, toneCount: number): Map<number, MapBuilding[]> {
  const groups = new Map<number, MapBuilding[]>();
  for (let index = 0; index < sectorCount(map.grid); index++) {
    for (const building of map.sector(index).buildings) {
      const tone = building.tone % toneCount;
      const list = groups.get(tone) ?? [];
      list.push(building);
      groups.set(tone, list);
    }
  }
  return new Map([...groups].sort((left, right) => left[0] - right[0]));
}

/** Always-resident road surface; shared edges do not depend on sector load order. */
export function roadMesh(device: pc.GraphicsDevice, map: MapDefinition): pc.Mesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const road of map.roads ?? []) {
    for (const quad of corridorQuads(road)) {
      const base = positions.length / 3;
      for (const point of quad) {
        positions.push(point.x, 0.08, point.z);
        uvs.push(point.x / UV_METRES, point.z / UV_METRES);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  return flatMesh(device, { positions, uvs, indices });
}

/** Land mesh made of z strips, so the ground has no holes over the whole map frame. */
export function groundMesh(device: pc.GraphicsDevice, map: MapDefinition): pc.Mesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const quad = (x0: number, x1: number, z0: number, z1: number): void => {
    const base = positions.length / 3;
    positions.push(x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z1);
    uvs.push(x0 / UV_METRES, z0 / UV_METRES, x1 / UV_METRES, z0 / UV_METRES);
    uvs.push(x1 / UV_METRES, z1 / UV_METRES, x0 / UV_METRES, z1 / UV_METRES);
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };
  for (let z = map.bounds.minZ; z < map.bounds.maxZ; z += GROUND_STEP_M) {
    const z1 = Math.min(z + GROUND_STEP_M, map.bounds.maxZ);
    for (const [x0, x1] of map.landSpans((z + z1) / 2)) quad(x0, x1, z, z1);
  }
  return flatMesh(device, { positions, uvs, indices });
}
