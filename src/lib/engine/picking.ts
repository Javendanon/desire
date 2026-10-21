// Screen point → district, board cell or miniature. Rays come from the camera; the hits are
// pure math (ray.ts), so picking is synchronous on WebGPU and WebGL 2 alike.

import type * as pc from 'playcanvas';

import { nearestIndex } from './math/hex.ts';
import { closestSphere, hitHorizontalPlane, type Ray, type SphereTarget } from './math/ray.ts';
import type { Cell } from './plan/board.ts';
import { TILE_SIZE, type CityPlan } from './plan/test-city.ts';

export interface PickContext {
  camera: pc.CameraComponent;
  plan: CityPlan;
  cells: readonly Cell[];
  deckY: number;
}

const GROUND_HEIGHT = 0.8;

export function screenRay(camera: pc.CameraComponent, x: number, y: number): Ray {
  const near = camera.screenToWorld(x, y, camera.nearClip);
  const far = camera.screenToWorld(x, y, camera.farClip);
  const dx = far.x - near.x;
  const dy = far.y - near.y;
  const dz = far.z - near.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  return {
    origin: { x: near.x, y: near.y, z: near.z },
    direction: { x: dx / length, y: dy / length, z: dz / length },
  };
}

/** District under the pointer, or null over the sea and the countryside. */
export function pickDistrict(context: PickContext, x: number, y: number): string | null {
  const hit = hitHorizontalPlane(screenRay(context.camera, x, y), GROUND_HEIGHT);
  if (!hit) return null;
  const tiles = context.plan.tiles;
  const index = nearestIndex(tiles, hit);
  if (index < 0) return null;
  const tile = tiles[index];
  return Math.hypot(tile.x - hit.x, tile.z - hit.z) <= TILE_SIZE ? tile.district : null;
}

/** Board cell under the pointer, or null off the board. */
export function pickCell(context: PickContext, x: number, y: number): number | null {
  const hit = hitHorizontalPlane(screenRay(context.camera, x, y), context.deckY);
  if (!hit) return null;
  const index = nearestIndex(context.cells, hit);
  if (index < 0) return null;
  const cell = context.cells[index];
  return Math.hypot(cell.x - hit.x, cell.z - hit.z) <= 1.5 ? index : null;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export function pickPiece(
  context: PickContext,
  point: ScreenPoint,
  targets: readonly SphereTarget[],
): string | null {
  return closestSphere(screenRay(context.camera, point.x, point.y), targets);
}
