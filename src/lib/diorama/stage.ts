// What both diorama modes stand on: the engine, camera, dusk sun and sky, the sea, the D11
// post-processing stack and the frame loop. Fog and the shadow range follow the camera distance:
// the fog starts past the subject at every zoom and closes before the horizon, and the street
// view keeps crisp shadows. What a mode puts on stage (a slice, or streamed city sectors) moves
// through movers, called every frame with the clock and the camera.

import * as pc from 'playcanvas';

import { bootApp } from '../engine/boot.ts';
import { cloneRig, dampRig, rigPosition, type Rig } from '../engine/math/camera-rig.ts';
import { buildSun, createFrame } from '../engine/render/atmosphere.ts';
import { paintTextures, type Textures } from '../engine/render/textures.ts';
import { bindOrbit, ZOOM } from './orbit.ts';
import { QUALITY, type QualityName, type QualitySettings } from './quality.ts';
import { animateSea, buildSea, type Sea } from './sea.ts';
import { buildSky, lightScene } from './sky.ts';

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
  quality?: QualityName;
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

/** One frame as movers see it. */
export interface Moment {
  time: number;
  /** Seconds since the previous frame. */
  dt: number;
  camera: pc.Entity;
  rig: Rig;
}

export type Mover = (moment: Moment) => void;

/** Where the stage looks first, and how far its sea spans around that. */
export interface StageSpec {
  centre: pc.Vec3;
  extent_m: number;
  options: DioramaOptions;
}

export interface Stage {
  app: pc.AppBase;
  frame: pc.CameraFrame;
  textures: Textures;
  orbit: { goal: Rig };
  movers: Set<Mover>;
  /** Frames drawn and the camera rig as it is now. */
  live(): { frames: number; rig: Rig };
  destroy(): void;
}

/** Everything the frame loop moves itself. */
type Live = {
  app: pc.AppBase;
  sun: pc.Entity;
  sky: pc.Entity;
  sea: Sea;
  orbit: { goal: Rig };
  movers: Set<Mover>;
  moment: Moment;
  frames: number;
};

function placeCamera(camera: pc.Entity, rig: Rig) {
  const position = rigPosition(rig);
  camera.setPosition(position.x, position.y, position.z);
  camera.lookAt(rig.target.x, rig.target.y, rig.target.z);
}

function tick(live: Live, dt: number) {
  const { moment } = live;
  moment.time += dt;
  moment.dt = dt;
  live.frames += 1;
  moment.rig = dampRig(moment.rig, live.orbit.goal, dt, CAMERA_HALF_LIFE_S);
  placeCamera(moment.camera, moment.rig);
  live.sky.setPosition(moment.camera.getPosition());
  live.app.scene.fog.start = moment.rig.radius * FOG_START_PER_RADIUS + FOG_START_M;
  live.app.scene.fog.end = FOG_END_M;
  const shadowRange = Math.max(MIN_SHADOW_DISTANCE_M, moment.rig.radius * SHADOW_PER_RADIUS);
  if (live.sun.light) live.sun.light.shadowDistance = shadowRange;
  animateSea(live.sea, moment.time);
  for (const mover of live.movers) mover(moment);
}

function buildCamera(app: pc.AppBase): pc.Entity {
  const camera = new pc.Entity('camera');
  camera.addComponent('camera', { fov: FIELD_OF_VIEW, nearClip: 0.5, farClip: FAR_CLIP_M });
  app.root.addChild(camera);
  return camera;
}

/** Pixel density, antialiasing, ambient occlusion and bloom for a quality preset. */
function applyQuality(app: pc.AppBase, frame: pc.CameraFrame, quality: QualitySettings) {
  app.graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio || 1, quality.pixelRatio);
  app.resizeCanvas();
  frame.rendering.samples = quality.msaa;
  frame.ssao.scale = SSAO_SCALE;
  if (!quality.ssao) frame.ssao.type = pc.SSAOTYPE_NONE;
  if (!quality.bloom) frame.bloom.intensity = 0;
  frame.update();
}

/** Lit windows read at dusk: every town's wall materials glow a little. */
export function glowWindows(walls: pc.StandardMaterial[]) {
  for (const wall of walls) {
    wall.emissiveIntensity = WINDOW_GLOW;
    wall.update();
  }
}

/** Sun, fill, ambient, fog and sky. Returns the sun the shadows follow. */
function light(app: pc.AppBase): { sun: pc.Entity; sky: pc.Entity } {
  const sun = buildSun('high');
  app.root.addChild(sun);
  lightScene(app, sun);
  return { sun, sky: buildSky(app, sun, SKY_RADIUS_M) };
}

function postProcess(app: pc.AppBase, camera: pc.Entity, quality: QualityName = 'high') {
  const frame = createFrame(app, camera.camera!, 'high');
  frame.grading.saturation = GRADING_SATURATION;
  applyQuality(app, frame, QUALITY[quality]);
  return frame;
}

const openingRig = (centre: pc.Vec3): Rig => ({ target: { x: centre.x, y: centre.y, z: centre.z },
  radius: ZOOM.city, polar: 0.92, azimuth: 0.7 });

/** Boots the engine and starts the frame loop over an empty stage. */
export async function createStage(canvas: HTMLCanvasElement, spec: StageSpec): Promise<Stage> {
  const { options } = spec;
  const app = await bootApp(canvas, { backend: options.backend ?? 'auto', lowQuality: false });
  const camera = buildCamera(app);
  const { sun, sky } = light(app);
  const sea = buildSea(app, spec.extent_m, spec.centre);
  app.root.addChild(sea.entity);
  const frame = postProcess(app, camera, options.quality);
  const orbit = { goal: openingRig(spec.centre) };
  const moment = { time: 0, dt: 0, camera, rig: cloneRig(orbit.goal) };
  const live: Live = { app, sun, sky, sea, orbit, movers: new Set(), moment, frames: 0 };
  const unbind = bindOrbit(canvas, orbit);
  app.on('update', (dt: number) => tick(live, dt));
  app.start();
  return {
    app, frame, orbit, movers: live.movers,
    textures: paintTextures(app.graphicsDevice, TEXTURE_SEED),
    live: () => ({ frames: live.frames, rig: live.moment.rig }),
    destroy: () => {
      unbind();
      app.destroy();
    },
  };
}
