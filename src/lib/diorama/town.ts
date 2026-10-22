// Houses of the slice, built storey by storey from their plans (house-plan.ts): timber and stone
// walls with lit windows, jettied upper floors, gable or hip roofs tinted from the map and the
// design palette, dormers and chimneys. Every part is a hardware-instanced batch.

import * as pc from 'playcanvas';

import { gableMesh, geometryMesh, instancedEntity, material, trs } from '../engine/render/kit.ts';
import type { Textures } from '../engine/render/textures.ts';
import { hipMesh } from './house-kit.ts';
import { planHouse, STOREY_M, type HousePlan } from './house-plan.ts';
import { roofTones, type Rgb } from './roof-palette.ts';
import type { SliceHouse } from './slice-data.ts';

/** Land sits 1 m above the water plane (tools/assets/src/slice.ts). */
const GROUND_Y = 1;
const EAVE_OVERHANG = 1.12;
const GABLE_OVERHANG = 1.06;
/** Roof rise as a share of the span: steep, like the reference art. */
const GABLE_PITCH = 0.85;
const HIP_PITCH = 0.6;
const ROOF_TILING = 3;
const CHIMNEY_SIZE: [number, number, number] = [0.7, 2.4, 0.7];
const DORMER_SIZE: [number, number, number] = [1.5, 1.3, 1.2];

type Batch = Map<string, pc.Mat4[]>;
type Build = {
  app: pc.AppBase;
  root: pc.Entity;
  tx: Textures;
};
type Placed = {
  house: SliceHouse;
  plan: HousePlan;
  tone: number;
};

/** A point on a house (chimney top, street door) with the house's id, for per-house choices. */
export interface Marker {
  at: pc.Vec3;
  id: number;
}

export interface TownSpec {
  houses: SliceHouse[];
  /** City-wide roof tone centres (index.json). Without them, tones come from these houses. */
  roofCentres?: Rgb[];
}

export interface Town {
  root: pc.Entity;
  windowMaterials: pc.StandardMaterial[];
  chimneyTops: Marker[];
  fronts: Marker[];
}

function push(batch: Batch, key: string, matrix: pc.Mat4) {
  const list = batch.get(key);
  if (list) list.push(matrix);
  else batch.set(key, [matrix]);
}

/** World position of a point given in the house's local frame (x across, z along the depth). */
function local(house: SliceHouse, x: number, y: number, z: number): [number, number, number] {
  const rotation = new pc.Quat().setFromEulerAngles(0, (house.rotation_radians * 180) / Math.PI, 0);
  const offset = rotation.transformVector(new pc.Vec3(x, 0, z));
  return [house.center.x_m + offset.x, y, house.center.z_m + offset.z];
}

const roofDepth = ({ house, plan }: Placed) =>
  house.depth_m + (plan.storeys > 1 ? 2 * plan.jetty : 0);

const pitchOf = (plan: HousePlan) => (plan.roof === 'gable' ? GABLE_PITCH : HIP_PITCH);

function addStoreys(batch: Batch, placed: Placed) {
  const { house, plan } = placed;
  const wall = plan.stone ? 'stone' : 'timber';
  for (let storey = 0; storey < plan.storeys; storey += 1) {
    const depth = house.depth_m + (storey > 0 ? 2 * plan.jetty : 0);
    const y = GROUND_Y + storey * STOREY_M + STOREY_M / 2;
    push(batch, wall, trs(local(house, 0, y, 0), house.rotation_radians,
      [house.width_m, STOREY_M, depth]));
  }
}

function addRoof(batch: Batch, placed: Placed) {
  const { house, plan, tone } = placed;
  const y = GROUND_Y + plan.wallHeight;
  const scale: [number, number, number] = [house.width_m * EAVE_OVERHANG,
    house.width_m * pitchOf(plan), roofDepth(placed) * GABLE_OVERHANG];
  push(batch, `${plan.roof}:${tone}`, trs(local(house, 0, y, 0), house.rotation_radians, scale));
}

function addChimney(batch: Batch, placed: Placed, tops: Marker[]) {
  const { house, plan } = placed;
  if (!plan.chimney) return;
  const side = (house.center.x_m * 7 + house.center.z_m) % 2 > 1 ? 1 : -1;
  const y = GROUND_Y + plan.wallHeight + house.width_m * pitchOf(plan) * 0.55;
  const position = local(house, side * house.width_m * 0.2, y, roofDepth(placed) * 0.2);
  push(batch, 'chimney', trs(position, house.rotation_radians, CHIMNEY_SIZE));
  tops.push({ at: new pc.Vec3(position[0], y + CHIMNEY_SIZE[1] / 2, position[2]), id: house.id });
}

function addDormer(batch: Batch, placed: Placed) {
  const { house, plan, tone } = placed;
  if (!plan.dormer) return;
  const z = -(roofDepth(placed) / 2 - DORMER_SIZE[2]);
  const y = GROUND_Y + plan.wallHeight + DORMER_SIZE[1] / 2;
  push(batch, plan.stone ? 'stone' : 'timber',
    trs(local(house, 0, y, z), house.rotation_radians, DORMER_SIZE));
  const roofScale: [number, number, number] = [DORMER_SIZE[0] * 1.2, 0.9, DORMER_SIZE[2] * 1.3];
  push(batch, `gable:${tone}`, trs(local(house, 0, y + DORMER_SIZE[1] / 2, z),
    house.rotation_radians, roofScale));
}

function frontOf(placed: Placed): Marker {
  const [x, , z] = local(placed.house, 0, 0, -(roofDepth(placed) / 2 + 0.25));
  return { at: new pc.Vec3(x, GROUND_Y + 2.6, z), id: placed.house.id };
}

function windowedWall(map: pc.Texture, windows: pc.Texture): pc.StandardMaterial {
  return material({ map, emissive: '#ffffff', emissiveMap: windows, emissiveIntensity: 0.9 });
}

function materialsFor(build: Build, tones: string[]) {
  const { tx } = build;
  const roofs = tones.map((colour) =>
    material({ map: tx.shingle, color: colour, gloss: 0.3, twoSided: true, tiling: ROOF_TILING }));
  return {
    timber: windowedWall(tx.timber, tx.windows),
    stone: windowedWall(tx.stone, tx.windows),
    chimney: material({ map: tx.stone, color: '#8a7f74' }),
    roofs,
  };
}

function emitBatches(build: Build, batch: Batch, tones: string[]) {
  const { app, root } = build;
  const mats = materialsFor(build, tones);
  const cube = geometryMesh(app.graphicsDevice, new pc.BoxGeometry());
  const meshes = { gable: gableMesh(app.graphicsDevice), hip: hipMesh(app.graphicsDevice) };
  const walls: Record<string, pc.StandardMaterial> = {
    stone: mats.stone, timber: mats.timber, chimney: mats.chimney,
  };
  for (const [key, matrices] of batch) {
    const [kind, tone] = key.split(':');
    const roof = kind === 'gable' || kind === 'hip';
    const mesh = roof ? meshes[kind] : cube;
    const surface = roof ? mats.roofs[Number(tone)] : walls[kind];
    root.addChild(instancedEntity(app, mesh, surface, matrices));
  }
  return [mats.timber, mats.stone];
}

export function buildTown(app: pc.AppBase, spec: TownSpec, tx: Textures): Town {
  const { houses } = spec;
  const build = { app, root: new pc.Entity('town'), tx };
  const palette = roofTones(houses, spec.roofCentres);
  const batch: Batch = new Map();
  const chimneyTops: Marker[] = [];
  const fronts: Marker[] = [];
  houses.forEach((house, index) => {
    const plan = planHouse(house);
    const placed = { house, plan, tone: palette.labels[index] };
    addStoreys(batch, placed);
    addRoof(batch, placed);
    addChimney(batch, placed, chimneyTops);
    addDormer(batch, placed);
    if (house.frontage) fronts.push(frontOf(placed));
  });
  const windowMaterials = emitBatches(build, batch, palette.colours);
  return { root: build.root, windowMaterials, chimneyTops, fronts };
}
