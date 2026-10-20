// Real-browser routing checks and measurements, isolated from the application UI.

import { RoutingWorkerClient, spawnRoutingWorker } from '../../src/lib/routing/worker-client.ts';
import type { RouteResponse, RoutingGrid } from '../../src/lib/routing/protocol.ts';
import { referenceRouteCost, REFERENCE_GRID } from './reference.ts';

const clock = () => performance.timeOrigin + performance.now();
const ENDPOINTS = { start: { x: 0, y: 0 }, goal: { x: 63, y: 63 } };
const GRID = { width: 64, height: 64, costs: new Uint32Array(64 * 64).fill(1) };
let pending = false;
let interactions = 0;
let frames = 0;
let maxFrameGapMs = 0;
let lastFrame = 0;

document.querySelector('button')!.addEventListener('click', (event) => {
  if (pending && event.isTrusted) interactions += 1;
});
function frame(now: number): void {
  if (pending) {
    frames += 1;
    if (lastFrame) maxFrameGapMs = Math.max(maxFrameGapMs, now - lastFrame);
    lastFrame = now;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function once(worker: Worker): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('worker response timed out')), 30_000);
    worker.addEventListener('message', (event) => {
      clearTimeout(timeout);
      resolve(event.data);
    }, { once: true });
    worker.addEventListener('error', (event) => reject(new Error(event.message)), { once: true });
  });
}

async function probeRoute(worker: Worker, requestId: number, grid = GRID, extra = {}) {
  const response = once(worker);
  const costs = grid.costs.slice();
  const request = { requestId, revision: 1, grid: { ...grid, costs }, ...ENDPOINTS, ...extra };
  const sentAt = clock();
  worker.postMessage({ kind: 'route', request, sentAt }, [costs.buffer]);
  check(costs.byteLength === 0, 'input buffer was not transferred');
  const result = await response;
  result.probe.outboundMs = clock() - result.probe.sentAt;
  return result;
}

async function checkProbe() {
  const start = performance.now();
  const worker = new Worker(new URL('./probe.worker.ts', import.meta.url), { type: 'module' });
  try {
    const ready = await once(worker);
    const startupMs = performance.now() - start;
    const results = [];
    for (let index = 1; index <= 20; index += 1) {
      const result = await probeRoute(worker, index);
      check(result.status === 'ok' && result.cost === 126, 'probe route cost mismatch');
      results.push(result.probe);
    }
    check(results.at(-1).outcomesFreed === 20, 'RouteOutcome leaked across idle-worker reuse');
    check(results.at(-1).memoryBytes === results[1].memoryBytes, 'Wasm memory grew after warmup');
    const invalid = await probeRoute(worker, 21, GRID, { start: { x: 2 ** 32, y: 0 } });
    check(invalid.status === 'error' && invalid.probe.plans === 20, 'wrapped coordinate entered Wasm');
    const oversized = { width: 4096, height: 4096, costs: new Uint32Array(4096 * 4096) };
    const rejected = await probeRoute(worker, 22, oversized);
    check(rejected.status === 'error' && rejected.probe.plans === 20, 'oversized grid entered Wasm');
    const blocked = { ...GRID, costs: new Uint32Array(64 * 64).fill(0xffff_ffff) };
    const failed = await probeRoute(worker, 23, blocked);
    check(failed.status === 'error' && failed.probe.outcomesFreed === 21, 'error outcome leaked');
    return { startupMs, ...ready, samples: results, invalidInput: 'rejected before Wasm' };
  } finally {
    worker.terminate();
  }
}

function clientSession() {
  let resolve: (value: RouteResponse) => void;
  let reject: (reason: Error) => void;
  const client = new RoutingWorkerClient(spawnRoutingWorker,
    (result) => resolve(result), (error) => reject(new Error(error.message)));
  return {
    client,
    route(grid: RoutingGrid, revision = 1) {
      const goal = { x: grid.width - 1, y: grid.height - 1 };
      return new Promise<RouteResponse>((done, fail) => {
        resolve = done;
        reject = fail;
        client.request(revision, grid, { start: { x: 0, y: 0 }, goal });
      });
    },
  };
}

async function compareReference() {
  const session = clientSession();
  try {
    const samples = [];
    for (let index = 0; index < 6; index += 1) {
      const start = performance.now();
      const result = await session.route(GRID);
      const workerE2eMs = performance.now() - start;
      const tsStart = performance.now();
      const cost = referenceRouteCost(GRID);
      const referenceMs = performance.now() - tsStart;
      check(result.status === 'ok' && result.cost === cost, 'browser reference cost mismatch');
      samples.push({ workerE2eMs, referenceMs, cost });
    }
    const fixture = await session.route(REFERENCE_GRID);
    check(fixture.cost === referenceRouteCost(REFERENCE_GRID), 'weighted/obstacle/zero fixture mismatch');
    return samples;
  } finally {
    session.client.dispose();
  }
}

async function checkInteraction() {
  const session = clientSession();
  const grid = { width: 1024, height: 1024, costs: new Uint32Array(1024 * 1024) };
  try {
    await session.route(GRID); // Warm the actual, uninstrumented production worker.
    pending = true;
    document.querySelector('output')!.textContent = 'pending';
    const start = performance.now();
    const obsolete = session.route(grid, 1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const result = await session.route(grid, 2); // Terminates the obsolete search.
    void obsolete; // Its callback is intentionally superseded, never accepted.
    const elapsedMs = performance.now() - start;
    pending = false;
    check(result.status === 'ok' && result.revision === 2 && result.cost === 0,
      'obsolete response accepted or large route failed');
    check(interactions > 0 && frames > 0, 'UI did not respond while routing was pending');
    return { elapsedMs, interactions, frames, maxFrameGapMs, revision: result.revision };
  } finally {
    pending = false;
    session.client.dispose();
  }
}

export async function runBrowserChecks() {
  const comparison = await compareReference();
  const probe = await checkProbe();
  const interaction = await checkInteraction();
  return { userAgent: navigator.userAgent, comparison, probe, interaction };
}
