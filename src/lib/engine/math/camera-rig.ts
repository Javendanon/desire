// Orbit camera as data: a target, a distance and two angles. Pure, so it is tested without a GPU.

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** polar: 0 looks straight down, π/2 looks at the horizon. azimuth turns around the target. */
export interface Rig {
  target: Vec3Like;
  radius: number;
  polar: number;
  azimuth: number;
}

export interface IntroKey extends Rig {
  /** Seconds from the start of the intro. */
  at: number;
}

export const POLAR_MIN = 0.85;
export const POLAR_MAX = 1.36;

export function cloneRig(rig: Rig): Rig {
  return { ...rig, target: { ...rig.target } };
}

/** World position of the camera for a rig. */
export function rigPosition(rig: Rig): Vec3Like {
  const ring = rig.radius * Math.sin(rig.polar);
  return {
    x: rig.target.x + ring * Math.sin(rig.azimuth),
    y: rig.target.y + rig.radius * Math.cos(rig.polar),
    z: rig.target.z + ring * Math.cos(rig.azimuth),
  };
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function mixRigs(a: Rig, b: Rig, t: number): Rig {
  const target = {
    x: mix(a.target.x, b.target.x, t),
    y: mix(a.target.y, b.target.y, t),
    z: mix(a.target.z, b.target.z, t),
  };
  return {
    target,
    radius: mix(a.radius, b.radius, t),
    polar: mix(a.polar, b.polar, t),
    azimuth: mix(a.azimuth, b.azimuth, t),
  };
}

/**
 * Frame-rate independent damping toward `goal`. `halfLife` is the seconds it takes to close half
 * of the remaining distance, and 0 jumps (reduced motion).
 */
export function dampRig(current: Rig, goal: Rig, dt: number, halfLife: number): Rig {
  if (halfLife <= 0) return cloneRig(goal);
  const t = 1 - Math.pow(0.5, dt / halfLife);
  return mixRigs(current, goal, t);
}

export function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** Camera along the intro path at `time` seconds, holding the last key after the end. */
export function sampleIntro(keys: readonly IntroKey[], time: number): Rig {
  if (keys.length === 0) throw new Error('sampleIntro needs at least one key');
  if (time <= keys[0].at) return cloneRig(keys[0]);
  for (let i = 1; i < keys.length; i++) {
    if (time < keys[i].at) {
      const span = keys[i].at - keys[i - 1].at;
      return mixRigs(keys[i - 1], keys[i], smoothstep((time - keys[i - 1].at) / span));
    }
  }
  return cloneRig(keys[keys.length - 1]);
}

export function introDuration(keys: readonly IntroKey[]): number {
  return keys.length ? keys[keys.length - 1].at : 0;
}

export function clampPolar(polar: number): number {
  return Math.min(POLAR_MAX, Math.max(POLAR_MIN, polar));
}
