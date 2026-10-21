// Life in the slice: lanterns at the doors, chimney smoke, low fog banks over the water. Smoke
// puffs and lantern halos are soft camera-facing billboards moved on the GPU (shaders.ts): their
// instance data is written once and each frame only sets a clock and the camera axes. The few
// fog banks sway on the CPU. Each kind is one culled instanced batch. Placement is in
// ambience-plan.ts.

import * as pc from 'playcanvas';

import { between, createRandom } from '../engine/math/rng.ts';
import {
  geometryMesh, instancedEntity, material, movingBatch, trs, type MovingBatch,
} from '../engine/render/kit.ts';
import {
  chimneySmoke, HALO, hasLantern, PUFF, waterSpots, type Spot,
} from './ambience-plan.ts';
import { boundsAround, useInstanceChunks } from './gpu-instancing.ts';
import { haloChunks, smokeChunks } from './shaders.ts';
import type { Slice } from './slice-data.ts';
import type { Marker, Town } from './town.ts';

const LANTERN_SIZE: [number, number, number] = [0.3, 0.4, 0.3];
const LANTERN_GLOW = 8;
/** Halo billboard around each lantern (sized in ambience-plan.ts): it reads as light from afar. */
const HALO_OPACITY = 0.55;
const PUFFS_PER_CHIMNEY = 7;
const SMOKE_OPACITY = 0.26;
const FOG_BANKS = 14;
const FOG_OPACITY = 0.3;
const FOG_SIZE_M: [number, number] = [70, 170];
const FOG_HEIGHT_M: [number, number] = [2.5, 7];
/** Fog banks sway this far back and forth across a slow cycle. */
const FOG_SWAY_M = 25;
const FOG_SWAY_RATE = 0.025;
const SOFT_TEXTURE_PX = 64;
const SEED = 0x5e7;

type Bank = Spot & {
  y: number;
  width: number;
  depth: number;
  phase: number;
};
type Fog = MovingBatch & {
  banks: Bank[];
};

export interface Ambience {
  root: pc.Entity;
  fog: Fog;
  /** Materials whose motion runs on the GPU, fed the clock and camera axes. */
  moving: pc.StandardMaterial[];
}

export interface AmbienceScene {
  slice: Slice;
  town: Town;
}

export interface AmbienceFrame {
  time: number;
  /** Camera axes in world space, so billboards face the viewer. */
  right: pc.Vec3;
  up: pc.Vec3;
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

const FLOATS_PER_INSTANCE = 16;
/** Largest puff reach from its chimney: drift plus its widest half-size. */
const PUFF_REACH_M = PUFF.riseM * PUFF.windSlant + PUFF.sizeM * (PUFF.birthShare + 1);

/** A plane batch over `count` instances inside `bounds`, its data written by the caller. */
function planeBatch(app: pc.AppBase, haze: pc.StandardMaterial, count: number,
  bounds: pc.BoundingBox): MovingBatch {
  const mesh = geometryMesh(app.graphicsDevice, new pc.PlaneGeometry());
  return movingBatch(app, { mesh, material: haze, count, castShadows: false, bounds });
}

/** Per puff: chimney top and phase in line 1, the puff's share of the cycle in line 2. */
function smokeData(tops: pc.Vec3[], offsets: number[]): Float32Array {
  const data = new Float32Array(tops.length * PUFFS_PER_CHIMNEY * FLOATS_PER_INSTANCE);
  tops.forEach((top, chimney) => {
    for (let puff = 0; puff < PUFFS_PER_CHIMNEY; puff += 1) {
      const at = (chimney * PUFFS_PER_CHIMNEY + puff) * FLOATS_PER_INSTANCE;
      data.set([top.x, top.y, top.z, offsets[chimney], puff / PUFFS_PER_CHIMNEY], at);
    }
  });
  return data;
}

function buildSmoke(app: pc.AppBase, disc: pc.Texture, tops: Marker[]) {
  const smoking = tops.filter((top) => chimneySmoke(top.id).smokes);
  const chosen = smoking.map((top) => top.at);
  const offsets = smoking.map((top) => chimneySmoke(top.id).phase);
  const haze = hazeMaterial(disc, { colour: '#bdb5ae', opacity: SMOKE_OPACITY });
  useInstanceChunks(haze, smokeChunks());
  const bounds = boundsAround(chosen,
    { side: PUFF_REACH_M, below: PUFF.sizeM, above: PUFF.riseM + PUFF.sizeM });
  const batch = planeBatch(app, haze, chosen.length * PUFFS_PER_CHIMNEY, bounds);
  batch.data.set(smokeData(chosen, offsets));
  batch.buffer.setData(batch.data);
  return { entity: batch.entity, material: haze };
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
  const centres = banks.map((bank) => new pc.Vec3(bank.x, bank.y, bank.z));
  const bounds = boundsAround(centres,
    { side: FOG_SIZE_M[1] / 2 + FOG_SWAY_M, below: 1, above: 1 });
  const batch = planeBatch(app, haze, banks.length, bounds);
  return { entity: batch.entity, fog: { ...batch, banks } };
}

/** Per lantern: its position and index (the flicker phase) in line 1. */
function haloData(lamps: pc.Vec3[]): Float32Array {
  const data = new Float32Array(lamps.length * FLOATS_PER_INSTANCE);
  lamps.forEach((lamp, index) =>
    data.set([lamp.x, lamp.y, lamp.z, index], index * FLOATS_PER_INSTANCE));
  return data;
}

function buildLanterns(app: pc.AppBase, disc: pc.Texture, fronts: Marker[]) {
  const lamps = fronts.filter((front) => hasLantern(front.id)).map((front) => front.at);
  const lamp = material({ color: '#ffcf86', emissive: '#ffb35a',
    emissiveIntensity: LANTERN_GLOW });
  const cube = geometryMesh(app.graphicsDevice, new pc.BoxGeometry());
  const matrices = lamps.map((front) => trs([front.x, front.y, front.z], 0, LANTERN_SIZE));
  const glow = hazeMaterial(disc,
    { colour: '#ffb35a', opacity: HALO_OPACITY, blend: pc.BLEND_ADDITIVEALPHA });
  useInstanceChunks(glow, haloChunks());
  const reach = HALO.sizeM * (1 + HALO.flicker);
  const halos = planeBatch(app, glow, lamps.length,
    boundsAround(lamps, { side: reach, below: reach, above: reach }));
  halos.data.set(haloData(lamps));
  halos.buffer.setData(halos.data);
  halos.entity.addChild(instancedEntity(app, cube, lamp, matrices));
  return { entity: halos.entity, material: glow };
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
  return { root, fog: fog.fog, moving: [smoke.material, lanterns.material] };
}

const scratch = {
  matrix: new pc.Mat4(),
  position: new pc.Vec3(),
  scale: new pc.Vec3(),
  right: new Float32Array(3),
  up: new Float32Array(3),
};
const WIND_X = PUFF.windX;
const WIND_Z = PUFF.windZ;

/** Fog banks: a handful of matrices, rewritten on the CPU. */
function writeFog(fog: Fog, time: number) {
  fog.banks.forEach((bank, index) => {
    const sway = Math.sin(time * FOG_SWAY_RATE * Math.PI * 2 + bank.phase) * FOG_SWAY_M;
    scratch.position.set(bank.x + WIND_X * sway, bank.y, bank.z + WIND_Z * sway);
    scratch.scale.set(bank.width, 1, bank.depth);
    scratch.matrix.setTRS(scratch.position, pc.Quat.IDENTITY, scratch.scale);
    fog.data.set(scratch.matrix.data, index * FLOATS_PER_INSTANCE);
  });
  fog.buffer.setData(fog.data);
}

/** Smoke rises and lanterns flicker on the GPU, and fog banks sway. Called every frame. */
export function animateAmbience(ambience: Ambience, frame: AmbienceFrame) {
  scratch.right.set([frame.right.x, frame.right.y, frame.right.z]);
  scratch.up.set([frame.up.x, frame.up.y, frame.up.z]);
  for (const moving of ambience.moving) {
    moving.setParameter('ambience_time', frame.time);
    moving.setParameter('view_right', scratch.right);
    moving.setParameter('view_up', scratch.up);
  }
  writeFog(ambience.fog, frame.time);
}
