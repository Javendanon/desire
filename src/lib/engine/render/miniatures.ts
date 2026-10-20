// Painted tabletop miniatures built from primitives: a bevelled base with a coloured rim and a
// figure on top. The figure is a child so it can tip over on its base when the piece falls.

import * as pc from 'playcanvas';

import { geometryMesh, material, meshPart, part } from './kit.ts';

export type Side = 'ally' | 'enemy';
export type Look = 'ranger' | 'mage' | 'cleric' | 'thug' | 'crab';

export interface Miniature {
  root: pc.Entity;
  figure: pc.Entity;
}

/** Scale of a miniature relative to one board cell. The owner asked for 1.5× the first draft. */
export const MINIATURE_SCALE = 1.725;
const RIM = { ally: '#e0aa4f', enemy: '#c4483a' } as const;

interface Humanoid {
  cloak: string;
  armor: string;
  legs: string;
  skin: string;
  metal?: number;
  hood?: boolean;
  hat?: boolean;
  helm?: boolean;
  weapon: 'bow' | 'staff' | 'mace' | 'cleaver';
}

const HUMANOIDS: Record<Exclude<Look, 'crab'>, Humanoid> = {
  ranger: {
    cloak: '#3f5e4b',
    armor: '#6b4f36',
    legs: '#3a2c22',
    skin: '#d8b48f',
    hood: true,
    weapon: 'bow',
  },
  mage: {
    cloak: '#38407a',
    armor: '#38407a',
    legs: '#2a2f5c',
    skin: '#e3c6a6',
    hat: true,
    weapon: 'staff',
  },
  cleric: {
    cloak: '#d8c9a0',
    armor: '#a9aaa4',
    legs: '#6f706b',
    skin: '#c99d78',
    metal: 0.65,
    helm: true,
    weapon: 'mace',
  },
  thug: {
    cloak: '#2e2522',
    armor: '#4a3b33',
    legs: '#2a221d',
    skin: '#c49c7a',
    hood: true,
    weapon: 'cleaver',
  },
};

function buildBase(device: pc.GraphicsDevice, side: Side): pc.Entity {
  const base = new pc.Entity('base');
  const bevel = new pc.ConeGeometry({
    baseRadius: 0.64,
    peakRadius: 0.56,
    height: 0.17,
    capSegments: 32,
  });
  meshPart(
    base,
    geometryMesh(device, bevel),
    material({ color: '#1c1916', gloss: 0.55, metalness: 0.2 }),
  ).setLocalPosition(0, 0.085, 0);
  const rim = new pc.TorusGeometry({
    ringRadius: 0.615,
    tubeRadius: 0.03,
    segments: 40,
    sides: 8,
  });
  meshPart(
    base,
    geometryMesh(device, rim),
    material({ color: RIM[side], gloss: 0.7, metalness: 0.6 }),
  ).setLocalPosition(0, 0.09, 0);
  return base;
}

function dressHead(
  figure: pc.Entity,
  look: Humanoid,
  cloth: pc.StandardMaterial,
  body: pc.StandardMaterial,
) {
  part(figure, {
    type: 'sphere',
    material: material({ color: look.skin, gloss: 0.3 }),
    position: [0, 1.1, 0],
    scale: [0.21, 0.21, 0.21],
  });
  if (look.hood)
    part(figure, {
      type: 'sphere',
      material: cloth,
      position: [0, 1.13, -0.02],
      scale: [0.27, 0.25, 0.27],
    });
  if (look.helm)
    part(figure, {
      type: 'sphere',
      material: body,
      position: [0, 1.14, 0],
      scale: [0.25, 0.2, 0.25],
    });
  if (look.hat) {
    part(figure, {
      type: 'cone',
      material: cloth,
      position: [0, 1.34, 0],
      scale: [0.34, 0.44, 0.34],
      rotation: [-7, 0, 0],
    });
    part(figure, {
      type: 'cylinder',
      material: cloth,
      position: [0, 1.18, 0],
      scale: [0.52, 0.02, 0.52],
    });
  }
}

interface Gear {
  figure: pc.Entity;
  device: pc.GraphicsDevice;
  wood: pc.StandardMaterial;
  steel: pc.StandardMaterial;
}

function bow({ figure, device, wood }: Gear): void {
  const shape = new pc.TorusGeometry({
    ringRadius: 0.34,
    tubeRadius: 0.018,
    sectorAngle: 180,
    segments: 24,
    sides: 6,
  });
  const entity = meshPart(figure, geometryMesh(device, shape), wood);
  entity.setLocalPosition(0.27, 0.86, 0.14);
  entity.setLocalEulerAngles(0, 90, 90);
}

function staff({ figure, wood }: Gear): void {
  part(figure, {
    type: 'cylinder',
    material: wood,
    position: [0.25, 0.72, 0.08],
    scale: [0.044, 1.35, 0.044],
  });
  const gem = material({
    color: '#cfe0ff',
    emissive: '#7fa8ff',
    emissiveIntensity: 8,
  });
  part(figure, {
    type: 'sphere',
    material: gem,
    position: [0.25, 1.44, 0.08],
    scale: [0.13, 0.13, 0.13],
  });
}

function mace({ figure, wood, steel }: Gear): void {
  part(figure, {
    type: 'cylinder',
    material: wood,
    position: [0.26, 0.74, 0.16],
    scale: [0.05, 0.42, 0.05],
    rotation: [29, 0, 0],
  });
  part(figure, {
    type: 'sphere',
    material: steel,
    position: [0.26, 0.93, 0.27],
    scale: [0.15, 0.15, 0.15],
  });
  const shield = material({ color: '#d8c9a0', gloss: 0.5, metalness: 0.2 });
  part(figure, {
    type: 'cylinder',
    material: shield,
    position: [-0.25, 0.8, 0.1],
    scale: [0.44, 0.04, 0.44],
    rotation: [90, 0, 11],
  });
}

function cleaver({ figure, steel }: Gear): void {
  part(figure, {
    type: 'box',
    material: steel,
    position: [0.27, 0.72, 0.2],
    scale: [0.04, 0.32, 0.15],
    rotation: [17, 0, 0],
  });
}

const WEAPONS: Record<Humanoid['weapon'], (gear: Gear) => void> = {
  bow,
  staff,
  mace,
  cleaver,
};

function arm(figure: pc.Entity, weapon: Humanoid['weapon'], device: pc.GraphicsDevice): void {
  const wood = material({ color: '#5a3d22', gloss: 0.3 });
  const steel = material({ color: '#b9bcbd', gloss: 0.7, metalness: 0.8 });
  WEAPONS[weapon]({ figure, device, wood, steel });
}

type Vec3Tuple = [number, number, number];

interface Limb {
  at: Vec3Tuple;
  rotation: Vec3Tuple;
  leg: boolean;
}

/** Two legs and two arms, posed. Rotations are Euler degrees. */
const LIMBS: readonly Limb[] = [
  { at: [-0.08, 0.38, 0], rotation: [0, 0, 0], leg: true },
  { at: [0.08, 0.38, 0], rotation: [0, 0, 0], leg: true },
  { at: [-0.2, 0.8, 0.02], rotation: [0, 0, 13], leg: false },
  { at: [0.2, 0.82, 0.08], rotation: [-34, 0, -11], leg: false },
];

function buildBody(figure: pc.Entity, body: pc.StandardMaterial, legs: pc.StandardMaterial): void {
  for (const limb of LIMBS) {
    part(figure, {
      type: 'cylinder',
      material: limb.leg ? legs : body,
      position: limb.at,
      scale: limb.leg ? [0.12, 0.42, 0.12] : [0.09, 0.36, 0.09],
      rotation: limb.rotation,
    });
  }
  part(figure, {
    type: 'cylinder',
    material: body,
    position: [0, 0.78, 0],
    scale: [0.29, 0.42, 0.29],
  });
}

/** A hooded figure gets a longer cloak that starts lower. */
function cloakShape(look: Humanoid): pc.ConeGeometry {
  return new pc.ConeGeometry({
    baseRadius: 0.3,
    peakRadius: 0.17,
    height: look.hat ? 0.95 : 0.64,
    capSegments: 16,
  });
}

function buildHumanoid(device: pc.GraphicsDevice, look: Humanoid): pc.Entity {
  const figure = new pc.Entity('figure');
  const body = material({
    color: look.armor,
    gloss: 0.5,
    metalness: look.metal ?? 0.05,
  });
  const cloth = material({ color: look.cloak, gloss: 0.15, twoSided: true });
  const legs = material({ color: look.legs, gloss: 0.3 });
  buildBody(figure, body, legs);
  const cloak = meshPart(figure, geometryMesh(device, cloakShape(look)), cloth);
  cloak.setLocalPosition(0, look.hat ? 0.6 : 0.7, -0.02);
  dressHead(figure, look, cloth, body);
  arm(figure, look.weapon, device);
  return figure;
}

function buildCrab(): pc.Entity {
  const figure = new pc.Entity('figure');
  const shell = material({ color: '#b5583f', gloss: 0.65, metalness: 0.1 });
  const dark = material({ color: '#5a2418', gloss: 0.5 });
  part(figure, {
    type: 'sphere',
    material: shell,
    position: [0, 0.36, 0],
    scale: [1.05, 0.42, 0.8],
  });
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      part(figure, {
        type: 'cylinder',
        material: dark,
        position: [side * 0.48, 0.22, -0.2 + i * 0.2],
        scale: [0.05, 0.5, 0.05],
        rotation: [0, 0, side * 63],
      });
    }
    part(figure, {
      type: 'cylinder',
      material: shell,
      position: [side * 0.3, 0.4, 0.42],
      scale: [0.1, 0.36, 0.1],
      rotation: [69, 0, side * -17],
    });
    part(figure, {
      type: 'sphere',
      material: shell,
      position: [side * 0.36, 0.48, 0.62],
      scale: [0.28, 0.2, 0.39],
    });
    part(figure, {
      type: 'sphere',
      material: dark,
      position: [side * 0.11, 0.58, 0.3],
      scale: [0.07, 0.07, 0.07],
    });
  }
  return figure;
}

export function buildMiniature(device: pc.GraphicsDevice, look: Look, side: Side): Miniature {
  const root = new pc.Entity(`miniature-${look}`);
  root.addChild(buildBase(device, side));
  const figure = look === 'crab' ? buildCrab() : buildHumanoid(device, HUMANOIDS[look]);
  figure.setLocalPosition(0, 0.17, 0);
  root.addChild(figure);
  root.setLocalScale(MINIATURE_SCALE, MINIATURE_SCALE, MINIATURE_SCALE);
  return { root, figure };
}
