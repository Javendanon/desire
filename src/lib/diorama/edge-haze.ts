// Hides the straight cut where the slice's source data ends, at every camera tilt. From above, a
// flat ring of haze, clear over the slice, opaque past its edge and thin again far out. From low,
// a standing curtain of mist along the edge, fading upward, dense where the edge cuts land and
// absent over open sea. The curtain shows only its inward face, so it never blocks a camera
// standing outside it. The two crossfade with the tilt (haze-blend.ts). Opacity rides on vertex
// colours.

import * as pc from 'playcanvas';

import { hazeBlend, landShare, perimeter, type HeightField, type PlanPoint } from './haze-blend.ts';
import type { Slice, SliceMeta } from './slice-data.ts';

/** The ring starts this far inside the slice edge... */
const CLEAR_INSET_M = 70;
/** ...and is opaque this far outside it. */
const SOLID_OUTSET_M = 30;
/** Past the slice the ring thins again over the open sea, so its far edge never shows. */
const THIN_EXTENTS = 1.2;
const OUTER_EXTENTS = 3;
const RING_Y_M = 18;
/** Opacity at each nested rectangle, inside out. */
const RING_ALPHA = [0, 1, 0.7, 0];
/** The curtain stands just outside the edge, from below the waterline to well above the roofs. */
const CURTAIN_OUTSET_M = 15;
const CURTAIN_STEP_M = 20;
/** Land within this distance of an edge point sets the curtain's density there. */
const CURTAIN_LAND_RADIUS_M = 40;
const CURTAIN_HEIGHTS_M = [-3, 30, 90];
/** Opacity at each height for a fully land edge. */
const CURTAIN_ALPHA = [1, 0.85, 0];
const HAZE_COLOUR = '#cdb3a3';
/** Below this change in blend weight the vertex colours are not re-uploaded. */
const BLEND_STEP = 0.01;

type Corner = [number, number];
/** Vertices in loops of `size`, each loop one ring outward or one height upward. */
type LayerSpec = {
  points: number[][];
  size: number;
  /** Opacity per vertex at full weight. */
  alpha: number[];
  cull: number;
};
type Layer = {
  mesh: pc.Mesh;
  alpha: number[];
};

export interface EdgeHaze {
  root: pc.Entity;
  ring: Layer;
  curtain: Layer;
  /** Curtain weight last uploaded. */
  shown: number;
}

function rectangle(meta: SliceMeta, grow: number): Corner[] {
  const east = meta.width_m + grow;
  const south = meta.depth_m + grow;
  return [[-grow, -grow], [east, -grow], [east, south], [-grow, south]];
}

/** Two triangles per segment between consecutive closed loops of `size` vertices. */
function bandIndices(loops: number, size: number): number[] {
  const indices: number[] = [];
  for (let loop = 0; loop + 1 < loops; loop += 1) {
    for (let corner = 0; corner < size; corner += 1) {
      const here = loop * size + corner;
      const next = loop * size + ((corner + 1) % size);
      indices.push(here, next, here + size, next, next + size, here + size);
    }
  }
  return indices;
}

function hazeMaterial(cull: number): pc.StandardMaterial {
  const haze = new pc.StandardMaterial();
  haze.useLighting = false;
  haze.diffuse = new pc.Color(0, 0, 0);
  haze.emissive = new pc.Color().fromString(HAZE_COLOUR);
  haze.opacityVertexColor = true;
  haze.opacityVertexColorChannel = 'a';
  haze.blendType = pc.BLEND_NORMAL;
  haze.depthWrite = false;
  haze.cull = cull;
  haze.update();
  return haze;
}

const colours = (alpha: number[], weight: number) =>
  alpha.flatMap((value) => [1, 1, 1, value * weight]);

function layerEntity(app: pc.AppBase, layer: LayerSpec) {
  const { points, size, alpha } = layer;
  const mesh = new pc.Mesh(app.graphicsDevice);
  mesh.setPositions(points.flat());
  mesh.setNormals(points.flatMap(() => [0, 1, 0]));
  mesh.setColors(colours(alpha, 1));
  mesh.setIndices(bandIndices(points.length / size, size));
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  const entity = new pc.Entity('edge-haze-layer');
  entity.addComponent('render', {
    meshInstances: [new pc.MeshInstance(mesh, hazeMaterial(layer.cull))],
    castShadows: false,
    receiveShadows: false,
  });
  return { entity, mesh };
}

function ringSpec(meta: SliceMeta): LayerSpec {
  const extent = Math.max(meta.width_m, meta.depth_m);
  const grows = [-CLEAR_INSET_M, SOLID_OUTSET_M, extent * THIN_EXTENTS, extent * OUTER_EXTENTS];
  return {
    points: grows.flatMap((grow) => rectangle(meta, grow).map(([x, z]) => [x, RING_Y_M, z])),
    size: 4,
    alpha: RING_ALPHA.flatMap((alpha) => [alpha, alpha, alpha, alpha]),
    cull: pc.CULLFACE_NONE,
  };
}

function curtainSpec(field: HeightField): LayerSpec {
  const edge: PlanPoint[] = perimeter(field.meta,
    { outset: CURTAIN_OUTSET_M, step: CURTAIN_STEP_M });
  const density = edge.map((point) => landShare(field, point, CURTAIN_LAND_RADIUS_M));
  return {
    points: CURTAIN_HEIGHTS_M.flatMap((y) => edge.map(([x, z]) => [x, y, z])),
    size: edge.length,
    alpha: CURTAIN_ALPHA.flatMap((alpha) => density.map((share) => alpha * share)),
    cull: pc.CULLFACE_BACK,
  };
}

export function buildEdgeHaze(app: pc.AppBase, slice: Slice): EdgeHaze {
  const ringLayer = ringSpec(slice.meta);
  const curtainLayer = curtainSpec(slice);
  const ring = layerEntity(app, ringLayer);
  const curtain = layerEntity(app, curtainLayer);
  const root = new pc.Entity('edge-haze');
  root.addChild(ring.entity);
  root.addChild(curtain.entity);
  const haze = {
    root,
    ring: { mesh: ring.mesh, alpha: ringLayer.alpha },
    curtain: { mesh: curtain.mesh, alpha: curtainLayer.alpha },
    shown: 1,
  };
  tiltEdgeHaze(haze, 0);
  return haze;
}

/** Crossfades ring and curtain for the camera's polar angle. Cheap when the tilt holds still. */
export function tiltEdgeHaze(haze: EdgeHaze, polar: number) {
  const blend = hazeBlend(polar);
  if (Math.abs(blend.curtain - haze.shown) < BLEND_STEP) return;
  haze.shown = blend.curtain;
  for (const [layer, weight] of [[haze.ring, blend.ring], [haze.curtain, blend.curtain]] as const) {
    layer.mesh.setColors(colours(layer.alpha, weight));
    layer.mesh.update(pc.PRIMITIVE_TRIANGLES);
  }
}
