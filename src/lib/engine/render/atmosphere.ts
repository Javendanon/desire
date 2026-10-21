// Light, fog and the camera's post-processing. Dusk is the default look: a low warm sun from the
// sea, long shadows, smoky violet sky. Night keeps a cool moon and brighter windows.

import * as pc from 'playcanvas';

export type TimeOfDay = 'dusk' | 'night';
export type Quality = 'low' | 'high';

interface Mood {
  sky: string;
  /** Lighter than the sky on purpose: distance should read as haze, not as darkness. */
  fog: string;
  ambient: string;
  sun: string;
  sunIntensity: number;
  /**
   * Euler angles of the light entity in degrees. A directional light shines along the entity's
   * -Y axis: pitch 70 leaves it 20 degrees above the horizon, yaw -90 makes it come from the sea.
   */
  sunAngles: [number, number];
  windows: number;
}

const MOODS: Record<TimeOfDay, Mood> = {
  dusk: {
    sky: '#5d5866',
    fog: '#6b6472',
    ambient: '#6a6070',
    sun: '#ffb06a',
    sunIntensity: 2.6,
    sunAngles: [68, -100],
    windows: 0.9,
  },
  night: {
    sky: '#0e1a24',
    fog: '#1d2b38',
    ambient: '#22303f',
    sun: '#a8bfdc',
    sunIntensity: 1,
    sunAngles: [40, -40],
    windows: 1.6,
  },
};

export function buildSun(quality: Quality): pc.Entity {
  const sun = new pc.Entity('sun');
  sun.addComponent('light', {
    type: 'directional',
    castShadows: true,
    shadowResolution: quality === 'high' ? 2048 : 1024,
    shadowDistance: 170,
    numCascades: quality === 'high' ? 2 : 1,
    shadowBias: 0.25,
    normalOffsetBias: 0.06,
    shadowType: pc.SHADOW_PCF3_32F,
  });
  return sun;
}

/** Sky, ambient, sun, fog and window glow for a time of day. `fog` goes from 0 to 1. */
export interface MoodTargets {
  camera: pc.Entity;
  sun: pc.Entity;
  windows: pc.StandardMaterial[];
}

export interface MoodSetting {
  time: TimeOfDay;
  fog: number;
}

export function applyMood(app: pc.AppBase, scene: MoodTargets, setting: MoodSetting): void {
  const { time, fog } = setting;
  const mood = MOODS[time];
  if (scene.camera.camera) scene.camera.camera.clearColor = new pc.Color().fromString(mood.sky);
  app.scene.ambientLight = new pc.Color().fromString(mood.ambient);
  app.scene.fog.type = pc.FOG_EXP2;
  app.scene.fog.color = new pc.Color().fromString(mood.fog);
  app.scene.fog.density = 0.002 + Math.min(1, Math.max(0, fog)) * 0.01;
  if (scene.sun.light) {
    scene.sun.light.color = new pc.Color().fromString(mood.sun);
    scene.sun.light.intensity = mood.sunIntensity;
  }
  scene.sun.setEulerAngles(mood.sunAngles[0], mood.sunAngles[1], 0);
  for (const m of scene.windows) {
    m.emissiveIntensity = mood.windows;
    m.update();
  }
}

/** Tone mapping, bloom (lantern and window halos), ambient occlusion, grading and vignette. */
export function createFrame(
  app: pc.AppBase,
  camera: pc.CameraComponent,
  quality: Quality,
): pc.CameraFrame {
  const frame = new pc.CameraFrame(app, camera);
  const high = quality === 'high';
  frame.rendering.toneMapping = pc.TONEMAP_ACES;
  frame.rendering.samples = high ? 4 : 1;
  frame.rendering.renderTargetScale = high ? 1 : 0.75;
  frame.bloom.intensity = 0.02;
  frame.bloom.blurLevel = 7;
  frame.ssao.type = high ? pc.SSAOTYPE_COMBINE : pc.SSAOTYPE_NONE;
  frame.ssao.intensity = 0.5;
  frame.ssao.radius = 3;
  frame.grading.enabled = true;
  frame.grading.contrast = 1.08;
  frame.grading.saturation = 0.95;
  frame.vignette.intensity = 0.45;
  frame.vignette.inner = 0.45;
  frame.vignette.outer = 1.1;
  frame.update();
  return frame;
}
