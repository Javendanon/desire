// Water plane of the slice at y = 0, larger than the slice so the horizon is never bare. The
// flat grid is uploaded once; the vertex shader lifts every vertex onto two slow crossing waves
// and tilts its normal by their exact slope (shaders.ts, reference in sea-swell.ts). Each frame
// sets one clock uniform.

import * as pc from 'playcanvas';

import { geometryMesh, material, movingBatch } from '../engine/render/kit.ts';
import { useInstanceChunks } from './gpu-instancing.ts';
import { SWELL } from './sea-swell.ts';
import { seaChunks } from './shaders.ts';

const SEGMENTS = 128;
const MARGIN = 3.5;
const WATER_COLOUR = '#3d7480';
/**
 * The open ocean past the swell grid: one opaque plane just under the seabed, wide enough for
 * the fog to close before its edge. Its tone is the swell (60 %) blended over it, so the
 * swell grid's edge leaves no seam.
 */
const OCEAN_M = 9000;
const OCEAN_Y = -2.6;
const OCEAN_COLOUR = '#366c77';
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
  water: pc.StandardMaterial;
}

/** The swell never leaves this band around the water plane. */
const SWELL_BAND_M = SWELL.heightM * (1 + SWELL.crossShare);
const IDENTITY = new pc.Mat4();

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

function waterMaterial(): pc.StandardMaterial {
  const water = material({ color: WATER_COLOUR, gloss: WATER_GLOSS, metalness: 0 });
  water.opacity = WATER_OPACITY;
  water.useMetalnessSpecularColor = true;
  water.specularityFactor = WATER_SPECULARITY;
  water.blendType = pc.BLEND_NORMAL;
  useInstanceChunks(water, seaChunks());
  return water;
}

/** The flat grid, drawn as one instance so the swell chunk can move its vertices. */
export function buildSea(app: pc.AppBase, extent: number, centre: pc.Vec3): Sea {
  const size = extent * MARGIN;
  const { positions, indices } = grid(size, centre);
  const mesh = new pc.Mesh(app.graphicsDevice);
  mesh.setPositions(positions);
  mesh.setNormals(Float32Array.from({ length: positions.length }, (_, i) => (i % 3 === 1 ? 1 : 0)));
  mesh.setIndices(indices);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  const water = waterMaterial();
  const half = size / 2;
  const bounds = new pc.BoundingBox();
  bounds.setMinMax(new pc.Vec3(centre.x - half, -SWELL_BAND_M, centre.z - half),
    new pc.Vec3(centre.x + half, SWELL_BAND_M, centre.z + half));
  const sea = movingBatch(app, { mesh, material: water, count: 1, castShadows: false, bounds });
  sea.data.set(IDENTITY.data);
  sea.buffer.setData(sea.data);
  sea.entity.name = 'sea';
  sea.entity.addChild(buildOcean(app.graphicsDevice, centre));
  return { entity: sea.entity, water };
}

function buildOcean(device: pc.GraphicsDevice, centre: pc.Vec3): pc.Entity {
  const ocean = new pc.Entity('ocean');
  ocean.addComponent('render', {
    meshInstances: [new pc.MeshInstance(geometryMesh(device, new pc.PlaneGeometry()),
      material({ color: OCEAN_COLOUR, gloss: WATER_GLOSS }))],
    castShadows: false,
    receiveShadows: false,
  });
  ocean.setPosition(centre.x, OCEAN_Y, centre.z);
  ocean.setLocalScale(OCEAN_M, 1, OCEAN_M);
  return ocean;
}

/** The swell runs on the GPU: only its clock moves here. */
export function animateSea(sea: Sea, time: number): void {
  sea.water.setParameter('swell_time', time);
}
