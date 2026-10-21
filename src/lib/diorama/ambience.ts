// Life in the slice: lanterns at the doors, chimney smoke, low fog banks over the water. Smoke
// puffs and lantern halos are soft camera-facing billboards, fog banks soft sheets, each kind one
// instanced batch whose matrices are rewritten every frame. Placement is in ambience-plan.ts.

import * as pc from 'playcanvas';

import { between, createRandom } from '../engine/math/rng.ts';
import { geometryMesh, instancedEntity, material, trs } from '../engine/render/kit.ts';
import { everyNth, puffAt, waterSpots, type Spot } from './ambience-plan.ts';
import type { Slice } from './slice-data.ts';
import type { Town } from './town.ts';

const LANTERN_EVERY = 3;
const LANTERN_SIZE: [number, number, number] = [0.3, 0.4, 0.3];
const LANTERN_GLOW = 8;
/** Halo billboard around each lantern: it reads as light from the ward view. */
const HALO_M = 2.2;
const HALO_OPACITY = 0.55;
const SMOKE_SHARE = 0.3;
const PUFFS_PER_CHIMNEY = 7;
const PUFF_LIFE_S = 9;
const SMOKE_OPACITY = 0.26;
const FOG_BANKS = 14;
const FOG_OPACITY = 0.3;
const FOG_SIZE_M: [number, number] = [70, 170];
const FOG_HEIGHT_M: [number, number] = [2.5, 7];
/** Fog banks sway this far back and forth across a slow cycle. */
const FOG_SWAY_M = 25;
const FOG_SWAY_RATE = 0.025;
/** Onshore breeze, from the sea in the west. */
const WIND = new pc.Vec3(1, 0, -0.35).normalize();
const SOFT_TEXTURE_PX = 64;
const SEED = 0x5e7;

type Batch = {
  buffer: pc.VertexBuffer;
  data: Float32Array;
};
type Smoke = Batch & {
  tops: pc.Vec3[];
  offsets: number[];
};
type Bank = Spot & {
  y: number;
  width: number;
  depth: number;
  phase: number;
};
type Fog = Batch & {
  banks: Bank[];
};
type Halos = Batch & {
  lamps: pc.Vec3[];
};

export interface Ambience {
  root: pc.Entity;
  smoke: Smoke;
  fog: Fog;
  halos: Halos;
}

export interface AmbienceScene {
  slice: Slice;
  town: Town;
}

export interface AmbienceFrame {
  time: number;
  /** Camera rotation, so smoke billboards face the viewer. */
  facing: pc.Quat;
}

/** White disc fading to transparent at its rim, for smoke and fog. */
function softDisc(device: pc.GraphicsDevice): pc.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = SOFT_TEXTURE_PX;
  canvas.height = SOFT_TEXTURE_PX;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('ambience: no 2D canvas context to paint the soft disc');
  const half = SOFT_TEXTURE_PX / 2;
  const gradient = context.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, SOFT_TEXTURE_PX, SOFT_TEXTURE_PX);
  const texture = new pc.Texture(device, {
    name: 'soft-disc', width: SOFT_TEXTURE_PX, height: SOFT_TEXTURE_PX, mipmaps: true,
  });
  texture.setSource(canvas);
  return texture;
}

type Haze = {
  colour: string;
  opacity: number;
  blend?: number;
};

/** Unlit, translucent, lit only by its own colour and the scene fog. */
function hazeMaterial(disc: pc.Texture, spec: Haze): pc.StandardMaterial {
  const { colour, opacity, blend = pc.BLEND_NORMAL } = spec;
  const haze = new pc.StandardMaterial();
  haze.useLighting = false;
  haze.diffuse = new pc.Color(0, 0, 0);
  haze.emissive = new pc.Color().fromString(colour);
  haze.opacity = opacity;
  haze.opacityMap = disc;
  haze.opacityMapChannel = 'a';
  haze.blendType = blend;
  haze.depthWrite = false;
  haze.cull = pc.CULLFACE_NONE;
  haze.update();
  return haze;
}

const UPRIGHT = new pc.Quat().setFromEulerAngles(90, 0, 0);
const scratch = {
  matrix: new pc.Mat4(),
  position: new pc.Vec3(),
  scale: new pc.Vec3(),
  turn: new pc.Quat(),
};

/** A plane batch whose instance matrices the caller rewrites each frame. Never culled. */
function dynamicBatch(app: pc.AppBase, haze: pc.StandardMaterial, count: number) {
  const device = app.graphicsDevice;
  const data = new Float32Array(count * 16);
  const format = pc.VertexFormat.getDefaultInstancingFormat(device);
  const buffer = new pc.VertexBuffer(device, format, Math.max(1, count),
    { usage: pc.BUFFER_DYNAMIC, data });
  const instance = new pc.MeshInstance(geometryMesh(device, new pc.PlaneGeometry()), haze);
  instance.setInstancing(buffer, false);
  const entity = new pc.Entity('haze');
  entity.addComponent('render', { meshInstances: [instance], castShadows: false });
  return { entity, batch: { buffer, data } };
}

function buildSmoke(app: pc.AppBase, disc: pc.Texture, tops: pc.Vec3[]) {
  const random = createRandom(SEED);
  const chosen = tops.filter(() => random() < SMOKE_SHARE);
  const offsets = chosen.map(() => random());
  const haze = hazeMaterial(disc, { colour: '#bdb5ae', opacity: SMOKE_OPACITY });
  const { entity, batch } = dynamicBatch(app, haze, chosen.length * PUFFS_PER_CHIMNEY);
  return { entity, smoke: { ...batch, tops: chosen, offsets } };
}

function buildFog(app: pc.AppBase, disc: pc.Texture, slice: Slice) {
  const random = createRandom(SEED + 1);
  const spots = waterSpots({ heights: slice.heights, meta: slice.meta, count: FOG_BANKS,
    seed: SEED });
  const banks = spots.map((spot) => ({
    ...spot,
    y: between(random, ...FOG_HEIGHT_M),
    width: between(random, ...FOG_SIZE_M),
    depth: between(random, ...FOG_SIZE_M) * 0.6,
    phase: random() * Math.PI * 2,
  }));
  const haze = hazeMaterial(disc, { colour: '#e2cfc2', opacity: FOG_OPACITY });
  const { entity, batch } = dynamicBatch(app, haze, banks.length);
  return { entity, fog: { ...batch, banks } };
}

function buildLanterns(app: pc.AppBase, disc: pc.Texture, fronts: pc.Vec3[]) {
  const lamps = everyNth(fronts, LANTERN_EVERY);
  const lamp = material({ color: '#ffcf86', emissive: '#ffb35a',
    emissiveIntensity: LANTERN_GLOW });
  const cube = geometryMesh(app.graphicsDevice, new pc.BoxGeometry());
  const matrices = lamps.map((front) => trs([front.x, front.y, front.z], 0, LANTERN_SIZE));
  const glow = { colour: '#ffb35a', opacity: HALO_OPACITY, blend: pc.BLEND_ADDITIVEALPHA };
  const { entity, batch } = dynamicBatch(app, hazeMaterial(disc, glow), lamps.length);
  entity.addChild(instancedEntity(app, cube, lamp, matrices));
  return { entity, halos: { ...batch, lamps } };
}

export function buildAmbience(app: pc.AppBase, scene: AmbienceScene): Ambience {
  const disc = softDisc(app.graphicsDevice);
  const root = new pc.Entity('ambience');
  const smoke = buildSmoke(app, disc, scene.town.chimneyTops);
  const fog = buildFog(app, disc, scene.slice);
  const lanterns = buildLanterns(app, disc, scene.town.fronts);
  root.addChild(lanterns.entity);
  root.addChild(smoke.entity);
  root.addChild(fog.entity);
  return { root, smoke: smoke.smoke, fog: fog.fog, halos: lanterns.halos };
}

function writeSmoke(smoke: Smoke, frame: AmbienceFrame) {
  scratch.turn.mul2(frame.facing, UPRIGHT);
  let slot = 0;
  smoke.tops.forEach((top, chimney) => {
    for (let puff = 0; puff < PUFFS_PER_CHIMNEY; puff += 1) {
      const cycle = frame.time / PUFF_LIFE_S + smoke.offsets[chimney] + puff / PUFFS_PER_CHIMNEY;
      const { rise, drift, size } = puffAt(cycle % 1);
      scratch.position.set(top.x + WIND.x * drift, top.y + rise, top.z + WIND.z * drift);
      scratch.scale.set(size, size, size);
      scratch.matrix.setTRS(scratch.position, scratch.turn, scratch.scale);
      smoke.data.set(scratch.matrix.data, slot * 16);
      slot += 1;
    }
  });
  smoke.buffer.setData(smoke.data);
}

function writeFog(fog: Fog, time: number) {
  fog.banks.forEach((bank, index) => {
    const sway = Math.sin(time * FOG_SWAY_RATE * Math.PI * 2 + bank.phase) * FOG_SWAY_M;
    scratch.position.set(bank.x + WIND.x * sway, bank.y, bank.z + WIND.z * sway);
    scratch.scale.set(bank.width, 1, bank.depth);
    scratch.matrix.setTRS(scratch.position, pc.Quat.IDENTITY, scratch.scale);
    fog.data.set(scratch.matrix.data, index * 16);
  });
  fog.buffer.setData(fog.data);
}

function writeHalos(halos: Halos, frame: AmbienceFrame) {
  halos.lamps.forEach((lamp, index) => {
    const flicker = 1 + Math.sin(frame.time * 7 + index * 3) * 0.06;
    scratch.scale.set(HALO_M * flicker, HALO_M * flicker, HALO_M * flicker);
    scratch.matrix.setTRS(lamp, scratch.turn, scratch.scale);
    halos.data.set(scratch.matrix.data, index * 16);
  });
  halos.buffer.setData(halos.data);
}

/** Smoke rises and drifts, fog banks sway, lanterns flicker. Called every frame. */
export function animateAmbience(ambience: Ambience, frame: AmbienceFrame) {
  writeSmoke(ambience.smoke, frame);
  writeHalos(ambience.halos, frame);
  writeFog(ambience.fog, frame.time);
}
