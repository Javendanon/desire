// A camera flight driven by a progress value from 0 to 1 instead of time, so scrolling or a
// preview slider can scrub it. Keys are evenly spaced along the progress.
import { smoothstep, type Vec3Like } from './camera-rig.ts';

export interface CameraKey {
  position: Vec3Like;
  target: Vec3Like;
}

function mix(a: Vec3Like, b: Vec3Like, t: number): Vec3Like {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

/** The camera at `progress` (clamped to 0..1), eased in and out of every key. O(1). */
export function sampleCameraPath(keys: readonly CameraKey[], progress: number): CameraKey {
  if (keys.length === 0) throw new Error('sampleCameraPath needs at least one key');
  const last = keys.length - 1;
  const scaled = Math.min(1, Math.max(0, progress)) * last;
  const index = Math.min(last - 1, Math.floor(scaled));
  if (last === 0) return keys[0];
  const t = smoothstep(scaled - index);
  if (t === 0) return keys[index];
  if (t === 1) return keys[index + 1];
  const [from, to] = [keys[index], keys[index + 1]];
  return { position: mix(from.position, to.position, t), target: mix(from.target, to.target, t) };
}
