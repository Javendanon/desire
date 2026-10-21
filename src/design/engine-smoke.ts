// Lifecycle check for the viewer (D11): mount and destroy it several times on a real GPU and
// prove each one rendered, stopped on destroy and left no live viewer behind.
// Query: ?backend=webgl2 forces WebGL 2; ?cycles=N (default 5). Result in window.__smoke.

import { createViewer, liveViewerCount, type PieceSpec } from '../lib/engine/viewer.ts';

interface CycleResult {
  backend: string;
  rendered: boolean;
  stoppedOnDestroy: boolean;
}

const params = new URLSearchParams(location.search);
const backend = params.get('backend') === 'webgl2' ? 'webgl2' : 'auto';
const cycles = Number(params.get('cycles') ?? 5);
const PIECES: PieceSpec[] = [
  { id: 'a', side: 'ally', look: 'ranger', fallen: false, at: { x: -3, z: 1 } },
  { id: 'b', side: 'enemy', look: 'crab', fallen: true, at: { x: 3, z: -1 } },
];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function cycle(): Promise<CycleResult> {
  const canvas = document.createElement('canvas');
  canvas.style.width = '480px';
  canvas.style.height = '320px';
  document.body.append(canvas);
  const viewer = await createViewer(canvas, { backend, quality: 'low', reducedMotion: true });
  viewer.setPieces(PIECES);
  viewer.setLevel(2);
  await wait(400);
  const used = viewer.backend;
  const rendered = viewer.stats().frames > 0;
  viewer.destroy();
  const atDestroy = viewer.stats().frames;
  await wait(300);
  const stoppedOnDestroy = viewer.stats().frames === atDestroy;
  canvas.remove();
  return { backend: used, rendered, stoppedOnDestroy };
}

async function run(): Promise<void> {
  const results: CycleResult[] = [];
  try {
    for (let i = 0; i < cycles; i++) results.push(await cycle());
    const ok = results.every((r) => r.rendered && r.stoppedOnDestroy) && liveViewerCount() === 0;
    Object.assign(window, { __smoke: { done: true, ok, live: liveViewerCount(), results } });
  } catch (error) {
    Object.assign(window, { __smoke: { done: true, ok: false, error: String(error), results } });
  }
  const status = document.getElementById('status');
  if (status)
    status.textContent = JSON.stringify((window as unknown as { __smoke: unknown }).__smoke);
}

void run();
