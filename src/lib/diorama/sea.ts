// Water plane of the slice at y = 0, larger than the slice so the horizon is never bare.
// Vertices swell with two slow sine waves; the faceted normals catch the low sun.

import * as pc from 'playcanvas';

import { material } from '../engine/render/kit.ts';

const SEGMENTS = 96;
const MARGIN = 1.8;
const SWELL_M = 0.25;
const WATER_COLOUR = '#3d7480';
/** Translucent enough that the shallows and foam painted on the seabed show through. */
const WATER_OPACITY = 0.6;
const WATER_GLOSS = 0.9;
/**
 * Water is a dielectric (no metalness) and its glint is scaled down: under the golden-hour
 * sun, Fresnel at the city view's grazing angle otherwise whitens the whole harbour.
 */
const WATER_SPECULARITY = 0.2;

export interface Sea {
  entity: pc.Entity;
  mesh: pc.Mesh;
  base: Float32Array;
  positions: Float32Array;
  indices: number[];
}

function grid(size: number, centre: pc.Vec3) {
  const side = SEGMENTS + 1;
  const positions = new Float32Array(side * side * 3);
  const indices: number[] = [];
  for (let row = 0; row < side; row += 1) {
    for (let column = 0; column < side; column += 1) {
      const index = (row * side + column) * 3;
      positions[index] = centre.x + (column / SEGMENTS - 0.5) * size;
      positions[index + 2] = centre.z + (row / SEGMENTS - 0.5) * size;
      if (row < SEGMENTS && column < SEGMENTS) {
        const a = row * side + column;
        indices.push(a, a + side, a + 1, a + 1, a + side, a + side + 1);
      }
    }
  }
  return { positions, indices };
}

export function buildSea(device: pc.GraphicsDevice, extent: number, centre: pc.Vec3): Sea {
  const { positions, indices } = grid(extent * MARGIN, centre);
  const mesh = new pc.Mesh(device);
  mesh.setPositions(positions);
  mesh.setNormals(pc.calculateNormals(Array.from(positions), indices));
  mesh.setIndices(indices);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  const water = material({ color: WATER_COLOUR, gloss: WATER_GLOSS, metalness: 0 });
  water.opacity = WATER_OPACITY;
  water.useMetalnessSpecularColor = true;
  water.specularityFactor = WATER_SPECULARITY;
  water.blendType = pc.BLEND_NORMAL;
  water.update();
  const entity = new pc.Entity('sea');
  entity.addComponent('render', {
    meshInstances: [new pc.MeshInstance(mesh, water)],
    receiveShadows: true,
    castShadows: false,
  });
  return { entity, mesh, base: positions.slice(), positions, indices };
}

export function animateSea(sea: Sea, time: number): void {
  const { base, positions } = sea;
  for (let index = 0; index < positions.length; index += 3) {
    const x = base[index];
    const z = base[index + 2];
    positions[index + 1] = Math.sin(x * 0.05 + time * 0.6) * SWELL_M
      + Math.cos(z * 0.04 + time * 0.45) * SWELL_M * 0.8;
  }
  sea.mesh.setPositions(positions);
  sea.mesh.setNormals(pc.calculateNormals(Array.from(positions), sea.indices));
  sea.mesh.update(pc.PRIMITIVE_TRIANGLES);
}
