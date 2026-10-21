// The sea's swell as a closed form: two crossing waves. Its slope is exact, so the sea's normals
// come from the formula instead of being recomputed from the mesh every frame. Pure.

const SWELL_M = 0.25;
const CROSS_SHARE = 0.8;
const WAVE_X = 0.05;
const WAVE_Z = 0.04;
const SPEED_X = 0.6;
const SPEED_Z = 0.45;

export type Normal = [number, number, number];

export function swellHeight(x: number, z: number, time: number): number {
  return Math.sin(x * WAVE_X + time * SPEED_X) * SWELL_M
    + Math.cos(z * WAVE_Z + time * SPEED_Z) * SWELL_M * CROSS_SHARE;
}

/** Unit normal of the swell at (x, z): (−∂h/∂x, 1, −∂h/∂z), normalised. */
export function swellNormal(x: number, z: number, time: number): Normal {
  const slopeX = Math.cos(x * WAVE_X + time * SPEED_X) * SWELL_M * WAVE_X;
  const slopeZ = -Math.sin(z * WAVE_Z + time * SPEED_Z) * SWELL_M * CROSS_SHARE * WAVE_Z;
  const length = Math.hypot(slopeX, 1, slopeZ);
  return [-slopeX / length, 1 / length, -slopeZ / length];
}
