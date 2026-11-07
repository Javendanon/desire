// Lantern light for an interior: warm ambient, a low sun through the windows that casts shadows,
// and the same tone mapping, ambient occlusion and grading as the table, so the house reads as
// part of the "Farol en la niebla" world.
import * as pc from 'playcanvas';

import { buildSun, createFrame, type Quality } from '../render/atmosphere.ts';

export interface InteriorLights {
  destroy(): void;
}

const AMBIENT = '#5b4a3c';
const BACKDROP = '#1b2125';
const SUN_COLOR = '#ffd9a1';
const SUN_INTENSITY = 2.2;
/** Pitch and heading of the evening sun, in degrees. */
const SUN_ANGLES = [52, 35] as const;
/** Shadows only need to cover the house, not the 170 m table scene. */
const SHADOW_DISTANCE_M = 60;

export function lightInterior(
  app: pc.AppBase,
  camera: pc.Entity,
  quality: Quality,
): InteriorLights {
  app.scene.ambientLight = new pc.Color().fromString(AMBIENT);
  if (camera.camera) camera.camera.clearColor = new pc.Color().fromString(BACKDROP);
  const sun = buildSun(quality);
  if (sun.light) {
    sun.light.color = new pc.Color().fromString(SUN_COLOR);
    sun.light.intensity = SUN_INTENSITY;
    sun.light.shadowDistance = SHADOW_DISTANCE_M;
  }
  sun.setEulerAngles(SUN_ANGLES[0], SUN_ANGLES[1], 0);
  app.root.addChild(sun);
  const frame = camera.camera ? createFrame(app, camera.camera, quality) : null;
  return {
    destroy() {
      frame?.destroy();
      sun.destroy();
    },
  };
}
