// The city viewer's loader thread: fetches and decodes sector assets, builds the ground tile's
// mesh and plans the sector's houses at both levels of detail, so the frame loop never waits on
// the network, JPEG decoding, payload parsing or mesh and matrix arithmetic. Replies transfer
// the buffers and the decoded image instead of copying them.

import { fogBanks, type FogBank } from './ambience-plan.ts';
import { loadSectorAssets, type SectorAssets, type SectorRequest } from './sector-assets.ts';
import type { Rgb } from './roof-palette.ts';
import { centred } from './sector-slice.ts';
import {
  groundGeometry, tileWater, type GroundGeometry, type GroundGrid, type GroundTile,
} from './sector-streaming.ts';
import { planTown, type Detail, type TownPlan } from './town-plan.ts';

/** A sector to load, with what its ground mesh is built from. */
export type WorkerRequest = SectorRequest & {
  tile: GroundTile;
  grid: GroundGrid;
  roofCentres: Rgb[];
};

/** A sector ready for the frame loop to put on stage. */
export interface Arrival {
  assets: SectorAssets<ImageBitmap>;
  geometry: GroundGeometry;
  /** The sector's houses at each level of detail. */
  plans: Record<Detail, TownPlan>;
  /** Fog banks over the tile's water. */
  banks: FogBank[];
}

export type WorkerReply =
  | { kind: 'loaded', arrival: Arrival }
  | { kind: 'failed', index: number, message: string };

const platform = { fetcher: (url: string) => fetch(url), decode: createImageBitmap };
function plansOf(request: WorkerRequest, assets: SectorAssets<ImageBitmap>) {
  const houses = (assets.sector?.houses ?? []).map(centred);
  const plan = (detail: Detail) => planTown(houses, { roofCentres: request.roofCentres, detail });
  return { near: plan('near'), far: plan('far') };
}

async function load(request: WorkerRequest): Promise<Arrival> {
  const assets = await loadSectorAssets(request, platform);
  const { tile, grid } = request;
  const geometry = groundGeometry(tile, grid, assets.heights);
  const banks = fogBanks(tileWater(tile, grid, assets.heights));
  return { assets, geometry, plans: plansOf(request, assets), banks };
}

const planBuffers = (plan: TownPlan) => Object.values(plan.batches).map((data) => data.buffer);

const transferred = ({ assets, geometry, plans }: Arrival): Transferable[] => [
  assets.heights.buffer, assets.albedo, geometry.positions.buffer, geometry.normals.buffer,
  geometry.uvs.buffer, geometry.indices.buffer, ...planBuffers(plans.near),
  ...planBuffers(plans.far)];

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerReply, transfer: Transferable[]): void;
};

scope.onmessage = (event) => {
  const request = event.data;
  load(request).then(
    (arrival) => scope.postMessage({ kind: 'loaded', arrival }, transferred(arrival)),
    (error: unknown) => scope.postMessage({ kind: 'failed', index: request.index,
      message: error instanceof Error ? error.message : String(error) }, []),
  );
};
