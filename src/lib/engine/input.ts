// Pointer, wheel, pinch and keyboard input on the canvas only (no global handlers). A drag orbits
// the camera, a tap picks, the wheel or a pinch asks for another zoom level, arrow keys orbit and
// + / - zoom while the canvas has focus. `attachInput` returns a function removing every listener.

export interface InputTarget {
  hover(x: number, y: number): void;
  click(x: number, y: number): void;
  orbit(dx: number, dy: number): void;
  zoom(direction: 1 | -1): void;
}

const TAP_SLOP = 5;
const ZOOM_COOLDOWN_MS = 650;
const PINCH_STEP = 1.25;
const KEY_ORBIT = 40;

interface Point {
  x: number;
  y: number;
}

class CanvasInput {
  private readonly canvas: HTMLCanvasElement;
  private readonly target: InputTarget;
  private readonly pointers = new Map<number, Point>();
  private last: Point | null = null;
  private moved = false;
  private pinchStart = 0;
  private lastZoom = 0;

  constructor(canvas: HTMLCanvasElement, target: InputTarget) {
    this.canvas = canvas;
    this.target = target;
  }

  private local(event: PointerEvent | WheelEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private zoomOnce(direction: 1 | -1): void {
    const now = performance.now();
    if (now - this.lastZoom < ZOOM_COOLDOWN_MS) return;
    this.lastZoom = now;
    this.target.zoom(direction);
  }

  private pinchDistance(): number {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  down = (event: PointerEvent): void => {
    this.canvas.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, this.local(event));
    this.last = this.local(event);
    this.moved = false;
    if (this.pointers.size === 2) this.pinchStart = this.pinchDistance();
  };

  move = (event: PointerEvent): void => {
    const point = this.local(event);
    if (!this.pointers.has(event.pointerId)) {
      this.target.hover(point.x, point.y);
      return;
    }
    this.pointers.set(event.pointerId, point);
    if (this.pointers.size === 2 && this.pinchStart > 0) this.pinch();
    else this.drag(point);
  };

  private pinch(): void {
    const ratio = this.pinchDistance() / this.pinchStart;
    if (ratio < PINCH_STEP && ratio > 1 / PINCH_STEP) return;
    this.zoomOnce(ratio > 1 ? 1 : -1);
    this.pinchStart = this.pinchDistance();
  }

  private drag(point: Point): void {
    if (!this.last) return;
    const dx = point.x - this.last.x;
    const dy = point.y - this.last.y;
    if (!this.moved && Math.hypot(dx, dy) < TAP_SLOP) return;
    this.moved = true;
    this.target.orbit(dx, dy);
    this.last = point;
  }

  up = (event: PointerEvent): void => {
    const point = this.local(event);
    if (this.pointers.size === 1 && !this.moved) this.target.click(point.x, point.y);
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.pinchStart = 0;
    if (this.pointers.size === 0) this.last = null;
  };

  wheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (Math.abs(event.deltaY) >= 8) this.zoomOnce(event.deltaY < 0 ? 1 : -1);
  };

  key = (event: KeyboardEvent): void => {
    const actions: Record<string, () => void> = {
      ArrowLeft: () => this.target.orbit(-KEY_ORBIT, 0),
      ArrowRight: () => this.target.orbit(KEY_ORBIT, 0),
      ArrowUp: () => this.target.orbit(0, -KEY_ORBIT),
      ArrowDown: () => this.target.orbit(0, KEY_ORBIT),
      '+': () => this.target.zoom(1),
      '=': () => this.target.zoom(1),
      '-': () => this.target.zoom(-1),
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  };
}

export function attachInput(canvas: HTMLCanvasElement, target: InputTarget): () => void {
  const input = new CanvasInput(canvas, target);
  const listeners: [string, EventListener, AddEventListenerOptions?][] = [
    ['pointerdown', input.down as EventListener],
    ['pointermove', input.move as EventListener],
    ['pointerup', input.up as EventListener],
    ['pointercancel', input.up as EventListener],
    ['wheel', input.wheel as EventListener, { passive: false }],
    ['keydown', input.key as EventListener],
  ];
  listeners.forEach(([type, listener, options]) =>
    canvas.addEventListener(type, listener, options),
  );
  return () => listeners.forEach(([type, listener]) => canvas.removeEventListener(type, listener));
}
