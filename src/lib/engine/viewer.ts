// The table viewer: a PlayCanvas app that renders the test city, the harbour scene and the
// miniatures, flies the intro, eases between zoom levels and reports picks. It knows nothing
// about Svelte; the host component only calls this API. Engine and frame loop stay out of UI
// reactivity: nothing here touches the DOM except the canvas it was given.

import * as pc from 'playcanvas';

import { bootApp, ViewerError } from './boot.ts';
import { Emitter } from './emitter.ts';
import {
  clampPolar,
  cloneRig,
  dampRig,
  introDuration,
  rigPosition,
  sampleIntro,
  type IntroKey,
  type Rig,
} from './math/camera-rig.ts';
import { hexDistance } from './math/hex.ts';
import {
  buildBoard,
  placePieces,
  reachableCells,
  SCENE_BOARD,
  stepToward,
  type BoardState,
  type Cell,
} from './plan/board.ts';
import { planCity, TEST_CITY, TEST_CITY_LABEL, type CityPlan } from './plan/test-city.ts';
import {
  applyMood,
  buildSun,
  createFrame,
  type Quality,
  type TimeOfDay,
} from './render/atmosphere.ts';
import { buildCity } from './render/city.ts';
import { animateHarbor, buildHarbor, type Harbor } from './render/harbor.ts';
import { destroyTextures, paintTextures, type Textures } from './render/textures.ts';
import { animateWater, buildWater, type Water } from './render/water.ts';
import { attachInput, type InputTarget } from './input.ts';
import { pickCell, pickDistrict, pickPiece, type PickContext } from './picking.ts';
import { BoardOverlay } from './scene/board-overlay.ts';
import { introKeys, levelGoal, type Level } from './scene/camera-goals.ts';
import { PieceSet, type PieceSpec } from './scene/pieces.ts';

export { ViewerError };
export type { Level, PieceSpec, Quality, TimeOfDay };

export interface ViewerOptions {
  quality?: Quality;
  timeOfDay?: TimeOfDay;
  /** Fog density from 0 to 1. */
  fog?: number;
  reducedMotion?: boolean;
  /** 'auto' tries WebGPU first and falls back to WebGL 2. */
  backend?: 'auto' | 'webgl2';
}

export interface ViewerStats {
  frames: number;
  destroyed: boolean;
  backend: string;
  pieces: number;
}

export interface ViewerEvents {
  district: string;
  hover: string | null;
  piece: string;
  cell: number;
  /** The player asked for another zoom level (wheel, pinch, keys). The host decides. */
  zoom: Level;
  introEnd: true;
}

const HALF_LIFE = 0.35;
const START_AZIMUTH = 0.55;
const DECK_LIFT = 0.4;
const live = new Set<TableViewer>();

/** Viewers alive right now. The mount/unmount smoke test expects 0 after every destroy. */
export function liveViewerCount(): number {
  return live.size;
}

export class TableViewer implements InputTarget {
  readonly label = TEST_CITY_LABEL;
  private readonly app: pc.AppBase;
  private readonly canvas: HTMLCanvasElement;
  private readonly options: Required<ViewerOptions>;
  private readonly plan: CityPlan;
  private readonly cells: Cell[];
  private readonly camera = new pc.Entity('camera');
  private readonly sun: pc.Entity;
  private readonly events = new Emitter<ViewerEvents>();
  private textures: Textures | null = null;
  private frame: pc.CameraFrame | null = null;
  private harbor: Harbor | null = null;
  private water: Water | null = null;
  private pieces: PieceSet | null = null;
  private overlay: BoardOverlay | null = null;
  private windows: pc.StandardMaterial[] = [];
  private placement = new Map<string, number>();
  private specs: PieceSpec[] = [];
  private introKeys: IntroKey[] = [];
  private rig: Rig;
  private goal: Rig;
  private level: Level = 0;
  private district = 'harbor';
  private turnId = '';
  private moveSteps: number | null = null;
  private hoverCell: number | null = null;
  private time = 0;
  private frames = 0;
  private introDone: boolean;
  private destroyed = false;
  private cleanups: (() => void)[] = [];
  /** Captured at start: the device is gone after destroy, the answer is still useful. */
  private backendName: 'webgpu' | 'webgl2' = 'webgl2';

  constructor(app: pc.AppBase, canvas: HTMLCanvasElement, options: ViewerOptions) {
    this.app = app;
    this.canvas = canvas;
    this.options = {
      quality: options.quality ?? 'high',
      timeOfDay: options.timeOfDay ?? 'dusk',
      fog: options.fog ?? 0.45,
      reducedMotion: options.reducedMotion ?? false,
      backend: options.backend ?? 'auto',
    };
    this.plan = planCity(TEST_CITY);
    this.cells = buildBoard({ center: this.plan.spot, ...SCENE_BOARD });
    this.sun = buildSun(this.options.quality);
    this.introDone = this.options.reducedMotion;
    this.goal = this.goalFor(0, START_AZIMUTH);
    this.rig = cloneRig(this.goal);
    live.add(this);
  }

  get backend(): 'webgpu' | 'webgl2' {
    return this.backendName;
  }

  get deckY(): number {
    return this.plan.spot.y + DECK_LIFT;
  }

  /** Builds the scene and starts the loop. Called once by createViewer. */
  start(): void {
    const device = this.app.graphicsDevice;
    this.backendName = device.isWebGPU ? 'webgpu' : 'webgl2';
    this.textures = paintTextures(device, TEST_CITY.seed);
    const city = buildCity(this.app, this.plan, TEST_CITY.districts, this.textures);
    this.windows = city.windowMaterials;
    this.harbor = buildHarbor(this.plan.spot, this.textures);
    this.water = buildWater(device);
    this.pieces = new PieceSet(device, this.deckY);
    this.overlay = new BoardOverlay(device, this.cells, SCENE_BOARD.cellSize, this.deckY);
    const root = this.app.root;
    [
      city.root,
      this.harbor.root,
      this.water.entity,
      this.pieces.root,
      this.overlay.root,
      this.sun,
    ].forEach((e) => root.addChild(e));
    this.setupCamera();
    this.introKeys = introKeys(this.plan.spot, START_AZIMUTH);
    if (!this.introDone) this.rig = sampleIntro(this.introKeys, 0);
    this.setMood(this.options.timeOfDay, this.options.fog);
    this.watchPage();
    this.cleanups.push(attachInput(this.canvas, this));
    this.app.on('update', this.onUpdate, this);
    this.app.start();
  }

  private setupCamera(): void {
    this.camera.addComponent('camera', { fov: 34, nearClip: 0.3, farClip: 800 });
    this.app.root.addChild(this.camera);
    if (this.camera.camera) {
      this.frame = createFrame(this.app, this.camera.camera, this.options.quality);
    }
  }

  private watchPage(): void {
    const resize = () => this.app.resizeCanvas(this.canvas.clientWidth, this.canvas.clientHeight);
    const observer = new ResizeObserver(resize);
    observer.observe(this.canvas);
    resize();
    const visibility = () => {
      this.app.timeScale = document.hidden ? 0 : 1;
    };
    document.addEventListener('visibilitychange', visibility);
    this.cleanups.push(() => observer.disconnect());
    this.cleanups.push(() => document.removeEventListener('visibilitychange', visibility));
  }

  // ---------- frame loop ----------

  private onUpdate(dt: number): void {
    this.frames++;
    this.time += dt;
    this.updateCamera(dt);
    const sceneLevel = this.level === 2;
    if (!this.options.reducedMotion && this.water && this.harbor) {
      animateWater(this.water, this.time);
      animateHarbor(this.harbor, this.time);
    }
    this.pieces?.update(dt, this.time, sceneLevel);
    if (sceneLevel) this.overlay?.drawGrid(this.app);
  }

  private updateCamera(dt: number): void {
    if (!this.introDone) {
      this.rig = sampleIntro(this.introKeys, this.time);
      if (this.time >= introDuration(this.introKeys)) this.finishIntro();
    } else {
      this.rig = dampRig(this.rig, this.goal, dt, this.options.reducedMotion ? 0 : HALF_LIFE);
    }
    const p = rigPosition(this.rig);
    this.camera.setPosition(p.x, p.y, p.z);
    this.camera.lookAt(this.rig.target.x, this.rig.target.y, this.rig.target.z);
  }

  private finishIntro(): void {
    if (this.introDone) return;
    this.introDone = true;
    this.emit('introEnd', true);
  }

  private goalFor(level: Level, azimuth: number): Rig {
    const focus = this.pieces?.position(this.turnId) ?? null;
    const context = { spot: this.plan.spot, districts: TEST_CITY.districts, focus };
    return levelGoal(level, { ...context, district: this.district }, azimuth);
  }

  // ---------- public API ----------

  on<K extends keyof ViewerEvents>(event: K, listener: (value: ViewerEvents[K]) => void) {
    return this.events.on(event, listener);
  }

  private emit<K extends keyof ViewerEvents>(event: K, value: ViewerEvents[K]): void {
    this.events.emit(event, value);
  }

  setLevel(level: Level, district?: string): void {
    const changed = level !== this.level || (district !== undefined && district !== this.district);
    if (!changed) return;
    this.skipIntro();
    const entering = level === 2 && this.level !== 2;
    if (district) this.district = district;
    this.level = level;
    const next = this.goalFor(level, this.goal.azimuth);
    if (level === 2 && !entering) next.polar = this.goal.polar;
    this.goal = next;
    this.repaintBoard();
  }

  skipIntro(): void {
    this.finishIntro();
  }

  setPieces(specs: readonly PieceSpec[]): void {
    const { x, z } = this.plan.spot;
    this.specs = [...specs];
    this.placement = placePieces(
      this.cells,
      specs.map((s) => ({ id: s.id, at: { x: x + s.at.x, z: z + s.at.z } })),
    );
    this.pieces?.setPieces(specs, this.cells, this.placement);
  }

  setFallen(id: string, fallen: boolean): void {
    this.pieces?.setFallen(id, fallen);
  }

  setTurn(id: string): void {
    this.turnId = id;
    this.pieces?.setTurn(id);
    if (this.level === 2) {
      this.goal = { ...this.goalFor(2, this.goal.azimuth), polar: this.goal.polar };
    }
    this.repaintBoard();
  }

  setSelected(id: string): void {
    this.pieces?.setSelected(id);
  }

  /** Show where the piece whose turn it is can move, or hide the reach with null. */
  setMoveMode(steps: number | null): void {
    this.moveSteps = steps;
    this.hoverCell = null;
    this.repaintBoard();
  }

  movePiece(id: string, cell: number): void {
    const target = this.cells[cell];
    if (!target) throw new Error(`movePiece: no cell ${cell}`);
    this.placement.set(id, cell);
    this.pieces?.carry(id, target);
    this.repaintBoard();
  }

  /** Moves `id` up to `steps` cells toward `targetId` and returns the hex distance left. */
  approach(id: string, targetId: string, steps: number): number {
    const goal = this.placement.get(targetId);
    if (goal === undefined) throw new Error(`approach: no piece "${targetId}"`);
    const next = stepToward(this.board(), { id, steps }, goal);
    if (next !== this.placement.get(id)) this.movePiece(id, next);
    return hexDistance(this.cells[next], this.cells[goal]);
  }

  setMood(time: TimeOfDay, fog: number): void {
    const targets = { camera: this.camera, sun: this.sun, windows: this.windows };
    applyMood(this.app, targets, { time, fog });
  }

  stats(): ViewerStats {
    return {
      frames: this.frames,
      destroyed: this.destroyed,
      backend: this.backend,
      pieces: this.specs.length,
    };
  }

  private board(): BoardState {
    return { cells: this.cells, placement: this.placement };
  }

  private repaintBoard(): void {
    const showReach = this.level === 2 && this.moveSteps !== null && this.turnId !== '';
    const reach = showReach
      ? reachableCells(this.board(), { id: this.turnId, steps: this.moveSteps ?? 0 })
      : [];
    this.overlay?.paint(reach, reach.includes(this.hoverCell ?? -1) ? this.hoverCell : null);
  }

  // ---------- input (InputTarget) ----------

  private pickContext(): PickContext | null {
    if (!this.camera.camera) return null;
    return { camera: this.camera.camera, plan: this.plan, cells: this.cells, deckY: this.deckY };
  }

  hover(x: number, y: number): void {
    const context = this.pickContext();
    if (!context) return;
    if (this.level === 2) {
      if (this.moveSteps === null) return;
      this.hoverCell = pickCell(context, x, y);
      this.repaintBoard();
      return;
    }
    this.emit('hover', pickDistrict(context, x, y));
  }

  click(x: number, y: number): void {
    const context = this.pickContext();
    if (!context) return;
    this.skipIntro();
    if (this.level < 2) {
      const district = pickDistrict(context, x, y);
      if (district) this.emit('district', district);
      return;
    }
    if (this.moveSteps !== null) {
      const cell = pickCell(context, x, y);
      const reach = reachableCells(this.board(), { id: this.turnId, steps: this.moveSteps });
      if (cell !== null && reach.includes(cell)) this.emit('cell', cell);
      return;
    }
    const piece = pickPiece(context, { x, y }, this.pieces?.targets() ?? []);
    if (piece) this.emit('piece', piece);
  }

  orbit(dx: number, dy: number): void {
    this.skipIntro();
    this.goal = { ...this.goal, azimuth: this.goal.azimuth - dx * 0.006 };
    if (this.level === 2) this.goal.polar = clampPolar(this.goal.polar - dy * 0.004);
  }

  zoom(direction: 1 | -1): void {
    this.skipIntro();
    const next = Math.min(2, Math.max(0, this.level + direction)) as Level;
    if (next !== this.level) this.emit('zoom', next);
  }

  // ---------- teardown ----------

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    live.delete(this);
    this.cleanups.forEach((cleanup) => cleanup());
    this.cleanups = [];
    this.events.clear();
    this.app.off('update', this.onUpdate, this);
    this.frame?.destroy();
    this.pieces?.destroy();
    this.overlay?.destroy();
    if (this.textures) destroyTextures(this.textures);
    this.app.destroy();
  }
}

/** Creates the device (WebGPU when available, else WebGL 2), the app and the scene. */
export async function createViewer(
  canvas: HTMLCanvasElement,
  options: ViewerOptions = {},
): Promise<TableViewer> {
  const backend = options.backend ?? 'auto';
  const app = await bootApp(canvas, { backend, lowQuality: options.quality === 'low' });
  const viewer = new TableViewer(app, canvas, options);
  viewer.start();
  return viewer;
}
