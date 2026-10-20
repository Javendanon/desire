// The sea: a segmented plane whose vertices swell every frame. 65 × 65 vertices keeps the
// per-frame cost small; the swell is two sine waves, faceted for a painted look.

import * as pc from 'playcanvas';

import { material } from './kit.ts';

const SIZE = 320;
const SEGMENTS = 64;
const SEA_LEVEL = -0.45;

export interface Water {
  entity: pc.Entity;
  mesh: pc.Mesh;
  base: Float32Array;
  positions: Float32Array;
  indices: number[];
}

interface Grid {
  positions: Float32Array;
  uvs: number[];
  indices: number[];
}

function grid(): Grid {
  const side = SEGMENTS + 1;
  const positions = new Float32Array(side * side * 3);
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let row = 0; row < side; row++) {
    for (let col = 0; col < side; col++) {
      const i = (row * side + col) * 3;
      positions[i] = (col / SEGMENTS - 0.5) * SIZE;
      positions[i + 2] = (row / SEGMENTS - 0.5) * SIZE;
      uvs.push(col / SEGMENTS, row / SEGMENTS);
      if (row < SEGMENTS && col < SEGMENTS) {
        const a = row * side + col;
        indices.push(a, a + side, a + 1, a + 1, a + side, a + side + 1);
      }
    }
  }
  return { positions, uvs, indices };
}

export function buildWater(device: pc.GraphicsDevice): Water {
  const { positions, uvs, indices } = grid();
  const mesh = new pc.Mesh(device);
  mesh.setPositions(positions);
  mesh.setNormals(pc.calculateNormals(positions, indices));
  mesh.setUvs(0, uvs);
  mesh.setIndices(indices);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  const sea = material({ color: '#173847', gloss: 0.78, metalness: 0.25 });
  const entity = new pc.Entity('sea');
  entity.addComponent('render', {
    meshInstances: [new pc.MeshInstance(mesh, sea)],
    receiveShadows: true,
  });
  entity.setLocalPosition(0, SEA_LEVEL, 0);
  return { entity, mesh, base: positions.slice(), positions, indices };
}

export function animateWater(water: Water, time: number): void {
  const { base, positions } = water;
  for (let i = 0; i < positions.length; i += 3) {
    const x = base[i];
    const z = base[i + 2];
    positions[i + 1] =
      Math.sin(x * 0.14 + time * 0.9) * 0.2 + Math.cos(z * 0.11 + time * 0.7) * 0.16;
  }
  water.mesh.setPositions(positions);
  water.mesh.setNormals(pc.calculateNormals(positions, water.indices));
  water.mesh.update(pc.PRIMITIVE_TRIANGLES);
}
