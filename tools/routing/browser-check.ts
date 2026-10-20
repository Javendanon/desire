// Real-browser routing checks and measurements, isolated from the application UI.

import { RoutingWorkerClient, spawnRoutingWorker } from '../../src/lib/routing/worker-client.ts';
import type { RouteResponse, RoutingGrid, RoutingRequest } from '../../src/lib/routing/protocol.ts';
import { referenceRouteCost, REFERENCE_GRID } from './reference.ts';

interface ProbeStats {
  inboundMs: number;
  computeMs: number;
  workerMs: number;
  sentAt: number;
  memoryBytes: number;
  plans: number;
  outcomesFreed: number;
  inputCopies: number;
  wasmFetches: number;
  outboundMs: number;
  mainCopyMs: number;
}
interface ProbedResponse extends RouteResponse { probe: ProbeStats }
interface Ready { ready: boolean; wasmLoadMs: number; bootMs: number }

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

function once<T>(worker: Worker): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('worker response timed out')), 30_000);
    worker.addEventListener('message', (event) => {
      clearTimeout(timeout);
      resolve(event.data);
    }, { once: true });
    worker.addEventListener('error', (event) => reject(new Error(event.message)), { once: true });
  });
}

async function probeRoute(
  worker: Worker, requestId: number,
  overrides: Partial<Pick<RoutingRequest, 'grid' | 'start' | 'goal' | 'revision'>> = {},
) {
  const { grid = GRID, ...extra } = overrides;
  const response = once<ProbedResponse>(worker);
  const copyStart = performance.now();
  const costs = grid.costs.slice();
  const mainCopyMs = performance.now() - copyStart;
  const request = { requestId, revision: 1, grid: { ...grid, costs }, ...ENDPOINTS, ...extra };
  const sentAt = clock();
  worker.postMessage({ kind: 'route', request, sentAt }, [costs.buffer]);
  check(costs.byteLength === 0, 'input buffer was not transferred');
  const result = await response;
  result.probe.outboundMs = clock() - result.probe.sentAt;
  result.probe.mainCopyMs = mainCopyMs;
  return result;
}

async function checkColdBoundary(): Promise<string> {
  const worker = new Worker(new URL('./probe.worker.ts', import.meta.url), {
    type: 'module', name: 'cold-validation',
  });
  try {
    await once<Ready>(worker);
    const invalid = await probeRoute(worker, 1, { revision: 2 ** 32 });
    const grid = { width: 4096, height: 4096, costs: new Uint32Array(4096 * 4096) };
    const oversized = await probeRoute(worker, 2, { grid });
    for (const result of [invalid, oversized]) {
      check(result.status === 'error', 'cold invalid request did not fail');
      check(result.probe.wasmFetches === 0, 'invalid request loaded Wasm');
      check(result.probe.plans === 0, 'invalid request entered Wasm');
    }
    return 'invalid revision and oversized grid rejected before Wasm fetch';
  } finally {
    worker.terminate();
  }
}

async function checkProbe() {
  const start = performance.now();
  const worker = new Worker(new URL('./probe.worker.ts', import.meta.url), { type: 'module' });
  try {
    const ready = await once<Ready>(worker);
    const startupMs = performance.now() - start;
    const results = [];
    for (let index = 1; index <= 20; index += 1) {
      const result = await probeRoute(worker, index);
      check(result.status === 'ok' && result.cost === 126, 'probe route cost mismatch');
      results.push(result.probe);
    }
    check(results[0].wasmFetches > 0, 'probe missed Wasm resource timing');
    check(results.at(-1)!.outcomesFreed === 20, 'RouteOutcome leaked across idle-worker reuse');
    check(results.at(-1)!.memoryBytes === results[1].memoryBytes, 'Wasm memory grew after warmup');
    const large = await checkWorkerBoundaries(worker);
    return { startupMs, ...ready, samples: results, large, invalidInput: 'rejected before Wasm' };
  } finally {
    worker.terminate();
  }
}

async function checkWorkerBoundaries(worker: Worker): Promise<ProbeStats> {
  const invalid = await probeRoute(worker, 21, { start: { x: 2 ** 32, y: 0 } });
  check(invalid.status === 'error' && invalid.probe.plans === 20, 'coordinate wrapped into Wasm');
  const grid = { width: 4096, height: 4096, costs: new Uint32Array(4096 * 4096) };
  const rejected = await probeRoute(worker, 22, { grid });
  check(rejected.status === 'error' && rejected.probe.plans === 20, 'oversized grid entered Wasm');
  check(rejected.probe.memoryBytes === invalid.probe.memoryBytes, 'invalid input grew Wasm memory');
  check(invalid.probe.inputCopies === 20 && rejected.probe.inputCopies === 20,
    'invalid request copied input into Wasm before rejection');
  const blocked = { ...GRID, costs: new Uint32Array(64 * 64).fill(0xffff_ffff) };
  const failed = await probeRoute(worker, 23, { grid: blocked });
  check(failed.status === 'error' && failed.probe.outcomesFreed === 21, 'error outcome leaked');
  const largeGrid = { width: 1024, height: 1024, costs: new Uint32Array(1024 * 1024) };
  const large = await probeRoute(worker, 24, { grid: largeGrid, goal: { x: 1023, y: 1023 } });
  check(large.status === 'ok' && large.cost === 0, 'large probe route failed');
  for (let id = 25; id < 44; id += 1) {
    const repeated = await probeRoute(worker, id, { grid: largeGrid, goal: { x: 1023, y: 1023 } });
    check(repeated.probe.memoryBytes === large.probe.memoryBytes, 'grid reuse grew Wasm memory');
    check(repeated.probe.outcomesFreed === id - 2, 'max-grid outcome leaked');
  }
  return large.probe;
}

function clientSession() {
  let resolve: (value: RouteResponse) => void;
  let reject: (reason: Error) => void;
  const results: RouteResponse[] = [];
  const client = new RoutingWorkerClient(spawnRoutingWorker,
    (result) => {
      results.push(result);
      resolve(result);
    },
    (error) => reject(new Error(error.message)));
  return {
    client, results,
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
    check(fixture.cost === referenceRouteCost(REFERENCE_GRID), 'fixture cost mismatch');
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
    void session.route(grid, 1);
    // Replace synchronously: no machine-speed assumption about search duration.
    const result = await session.route(grid, 2);
    const elapsedMs = performance.now() - start;
    pending = false;
    check(result.status === 'ok' && result.revision === 2 && result.cost === 0,
      'obsolete response accepted or large route failed');
    check(session.results.length === 2, 'cancelled search delivered an obsolete result');
    check(interactions > 0 && frames > 0, 'UI did not respond while routing was pending');
    return { elapsedMs, interactions, frames, maxFrameGapMs, revision: result.revision };
  } finally {
    pending = false;
    session.client.dispose();
  }
}

export async function runBrowserChecks() {
  const coldValidation = await checkColdBoundary();
  const comparison = await compareReference();
  const probe = await checkProbe();
  const interaction = await checkInteraction();
  return { userAgent: navigator.userAgent, coldValidation, comparison, probe, interaction };
}
