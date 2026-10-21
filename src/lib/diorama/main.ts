// Entry of the diorama review page: loads the slice exported by tools/assets and mounts the
// scene. The slice lives under ignored outputs/ (derived from the source map, not redistributed).

import { createDiorama, type Diorama } from './scene.ts';
import { loadSlice } from './slice-data.ts';

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

async function start() {
  loadFonts();
  const params = new URLSearchParams(location.search);
  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  try {
    const slice = await loadSlice(params.get('slice') ?? DEFAULT_SLICE);
    const backend = params.get('backend') === 'webgl2' ? 'webgl2' : 'auto';
    window.diorama = await createDiorama(canvas, slice, { backend });
  } catch (error) {
    window.dioramaError = error instanceof Error ? error.message : String(error);
    document.getElementById('status')!.textContent = window.dioramaError;
  } finally {
    window.dioramaReady = true;
  }
}

void start();
