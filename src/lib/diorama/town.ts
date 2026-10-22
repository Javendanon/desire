// Houses on stage. Where each part goes is planned in town-plan.ts; here every batch key gets its
// mesh and material: timber and stone walls with lit windows, gable or hip roofs tinted from the
// map's roof tones, stone chimneys. Every part is a hardware-instanced batch.

import * as pc from 'playcanvas';

import {
  gableMesh, geometryMesh, instancedData, material, type InstancedLook,
} from '../engine/render/kit.ts';
import type { Textures } from '../engine/render/textures.ts';
import type { TownMarkers } from './ambience.ts';
import { hipMesh } from './house-kit.ts';
import type { Rgb } from './roof-palette.ts';
import type { SliceHouse } from './slice-data.ts';
import { planTown } from './town-plan.ts';

const ROOF_TILING = 3;
const WINDOW_GLOW = 1.1;

export interface TownSpec {
  houses: SliceHouse[];
  /** City-wide roof tone centres (index.json). Without them, tones come from these houses. */
  roofCentres?: Rgb[];
}

export interface Town extends TownMarkers {
  root: pc.Entity;
  windowMaterials: pc.StandardMaterial[];
}

/** The meshes and materials every batch key draws with. */
export interface TownLook {
  walls: Record<string, pc.StandardMaterial>;
  roofs: pc.StandardMaterial[];
  meshes: Record<string, pc.Mesh>;
  /** Walls whose windows glow at dusk. */
  windowMaterials: pc.StandardMaterial[];
}

function windowedWall(map: pc.Texture, windows: pc.Texture): pc.StandardMaterial {
  return material({ map, emissive: '#ffffff', emissiveMap: windows, emissiveIntensity: 0.9 });
}

/** Materials for walls, chimneys and one roof per tone colour, and the three meshes. */
export function townLook(device: pc.GraphicsDevice, tx: Textures, tones: string[]): TownLook {
  const timber = windowedWall(tx.timber, tx.windows);
  const stone = windowedWall(tx.stone, tx.windows);
  const cube = geometryMesh(device, new pc.BoxGeometry());
  return {
    walls: { timber, stone, chimney: material({ map: tx.stone, color: '#8a7f74' }) },
    roofs: tones.map((color) =>
      material({ map: tx.shingle, color, gloss: 0.3, twoSided: true, tiling: ROOF_TILING })),
    meshes: { cube, gable: gableMesh(device), hip: hipMesh(device) },
    windowMaterials: [timber, stone],
  };
}

/** A batch key (`timber`, `chimney`, `gable:3`) as the mesh and material it draws. */
export function lookOf(look: TownLook, key: string): InstancedLook {
  const [kind, tone] = key.split(':');
  const roof = tone !== undefined;
  return {
    mesh: roof ? look.meshes[kind] : look.meshes.cube,
    material: roof ? look.roofs[Number(tone)] : look.walls[kind],
  };
}

/** Lit windows read at dusk: every town's wall materials glow a little. */
export function glowWindows(walls: pc.StandardMaterial[]) {
  for (const wall of walls) {
    wall.emissiveIntensity = WINDOW_GLOW;
    wall.update();
  }
}

/** A whole town at full detail as static batches: the slice's houses. */
export function buildTown(app: pc.AppBase, spec: TownSpec, tx: Textures): Town {
  const plan = planTown(spec.houses, { roofCentres: spec.roofCentres, detail: 'near' });
  const look = townLook(app.graphicsDevice, tx, plan.tones);
  const root = new pc.Entity('town');
  for (const [key, data] of Object.entries(plan.batches)) {
    root.addChild(instancedData(app, lookOf(look, key), data));
  }
  const { chimneyTops, fronts } = plan;
  return { root, windowMaterials: look.windowMaterials, chimneyTops, fronts };
}
