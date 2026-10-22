// What one city sector needs from the server: its render payload (when it holds any feature),
// its ground heights and its albedo. Fetching and image decoding are injected, so the Worker
// passes the platform's and the tests pass fakes.

import { readSector, type Sector } from '../map/sector-format.ts';

export interface SectorRequest {
  /** Directory holding `sectors/` and `ground/`. */
  base: string;
  index: number;
  /** Whether `index.json` lists a payload for the sector (open sea has none). */
  hasSector: boolean;
}

export interface SectorAssets<Image> {
  index: number;
  sector: Sector | null;
  /** Vertex heights in centimetres (`desire.ground-tiles/1`). */
  heights: Int16Array;
  albedo: Image;
}

export interface Platform<Image> {
  fetcher: (url: string) => Promise<Response>;
  decode: (blob: Blob) => Promise<Image>;
  /** Frees a decoded image nobody will use (an ImageBitmap holds memory until closed). */
  discard?: (image: Image) => void;
}

async function fetched<Image>(platform: Platform<Image>, url: string): Promise<Response> {
  const response = await platform.fetcher(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response;
}

/** The value of a settled load, or its error thrown. */
function valueOf<T>(result: PromiseSettledResult<T>): T {
  if (result.status === 'rejected') throw result.reason;
  return result.value;
}

/**
 * Loads the three files in parallel. Rejects naming the first file that fails, after freeing an
 * albedo that was already decoded.
 */
export async function loadSectorAssets<Image>(
  request: SectorRequest,
  platform: Platform<Image>,
): Promise<SectorAssets<Image>> {
  const { base, index } = request;
  const bytes = (url: string) => fetched(platform, url).then((r) => r.arrayBuffer());
  const results = await Promise.allSettled([
    request.hasSector
      ? bytes(`${base}/sectors/${index}.render.bin`).then((b) => readSector(new Uint8Array(b)))
      : null,
    bytes(`${base}/ground/${index}.heights.bin`).then((b) => new Int16Array(b)),
    fetched(platform, `${base}/ground/${index}.jpg`).then((r) => r.blob()).then(platform.decode),
  ]);
  const [, , decoded] = results;
  if (decoded.status === 'fulfilled' && results.some(({ status }) => status === 'rejected')) {
    platform.discard?.(decoded.value);
  }
  return { index, sector: valueOf(results[0]), heights: valueOf(results[1]),
    albedo: valueOf(decoded) };
}
