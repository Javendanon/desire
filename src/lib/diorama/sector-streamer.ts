// Keeps the city sectors around the camera target on stage. A few times a second it plans which
// sectors to load and drop and which get full detail (sector-streaming.ts), and refreshes the
// city-wide houses, ships and ambience (city-life.ts) with what changed. The Worker fetches,
// decodes and plans; the frame loop puts at most one arrived ground tile on stage per frame, so
// arrivals never stack into one long frame. Requests are tracked by generation
// (stream-ledger.ts): stale replies are discarded and their decoded images closed.

import type * as pc from 'playcanvas';

import {
  addSector, dropSector, refreshLife, setDetail, type CityLife,
} from './city-life.ts';
import {
  planSectors, sectorDetail, sectorDistance, type GridShape, type SectorDetail,
} from './sector-streaming.ts';
import type { Arrival, WorkerReply, WorkerRequest } from './sector-worker.ts';
import { buildSectorView, type SectorKit, type SectorView } from './sector-view.ts';
import type { Moment } from './stage.ts';
import {
  busy, capacity, claim, createLedger, place, release, settle, type Ledger,
} from './stream-ledger.ts';

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
  ledger: Ledger;
  /** Replies the Worker sent that the frame loop has not put on stage yet. */
  arrived: Arrival[];
  worker: Worker;
  sincePlan: number;
  /** Seconds on the frame clock, for failure back-off. */
  clock: number;
  /** The camera rig at the last plan, for the detail of sectors arriving after it. */
  rig: Moment['rig'] | null;
  spec: StreamSpec;
}

function request(streamer: Streamer, index: number) {
  const { base, listed, kit } = streamer.spec;
  const message: WorkerRequest = { base, index, hasSector: listed.has(index),
    generation: claim(streamer.ledger, index), tile: kit.ground.tiles[index], grid: kit.ground,
    roofCentres: kit.roofCentres };
  streamer.worker.postMessage(message);
}

function drop(streamer: Streamer, index: number) {
  streamer.views.get(index)?.release();
  streamer.views.delete(index);
  release(streamer.ledger, index);
  dropSector(streamer.spec.life, index);
}

/** The detail a sector should have now, from its current one (hysteresis). */
function detailOf(streamer: Streamer, index: number, current: SectorDetail): SectorDetail {
  const { rig } = streamer;
  if (!rig) return current;
  const target = { x: rig.target.x, z: rig.target.z };
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
  streamer.rig = rig;
  const { load, unload } = planSectors({
    grid: streamer.spec.grid,
    loaded: [...streamer.views.keys(), ...busy(streamer.ledger, streamer.clock)],
    target: { x: rig.target.x, z: rig.target.z },
    reach_m: rig.radius * REACH_PER_RADIUS + REACH_M,
  });
  unload.forEach((index) => drop(streamer, index));
  load.slice(0, capacity(streamer.ledger, MAX_IN_FLIGHT)).forEach((index) =>
    request(streamer, index));
  redetail(streamer);
  refreshLife(streamer.spec.life);
}

/** Puts the next arrived sector on stage, unless it was dropped meanwhile. */
function buildNext(streamer: Streamer, root: pc.Entity) {
  const arrival = streamer.arrived.shift();
  if (!arrival) return;
  if (!place(streamer.ledger, arrival.index, arrival.generation)) {
    arrival.albedo.close();
    return;
  }
  const view = buildSectorView(streamer.spec.kit, arrival);
  root.addChild(view.root);
  streamer.views.set(arrival.index, view);
  const { plans, berths, banks } = arrival;
  addSector(streamer.spec.life, { index: arrival.index, sector: { ...plans, berths, banks },
    detail: detailOf(streamer, arrival.index, 'far') });
}

function receive(streamer: Streamer, reply: WorkerReply) {
  const ok = reply.kind === 'loaded';
  const { index, generation } = ok ? reply.arrival : reply;
  const verdict = settle(streamer.ledger, { index, generation, ok, now: streamer.clock });
  if (ok && verdict === 'build') streamer.arrived.push(reply.arrival);
  else if (ok) reply.arrival.albedo.close();
  else console.warn(`sector ${index}: ${reply.message}`);
}

export function createStreamer(spec: StreamSpec): Streamer {
  const worker = new Worker(new URL('./sector-worker.ts', import.meta.url), { type: 'module' });
  const streamer: Streamer = { views: new Map(), ledger: createLedger(), arrived: [], worker,
    sincePlan: PLAN_EVERY_S, clock: 0, rig: null, spec };
  worker.onmessage = (event: MessageEvent<WorkerReply>) => receive(streamer, event.data);
  return streamer;
}

/** Called every frame: replans now and then and builds one arrival. */
export function streamSectors(streamer: Streamer, moment: Moment) {
  streamer.clock = moment.time;
  streamer.sincePlan += moment.dt;
  if (streamer.sincePlan >= PLAN_EVERY_S) {
    streamer.sincePlan = 0;
    plan(streamer, moment.rig);
  }
  buildNext(streamer, streamer.spec.kit.app.root);
}

export function stopStreamer(streamer: Streamer) {
  streamer.worker.terminate();
  streamer.arrived.forEach((arrival) => arrival.albedo.close());
  streamer.arrived = [];
  [...streamer.views.keys()].forEach((index) => drop(streamer, index));
}
