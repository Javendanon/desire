// A navigable map viewer: orbit/pan/zoom over a MapDefinition, streamed sectors around the
// focus, and place markers that link to the catalog. Generic: no city identity lives here.

import * as pc from 'playcanvas';

import { bootApp, ViewerError } from './boot.ts';
import { Emitter } from './emitter.ts';
import { attachMapInput, type MapInputTarget } from './input/map-input.ts';
import { watchPage } from './page-watch.ts';
import {
  cloneRig,
  dampRig,
  rigPosition,
  type Rig,
} from './math/camera-rig.ts';
import type { Point2 } from './math/hex.ts';
import type { MapDefinition, MapPlace } from './plan/map-definition.ts';
import { closestSphere } from './math/ray.ts';
import { screenRay } from './picking.ts';
import {
  applyMood,
  buildSun,
  createFrame,
  type Quality,
  type TimeOfDay,
} from './render/atmosphere.ts';
import { SectorCity, type SectorCityStats } from './render/sector-city.ts';
import { MapMarkers } from './scene/map-markers.ts';
import {
  clampRadius,
  orbitGoal,
  panGoal,
  projectPoint,
  startGoal,
  zoomGoal,
  type ProjectedPoint,
} from './scene/map-camera.ts';

export type { Quality, TimeOfDay };

export interface MapViewerOptions {
  quality?: Quality;
  timeOfDay?: TimeOfDay;
  fog?: number;
  reducedMotion?: boolean;
  backend?: 'auto' | 'webgl2';
  sectorLimit?: number;
  detailRadiusM?: number;
}

export interface MapViewerStats {
  frames: number;
  backend: string;
  radius: number;
  azimuth: number;
  polar: number;
  focus: Point2;
  selected: string | null;
  sectors: SectorCityStats;
}

export type { ProjectedPoint };

export interface MapViewerEvents {
  place: MapPlace;
  hover: MapPlace | null;
}

const MIN_RADIUS = 45;
const HALF_LIFE = 0.3;
/** D11 fog is tuned for a 200 m scene. Map haze scales with the orbit radius instead. */
const FOG_PER_RADIUS = 0.45;

const live = new Set<MapViewer>();

/** Map viewers alive right now. The smoke test expects 0 after every destroy. */
export function liveMapViewerCount(): number {
  return live.size;
}

export class MapViewer implements MapInputTarget {
  readonly label: string;
  private readonly app: pc.AppBase;
  private readonly canvas: HTMLCanvasElement;
  private readonly map: MapDefinition;
  private readonly options: Required<MapViewerOptions>;
  private readonly camera = new pc.Entity('camera');
  private readonly sun: pc.Entity;
  private readonly markers: MapMarkers;
  private readonly placeTargets: import('./math/ray.ts').SphereTarget[];
  private sectorCity: SectorCity | null = null;
  private frame: pc.CameraFrame | null = null;
  private readonly events = new Emitter<MapViewerEvents>();
  private readonly frameListeners = new Set<(time: number) => void>();
  private readonly cleanups: (() => void)[] = [];
  private rig: Rig;
  private goal: Rig;
  private hovered: string | null = null;
  private selected: string | null = null;
  private frames = 0;
  private time = 0;
  private destroyed = false;
  private backendName: 'webgpu' | 'webgl2' = 'webgl2';

  constructor(
    app: pc.AppBase,
    canvas: HTMLCanvasElement,
    map: MapDefinition,
    options: MapViewerOptions = {},
  ) {
    this.app = app;
    this.canvas = canvas;
    this.map = map;
    this.label = map.name;
    this.options = {
      quality: options.quality ?? 'high',
      timeOfDay: options.timeOfDay ?? 'dusk',
      fog: options.fog ?? 0.35,
      reducedMotion: options.reducedMotion ?? false,
      backend: options.backend ?? 'auto',
      sectorLimit: options.sectorLimit ?? 20,
      detailRadiusM: options.detailRadiusM ?? 900,
    };
    this.sun = buildSun(this.options.quality);
    this.goal = startGoal(map);
    this.rig = cloneRig(this.goal);
    this.markers = new MapMarkers(map);
    this.placeTargets = this.markers.targets;
    live.add(this);
  }

  start(): void {
    const device = this.app.graphicsDevice;
    this.backendName = device.isWebGPU ? 'webgpu' : 'webgl2';
    this.sectorCity = new SectorCity(this.app, this.map, {
      limit: this.options.sectorLimit,
      radiusM: this.options.detailRadiusM,
    });
    this.app.root.addChild(this.markers.root);
    this.app.root.addChild(this.sun);
    this.setupCamera();
    this.markers.setGroupVisible('control', false);
    this.markers.setGroupVisible('street', false);
    this.sectorCity.update(this.goal.target);
    this.setMood();
    this.cleanups.push(watchPage(this.app, this.canvas));
    this.cleanups.push(attachMapInput(this.canvas, this));
    this.app.on('update', this.tick, this);
    this.app.start();
  }

  private readonly tick = (dt: number): void => this.onUpdate(dt);

  private setupCamera(): void {
    this.camera.addComponent('camera', {
      fov: 32,
      nearClip: 1.5,
      farClip: 26000,
      clearColor: new pc.Color().fromString('#5d5866'),
    });
    this.app.root.addChild(this.camera);
    if (this.camera.camera) {
      this.frame = createFrame(this.app, this.camera.camera, this.options.quality);
    }
  }

  private setMood(): void {
    applyMood(
      this.app,
      { camera: this.camera, sun: this.sun, windows: [] },
      { time: this.options.timeOfDay, fog: this.options.fog },
    );
  }

  private onUpdate(dt: number): void {
    if (this.destroyed) return;
    this.frames++;
    this.time += dt;
    this.rig = dampRig(this.rig, this.goal, dt, this.options.reducedMotion ? 0 : HALF_LIFE);
    const position = rigPosition(this.rig);
    this.camera.setPosition(position.x, position.y, position.z);
    this.camera.lookAt(this.rig.target.x, this.rig.target.y, this.rig.target.z);
    this.app.scene.fog.density = FOG_PER_RADIUS / Math.max(this.rig.radius, MIN_RADIUS);
    this.scaleMarkers();
    this.sectorCity?.update(this.rig.target);
    for (const listener of this.frameListeners) listener(this.time);
  }

  // ---------- public API ----------

  on<K extends keyof MapViewerEvents>(event: K, listener: (value: MapViewerEvents[K]) => void) {
    return this.events.on(event, listener);
  }

  onFrame(listener: (time: number) => void): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  stats(): MapViewerStats {
    const sectors = this.sectorCity?.stats() ?? {
      sectors: 0,
      resident: [],
      near: 0,
      mid: 0,
      detailedBuildings: 0,
      farInstances: 0,
      matrixBytes: 0,
      drawCalls: 0,
    };
    return {
      frames: this.frames,
      backend: this.backendName,
      radius: this.rig.radius,
      azimuth: this.rig.azimuth,
      polar: this.rig.polar,
      focus: { x: this.rig.target.x, z: this.rig.target.z },
      selected: this.selected,
      sectors,
    };
  }

  places(): readonly MapPlace[] {
    return this.map.places;
  }

  project(point: Point2, height = 0): ProjectedPoint {
    return projectPoint(this.camera, point, height);
  }

  panBy(dx: number, dy: number): void {
    this.pan(dx, dy);
  }

  zoomBy(steps: number): void {
    this.zoom(steps);
  }

  focusPlace(id: string): void {
    const place = this.findPlace(id);
    this.goal = {
      ...this.goal,
      target: { x: place.at.x, y: 0, z: place.at.z },
      radius: Math.min(this.goal.radius, 340),
    };
  }

  selectPlace(id: string): MapPlace {
    const place = this.findPlace(id);
    this.select(id);
    return place;
  }

  setMarkersVisible(group: 'control' | 'street', visible: boolean): void {
    this.markers.setGroupVisible(group, visible);
  }

  private findPlace(id: string): MapPlace {
    const place = this.map.places.find((entry) => entry.id === id);
    if (!place) throw new Error(`map: no place "${id}"`);
    return place;
  }

  private select(id: string): void {
    this.selected = id;
    this.scaleMarkers();
  }

  /** Markers grow with the camera radius so a 7 km overview still shows the D05 points. */
  private scaleMarkers(): void {
    this.markers.updateScale(this.rig.radius, this.selected);
  }

  private pickPlace(x: number, y: number): MapPlace | null {
    if (!this.camera.camera) return null;
    const ray = screenRay(this.camera.camera, x, y);
    const id = closestSphere(ray, this.placeTargets);
    return id ? this.map.places.find((place) => place.id === id) ?? null : null;
  }

  // ---------- MapInputTarget ----------

  hover(x: number, y: number): void {
    const place = this.pickPlace(x, y);
    const id = place?.id ?? null;
    if (id === this.hovered) return;
    this.hovered = id;
    this.events.emit('hover', place);
  }

  click(x: number, y: number): void {
    const place = this.pickPlace(x, y);
    if (!place) return;
    this.select(place.id);
    this.events.emit('place', place);
  }

  pan(dx: number, dy: number): void {
    panGoal(this.goal, this.map, dx, dy);
  }

  orbit(dx: number, dy: number): void {
    orbitGoal(this.goal, dx, dy);
  }

  zoom(steps: number): void {
    zoomGoal(this.goal, this.map, steps);
  }

  reset(): void {
    this.goal = startGoal(this.map);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    live.delete(this);
    this.cleanups.forEach((cleanup) => cleanup());
    this.cleanups.length = 0;
    this.events.clear();
    this.frameListeners.clear();
    this.app.off('update', this.tick, this);
    this.frame?.destroy();
    this.sectorCity?.destroy();
    this.markers.destroy();
    this.app.destroy();
  }
}

/** Boots the device, creates the viewer and starts the loop. */
export async function createMapViewer(
  canvas: HTMLCanvasElement,
  map: MapDefinition,
  options: MapViewerOptions = {},
): Promise<MapViewer> {
  const backend = options.backend ?? 'auto';
  const app = await bootApp(canvas, { backend, lowQuality: options.quality === 'low' });
  const viewer = new MapViewer(app, canvas, map, options);
  viewer.start();
  return viewer;
}

export { ViewerError };
