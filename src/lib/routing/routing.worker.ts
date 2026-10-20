// Dedicated Web Worker. The main thread cancels work by terminating this
// worker, because the synchronous Wasm search blocks this message loop.

// @ts-ignore -- emitted by `pnpm build:wasm`; absent until that step runs.
import * as wasm from '../../generated/wasm/desire_wasm.js';
import { errorResponse, failureResponse, outcomeResponse } from './outcome.ts';
import {
  isRouteMessage,
  recoverIdentity,
  type RouteIdentity,
  type RouteResponse,
  type RoutingRequest,
} from './protocol.ts';

interface WorkerScope {
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

const scope = globalThis as unknown as WorkerScope;
let wasmReady: Promise<void> | null = null;

function loadWasm(): Promise<void> {
  wasmReady ??= Promise.resolve(wasm.default()).then(() => undefined);
  return wasmReady;
}

function identityOf(request: RoutingRequest): RouteIdentity {
  return { requestId: request.requestId, revision: request.revision };
}

function route(request: RoutingRequest): RouteResponse {
  const grid = new wasm.RoutingGrid(request.grid.width, request.grid.height, request.grid.costs);
  const identity = new wasm.RouteIdentity(request.requestId, request.revision);
  const start = new wasm.GridPoint(request.start.x, request.start.y);
  const goal = new wasm.GridPoint(request.goal.x, request.goal.y);
  const span = new wasm.RouteSpan(start, goal);
  let outcome: wasm.RouteOutcome | undefined;
  try {
    outcome = grid.plan(identity, span);
    return outcomeResponse(identityOf(request), outcome);
  } finally {
    outcome?.free();
    span.free();
    start.free();
    goal.free();
    identity.free();
    grid.free();
  }
}

function reject(data: unknown): void {
  const detail = 'routing worker rejected an invalid request';
  const identity = recoverIdentity(data);
  if (identity === null) {
    console.error(`${detail}: no request identity to report`);
    return;
  }
  scope.postMessage(errorResponse(identity, detail));
}

async function handleMessage(data: unknown): Promise<void> {
  if (!isRouteMessage(data)) {
    reject(data);
    return;
  }
  try {
    await loadWasm();
    scope.postMessage(route(data.request));
  } catch (error) {
    scope.postMessage(failureResponse(identityOf(data.request), error));
  }
}

scope.addEventListener('message', (event) => {
  void handleMessage(event.data);
});
