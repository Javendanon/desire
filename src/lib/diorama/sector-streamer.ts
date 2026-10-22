// Keeps the city sectors around the camera target on stage. A few times a second it plans which
// sectors to load and drop and which get full detail (sector-streaming.ts), and refreshes the
// city-wide houses, ships and ambience (city-life.ts) with what changed. The Worker fetches,
// decodes and plans; the frame loop puts at most one arrived ground tile on stage per frame, so
// arrivals never stack into one long frame. A sector dropped while in flight is discarded.

import type * as pc from 'playcanvas';

import {
  addSector, dropSector, refreshLife, setDetail, type CityLife,
} from './city-life.ts';
import {
  planSectors, sectorDetail, sectorDistance, type GridShape, type SectorDetail, type Target,
} from './sector-streaming.ts';
import type { Arrival, WorkerReply, WorkerRequest } from './sector-worker.ts';
import { buildSectorView, type SectorKit, type SectorView } from './sector-view.ts';
import type { Moment } from './stage.ts';

/** Sectors load within this many camera distances plus metres of the target. */
const REACH_PER_RADIUS = 1.5;
const REACH_M = 300;
const PLAN_EVERY_S = 0.25;
const MAX_IN_FLIGHT = 4;

export interface StreamSpec {
  kit: SectorKit;
  grid: GridShape;
  /** Directory holding `sectors/` and `ground/`. */
  base: string;
  /** Sectors with a payload in `index.json`. */
  listed: Set<number>;
  life: CityLife;
}

export interface Streamer {
  views: Map<number, SectorView>;
  /** Requested and not yet on stage: in flight, or arrived and waiting to be built. */
  pending: Set<number>;
  arrived: Arrival[];
  failed: Set<number>;
  worker: Worker;
  sincePlan: number;
  /** The camera rig at the last plan, for the detail of sectors arriving after it. */
  rig: Moment['rig'] | null;
  spec: StreamSpec;
}

function request(streamer: Streamer, index: number) {
  const { base, listed, kit } = streamer.spec;
  const message: WorkerRequest = { base, index, hasSector: listed.has(index),
    tile: kit.ground.tiles[index], grid: kit.ground, roofCentres: kit.roofCentres };
  streamer.worker.postMessage(message);
  streamer.pending.add(index);
}

function drop(streamer: Streamer, index: number) {
  streamer.views.get(index)?.release();
  streamer.views.delete(index);
  dropSector(streamer.spec.life, index);
  streamer.pending.delete(index);
  streamer.failed.delete(index);
}

/** The detail a sector should have now, from its current one (hysteresis). */
function detailOf(streamer: Streamer, index: number, current: SectorDetail): SectorDetail {
  const { rig } = streamer;
  if (!rig) return current;
  const target: Target = { x: rig.target.x, z: rig.target.z };
  const distance_m = sectorDistance(streamer.spec.grid, index, target);
  return sectorDetail({ distance_m, radius_m: rig.radius, current });
}

function redetail(streamer: Streamer) {
  const { life } = streamer.spec;
  for (const [index, current] of life.detail) {
    setDetail(life, index, detailOf(streamer, index, current));
  }
}

function plan(streamer: Streamer, rig: Moment['rig']) {
  const { views, pending, failed } = streamer;
  streamer.rig = rig;
  const { load, unload } = planSectors({
    grid: streamer.spec.grid,
    loaded: [...views.keys(), ...pending, ...failed],
    target: { x: rig.target.x, z: rig.target.z },
    reach_m: rig.radius * REACH_PER_RADIUS + REACH_M,
  });
  unload.forEach((index) => drop(streamer, index));
  load.slice(0, Math.max(0, MAX_IN_FLIGHT - pending.size)).forEach((index) =>
    request(streamer, index));
  redetail(streamer);
  refreshLife(streamer.spec.life);
}

/** Puts the next arrived sector on stage, unless it was dropped meanwhile. */
function buildNext(streamer: Streamer, root: pc.Entity) {
  const arrival = streamer.arrived.shift();
  if (!arrival) return;
  const { index } = arrival.assets;
  if (!streamer.pending.delete(index)) {
    arrival.assets.albedo.close();
    return;
  }
  const view = buildSectorView(streamer.spec.kit, arrival);
  root.addChild(view.root);
  streamer.views.set(index, view);
  const { berths = [] } = arrival.assets.sector ?? {};
  addSector(streamer.spec.life, index, { ...arrival.plans, berths, banks: arrival.banks },
    detailOf(streamer, index, 'far'));
}

function receive(streamer: Streamer, reply: WorkerReply) {
  if (reply.kind === 'loaded') {
    streamer.arrived.push(reply.arrival);
    return;
  }
  streamer.pending.delete(reply.index);
  streamer.failed.add(reply.index);
  console.warn(`sector ${reply.index}: ${reply.message}`);
}

export function createStreamer(spec: StreamSpec): Streamer {
  const worker = new Worker(new URL('./sector-worker.ts', import.meta.url), { type: 'module' });
  const streamer: Streamer = { views: new Map(), pending: new Set(), arrived: [],
    failed: new Set(), worker, sincePlan: PLAN_EVERY_S, rig: null, spec };
  worker.onmessage = (event: MessageEvent<WorkerReply>) => receive(streamer, event.data);
  return streamer;
}

/** Called every frame: replans now and then and builds one arrival. */
export function streamSectors(streamer: Streamer, moment: Moment) {
  streamer.sincePlan += moment.dt;
  if (streamer.sincePlan >= PLAN_EVERY_S) {
    streamer.sincePlan = 0;
    plan(streamer, moment.rig);
  }
  buildNext(streamer, streamer.spec.kit.app.root);
}

export function stopStreamer(streamer: Streamer) {
  streamer.worker.terminate();
  [...streamer.views.keys()].forEach((index) => drop(streamer, index));
}
