// Keeps the city sectors around the camera target on stage. A few times a second it plans which
// sectors to load and drop (sector-streaming.ts); the Worker fetches and decodes, and the frame
// loop builds at most one arrived sector per frame, so arrivals never stack into one long frame.
// A sector dropped while in flight is discarded on arrival.

import type * as pc from 'playcanvas';

import {
  castsShadows, planSectors, sectorDistance, type GridShape, type Target,
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
}

export interface Streamer {
  views: Map<number, SectorView>;
  /** Requested and not yet on stage: in flight, or arrived and waiting to be built. */
  pending: Set<number>;
  arrived: Arrival[];
  failed: Set<number>;
  worker: Worker;
  sincePlan: number;
  spec: StreamSpec;
}

function request(streamer: Streamer, index: number) {
  const { base, listed, kit } = streamer.spec;
  const message: WorkerRequest = { base, index, hasSector: listed.has(index),
    tile: kit.ground.tiles[index], grid: kit.ground };
  streamer.worker.postMessage(message);
  streamer.pending.add(index);
}

function drop(streamer: Streamer, index: number) {
  streamer.views.get(index)?.release();
  streamer.views.delete(index);
  streamer.pending.delete(index);
  streamer.failed.delete(index);
}

/** Near sectors cast shadows, far ones stop (sector-streaming.ts). */
function shade(streamer: Streamer, target: Target, radius_m: number) {
  for (const [index, view] of streamer.views) {
    const distance_m = sectorDistance(streamer.spec.grid, index, target);
    view.shade(castsShadows({ distance_m, radius_m }));
  }
}

function plan(streamer: Streamer, rig: Moment['rig']) {
  const { views, pending, failed } = streamer;
  const target = { x: rig.target.x, z: rig.target.z };
  const { load, unload } = planSectors({
    grid: streamer.spec.grid,
    loaded: [...views.keys(), ...pending, ...failed],
    target,
    reach_m: rig.radius * REACH_PER_RADIUS + REACH_M,
  });
  shade(streamer, target, rig.radius);
  unload.forEach((index) => drop(streamer, index));
  load.slice(0, Math.max(0, MAX_IN_FLIGHT - pending.size)).forEach((index) =>
    request(streamer, index));
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
    failed: new Set(), worker, sincePlan: PLAN_EVERY_S, spec };
  worker.onmessage = (event: MessageEvent<WorkerReply>) => receive(streamer, event.data);
  return streamer;
}

/** Called every frame: replans now and then, builds one arrival, moves what is on stage. */
export function streamSectors(streamer: Streamer, moment: Moment) {
  streamer.sincePlan += moment.dt;
  if (streamer.sincePlan >= PLAN_EVERY_S) {
    streamer.sincePlan = 0;
    plan(streamer, moment.rig);
  }
  buildNext(streamer, streamer.spec.kit.app.root);
  for (const view of streamer.views.values()) view.mover(moment);
}

export function stopStreamer(streamer: Streamer) {
  streamer.worker.terminate();
  [...streamer.views.keys()].forEach((index) => drop(streamer, index));
}
