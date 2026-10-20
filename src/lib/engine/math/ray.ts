// Ray tests for picking: tiles and board cells by hitting a horizontal plane, miniatures by
// bounding sphere. Pure math keeps picking synchronous on WebGL2 and WebGPU alike.

import type { Vec3Like } from './camera-rig.ts';

export interface Ray {
  origin: Vec3Like;
  direction: Vec3Like;
}

/** Point where the ray meets the plane y = height, or null if it never does. */
export interface SphereTarget {
  id: string;
  center: Vec3Like;
  radius: number;
}

export function hitHorizontalPlane(ray: Ray, height: number): Vec3Like | null {
  const dy = ray.direction.y;
  if (Math.abs(dy) < 1e-6) return null;
  const t = (height - ray.origin.y) / dy;
  if (t < 0) return null;
  return {
    x: ray.origin.x + ray.direction.x * t,
    y: height,
    z: ray.origin.z + ray.direction.z * t,
  };
}

/** Distance along the ray to the sphere, or null on a miss. Direction must be normalised. */
export function hitSphere(ray: Ray, center: Vec3Like, radius: number): number | null {
  const ox = ray.origin.x - center.x;
  const oy = ray.origin.y - center.y;
  const oz = ray.origin.z - center.z;
  const b = ox * ray.direction.x + oy * ray.direction.y + oz * ray.direction.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const entry = -b - root;
  const exit = -b + root;
  return entry >= 0 ? entry : exit >= 0 ? exit : null;
}

/** Closest sphere hit among `targets`, by id. */
export function closestSphere(ray: Ray, targets: readonly SphereTarget[]): string | null {
  let best: string | null = null;
  let bestT = Infinity;
  for (const target of targets) {
    const t = hitSphere(ray, target.center, target.radius);
    if (t !== null && t < bestT) {
      bestT = t;
      best = target.id;
    }
  }
  return best;
}
