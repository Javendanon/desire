// A playable interior: the floors of a FloorPlan as glTF models, furniture placed and tinted from
// the catalogue, miniatures on the 5 ft grid, move mode with reachable squares, the slide, and a
// camera that orbits the active floor or follows a 0..1 path for previews.
import * as pc from 'playcanvas';

import type { FloorPlan, PropCatalog } from '../../generated/contracts.ts';
import { bootApp, ViewerError } from './boot.ts';
import { Emitter } from './emitter.ts';
import { attachMapInput, type MapInputTarget } from './input/map-input.ts';
import { InteriorAssets } from './interior/interior-assets.ts';
import { lightInterior, type InteriorLights } from './interior/lighting.ts';
import { InteriorPieces, type InteriorPieceSpec } from './interior/interior-pieces.ts';
import { InteriorScene, interiorModelUrls } from './interior/interior-scene.ts';
import { Lifecycle } from './lifecycle.ts';
import { MoveOverlay } from './interior/move-overlay.ts';
import { sampleCameraPath, type CameraKey } from './math/camera-path.ts';
import { cloneRig, dampRig, rigPosition, type Rig, type Vec3Like } from './math/camera-rig.ts';
import { hitHorizontalPlane } from './math/ray.ts';
import { watchPage } from './page-watch.ts';
import { screenRay } from './picking.ts';
import { buildFloorBoard, findPath, reachable, type FloorBoard } from './plan/floor-board.ts';
import { cellKey, type FloorCellRef } from './plan/floor-index.ts';
import { orbitRig, panRig, startRig, zoomRig } from './plan/interior-camera.ts';
import { floorById, worldToCell } from './plan/interior-placement.ts';

export type { CameraKey, FloorCellRef, InteriorPieceSpec };

export interface InteriorViewerOptions {
  plan: FloorPlan;
  catalog: PropCatalog;
  /** URL folder of the models, ending with a slash, e.g. `/models/trollskull/`. */
  modelBase: string;
  quality?: 'low' | 'high';
  reducedMotion?: boolean;
  backend?: 'auto' | 'webgl2';
}

export interface InteriorViewerStats {
  frames: number;
  backend: 'webgpu' | 'webgl2';
  floor: string;
  reachable: number;
  drawCalls: number;
}

export interface InteriorViewerEvents {
  cell: FloorCellRef;
}

interface MoveMode {
  id: string;
  steps: number;
  cells: Map<string, FloorCellRef>;
}

const HALF_LIFE = 0.25;
const live = new Set<InteriorViewer>();

/** Interior viewers alive right now. The smoke test expects 0 after every destroy. */
export function liveInteriorViewerCount(): number {
  return live.size;
}

export class InteriorViewer {
  private readonly app: pc.AppBase;
  private readonly canvas: HTMLCanvasElement;
  private readonly options: Required<InteriorViewerOptions>;
  private readonly board: FloorBoard;
  private readonly assets: InteriorAssets;
  private readonly camera = new pc.Entity('camera');
  private readonly events = new Emitter<InteriorViewerEvents>();
  private readonly lifecycle: Lifecycle<InteriorViewer>;
  private scene: InteriorScene | null = null;
  private pieces: InteriorPieces | null = null;
  private overlay: MoveOverlay | null = null;
  private lights: InteriorLights | null = null;
  private floor: string;
  private goal: Rig;
  private rig: Rig;
  private path: readonly CameraKey[] = [];
  private progress: number | null = null;
  private moveMode: MoveMode | null = null;
  private frames = 0;
  private backendName: 'webgpu' | 'webgl2' = 'webgl2';

  constructor(app: pc.AppBase, canvas: HTMLCanvasElement, options: InteriorViewerOptions) {
    this.app = app;
    this.canvas = canvas;
    this.options = { quality: 'high', reducedMotion: false, backend: 'auto', ...options };
    this.board = buildFloorBoard(options.plan, options.catalog);
    this.assets = new InteriorAssets(app);
    this.floor = options.plan.floors.find((floor) => floor.elevation_m === 0)?.id
      ?? options.plan.floors[0].id;
    this.goal = startRig(options.plan, this.floor);
    this.rig = cloneRig(this.goal);
    this.lifecycle = new Lifecycle(live, this);
  }

  /** The graphics backend, kept after destroy so stats stay readable. */
  get backend(): 'webgpu' | 'webgl2' {
    return this.backendName;
  }

  /** Loads every model, builds the house and starts the frame loop. */
  async start(): Promise<void> {
    const { plan, catalog, modelBase } = this.options;
    this.backendName = this.app.graphicsDevice.isWebGPU ? 'webgpu' : 'webgl2';
    await this.assets.load(interiorModelUrls(plan, catalog, modelBase));
    if (this.lifecycle.ended) return;
    this.scene = new InteriorScene(plan, catalog, this.assets);
    this.pieces = new InteriorPieces(this.app.graphicsDevice, plan);
    this.overlay = new MoveOverlay(plan);
    for (const root of [this.scene.root, this.pieces.root, this.overlay.root]) {
      this.app.root.addChild(root);
    }
    this.camera.addComponent('camera', { fov: 38, nearClip: 0.2, farClip: 400 });
    this.app.root.addChild(this.camera);
    this.lights = lightInterior(this.app, this.camera, this.options.quality);
    this.setFloor(this.floor);
    this.lifecycle.cleanups.push(
      watchPage(this.app, this.canvas),
      attachMapInput(this.canvas, this.input()),
    );
    this.app.on('update', this.tick, this);
    this.app.start();
  }

  private readonly tick = (dt: number): void => {
    if (this.lifecycle.ended) return;
    this.frames++;
    this.pieces?.update(this.options.reducedMotion ? Number.POSITIVE_INFINITY : dt);
    this.placeCamera(dt);
  };

  private placeCamera(dt: number): void {
    // A progress without keys has nothing to fly, so the orbit keeps the camera.
    if (this.progress !== null && this.path.length > 0) {
      const key = sampleCameraPath(this.path, this.progress);
      this.aim(key.position, key.target);
      return;
    }
    this.rig = dampRig(this.rig, this.goal, dt, this.options.reducedMotion ? 0 : HALF_LIFE);
    this.aim(rigPosition(this.rig), this.rig.target);
  }

  private aim(position: Vec3Like, target: Vec3Like): void {
    this.camera.setPosition(position.x, position.y, position.z);
    this.camera.lookAt(target.x, target.y, target.z);
  }

  // ---------- public API ----------

  on<K extends keyof InteriorViewerEvents>(
    event: K,
    listener: (value: InteriorViewerEvents[K]) => void,
  ) {
    return this.events.on(event, listener);
  }

  /** Shows `floorId` and the floors below it, and centres the camera on it. */
  setFloor(floorId: string): void {
    floorById(this.options.plan, floorId);
    this.floor = floorId;
    this.scene?.setFloor(floorId);
    this.goal = startRig(this.options.plan, floorId);
    if (this.moveMode) this.setMoveMode(this.moveMode.id, this.moveMode.steps);
  }

  setPieces(specs: readonly InteriorPieceSpec[]): void {
    this.pieces?.set(specs);
    this.setMoveMode(null);
  }

  /** Highlights the squares `id` can reach in `steps` moves, or clears move mode with null. */
  setMoveMode(id: string | null, steps = 0): void {
    this.overlay?.clear();
    this.moveMode = null;
    if (!id || !this.pieces) return;
    const from = this.pieces.cellOf(id);
    const reached = reachable(this.board, from, steps);
    reached.delete(cellKey(from));
    const cells = new Map([...reached.keys()].map((key) => [key, this.parseKey(key)]));
    this.moveMode = { id, steps, cells };
    this.overlay?.show([...cells.values()].filter((cell) => this.isShown(cell.floor)));
  }

  /**
   * Walks `id` to `to` along the shortest legal route. In move mode for `id` only a lit square is
   * accepted. Without move mode any reachable square is: that is the DM's path, and player input
   * should always go through move mode. False when the move is refused, including while the
   * miniature is still walking.
   */
  movePiece(id: string, to: FloorCellRef): boolean {
    if (!this.pieces || this.pieces.isMoving(id)) return false;
    const limited = this.moveMode?.id === id;
    if (limited && !this.moveMode?.cells.has(cellKey(to))) return false;
    const route = findPath(this.board, this.pieces.cellOf(id), to);
    if (!route) return false;
    this.pieces.move(id, route, this.options.reducedMotion);
    this.setMoveMode(null);
    return true;
  }

  pieceCell(id: string): FloorCellRef | null {
    return this.pieces?.cellOf(id) ?? null;
  }

  isMoving(id: string): boolean {
    return this.pieces?.isMoving(id) ?? false;
  }

  /** Flies the camera along `keys` at `progress` (0..1), or hands it back to the orbit on null. */
  setCameraProgress(progress: number | null, keys: readonly CameraKey[] = this.path): void {
    this.path = keys;
    this.progress = progress;
  }

  stats(): InteriorViewerStats {
    return {
      frames: this.frames,
      backend: this.backend,
      floor: this.floor,
      reachable: this.moveMode?.cells.size ?? 0,
      drawCalls: this.lifecycle.ended ? 0 : this.app.stats.drawCalls.total,
    };
  }

  private parseKey(key: string): FloorCellRef {
    const [floor, xy] = key.split(':');
    const [x, y] = xy.split(',').map(Number);
    return { floor, x, y };
  }

  private isShown(floorId: string): boolean {
    const plan = this.options.plan;
    return floorById(plan, floorId).elevation_m <= floorById(plan, this.floor).elevation_m;
  }

  /** The square under the pointer: a lit one on any visible floor first, else the active floor. */
  private pickCell(x: number, y: number): FloorCellRef | null {
    if (!this.camera.camera) return null;
    const ray = screenRay(this.camera.camera, x, y);
    const visible = this.options.plan.floors
      .filter((floor) => this.isShown(floor.id))
      .sort((a, b) => b.elevation_m - a.elevation_m);
    const candidates = visible.flatMap((floor) => {
      const hit = hitHorizontalPlane(ray, floor.elevation_m);
      if (!hit) return [];
      return [{ floor: floor.id, ...worldToCell(this.options.plan, floor.id, hit) }];
    });
    const reachableHit = candidates.find((cell) => this.moveMode?.cells.has(cellKey(cell)));
    return reachableHit ?? candidates.find((cell) => cell.floor === this.floor) ?? null;
  }

  /** Pointer, wheel and keys: drag pans the floor, shift-drag orbits, a click picks a square. */
  private input(): MapInputTarget {
    return {
      hover: () => undefined,
      click: (x, y) => {
        const cell = this.pickCell(x, y);
        if (cell) this.events.emit('cell', cell);
      },
      pan: (dx, dy) => panRig(this.goal, dx, dy),
      orbit: (dx, dy) => orbitRig(this.goal, dx, dy),
      zoom: (steps) => zoomRig(this.goal, steps),
      reset: () => {
        this.goal = startRig(this.options.plan, this.floor);
      },
    };
  }

  destroy(): void {
    if (!this.lifecycle.end()) return;
    this.events.clear();
    this.app.off('update', this.tick, this);
    this.lights?.destroy();
    this.overlay?.destroy();
    this.pieces?.destroy();
    this.scene?.destroy();
    this.assets.destroy();
    this.app.destroy();
  }
}

/** Boots the device with model loading, builds the interior and starts the loop. */
export async function createInteriorViewer(
  canvas: HTMLCanvasElement,
  options: InteriorViewerOptions,
): Promise<InteriorViewer> {
  const app = await bootApp(canvas, {
    backend: options.backend ?? 'auto',
    lowQuality: options.quality === 'low',
    loadsModels: true,
  });
  const viewer = new InteriorViewer(app, canvas, options);
  try {
    await viewer.start();
  } catch (error) {
    viewer.destroy();
    throw error instanceof ViewerError ? error : new ViewerError(String(error));
  }
  return viewer;
}

export { ViewerError };
