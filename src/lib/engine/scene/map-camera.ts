// Orbit camera for the map viewer as pure functions: pan, orbit, zoom, clamps and projection.
// No city identity and no viewer state, so every rule here is testable without a GPU.

import * as pc from 'playcanvas';

import { type Rig, type Vec3Like } from '../math/camera-rig.ts';
import type { Point2 } from '../math/hex.ts';
import type { MapDefinition } from '../plan/map-definition.ts';

export const MIN_RADIUS = 45;
export const MAX_POLAR = 1.34;
export const MIN_POLAR = 0.32;
export const START_RADIUS = 1800;
const START_ANGLE = 0;
const START_POLAR = 1.02;
const PAN_PER_PIXEL = 0.0016;
const ORBIT_PER_PIXEL = 0.005;
const ZOOM_PER_STEP = 0.78;
const MAX_RADIUS_FACTOR = 1.9;

export interface ProjectedPoint {
  x: number;
  y: number;
  visible: boolean;
}

export function startGoal(map: MapDefinition): Rig {
  const { minX, maxX, minZ, maxZ } = map.bounds;
  return {
    target: { x: (minX + maxX) / 2, y: 0, z: (minZ + maxZ) / 2 },
    radius: START_RADIUS,
    polar: START_POLAR,
    azimuth: START_ANGLE,
  };
}

export function clampRadius(map: MapDefinition, radius: number): number {
  const width = map.bounds.maxX - map.bounds.minX;
  const depth = map.bounds.maxZ - map.bounds.minZ;
  return Math.min(Math.max(width, depth) * MAX_RADIUS_FACTOR, Math.max(MIN_RADIUS, radius));
}

export function clampTarget(map: MapDefinition, target: Vec3Like): void {
  const { minX, maxX, minZ, maxZ } = map.bounds;
  target.x = Math.min(maxX, Math.max(minX, target.x));
  target.z = Math.min(maxZ, Math.max(minZ, target.z));
}

/** Drag the map with the pointer: the ground follows the cursor. */
export function panGoal(goal: Rig, map: MapDefinition, dx: number, dy: number): void {
  const scale = goal.radius * PAN_PER_PIXEL;
  const sin = Math.sin(goal.azimuth);
  const cos = Math.cos(goal.azimuth);
  goal.target.x -= (dx * cos + dy * sin) * scale;
  goal.target.z -= (dy * cos - dx * sin) * scale;
  clampTarget(map, goal.target);
}

export function orbitGoal(goal: Rig, dx: number, dy: number): void {
  goal.azimuth -= dx * ORBIT_PER_PIXEL;
  const polar = goal.polar - dy * ORBIT_PER_PIXEL * 0.6;
  goal.polar = Math.min(MAX_POLAR, Math.max(MIN_POLAR, polar));
}

export function zoomGoal(goal: Rig, map: MapDefinition, steps: number): void {
  goal.radius = clampRadius(map, goal.radius * Math.pow(ZOOM_PER_STEP, steps));
}

/** Screen position of a map point, and whether it is in front of the camera. */
export function projectPoint(
  camera: pc.Entity,
  point: Point2,
  height: number,
): ProjectedPoint {
  if (!camera.camera) return { x: 0, y: 0, visible: false };
  const screen = camera.camera.worldToScreen(new pc.Vec3(point.x, height, point.z));
  const position = camera.getPosition();
  const forward = camera.forward;
  const dx = point.x - position.x;
  const dy = height - position.y;
  const dz = point.z - position.z;
  const visible = forward.x * dx + forward.y * dy + forward.z * dz > 0;
  return { x: screen.x, y: screen.y, visible };
}
