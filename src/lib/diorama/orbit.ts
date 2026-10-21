// Orbit controls for the diorama: drag turns, shift- or right-drag pans, the wheel and pinch
// zoom between the city, ward and street distances. The camera eases toward the goal rig.

import type { Rig } from '../engine/math/camera-rig.ts';

export const ZOOM = { city: 520, ward: 200, street: 55 } as const;
const MIN_RADIUS = 25;
const MAX_RADIUS = 900;
const POLAR_LIMITS: [number, number] = [0.3, 1.32];
const TURN_PER_PX = 0.005;
const WHEEL_ZOOM = 0.0012;

interface Pointer {
  x: number;
  y: number;
}

export interface OrbitTarget {
  goal: Rig;
}

const clamp = (value: number, [low, high]: [number, number]) =>
  Math.min(high, Math.max(low, value));

function pan(goal: Rig, dx: number, dy: number) {
  const scale = goal.radius * 0.0018;
  const sin = Math.sin(goal.azimuth);
  const cos = Math.cos(goal.azimuth);
  goal.target.x -= (dx * cos - dy * sin) * scale;
  goal.target.z += (dx * sin + dy * cos) * scale;
}

export function bindOrbit(canvas: HTMLCanvasElement, orbit: OrbitTarget): () => void {
  let last: Pointer | null = null;
  let panning = false;
  const down = (event: PointerEvent) => {
    canvas.setPointerCapture(event.pointerId);
    last = { x: event.clientX, y: event.clientY };
    panning = event.shiftKey || event.button === 2;
  };
  const move = (event: PointerEvent) => {
    if (!last) return;
    const dx = event.clientX - last.x;
    const dy = event.clientY - last.y;
    last = { x: event.clientX, y: event.clientY };
    if (panning) pan(orbit.goal, dx, dy);
    else {
      orbit.goal.azimuth -= dx * TURN_PER_PX;
      orbit.goal.polar = clamp(orbit.goal.polar - dy * TURN_PER_PX, POLAR_LIMITS);
    }
  };
  const up = () => {
    last = null;
  };
  const wheel = (event: WheelEvent) => {
    event.preventDefault();
    const factor = Math.exp(event.deltaY * WHEEL_ZOOM);
    orbit.goal.radius = clamp(orbit.goal.radius * factor, [MIN_RADIUS, MAX_RADIUS]);
  };
  const menu = (event: Event) => event.preventDefault();
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('wheel', wheel, { passive: false });
  canvas.addEventListener('contextmenu', menu);
  return () => {
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('wheel', wheel);
    canvas.removeEventListener('contextmenu', menu);
  };
}
