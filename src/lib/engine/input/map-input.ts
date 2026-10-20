// Pointer, wheel and key input for the map viewer: drag pans, shift or right drag orbits, wheel
// and pinch zoom. Canvas listeners only; `attachMapInput` returns the cleanup.

export interface MapInputTarget {
  hover(x: number, y: number): void;
  click(x: number, y: number): void;
  pan(dx: number, dy: number): void;
  orbit(dx: number, dy: number): void;
  /** Positive steps zoom in, negative steps zoom out. */
  zoom(steps: number): void;
  reset(): void;
}

interface Point {
  x: number;
  y: number;
}

const TAP_SLOP = 5;
const KEY_STEP = 60;
const KEY_ZOOM = 1;
const PINCH_STEP = 1.2;

class CanvasMapInput {
  private readonly canvas: HTMLCanvasElement;
  private readonly target: MapInputTarget;
  private readonly pointers = new Map<number, Point>();
  private last: Point | null = null;
  private pressedButton = 0;
  private moved = false;
  private pinchStart = 0;

  constructor(canvas: HTMLCanvasElement, target: MapInputTarget) {
    this.canvas = canvas;
    this.target = target;
  }

  private local(event: PointerEvent | WheelEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private pinchDistance(): number {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  down = (event: PointerEvent): void => {
    event.preventDefault();
    this.canvas.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, this.local(event));
    this.last = this.local(event);
    this.pressedButton = event.button;
    this.moved = false;
    if (this.pointers.size >= 2) {
      this.moved = true;
      this.pinchStart = this.pinchDistance();
    }
  };

  move = (event: PointerEvent): void => {
    const point = this.local(event);
    if (!this.pointers.has(event.pointerId)) {
      this.target.hover(point.x, point.y);
      return;
    }
    this.pointers.set(event.pointerId, point);
    if (this.pointers.size >= 2) {
      this.pinch();
      return;
    }
    this.drag(point, event.shiftKey || this.pressedButton === 2);
  };

  private pinch(): void {
    if (this.pinchStart <= 0) return;
    const ratio = this.pinchDistance() / this.pinchStart;
    if (ratio > PINCH_STEP) this.target.zoom(1);
    else if (ratio < 1 / PINCH_STEP) this.target.zoom(-1);
    else return;
    this.pinchStart = this.pinchDistance();
  }

  private drag(point: Point, orbit: boolean): void {
    if (!this.last) return;
    const dx = point.x - this.last.x;
    const dy = point.y - this.last.y;
    if (!this.moved && Math.hypot(dx, dy) < TAP_SLOP) return;
    this.moved = true;
    if (orbit) this.target.orbit(dx, dy);
    else this.target.pan(dx, dy);
    this.last = point;
  }

  up = (event: PointerEvent): void => {
    const point = this.local(event);
    const tap =
      this.pointers.size === 1 &&
      this.pressedButton === 0 &&
      !this.moved &&
      event.type !== 'pointercancel';
    if (tap) this.target.click(point.x, point.y);
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.pinchStart = 0;
    if (this.pointers.size === 1) {
      // A pinch left one finger down: rebase the drag and keep the gesture non-tapping.
      const remaining = [...this.pointers.values()][0];
      this.last = remaining ?? null;
      this.moved = true;
    } else if (this.pointers.size === 0) {
      this.last = null;
      this.moved = false;
    }
  };

  wheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (Math.abs(event.deltaY) < 4) return;
    this.target.zoom(event.deltaY < 0 ? 1 : -1);
  };

  key = (event: KeyboardEvent): void => {
    const actions: Record<string, () => void> = {
      ArrowLeft: () => this.target.pan(-KEY_STEP, 0),
      ArrowRight: () => this.target.pan(KEY_STEP, 0),
      ArrowUp: () => this.target.pan(0, -KEY_STEP),
      ArrowDown: () => this.target.pan(0, KEY_STEP),
      '+': () => this.target.zoom(KEY_ZOOM),
      '=': () => this.target.zoom(KEY_ZOOM),
      '-': () => this.target.zoom(-KEY_ZOOM),
      '0': () => this.target.reset(),
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  };

  context = (event: Event): void => {
    event.preventDefault();
  };
}

export function attachMapInput(canvas: HTMLCanvasElement, target: MapInputTarget): () => void {
  const input = new CanvasMapInput(canvas, target);
  const listeners: [string, EventListener, AddEventListenerOptions?][] = [
    ['pointerdown', input.down as EventListener],
    ['pointermove', input.move as EventListener],
    ['pointerup', input.up as EventListener],
    ['pointercancel', input.up as EventListener],
    ['wheel', input.wheel as EventListener, { passive: false }],
    ['keydown', input.key as EventListener],
    ['contextmenu', input.context as EventListener],
  ];
  for (const [type, listener, options] of listeners) {
    canvas.addEventListener(type, listener, options);
  }
  return () => {
    for (const [type, listener, options] of listeners) {
      canvas.removeEventListener(type, listener, options);
    }
  };
}
