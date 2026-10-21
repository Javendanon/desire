// Frames the slice in low haze: a flat ring, clear over the slice and opaque past its edge, so
// the straight cut where the source data ends never shows. Opacity rides on vertex colours.

import * as pc from 'playcanvas';

import type { SliceMeta } from './slice-data.ts';

/** The haze starts this far inside the slice edge... */
const CLEAR_INSET_M = 70;
/** ...and is opaque this far outside it. */
const SOLID_OUTSET_M = 30;
/** The ring reaches this many slice extents out, past the sea. */
const OUTER_EXTENTS = 4;
const HAZE_Y_M = 18;
const HAZE_COLOUR = '#cdb3a3';
/** Opacity at each nested rectangle, inside out. */
const RING_ALPHA = [0, 1, 1];

type Corner = [number, number];

function rectangle(meta: SliceMeta, grow: number): Corner[] {
  const east = meta.width_m + grow;
  const south = meta.depth_m + grow;
  return [[-grow, -grow], [east, -grow], [east, south], [-grow, south]];
}

/** Two triangles per side between consecutive rectangles. */
function bandIndices(rings: number): number[] {
  const indices: number[] = [];
  for (let ring = 0; ring + 1 < rings; ring += 1) {
    for (let corner = 0; corner < 4; corner += 1) {
      const inner = ring * 4 + corner;
      const innerNext = ring * 4 + ((corner + 1) % 4);
      indices.push(inner, inner + 4, innerNext, innerNext, inner + 4, innerNext + 4);
    }
  }
  return indices;
}

function hazeMaterial(): pc.StandardMaterial {
  const haze = new pc.StandardMaterial();
  haze.useLighting = false;
  haze.diffuse = new pc.Color(0, 0, 0);
  haze.emissive = new pc.Color().fromString(HAZE_COLOUR);
  haze.opacityVertexColor = true;
  haze.opacityVertexColorChannel = 'a';
  haze.blendType = pc.BLEND_NORMAL;
  haze.depthWrite = false;
  haze.cull = pc.CULLFACE_NONE;
  haze.update();
  return haze;
}

export function buildEdgeHaze(app: pc.AppBase, meta: SliceMeta): pc.Entity {
  const extent = Math.max(meta.width_m, meta.depth_m);
  const grows = [-CLEAR_INSET_M, SOLID_OUTSET_M, extent * OUTER_EXTENTS];
  const corners = grows.flatMap((grow) => rectangle(meta, grow));
  const mesh = new pc.Mesh(app.graphicsDevice);
  mesh.setPositions(corners.flatMap(([x, z]) => [x, HAZE_Y_M, z]));
  mesh.setNormals(corners.flatMap(() => [0, 1, 0]));
  mesh.setColors(RING_ALPHA.flatMap((alpha) => [0, 0, 0, 0].flatMap(() => [1, 1, 1, alpha])));
  mesh.setIndices(bandIndices(grows.length));
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  const entity = new pc.Entity('edge-haze');
  entity.addComponent('render', {
    meshInstances: [new pc.MeshInstance(mesh, hazeMaterial())],
    castShadows: false,
    receiveShadows: false,
  });
  return entity;
}
