// The city viewer's loader thread: fetches and decodes sector assets so the frame loop never
// waits on the network, JPEG decoding or payload parsing. Replies transfer the height buffer
// and the decoded image instead of copying them.

import { loadSectorAssets, type SectorRequest } from './sector-assets.ts';

export type WorkerReply =
  | { kind: 'loaded', assets: Awaited<ReturnType<typeof load>> }
  | { kind: 'failed', index: number, message: string };

const platform = { fetcher: (url: string) => fetch(url), decode: createImageBitmap };
const load = (request: SectorRequest) => loadSectorAssets(request, platform);

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SectorRequest>) => void) | null;
  postMessage(message: WorkerReply, transfer: Transferable[]): void;
};

scope.onmessage = (event) => {
  const request = event.data;
  load(request).then(
    (assets) => scope.postMessage({ kind: 'loaded', assets },
      [assets.heights.buffer, assets.albedo]),
    (error: unknown) => scope.postMessage({ kind: 'failed', index: request.index,
      message: error instanceof Error ? error.message : String(error) }, []),
  );
};
