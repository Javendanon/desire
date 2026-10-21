// The diorama scene: slice terrain, town, sea, dusk light and the D11 post-processing stack.
// Fog and the shadow range follow the camera distance, so the city view keeps its depth and the
// street view keeps crisp shadows.

import * as pc from 'playcanvas';

import { bootApp } from '../engine/boot.ts';
import { cloneRig, dampRig, rigPosition, type Rig } from '../engine/math/camera-rig.ts';
import { buildSun, createFrame } from '../engine/render/atmosphere.ts';
import { paintTextures } from '../engine/render/textures.ts';
import { bindOrbit, ZOOM } from './orbit.ts';
import { animateSea, buildSea } from './sea.ts';
import type { Slice } from './slice-data.ts';
import { buildSky, lightScene } from './sky.ts';
import { buildTerrain } from './terrain.ts';
import { buildTown } from './town.ts';

const FIELD_OF_VIEW = 34;
const FAR_CLIP_M = 4000;
const CAMERA_HALF_LIFE_S = 0.35;
/** Fog density times the camera distance: the same haze share at every zoom. */
const FOG_PER_RADIUS = 0.55;
const SHADOW_PER_RADIUS = 1.6;
const MIN_SHADOW_DISTANCE_M = 120;
const TEXTURE_SEED = 7;
const SKY_RADIUS_M = 3000;
const WINDOW_GLOW = 1.1;

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

function buildCamera(app: pc.AppBase): pc.Entity {
  const camera = new pc.Entity('camera');
  camera.addComponent('camera', { fov: FIELD_OF_VIEW, nearClip: 0.5, farClip: FAR_CLIP_M });
  app.root.addChild(camera);
  return camera;
}

export async function createDiorama(
  canvas: HTMLCanvasElement,
  slice: Slice,
  options: DioramaOptions = {},
): Promise<Diorama> {
  const app = await bootApp(canvas, { backend: options.backend ?? 'auto', lowQuality: false });
  const textures = paintTextures(app.graphicsDevice, TEXTURE_SEED);
  const camera = buildCamera(app);
  const sun = buildSun('high');
  app.root.addChild(sun);
  const town = buildTown(app, slice.houses, textures);
  app.root.addChild(buildTerrain(app, slice));
  app.root.addChild(town.root);
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
  createFrame(app, camera.camera!, 'high');
  const goal: Rig = { target: { x: centre.x, y: centre.y, z: centre.z }, radius: ZOOM.city,
    polar: 0.92, azimuth: 0.7 };
  const orbit = { goal };
  let rig = cloneRig(goal);
  let frames = 0;
  let time = 0;
  const unbind = bindOrbit(canvas, orbit);
  app.on('update', (dt: number) => {
    time += dt;
    frames += 1;
    rig = dampRig(rig, orbit.goal, dt, CAMERA_HALF_LIFE_S);
    placeCamera(camera, rig);
    sky.setPosition(camera.getPosition());
    app.scene.fog.density = FOG_PER_RADIUS / Math.max(rig.radius, 1) / 100;
    const shadowRange = Math.max(MIN_SHADOW_DISTANCE_M, rig.radius * SHADOW_PER_RADIUS);
    if (sun.light) sun.light.shadowDistance = shadowRange;
    animateSea(sea, time);
  });
  app.start();
  return {
    app,
    orbit,
    stats: () => ({ frames, houses: slice.houses.length, radius: rig.radius,
      backend: app.graphicsDevice.deviceType }),
    destroy: () => {
      unbind();
      app.destroy();
    },
  };
}
