// The scene stage at the harbour: deck, piers, the broken crane, cargo, lantern posts and ships.
// Lantern lamps are emissive; the camera's bloom turns them into halos.

import * as pc from 'playcanvas';

import type { Point2 } from '../math/hex.ts';
import { material, part, type Triple } from './kit.ts';
import type { Textures } from './textures.ts';

export const DECK = { width: 17, depth: 12.5, thickness: 0.4 } as const;
export const LANTERN_LIGHT = '#ffb05a';
const LANTERN_INTENSITY = 1.6;

interface Ship {
  entity: pc.Entity;
  heading: number;
}

export interface Harbor {
  root: pc.Entity;
  ships: Ship[];
  lanterns: pc.Entity[];
  /** Local y of the ships' waterline (the harbour root sits on the deck height). */
  waterline: number;
}

type Spot = Point2 & { y: number };

function box(
  parent: pc.Entity,
  mat: pc.StandardMaterial,
  position: Triple,
  scale: Triple,
): pc.Entity {
  return part(parent, {
    type: 'box',
    material: mat,
    position: [...position],
    scale: [...scale],
  });
}

function buildDeck(root: pc.Entity, tx: Textures): void {
  const wood = material({ map: tx.planks, gloss: 0.15 });
  box(root, wood, [0, 0.2, 0], [DECK.width, DECK.thickness, DECK.depth]);
  for (let i = 0; i < 5; i++) box(root, wood, [-9 + i * 4.5, -0.1, 11], [1.6, 0.35, 10]);
  // The broken crane stands in the back corner, behind the board from the scene camera.
  box(root, wood, [-6.6, 3.9, -4.6], [0.5, 7, 0.5]);
  const brokenArm = box(root, wood, [-4.6, 2.2, -4.6], [6.5, 0.35, 0.35]);
  brokenArm.setLocalEulerAngles(0, 0, -31);
}

function buildCargo(root: pc.Entity, tx: Textures): void {
  const wood = material({ map: tx.planks, gloss: 0.15 });
  const crates: [number, number, number, number][] = [
    [6.4, 0.85, -5.2, 0.9],
    [7.5, 0.8, -4.6, 0.8],
    [6.9, 0.8, -4.1, 0.75],
    [7.6, 1.7, -4.7, 0.7],
  ];
  crates.forEach(([x, y, z, s], i) =>
    box(root, wood, [x, y, z], [s, s, s]).setLocalEulerAngles(0, i * 23, 0),
  );
  const barrelWood = material({ map: tx.planks, color: '#c49a6c', gloss: 0.3 });
  for (let i = 0; i < 6; i++) {
    part(root, {
      type: 'cylinder',
      material: barrelWood,
      position: [7.2 + (i % 2) * 0.7, 0.8, 0.6 + Math.floor(i / 2) * 0.72],
      scale: [0.66, 0.8, 0.66],
    });
  }
}

function lanternPost(root: pc.Entity, x: number, z: number, y: number): pc.Entity {
  const iron = material({ color: '#1f1d1b', gloss: 0.4, metalness: 0.5 });
  const lamp = material({
    color: '#ffcf86',
    emissive: '#ffb35a',
    emissiveIntensity: 4,
  });
  part(root, {
    type: 'cylinder',
    material: iron,
    position: [x, y + 1.2, z],
    scale: [0.14, 2.4, 0.14],
  });
  box(root, lamp, [x, y + 2.5, z], [0.28, 0.36, 0.28]);
  const light = new pc.Entity('lantern');
  light.addComponent('light', {
    type: 'omni',
    color: new pc.Color().fromString(LANTERN_LIGHT),
    intensity: LANTERN_INTENSITY,
    range: 18,
    castShadows: false,
  });
  light.setLocalPosition(x, y + 2.6, z);
  root.addChild(light);
  return light;
}

function buildShip(tx: Textures, sail: pc.StandardMaterial): pc.Entity {
  const ship = new pc.Entity('ship');
  const hull = material({ map: tx.planks, color: '#8a6a50', gloss: 0.2 });
  const lamp = material({
    color: '#ffcf86',
    emissive: '#ffb35a',
    emissiveIntensity: 5,
  });
  box(ship, hull, [0, 0, 0], [2.4, 1.2, 7]);
  part(ship, {
    type: 'cone',
    material: hull,
    position: [0, 0, 4.6],
    scale: [2.4, 2.4, 1.2],
    rotation: [90, 0, 0],
  });
  part(ship, {
    type: 'cylinder',
    material: hull,
    position: [0, 3.8, 0],
    scale: [0.24, 7, 0.24],
  });
  part(ship, {
    type: 'plane',
    material: sail,
    position: [0.3, 4.2, 0],
    scale: [3.4, 1, 3],
    rotation: [0, 0, 90],
  });
  box(ship, lamp, [0, 1.4, -3.2], [0.25, 0.3, 0.25]);
  return ship;
}

export function buildHarbor(spot: Spot, tx: Textures): Harbor {
  const root = new pc.Entity('harbor');
  root.setLocalPosition(spot.x, spot.y, spot.z);
  buildDeck(root, tx);
  buildCargo(root, tx);
  const lanterns = [
    lanternPost(root, -8, 5.8, 0.4),
    lanternPost(root, 8, -5.8, 0.4),
    lanternPost(root, -1, 16, -0.1),
  ];
  const sail = material({ color: '#d9ccab', twoSided: true });
  const waterline = 0.2 - spot.y;
  const moorings = [
    [-3, 22, 17],
    [9, 27, -29],
    [-10, 30, 52],
  ] as const;
  const ships = moorings.map(([dx, dz, heading]) => {
    const entity = buildShip(tx, sail);
    entity.setLocalPosition(dx, waterline, dz);
    entity.setLocalEulerAngles(0, heading, 0);
    root.addChild(entity);
    return { entity, heading };
  });
  return { root, ships, lanterns, waterline };
}

/** Ships rock and lanterns flicker. Called every frame unless motion is reduced. */
export function animateHarbor(harbor: Harbor, time: number): void {
  harbor.ships.forEach(({ entity, heading }, i) => {
    const position = entity.getLocalPosition();
    const bob = Math.sin(time * 0.9 + i) * 0.16;
    entity.setLocalPosition(position.x, harbor.waterline + bob, position.z);
    entity.setLocalEulerAngles(0, heading, Math.sin(time * 0.7 + i) * 2.3);
  });
  harbor.lanterns.forEach((lantern, i) => {
    const flicker = 0.9 + Math.sin(time * 7 + i * 3) * 0.05 + Math.sin(time * 13 + i) * 0.04;
    if (lantern.light) lantern.light.intensity = LANTERN_INTENSITY * flicker;
  });
}
