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

export interface SwellGrid {
  /** Vertex x per column and z per row: the swell is separable along them. */
  xs: Float32Array;
  zs: Float32Array;
  /** Per-column height and slope for the frame being written, kept to avoid reallocating. */
  scratch?: {
    height: Float32Array;
    slope: Float32Array;
  };
}

export interface SwellTarget {
  positions: Float32Array;
  normals: Float32Array;
}

/**
 * Heights and normals of a row-major grid, written in place. Each wave depends on one axis only,
 * so trigonometry runs once per column and once per row: O(columns + rows) trig, O(vertices)
 * multiply-adds, and no allocation after the first frame.
 */
export function writeSwell(grid: SwellGrid, time: number, target: SwellTarget): void {
  const { xs, zs } = grid;
  const { positions, normals } = target;
  grid.scratch ??= { height: new Float32Array(xs.length), slope: new Float32Array(xs.length) };
  const { height, slope } = grid.scratch;
  for (let column = 0; column < xs.length; column += 1) {
    const phaseX = xs[column] * WAVE_X + time * SPEED_X;
    height[column] = Math.sin(phaseX) * SWELL_M;
    slope[column] = Math.cos(phaseX) * SWELL_M * WAVE_X;
  }
  for (let row = 0; row < zs.length; row += 1) {
    const phaseZ = zs[row] * WAVE_Z + time * SPEED_Z;
    const heightZ = Math.cos(phaseZ) * SWELL_M * CROSS_SHARE;
    const slopeZ = -Math.sin(phaseZ) * SWELL_M * CROSS_SHARE * WAVE_Z;
    for (let column = 0; column < xs.length; column += 1) {
      const slopeX = slope[column];
      const inverse = 1 / Math.sqrt(slopeX * slopeX + 1 + slopeZ * slopeZ);
      const index = (row * xs.length + column) * 3;
      positions[index + 1] = height[column] + heightZ;
      normals[index] = -slopeX * inverse;
      normals[index + 1] = inverse;
      normals[index + 2] = -slopeZ * inverse;
    }
  }
}
