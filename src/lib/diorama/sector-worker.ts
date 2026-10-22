// The city viewer's loader thread: fetches and decodes sector assets and builds the ground
// tile's mesh, so the frame loop never waits on the network, JPEG decoding, payload parsing or
// mesh arithmetic. Replies transfer the buffers and the decoded image instead of copying them.

import { loadSectorAssets, type SectorAssets, type SectorRequest } from './sector-assets.ts';
import {
  groundGeometry, type GroundGeometry, type GroundGrid, type GroundTile,
} from './sector-streaming.ts';

/** A sector to load, with what its ground mesh is built from. */
export type WorkerRequest = SectorRequest & {
  tile: GroundTile;
  grid: GroundGrid;
};

/** A sector ready for the frame loop to put on stage. */
export interface Arrival {
  assets: SectorAssets<ImageBitmap>;
  geometry: GroundGeometry;
}

export type WorkerReply =
  | { kind: 'loaded', arrival: Arrival }
  | { kind: 'failed', index: number, message: string };

const platform = { fetcher: (url: string) => fetch(url), decode: createImageBitmap };
async function load(request: WorkerRequest): Promise<Arrival> {
  const assets = await loadSectorAssets(request, platform);
  return { assets, geometry: groundGeometry(request.tile, request.grid, assets.heights) };
}

const transferred = ({ assets, geometry }: Arrival): Transferable[] => [assets.heights.buffer,
  assets.albedo, geometry.positions.buffer, geometry.normals.buffer, geometry.uvs.buffer,
  geometry.indices.buffer];

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
