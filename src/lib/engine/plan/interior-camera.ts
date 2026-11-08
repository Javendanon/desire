// Camera goals for an interior: orbit around the active floor, drag to pan over it, wheel to zoom.
// Pure maths over a Rig, clamped so the camera stays near the house.
import type { FloorPlan } from '../../../generated/contracts.ts';
import type { Rig, Vec3Like } from '../math/camera-rig.ts';
import { rectCells } from '../math/square.ts';
import { floorById } from './interior-placement.ts';

const START = { radius: 24, polar: 0.72, azimuth: 0.55 };
const RADIUS = { min: 6, max: 48 };
const POLAR = { min: 0.25, max: 1.3 };
const PAN_PER_PIXEL = 0.0016;
const ORBIT_PER_PIXEL = 0.006;
const ZOOM_PER_STEP = 0.88;
/** Look a little above the floor surface, at the height of a miniature. */
const EYE_LIFT = 0.6;

/** Centre of a floor's squares, at its surface. O(cells). */
export function floorFocus(plan: FloorPlan, floorId: string): Vec3Like {
  const floor = floorById(plan, floorId);
  const cells = floor.rooms.flatMap((room) => room.cells.flatMap(rectCells));
  const mid = (values: number[]) => (Math.min(...values) + Math.max(...values) + 1) / 2;
  const size = plan.cell_size_m;
  return {
    x: (floor.origin_x + mid(cells.map((cell) => cell.x))) * size,
    y: floor.elevation_m + EYE_LIFT,
    z: (floor.origin_y + mid(cells.map((cell) => cell.y))) * size,
  };
}

export function startRig(plan: FloorPlan, floorId: string): Rig {
  return { target: floorFocus(plan, floorId), ...START };
}

/** Drag the floor with the pointer: the floor follows the cursor. */
export function panRig(goal: Rig, dx: number, dy: number): void {
  const scale = goal.radius * PAN_PER_PIXEL;
  const sin = Math.sin(goal.azimuth);
  const cos = Math.cos(goal.azimuth);
  goal.target.x -= (dx * cos + dy * sin) * scale;
  goal.target.z -= (dy * cos - dx * sin) * scale;
}

export function orbitRig(goal: Rig, dx: number, dy: number): void {
  goal.azimuth -= dx * ORBIT_PER_PIXEL;
  goal.polar = Math.min(POLAR.max, Math.max(POLAR.min, goal.polar - dy * ORBIT_PER_PIXEL));
}

/** Positive steps zoom in. */
export function zoomRig(goal: Rig, steps: number): void {
  goal.radius = Math.min(RADIUS.max, Math.max(RADIUS.min, goal.radius * ZOOM_PER_STEP ** steps));
}
