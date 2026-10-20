// Main-thread client for the dedicated routing worker. An in-flight request is
// cancelled by terminating its worker; an idle worker is reused.

import {
  isCurrentResult,
  isGrid,
  isPoint,
  isPositiveU32,
  isRouteResponse,
  MAX_GRID_CELLS,
  type RouteEndpoints,
  type RouteIdentity,
  type RouteResponse,
  type RoutingGrid,
} from './protocol.ts';

type MessageListener = (event: { data: unknown }) => void;
type ErrorListener = (event: { message: string }) => void;

export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  addEventListener(type: 'message', listener: MessageListener): void;
  addEventListener(type: 'error', listener: ErrorListener): void;
}

export interface RouteFailure extends RouteIdentity {
  message: string;
}

export type WorkerFactory = () => WorkerLike;
export type ResultHandler = (result: RouteResponse) => void;
export type FailureHandler = (failure: RouteFailure) => void;

/** Vite bundles this worker entry; call it from the main thread. */
export function spawnRoutingWorker(): WorkerLike {
  return new Worker(new URL('./routing.worker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as WorkerLike;
}

function assertGrid(grid: RoutingGrid): void {
  if (!isGrid(grid)) {
    throw new TypeError(
      `routing grid requires positive u32 dimensions, matching Uint32Array costs, ` +
      `and at most ${MAX_GRID_CELLS} cells`,
    );
  }
}

function assertEndpoints(endpoints: RouteEndpoints): void {
  if (!isPoint(endpoints.start) || !isPoint(endpoints.goal)) {
    throw new TypeError('routing endpoints must have u32 x and y coordinates');
  }
}

export class RoutingWorkerClient {
  private readonly createWorker: WorkerFactory;
  private readonly onResult: ResultHandler;
  private readonly onFailure: FailureHandler;
  private worker: WorkerLike | null = null;
  private current: RouteIdentity | null = null;
  private nextRequestId = 1;

  constructor(createWorker: WorkerFactory, onResult: ResultHandler, onFailure: FailureHandler) {
    this.createWorker = createWorker;
    this.onResult = onResult;
    this.onFailure = onFailure;
  }

  /** Cancels in-flight work and starts (or reuses) a worker for this request. */
  request(revision: number, grid: RoutingGrid, endpoints: RouteEndpoints): number {
    assertGrid(grid);
    assertEndpoints(endpoints);
    if (!isPositiveU32(revision)) {
      throw new TypeError(`routing revision must be a positive u32, got ${revision}`);
    }
    if (!isPositiveU32(this.nextRequestId)) {
      throw new RangeError('routing request IDs exhausted; create a new client');
    }
    if (this.current !== null) this.cancel();
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    const worker = this.ensureWorker();
    this.current = { requestId, revision };
    try {
      const costs = grid.costs.slice();
      const request = {
        requestId,
        revision,
        grid: { width: grid.width, height: grid.height, costs },
        start: { x: endpoints.start.x, y: endpoints.start.y },
        goal: { x: endpoints.goal.x, y: endpoints.goal.y },
      };
      worker.postMessage({ kind: 'route', request }, [costs.buffer as ArrayBuffer]);
    } catch (error) {
      this.cancel();
      throw error;
    }
    return requestId;
  }

  cancel(): void {
    this.worker?.terminate();
    this.worker = null;
    this.current = null;
  }

  private ensureWorker(): WorkerLike {
    if (this.worker !== null) return this.worker;
    const worker = this.createWorker();
    worker.addEventListener('message', (event) => this.handleMessage(worker, event.data));
    worker.addEventListener('error', (event) => this.handleFailure(worker, event.message));
    this.worker = worker;
    return worker;
  }

  dispose(): void {
    this.cancel();
  }

  private handleMessage(worker: WorkerLike, data: unknown): void {
    if (worker !== this.worker || this.current === null) return;
    if (!isRouteResponse(data)) {
      const current = this.current;
      this.cancel();
      this.onFailure({ ...current, message: 'routing worker sent an invalid response' });
      return;
    }
    if (!isCurrentResult(data, this.current)) return;
    this.current = null;
    this.onResult(data);
  }

  private handleFailure(worker: WorkerLike, message: string): void {
    if (worker !== this.worker || this.current === null) return;
    const current = this.current;
    this.cancel();
    this.onFailure({ ...current, message: `routing worker failed: ${message}` });
  }
}
