// The sea's swell as a closed form: two crossing waves. The vertex shader (shaders.ts) evaluates
// it on the GPU from these same constants; these functions are its reference and also let things
// ride the swell (ships). Pure.

export const SWELL = {
  heightM: 0.25,
  crossShare: 0.8,
  waveX: 0.05,
  waveZ: 0.04,
  speedX: 0.6,
  speedZ: 0.45,
} as const;

const { heightM: SWELL_M, crossShare: CROSS_SHARE, waveX: WAVE_X, waveZ: WAVE_Z } = SWELL;
const { speedX: SPEED_X, speedZ: SPEED_Z } = SWELL;

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
