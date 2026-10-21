// Houses of the slice: instanced timber and stone walls with lit windows, gable roofs whose
// colour comes from the source map, and chimneys. The gable faces the street: a narrow frontage
// with its gable end to the lane, as in a medieval harbour town.

import * as pc from 'playcanvas';

import { gableMesh, geometryMesh, instancedEntity, material, trs } from '../engine/render/kit.ts';
import type { Textures } from '../engine/render/textures.ts';
import { createRandom, type Random } from '../engine/math/rng.ts';
import type { SliceHouse } from './slice-data.ts';

type Rgb = [number, number, number];

/** Land sits 1 m above the water plane (tools/assets/src/slice.ts). */
const GROUND_Y = 1;
const ROOF_TONES = 6;
const KMEANS_ROUNDS = 12;
const EAVE_OVERHANG = 1.14;
const GABLE_OVERHANG = 1.06;
/** Roof rise as a share of the span: steep, like the reference art. */
const ROOF_PITCH = 0.85;
const STONE_SHARE = 0.25;
const CHIMNEY_SHARE = 0.4;
const CHIMNEY_SIZE: [number, number, number] = [0.7, 2.2, 0.7];
/**
 * Roof tints of the design canvas ("Farol en la niebla"), as D13 uses them. A painted map colour
 * is far darker than a daylight albedo, so each sampled tone is mixed with its nearest tint.
 */
const DESIGN_ROOFS: Rgb[] = [
  [124, 135, 146], [184, 113, 79], [95, 106, 116], [143, 135, 112], [163, 95, 69],
];
const DESIGN_SHARE = 0.55;

type Build = {
  app: pc.AppBase;
  root: pc.Entity;
  houses: SliceHouse[];
  tx: Textures;
};

export interface Town {
  root: pc.Entity;
  windowMaterials: pc.StandardMaterial[];
  chimneyTops: pc.Vec3[];
}

const distance2 = (a: Rgb, b: Rgb) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

function nearest(colour: Rgb, centres: Rgb[]): number {
  let best = 0;
  centres.forEach((centre, index) => {
    if (distance2(colour, centre) < distance2(colour, centres[best])) best = index;
  });
  return best;
}

type Tones = {
  centres: Rgb[];
  labels: number[];
};

/** k-means over roof colours, seeded deterministically from evenly spaced samples. */
function roofTones(houses: SliceHouse[]): Tones {
  const colours = houses.map((house) => house.roof_rgb);
  let centres: Rgb[] = Array.from({ length: Math.min(ROOF_TONES, colours.length) }, (_, index) =>
    colours[Math.floor((index * colours.length) / ROOF_TONES)]);
  let labels = colours.map((colour) => nearest(colour, centres));
  for (let round = 0; round < KMEANS_ROUNDS; round += 1) {
    centres = centres.map((centre, index) => {
      const members = colours.filter((_, house) => labels[house] === index);
      if (members.length === 0) return centre;
      return [0, 1, 2].map((channel) =>
        members.reduce((sum, colour) => sum + colour[channel], 0) / members.length) as Rgb;
    });
    labels = colours.map((colour) => nearest(colour, centres));
  }
  return { centres, labels };
}

/** Hue-led match: compare colours with their brightness removed. */
function nearestDesignRoof(colour: Rgb): Rgb {
  const chroma = (value: Rgb) => {
    const sum = value[0] + value[1] + value[2] || 1;
    return value.map((channel) => (channel / sum) * 255) as Rgb;
  };
  return DESIGN_ROOFS[nearest(chroma(colour), DESIGN_ROOFS.map(chroma))];
}

function roofHex(colour: Rgb): string {
  const tint = nearestDesignRoof(colour);
  const mixed = colour.map((channel, index) =>
    channel * (1 - DESIGN_SHARE) + tint[index] * DESIGN_SHARE);
  return `#${mixed.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
}

function windowedWall(map: pc.Texture, windows: pc.Texture): pc.StandardMaterial {
  return material({ map, emissive: '#ffffff', emissiveMap: windows, emissiveIntensity: 0.9 });
}

const wallMatrix = (house: SliceHouse) => trs(
  [house.center.x_m, GROUND_Y + house.height_m / 2, house.center.z_m],
  house.rotation_radians,
  [house.width_m, house.height_m, house.depth_m],
);

const roofMatrix = (house: SliceHouse) => trs(
  [house.center.x_m, GROUND_Y + house.height_m, house.center.z_m],
  house.rotation_radians,
  [house.width_m * EAVE_OVERHANG, house.width_m * ROOF_PITCH, house.depth_m * GABLE_OVERHANG],
);

/** A chimney on one roof slope, a third of the way along the ridge. */
function chimneyMatrix(house: SliceHouse, random: Random): pc.Mat4 {
  const side = random() < 0.5 ? -1 : 1;
  const local = new pc.Vec3(side * house.width_m * 0.22, 0, (random() - 0.5) * house.depth_m * 0.5);
  const rotation = new pc.Quat().setFromEulerAngles(0, (house.rotation_radians * 180) / Math.PI, 0);
  const offset = rotation.transformVector(local);
  const y = GROUND_Y + house.height_m + house.width_m * ROOF_PITCH * 0.55;
  return trs([house.center.x_m + offset.x, y, house.center.z_m + offset.z], house.rotation_radians,
    CHIMNEY_SIZE);
}

function addWalls(build: Build) {
  const { app, root, houses, tx } = build;
  const random = createRandom(11);
  const stone = houses.map(() => random() < STONE_SHARE);
  const cube = geometryMesh(app.graphicsDevice, new pc.BoxGeometry());
  const timberWall = windowedWall(tx.timber, tx.windows);
  const stoneWall = windowedWall(tx.stone, tx.windows);
  root.addChild(instancedEntity(app, cube, timberWall,
    houses.filter((_, index) => !stone[index]).map(wallMatrix)));
  root.addChild(instancedEntity(app, cube, stoneWall,
    houses.filter((_, index) => stone[index]).map(wallMatrix)));
  return [timberWall, stoneWall];
}

function addRoofs(build: Build) {
  const { app, root, houses, tx } = build;
  const gable = gableMesh(app.graphicsDevice);
  const { centres, labels } = roofTones(houses);
  centres.forEach((centre, tone) => {
    const roof = material({ map: tx.shingle, color: roofHex(centre), gloss: 0.3, twoSided: true });
    const matrices = houses.filter((_, index) => labels[index] === tone).map(roofMatrix);
    root.addChild(instancedEntity(app, gable, roof, matrices));
  });
}

function addChimneys(build: Build) {
  const { app, root, houses, tx } = build;
  const random = createRandom(23);
  const chosen = houses.filter(() => random() < CHIMNEY_SHARE);
  const matrices = chosen.map((house) => chimneyMatrix(house, random));
  const cube = geometryMesh(app.graphicsDevice, new pc.BoxGeometry());
  const brick = material({ map: tx.stone, color: '#8a7f74' });
  root.addChild(instancedEntity(app, cube, brick, matrices));
  return matrices.map((matrix) => {
    const top = matrix.getTranslation();
    return new pc.Vec3(top.x, top.y + CHIMNEY_SIZE[1] / 2, top.z);
  });
}

export function buildTown(app: pc.AppBase, houses: SliceHouse[], tx: Textures): Town {
  const build = { app, root: new pc.Entity('town'), houses, tx };
  const windowMaterials = addWalls(build);
  addRoofs(build);
  const chimneyTops = addChimneys(build);
  const { root } = build;
  return { root, windowMaterials, chimneyTops };
}
