// World bounds of an instanced batch from its column-major 4 × 4 instance matrices. The mesh is
// taken to fit in the unit cube [-1, 1]³ (the kit's meshes fit in [-0.5, 0.5] or [0, 1]), so the
// box is conservative. Pure, so the shadow-fitting fix is tested without a GPU.

export type Triple = [number, number, number];

export interface Bounds {
  min: Triple;
  max: Triple;
}

/** Floats in one column-major 4 × 4 instance matrix. */
export const MATRIX_FLOATS = 16;
const TRANSLATION = 12;

/** O(instances). */
export function instanceBounds(data: Float32Array): Bounds {
  if (data.length < MATRIX_FLOATS) return { min: [0, 0, 0], max: [0, 0, 0] };
  const min: Triple = [Infinity, Infinity, Infinity];
  const max: Triple = [-Infinity, -Infinity, -Infinity];
  for (let start = 0; start + MATRIX_FLOATS <= data.length; start += MATRIX_FLOATS) {
    for (let axis = 0; axis < 3; axis += 1) {
      const reach = Math.abs(data[start + axis]) + Math.abs(data[start + 4 + axis])
        + Math.abs(data[start + 8 + axis]);
      const centre = data[start + TRANSLATION + axis];
      min[axis] = Math.min(min[axis], centre - reach);
      max[axis] = Math.max(max[axis], centre + reach);
    }
  }
  return { min, max };
}

/** The smallest box holding every given box. O(boxes). */
export function unionBounds(boxes: Bounds[]): Bounds {
  const min: Triple = [Infinity, Infinity, Infinity];
  const max: Triple = [-Infinity, -Infinity, -Infinity];
  for (const box of boxes) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], box.min[axis]);
      max[axis] = Math.max(max[axis], box.max[axis]);
    }
  }
  return { min, max };
}
