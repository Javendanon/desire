// Orbit controls for the diorama: drag turns; shift- or right-drag, a two-finger trackpad swipe
// or WASD and the arrow keys pan; a pinch or the mouse wheel zooms between the city, ward and
// street distances. The camera eases toward the goal rig.

import type { Rig } from '../engine/math/camera-rig.ts';

export const ZOOM = { city: 520, ward: 200, street: 55 } as const;
const MIN_RADIUS = 25;
const MAX_RADIUS = 900;
const POLAR_LIMITS: [number, number] = [0.3, 1.32];
const TURN_PER_PX = 0.005;
const WHEEL_ZOOM = 0.0012;
/** Ground covered per screen pixel of pan, per metre of camera distance. */
const PAN_PER_PX = 0.0018;
/** Held keys pan as fast as dragging this many pixels a second. */
const KEY_PAN_PX_PER_S = 600;
/** A mouse wheel notch is a whole delta at least this large. Trackpads send small fractions. */
const WHEEL_NOTCH = 50;

interface Pointer {
  x: number;
  y: number;
}

export interface OrbitTarget {
  goal: Rig;
}

/** What the browser reports for a wheel, a pinch or a two-finger swipe. */
export interface WheelLike {
  ctrlKey: boolean;
  deltaMode: number;
  deltaX: number;
  deltaY: number;
}

export type WheelIntent = 'zoom' | 'pan';

/** First matching rule wins: pinches and mouse wheels zoom, trackpad swipes pan. */
const WHEEL_RULES: [(wheel: WheelLike) => boolean, WheelIntent][] = [
  [(wheel) => wheel.ctrlKey, 'zoom'],
  [(wheel) => wheel.deltaMode !== 0, 'zoom'],
  [(wheel) => wheel.deltaX !== 0, 'pan'],
  [(wheel) => Number.isInteger(wheel.deltaY) && Math.abs(wheel.deltaY) >= WHEEL_NOTCH, 'zoom'],
];

export function wheelIntent(wheel: WheelLike): WheelIntent {
  return WHEEL_RULES.find(([matches]) => matches(wheel))?.[1] ?? 'pan';
}

/** Screen direction per key: x right, y down. */
const KEY_STEPS: Record<string, [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

/** The screen direction the held keys pan toward. */
export function keyDirection(held: Set<string>): [number, number] {
  let [x, y] = [0, 0];
  for (const code of held) {
    const [dx, dy] = KEY_STEPS[code] ?? [0, 0];
    x += dx;
    y += dy;
  }
  return [x, y];
}

const clamp = (value: number, [low, high]: [number, number]) =>
  Math.min(high, Math.max(low, value));

/**
 * Moves the target as if the ground were dragged `dx`, `dy` screen pixels: right drags move it
 * left (camera right is (cos, −sin)), down drags move it forward (camera forward is (−sin, −cos)).
 */
export function panGoal(goal: Rig, dx: number, dy: number) {
  const scale = goal.radius * PAN_PER_PX;
  const sin = Math.sin(goal.azimuth);
  const cos = Math.cos(goal.azimuth);
  goal.target.x -= (dx * cos + dy * sin) * scale;
  goal.target.z += (dx * sin - dy * cos) * scale;
}

function turn(goal: Rig, dx: number, dy: number) {
  goal.azimuth -= dx * TURN_PER_PX;
  goal.polar = clamp(goal.polar - dy * TURN_PER_PX, POLAR_LIMITS);
}

function zoom(goal: Rig, delta: number) {
  goal.radius = clamp(goal.radius * Math.exp(delta * WHEEL_ZOOM), [MIN_RADIUS, MAX_RADIUS]);
}

export interface OrbitBinding {
  /** Pans for the keys held, called once a frame. */
  step(dt: number): void;
  unbind(): void;
}

type Listeners = [EventTarget, string, EventListener, AddEventListenerOptions?][];

function pointerListeners(canvas: HTMLCanvasElement, goal: Rig): Listeners {
  let last: Pointer | null = null;
  let panning = false;
  const down = (event: PointerEvent) => {
    canvas.setPointerCapture(event.pointerId);
    last = { x: event.clientX, y: event.clientY };
    panning = event.shiftKey || event.button === 2;
  };
  const move = (event: PointerEvent) => {
    if (!last) return;
    const [dx, dy] = [event.clientX - last.x, event.clientY - last.y];
    last = { x: event.clientX, y: event.clientY };
    (panning ? panGoal : turn)(goal, dx, dy);
  };
  const up = () => {
    last = null;
  };
  return [[canvas, 'pointerdown', down as EventListener],
    [canvas, 'pointermove', move as EventListener], [canvas, 'pointerup', up]];
}

function wheelListener(canvas: HTMLCanvasElement, goal: Rig): Listeners {
  const wheel = (event: WheelEvent) => {
    event.preventDefault();
    if (wheelIntent(event) === 'zoom') zoom(goal, event.deltaY);
    else panGoal(goal, -event.deltaX, -event.deltaY);
  };
  const menu = (event: Event) => event.preventDefault();
  return [[canvas, 'wheel', wheel as EventListener, { passive: false }],
    [canvas, 'contextmenu', menu]];
}

function keyListeners(held: Set<string>): Listeners {
  const press = (event: KeyboardEvent) => {
    if (event.code in KEY_STEPS) held.add(event.code);
  };
  const release = (event: KeyboardEvent) => {
    held.delete(event.code);
  };
  const clear = () => held.clear();
  return [[window, 'keydown', press as EventListener], [window, 'keyup', release as EventListener],
    [window, 'blur', clear]];
}

export function bindOrbit(canvas: HTMLCanvasElement, orbit: OrbitTarget): OrbitBinding {
  const held = new Set<string>();
  const listeners = [...pointerListeners(canvas, orbit.goal),
    ...wheelListener(canvas, orbit.goal), ...keyListeners(held)];
  for (const [target, type, listener, options] of listeners) {
    target.addEventListener(type, listener, options);
  }
  return {
    step: (dt) => {
      const [x, y] = keyDirection(held);
      panGoal(orbit.goal, -x * KEY_PAN_PX_PER_S * dt, -y * KEY_PAN_PX_PER_S * dt);
    },
    unbind: () => {
      for (const [target, type, listener] of listeners) target.removeEventListener(type, listener);
    },
  };
}
