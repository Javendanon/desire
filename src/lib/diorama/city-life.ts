// The city's houses, ships, smoke, lanterns and fog over every streamed sector, drawn city-wide
// instead of sector by sector. Each sector brings two town plans from the Worker: near sectors
// show the full one and cast shadows, far ones a wall box and a roof per house without shadows.
// Every house part of one kind is one merged batch per level of detail, so the draw count no
// longer grows with the sectors on stage, and that count is paid again by the shadow and depth
// passes. Changes are batched: a refresh rebuilds only what the sectors it saw changed.

import * as pc from 'playcanvas';

import type { Textures } from '../engine/render/textures.ts';
import type { FogBank } from './ambience-plan.ts';
import { animateAmbience, buildAmbience, type Ambience } from './ambience.ts';
import { releaseGpu } from './gpu-release.ts';
import {
  createMergedBatch, fillMergedBatch, releaseMergedBatch, type MergedBatch,
} from './merged-batch.ts';
import type { SectorDetail } from './sector-streaming.ts';
import { animateFleet, buildFleet, type Fleet } from './ships.ts';
import type { SliceBerth } from './slice-data.ts';
import { glowWindows, type Mover } from './stage.ts';
import { lookOf, townLook, type TownLook } from './town.ts';
import { mergePlans, type TownPlan } from './town-plan.ts';

/** What one sector contributes, at both levels of detail. */
export interface SectorLife {
  near: TownPlan;
  far: TownPlan;
  berths: SliceBerth[];
  banks: FogBank[];
}

type Part = SectorDetail | 'living';

/** What moves: ships at every berth, and smoke, lanterns and fog. */
type Living = {
  fleet: Fleet;
  ambience: Ambience;
};

export interface CityLife {
  app: pc.AppBase;
  textures: Textures;
  look: TownLook;
  root: pc.Entity;
  sectors: Map<number, SectorLife>;
  detail: Map<number, SectorDetail>;
  layers: Record<SectorDetail, Map<string, MergedBatch>>;
  /** What the next refresh rebuilds. */
  dirty: Set<Part>;
  living: Living | null;
}

/** Only full-detail houses cast shadows: far ones would blur away in the shadow map. */
const CASTS: Record<SectorDetail, boolean> = { near: true, far: false };
const EMPTY = new Float32Array(0);

export function createCityLife(app: pc.AppBase, textures: Textures, tones: string[]): CityLife {
  const look = townLook(app.graphicsDevice, textures, tones);
  glowWindows(look.windowMaterials);
  const root = new pc.Entity('city-life');
  app.root.addChild(root);
  return { app, textures, look, root, sectors: new Map(), detail: new Map(),
    layers: { near: new Map(), far: new Map() }, dirty: new Set(), living: null };
}

export function addSector(life: CityLife, index: number, sector: SectorLife,
  detail: SectorDetail) {
  life.sectors.set(index, sector);
  life.detail.set(index, detail);
  life.dirty.add(detail).add('living');
}

export function dropSector(life: CityLife, index: number) {
  const detail = life.detail.get(index);
  if (!detail) return;
  life.sectors.delete(index);
  life.detail.delete(index);
  life.dirty.add(detail).add('living');
}

export function setDetail(life: CityLife, index: number, detail: SectorDetail) {
  if (life.detail.get(index) === detail || !life.detail.has(index)) return;
  life.detail.set(index, detail);
  life.dirty.add('near').add('far').add('living');
}

/** The sectors at a level of detail, in index order so merges are stable. */
function sectorsAt(life: CityLife, detail: SectorDetail): SectorLife[] {
  return [...life.detail].filter(([, level]) => level === detail).sort(([a], [b]) => a - b)
    .map(([index]) => life.sectors.get(index)!);
}

function batchFor(life: CityLife, detail: SectorDetail, key: string): MergedBatch {
  const layer = life.layers[detail];
  const found = layer.get(key);
  if (found) return found;
  const batch = createMergedBatch(lookOf(life.look, key), CASTS[detail]);
  life.root.addChild(batch.entity);
  layer.set(key, batch);
  return batch;
}

function refillLayer(life: CityLife, detail: SectorDetail) {
  const merged = mergePlans(sectorsAt(life, detail).map((sector) => sector[detail]));
  const device = life.app.graphicsDevice;
  for (const [key, batch] of life.layers[detail]) {
    if (!(key in merged)) fillMergedBatch(device, batch, EMPTY);
  }
  for (const [key, data] of Object.entries(merged)) {
    fillMergedBatch(device, batchFor(life, detail, key), data);
  }
}

/** Ships at every berth, smoke and lanterns on near houses, fog over all loaded water. */
function rebuildLiving(life: CityLife) {
  const shared = new Set(Object.values(life.textures));
  if (life.living) {
    releaseGpu(life.living.fleet.root, shared);
    releaseGpu(life.living.ambience.root, shared);
  }
  const all = [...life.sectors.values()];
  const near = sectorsAt(life, 'near').map((sector) => sector.near);
  const fleet = buildFleet(life.app, all.flatMap((sector) => sector.berths), life.textures);
  const town = { chimneyTops: near.flatMap((plan) => plan.chimneyTops),
    fronts: near.flatMap((plan) => plan.fronts) };
  const ambience = buildAmbience(life.app, { banks: all.flatMap((sector) => sector.banks), town });
  life.root.addChild(fleet.root);
  life.root.addChild(ambience.root);
  life.living = { fleet, ambience };
}

const REBUILDS: Record<Part, (life: CityLife) => void> = {
  near: (life) => refillLayer(life, 'near'),
  far: (life) => refillLayer(life, 'far'),
  living: rebuildLiving,
};

/** Rebuilds what changed since the last refresh. */
export function refreshLife(life: CityLife) {
  for (const part of life.dirty) REBUILDS[part](life);
  life.dirty.clear();
}

export const lifeMover = (life: CityLife): Mover => (moment) => {
  if (!life.living) return;
  animateFleet(life.living.fleet, moment.time);
  const { right, up } = moment.camera;
  animateAmbience(life.living.ambience, { time: moment.time, right, up });
};

export function releaseLife(life: CityLife) {
  for (const layer of Object.values(life.layers)) layer.forEach(releaseMergedBatch);
  life.root.destroy();
}
