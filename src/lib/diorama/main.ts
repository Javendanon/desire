// Entry of the diorama review page: loads the slice exported by tools/assets and mounts the
// scene. The slice lives under ignored outputs/ (derived from the source map, not redistributed).
// `?stress=5x4` repeats it over a city-sized area for performance work (stress-slice.ts),
// `?quality=high|medium|low` picks a preset (quality.ts), `?hud` shows frame times and
// `?sectors=<dir>` reads houses, berths and trees from sector payloads (sector-slice.ts).
// `?city=<dir>` streams the whole map instead (city.ts) from `<dir>/sectors` and `<dir>/ground`,
// looking first at `?at=<x>,<z>` map metres.

import { createCity, type MapPoint } from './city.ts';
import { mountHud } from './hud.ts';
import { parseQuality } from './quality.ts';
import { createDiorama, type Diorama, type DioramaOptions } from './scene.ts';
import { loadSlice, withSectorFeatures } from './slice-data.ts';
import { parseStress, tileSlice } from './stress-slice.ts';

declare global {
  interface Window {
    diorama?: Diorama;
    dioramaError?: string;
    dioramaReady?: boolean;
  }
}

const DEFAULT_SLICE = '/outputs/waterdeep-layers/slice-dock';
/** Design canvas faces: IM Fell English for display, Alegreya Sans and its small caps for UI. */
const FONT_FAMILIES = [
  'Alegreya+Sans+SC:wght@500;700',
  'Alegreya+Sans:wght@400;500',
  'IM+Fell+English:ital@0;1',
];

function loadFonts() {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  const families = FONT_FAMILIES.map((family) => `family=${family}`).join('&');
  link.href = `https://fonts.googleapis.com/css2?${families}&display=swap`;
  document.head.append(link);
}

/** `x,z` in map metres, or nothing when absent or malformed. */
function parseFocus(text: string | null): MapPoint | undefined {
  const [x_m, z_m] = (text ?? '').split(',').map(Number);
  return Number.isFinite(x_m) && Number.isFinite(z_m) ? { x_m, z_m } : undefined;
}

async function mountSlice(canvas: HTMLCanvasElement, params: URLSearchParams,
  options: DioramaOptions): Promise<Diorama> {
  const own = await loadSlice(params.get('slice') ?? DEFAULT_SLICE);
  const sectors = params.get('sectors');
  const slice = sectors ? await withSectorFeatures(own, sectors) : own;
  const grid = parseStress(params.get('stress')) ?? { columns: 1, rows: 1 };
  return createDiorama(canvas, tileSlice(slice, grid), options);
}

async function start() {
  loadFonts();
  const params = new URLSearchParams(location.search);
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  try {
    const backend = params.get('backend') === 'webgl2' ? 'webgl2' : 'auto';
    const quality = parseQuality(params.get('quality'));
    const city = params.get('city');
    const focus = parseFocus(params.get('at'));
    window.diorama = city
      ? await createCity(canvas, { base: city, focus, options: { backend, quality } })
      : await mountSlice(canvas, params, { backend, quality });
    if (params.has('hud')) mountHud(document.getElementById('hud')!, window.diorama.app, quality);
  } catch (error) {
    window.dioramaError = error instanceof Error ? error.message : String(error);
    document.getElementById('status')!.textContent = window.dioramaError;
  } finally {
    window.dioramaReady = true;
  }
}

void start();
