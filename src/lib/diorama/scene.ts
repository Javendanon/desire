// The diorama scene: slice terrain, town, sea, dusk light and the D11 post-processing stack.
// Fog and the shadow range follow the camera distance: the fog starts past the subject at every
// zoom and closes before the horizon, and the street view keeps crisp shadows.

import * as pc from 'playcanvas';

import { bootApp } from '../engine/boot.ts';
import { cloneRig, dampRig, rigPosition, type Rig } from '../engine/math/camera-rig.ts';
import { buildSun, createFrame } from '../engine/render/atmosphere.ts';
import { paintTextures } from '../engine/render/textures.ts';
import { animateAmbience, buildAmbience, type Ambience } from './ambience.ts';
import { buildEdgeHaze, tiltEdgeHaze, type EdgeHaze } from './edge-haze.ts';
import { bindOrbit, ZOOM } from './orbit.ts';
import { animateSea, buildSea } from './sea.ts';
import { animateFleet, buildFleet, type Fleet } from './ships.ts';
import type { Slice } from './slice-data.ts';
import type { TiledSlice } from './stress-slice.ts';
import { buildSky, lightScene } from './sky.ts';
import { buildTerrain } from './terrain.ts';
import { buildTown } from './town.ts';

const FIELD_OF_VIEW = 34;
const FAR_CLIP_M = 4000;
const CAMERA_HALF_LIFE_S = 0.35;
/** Linear fog starts this many camera distances plus metres out, past what the camera frames. */
const FOG_START_PER_RADIUS = 2;
const FOG_START_M = 400;
/** ...and is opaque here, inside the far clip, so the sea melts into the horizon colour. */
const FOG_END_M = 3200;
const SHADOW_PER_RADIUS = 1.6;
const MIN_SHADOW_DISTANCE_M = 120;
const TEXTURE_SEED = 7;
const SKY_RADIUS_M = 3000;
const WINDOW_GLOW = 1.1;
/** Below the engine default: the warm light saturates enough. */
const GRADING_SATURATION = 0.86;
/**
 * Ambient occlusion at half resolution: on a 2x display at full resolution it took 10 of the
 * frame's 16 ms of GPU time, and the halved pass looks the same at these scales.
 */
const SSAO_SCALE = 0.5;

export interface DioramaOptions {
  backend?: 'auto' | 'webgl2';
}

export interface DioramaStats {
  frames: number;
  houses: number;
  radius: number;
  backend: string;
}

export interface Diorama {
  app: pc.AppBase;
  /** The post-processing stack, for quality settings and performance work. */
  frame: pc.CameraFrame;
  orbit: { goal: Rig };
  stats(): DioramaStats;
  destroy(): void;
}

function sceneCentre(slice: Slice): pc.Vec3 {
  return new pc.Vec3(slice.meta.width_m / 2, 1, slice.meta.depth_m / 2);
}

function placeCamera(camera: pc.Entity, rig: Rig) {
  const position = rigPosition(rig);
  camera.setPosition(position.x, position.y, position.z);
  camera.lookAt(rig.target.x, rig.target.y, rig.target.z);
}

/** Everything the frame loop moves. */
type Live = {
  app: pc.AppBase;
  camera: pc.Entity;
  sun: pc.Entity;
  sky: pc.Entity;
  sea: ReturnType<typeof buildSea>;
  ambience: Ambience;
  fleet: Fleet;
  edge: EdgeHaze;
  orbit: { goal: Rig };
  rig: Rig;
  frames: number;
  time: number;
};

function tick(live: Live, dt: number) {
  live.time += dt;
  live.frames += 1;
  live.rig = dampRig(live.rig, live.orbit.goal, dt, CAMERA_HALF_LIFE_S);
  placeCamera(live.camera, live.rig);
  live.sky.setPosition(live.camera.getPosition());
  live.app.scene.fog.start = live.rig.radius * FOG_START_PER_RADIUS + FOG_START_M;
  live.app.scene.fog.end = FOG_END_M;
  const shadowRange = Math.max(MIN_SHADOW_DISTANCE_M, live.rig.radius * SHADOW_PER_RADIUS);
  if (live.sun.light) live.sun.light.shadowDistance = shadowRange;
  animateSea(live.sea, live.time);
  animateFleet(live.fleet, live.time);
  tiltEdgeHaze(live.edge, live.rig.polar);
  animateAmbience(live.ambience, { time: live.time, facing: live.camera.getRotation() });
}

function buildCamera(app: pc.AppBase): pc.Entity {
  const camera = new pc.Entity('camera');
  camera.addComponent('camera', { fov: FIELD_OF_VIEW, nearClip: 0.5, farClip: FAR_CLIP_M });
  app.root.addChild(camera);
  return camera;
}

/** The source slice's terrain at every tile offset; clones share its mesh and material. */
function buildGround(app: pc.AppBase, layout: TiledSlice, detail: pc.Texture): pc.Entity {
  const ground = new pc.Entity('ground');
  const terrain = buildTerrain(app, layout.source, detail);
  layout.offsets.forEach((offset, index) => {
    const tile = index === 0 ? terrain : terrain.clone();
    tile.setPosition(offset.x_m, 0, offset.z_m);
    ground.addChild(tile);
  });
  return ground;
}

export async function createDiorama(
  canvas: HTMLCanvasElement,
  layout: TiledSlice,
  options: DioramaOptions = {},
): Promise<Diorama> {
  const { slice } = layout;
  const app = await bootApp(canvas, { backend: options.backend ?? 'auto', lowQuality: false });
  const textures = paintTextures(app.graphicsDevice, TEXTURE_SEED);
  const camera = buildCamera(app);
  const sun = buildSun('high');
  app.root.addChild(sun);
  const town = buildTown(app, slice.houses, textures);
  app.root.addChild(buildGround(app, layout, textures.cobble));
  app.root.addChild(town.root);
  const fleet = buildFleet(app, slice.features.berths, textures);
  app.root.addChild(fleet.root);
  const ambience = buildAmbience(app, { slice, town });
  app.root.addChild(ambience.root);
  const edge = buildEdgeHaze(app, slice);
  app.root.addChild(edge.root);
  const centre = sceneCentre(slice);
  const extent = Math.max(slice.meta.width_m, slice.meta.depth_m);
  const sea = buildSea(app.graphicsDevice, extent, centre);
  app.root.addChild(sea.entity);
  lightScene(app, sun);
  const sky = buildSky(app, sun, SKY_RADIUS_M);
  for (const wall of town.windowMaterials) {
    wall.emissiveIntensity = WINDOW_GLOW;
    wall.update();
  }
  const frame = createFrame(app, camera.camera!, 'high');
  frame.grading.saturation = GRADING_SATURATION;
  frame.ssao.scale = SSAO_SCALE;
  frame.update();
  const goal: Rig = { target: { x: centre.x, y: centre.y, z: centre.z }, radius: ZOOM.city,
    polar: 0.92, azimuth: 0.7 };
  const orbit = { goal };
  const live: Live = {
    app, camera, sun, sky, sea, ambience, fleet, edge, orbit, rig: cloneRig(goal), frames: 0,
    time: 0,
  };
  const unbind = bindOrbit(canvas, orbit);
  app.on('update', (dt: number) => tick(live, dt));
  app.start();
  return {
    app,
    frame,
    orbit,
    stats: () => ({ frames: live.frames, houses: slice.houses.length, radius: live.rig.radius,
      backend: app.graphicsDevice.deviceType }),
    destroy: () => {
      unbind();
      app.destroy();
    },
  };
}
