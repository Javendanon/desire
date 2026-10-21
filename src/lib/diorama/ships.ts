// Ships moored at the slice's berths (features.json): a caravel about 22 m long with a pointed
// bow, a sterncastle, two masts with furled sails and a stern lantern. They ride the swell.
// A ship is a list of parts; each mesh and paint pair is one instanced batch for the whole
// fleet, so draw calls stay constant however many ships moor.

import * as pc from 'playcanvas';

import { geometryMesh, material, movingBatch, type MovingBatch } from '../engine/render/kit.ts';
import type { Textures } from '../engine/render/textures.ts';
import { swellHeight } from './sea-swell.ts';
import type { SliceBerth } from './slice-data.ts';

const LENGTH_M = 22;
const BEAM_M = 6.2;
const HULL_HEIGHT_M = 2.8;
/** Hull centre above the water plane: about a third of the hull sits below the waterline. */
const WATERLINE_Y = 0.5;
const BOW_SHARE = 0.22;
const ROLL_DEGREES = 2.2;
/** A moored ship, masts included, stays within this distance of its berth. */
const SHIP_REACH_M = 24;

type Triple = [number, number, number];
type MeshKind = 'box' | 'cone' | 'cylinder';
type Paint = 'hull' | 'wood' | 'sail' | 'lamp';

/** One part of the ship in its own frame: keel along +Z, origin at the waterline. */
type Part = {
  mesh: MeshKind;
  paint: Paint;
  position: Triple;
  scale: Triple;
  rotation?: Triple;
};

type Mast = {
  z: number;
  height: number;
  yard: number;
};

const MASTS: Mast[] = [
  { z: 1.5, height: 17, yard: 11 },
  { z: -5.5, height: 12, yard: 7 },
];

/**
 * Only hull parts cast shadows: under the low golden-hour sun a 17 m mast throws one some 50 m
 * long across the town.
 */
const SHADOWED: ReadonlySet<Paint> = new Set(['hull']);

function mastParts(mast: Mast): Part[] {
  const top = HULL_HEIGHT_M / 2;
  const yardY = top + mast.height * 0.82;
  return [
    { mesh: 'cylinder', paint: 'wood', position: [0, top + mast.height / 2, mast.z],
      scale: [0.45, mast.height, 0.45] },
    { mesh: 'cylinder', paint: 'wood', position: [0, yardY, mast.z],
      scale: [0.25, mast.yard, 0.25], rotation: [0, 0, 90] },
    { mesh: 'cylinder', paint: 'sail', position: [0, yardY - 0.55, mast.z],
      scale: [0.8, mast.yard * 0.9, 0.8], rotation: [0, 0, 90] },
  ];
}

function shipParts(): Part[] {
  const bow = LENGTH_M * BOW_SHARE;
  const body = LENGTH_M - bow;
  const castleZ = -LENGTH_M / 2 + 2.6;
  return [
    { mesh: 'box', paint: 'hull', position: [0, 0, -LENGTH_M / 2 + body / 2],
      scale: [BEAM_M, HULL_HEIGHT_M, body] },
    { mesh: 'cone', paint: 'hull', position: [0, 0, LENGTH_M / 2 - bow / 2],
      scale: [BEAM_M, bow, HULL_HEIGHT_M], rotation: [90, 0, 0] },
    { mesh: 'box', paint: 'hull', position: [0, HULL_HEIGHT_M * 0.9, castleZ],
      scale: [BEAM_M * 0.92, 2.2, 4.8] },
    { mesh: 'box', paint: 'lamp', position: [0, HULL_HEIGHT_M * 1.6, castleZ - 2.6],
      scale: [0.35, 0.45, 0.35] },
    ...MASTS.flatMap(mastParts),
  ];
}

type FleetBatch = MovingBatch & {
  /** Part matrices in the ship's frame. */
  locals: pc.Mat4[];
};

export interface Fleet {
  root: pc.Entity;
  berths: SliceBerth[];
  batches: FleetBatch[];
}

function paints(tx: Textures): Record<Paint, pc.StandardMaterial> {
  return {
    hull: material({ map: tx.planks, color: '#8c7a66', gloss: 0.2 }),
    wood: material({ color: '#4a3526', gloss: 0.15 }),
    sail: material({ color: '#d9ccab' }),
    lamp: material({ color: '#ffcf86', emissive: '#ffb35a', emissiveIntensity: 6 }),
  };
}

function meshes(device: pc.GraphicsDevice): Record<MeshKind, pc.Mesh> {
  return {
    box: geometryMesh(device, new pc.BoxGeometry()),
    cone: geometryMesh(device, new pc.ConeGeometry()),
    cylinder: geometryMesh(device, new pc.CylinderGeometry()),
  };
}

function localMatrix(part: Part): pc.Mat4 {
  const rotation = new pc.Quat().setFromEulerAngles(...(part.rotation ?? [0, 0, 0]));
  return new pc.Mat4().setTRS(new pc.Vec3(...part.position), rotation, new pc.Vec3(...part.scale));
}

/** O(berths): a loop, not a spread, so a city's worth of berths cannot overflow the stack. */
function fleetBounds(berths: SliceBerth[]): pc.BoundingBox {
  const min = new pc.Vec3(Infinity, -SHIP_REACH_M, Infinity);
  const max = new pc.Vec3(-Infinity, SHIP_REACH_M, -Infinity);
  for (const berth of berths) {
    min.x = Math.min(min.x, berth.x_m - SHIP_REACH_M);
    min.z = Math.min(min.z, berth.z_m - SHIP_REACH_M);
    max.x = Math.max(max.x, berth.x_m + SHIP_REACH_M);
    max.z = Math.max(max.z, berth.z_m + SHIP_REACH_M);
  }
  const box = new pc.BoundingBox();
  box.setMinMax(min, max);
  return box;
}

function partsByBatch(): Part[][] {
  const groups = new Map<string, Part[]>();
  for (const part of shipParts()) {
    const key = `${part.mesh}:${part.paint}`;
    const group = groups.get(key);
    if (group) group.push(part);
    else groups.set(key, [part]);
  }
  return [...groups.values()];
}

export function buildFleet(app: pc.AppBase, berths: SliceBerth[], tx: Textures): Fleet {
  const root = new pc.Entity('fleet');
  if (berths.length === 0) return { root, berths, batches: [] };
  const materials = paints(tx);
  const kinds = meshes(app.graphicsDevice);
  const bounds = fleetBounds(berths);
  const batches = partsByBatch().map((parts) => {
    const { mesh, paint } = parts[0];
    const batch = movingBatch(app, { mesh: kinds[mesh], material: materials[paint],
      count: parts.length * berths.length, castShadows: SHADOWED.has(paint), bounds });
    root.addChild(batch.entity);
    return { ...batch, locals: parts.map(localMatrix) };
  });
  return { root, berths, batches };
}

const scratch = {
  ship: new pc.Mat4(),
  part: new pc.Mat4(),
  position: new pc.Vec3(),
  rotation: new pc.Quat(),
  unit: new pc.Vec3(1, 1, 1),
};

function placeShip(fleet: Fleet, ship: number, time: number) {
  const berth = fleet.berths[ship];
  const roll = Math.sin(time * 0.7 + ship) * ROLL_DEGREES;
  const swell = swellHeight(berth.x_m, berth.z_m, time);
  scratch.position.set(berth.x_m, WATERLINE_Y + swell, berth.z_m);
  scratch.rotation.setFromEulerAngles(0, (berth.heading_radians * 180) / Math.PI, roll);
  scratch.ship.setTRS(scratch.position, scratch.rotation, scratch.unit);
  for (const batch of fleet.batches) {
    const parts = batch.locals.length;
    for (let part = 0; part < parts; part += 1) {
      scratch.part.mul2(scratch.ship, batch.locals[part]);
      batch.data.set(scratch.part.data, (ship * parts + part) * 16);
    }
  }
}

/** Each ship rides the swell at its berth and rolls on its own phase. O(ships · parts). */
export function animateFleet(fleet: Fleet, time: number) {
  for (let ship = 0; ship < fleet.berths.length; ship += 1) placeShip(fleet, ship, time);
  for (const batch of fleet.batches) batch.buffer.setData(batch.data);
}
