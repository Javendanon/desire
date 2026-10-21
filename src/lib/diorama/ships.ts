// Ships moored at the slice's berths (features.json): a caravel about 22 m long with a pointed
// bow, a sterncastle, two masts with furled sails and a stern lantern. They rock on the swell.

import * as pc from 'playcanvas';

import { material, part } from '../engine/render/kit.ts';
import type { Textures } from '../engine/render/textures.ts';
import type { SliceBerth } from './slice-data.ts';

const LENGTH_M = 22;
const BEAM_M = 6.2;
const HULL_HEIGHT_M = 2.8;
/** Hull centre above the water plane: about a third of the hull sits below the waterline. */
const WATERLINE_Y = 0.5;
const BOW_SHARE = 0.22;
const BOB_M = 0.18;
const ROLL_DEGREES = 2.2;

type Mast = {
  z: number;
  height: number;
  yard: number;
};

const MASTS: Mast[] = [
  { z: 1.5, height: 17, yard: 11 },
  { z: -5.5, height: 12, yard: 7 },
];

export interface Fleet {
  root: pc.Entity;
  ships: {
    entity: pc.Entity;
    heading: number;
  }[];
}

type Rig = {
  hull: pc.StandardMaterial;
  wood: pc.StandardMaterial;
  sail: pc.StandardMaterial;
  lamp: pc.StandardMaterial;
};

function rigMaterials(tx: Textures): Rig {
  return {
    hull: material({ map: tx.planks, color: '#8c7a66', gloss: 0.2 }),
    wood: material({ color: '#4a3526', gloss: 0.15 }),
    sail: material({ color: '#d9ccab' }),
    lamp: material({ color: '#ffcf86', emissive: '#ffb35a', emissiveIntensity: 6 }),
  };
}

/**
 * Masts and yards cast no shadow: under the low golden-hour sun a 17 m mast throws one some
 * 50 m long across the town.
 */
function buildMast(ship: pc.Entity, rig: Rig, mast: Mast) {
  const top = HULL_HEIGHT_M / 2;
  const spars = new pc.Entity('mast');
  ship.addChild(spars);
  part(spars, { type: 'cylinder', material: rig.wood, position: [0, top + mast.height / 2, mast.z],
    scale: [0.45, mast.height, 0.45] });
  const yardY = top + mast.height * 0.82;
  part(spars, { type: 'cylinder', material: rig.wood, position: [0, yardY, mast.z],
    scale: [0.25, mast.yard, 0.25], rotation: [0, 0, 90] });
  part(spars, { type: 'cylinder', material: rig.sail, position: [0, yardY - 0.55, mast.z],
    scale: [0.8, mast.yard * 0.9, 0.8], rotation: [0, 0, 90] });
  for (const render of spars.findComponents('render') as pc.RenderComponent[]) {
    render.castShadows = false;
  }
}

function buildShip(rig: Rig): pc.Entity {
  const ship = new pc.Entity('ship');
  const bow = LENGTH_M * BOW_SHARE;
  const body = LENGTH_M - bow;
  part(ship, { type: 'box', material: rig.hull, position: [0, 0, -LENGTH_M / 2 + body / 2],
    scale: [BEAM_M, HULL_HEIGHT_M, body] });
  part(ship, { type: 'cone', material: rig.hull, position: [0, 0, LENGTH_M / 2 - bow / 2],
    scale: [BEAM_M, bow, HULL_HEIGHT_M], rotation: [90, 0, 0] });
  const castleZ = -LENGTH_M / 2 + 2.6;
  part(ship, { type: 'box', material: rig.hull, position: [0, HULL_HEIGHT_M * 0.9, castleZ],
    scale: [BEAM_M * 0.92, 2.2, 4.8] });
  part(ship, { type: 'box', material: rig.lamp, position: [0, HULL_HEIGHT_M * 1.6, castleZ - 2.6],
    scale: [0.35, 0.45, 0.35] });
  MASTS.forEach((mast) => buildMast(ship, rig, mast));
  return ship;
}

export function buildFleet(berths: SliceBerth[], tx: Textures): Fleet {
  const root = new pc.Entity('fleet');
  const rig = rigMaterials(tx);
  const ships = berths.map((berth) => {
    const entity = buildShip(rig);
    const heading = (berth.heading_radians * 180) / Math.PI;
    entity.setLocalPosition(berth.x_m, WATERLINE_Y, berth.z_m);
    entity.setLocalEulerAngles(0, heading, 0);
    root.addChild(entity);
    return { entity, heading };
  });
  return { root, ships };
}

/** Each ship bobs and rolls on its own phase. Called every frame. */
export function animateFleet(fleet: Fleet, time: number) {
  fleet.ships.forEach(({ entity, heading }, index) => {
    const position = entity.getLocalPosition();
    const bob = Math.sin(time * 0.9 + index * 1.7) * BOB_M;
    entity.setLocalPosition(position.x, WATERLINE_Y + bob, position.z);
    entity.setLocalEulerAngles(0, heading, Math.sin(time * 0.7 + index) * ROLL_DEGREES);
  });
}
