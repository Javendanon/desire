import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isCurrentResult,
  isRouteMessage,
  isRouteResponse,
  recoverIdentity,
  type GridPoint,
  type RouteResponse,
  type RoutingGrid,
} from '../src/lib/routing/protocol.ts';
import {
  RoutingWorkerClient,
  type RouteFailure,
  type WorkerLike,
} from '../src/lib/routing/worker-client.ts';
import {
  errorResponse,
  failureResponse,
  outcomeResponse,
} from '../src/lib/routing/outcome.ts';

const GRID: RoutingGrid = {
  width: 2,
  height: 2,
  costs: Uint32Array.from([1, 1, 1, 1]),
};
const START: GridPoint = { x: 0, y: 0 };
const GOAL: GridPoint = { x: 1, y: 1 };
const ENDPOINTS = { start: START, goal: GOAL };

type Listener = (event: unknown) => void;

class FakeWorker implements WorkerLike {
  readonly sent: { message: unknown; transfers: Transferable[] }[] = [];
  terminated = false;
  throwOnPost = false;
  addListenerCalls = 0;
  private readonly listeners = new Map<string, Listener[]>();

  postMessage(message: unknown, transfer: Transferable[] = []): void {
    if (this.throwOnPost) throw new Error('clone failed');
    this.sent.push({ message, transfers: transfer });
  }

  terminate(): void {
    this.terminated = true;
  }

  addEventListener(type: string, listener: Listener): void {
    this.addListenerCalls += 1;
    const current = this.listeners.get(type) ?? [];
    current.push(listener);
    this.listeners.set(type, current);
  }

  emit(type: string, event: { data: RouteResponse } | { message: string }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function response(requestId: number, revision: number): RouteResponse {
  return { requestId, revision, status: 'ok', cost: 2, path: [0, 0, 1, 0, 1, 1] };
}

function setup() {
  const workers: FakeWorker[] = [];
  const results: RouteResponse[] = [];
  const errors: RouteFailure[] = [];
  const client = new RoutingWorkerClient(
    () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
    (result) => results.push(result),
    (failure) => errors.push(failure),
  );
  return { client, workers, results, errors };
}

test('sends grid costs as a copied transferable buffer', () => {
  const { client, workers } = setup();
  const costs = Uint32Array.from([1, 1, 1, 1]);
  const gridWithExtra = { ...GRID, costs, extra: () => 1 } as RoutingGrid;
  const requestId = client.request(3, gridWithExtra, ENDPOINTS);
  const sent = workers[0].sent[0];
  const request = (sent.message as { request: { grid: RoutingGrid } }).request;

  assert.equal(requestId, 1);
  assert.equal(sent.transfers.length, 1);
  assert.deepEqual(Object.keys(request.grid).sort(), ['costs', 'height', 'width']);
  assert.notEqual(request.grid.costs.buffer, costs.buffer, 'caller buffer must stay usable');
  assert.deepEqual(Array.from(costs), [1, 1, 1, 1]);
});

test('discards a stale result after a newer request', () => {
  const { client, workers, results } = setup();
  const first = client.request(1, GRID, ENDPOINTS);
  const firstWorker = workers[0];
  const second = client.request(2, GRID, ENDPOINTS);

  assert.equal(firstWorker.terminated, true, 'new request cancels in-flight work');
  firstWorker.emit('message', { data: response(first, 1) });
  assert.equal(results.length, 0, 'stale worker result is ignored');

  workers[1].emit('message', { data: response(second, 2) });
  assert.equal(results.length, 1);
  assert.equal(results[0].requestId, second);
});

test('cancel terminates the worker and drops its result', () => {
  const { client, workers, results } = setup();
  const requestId = client.request(1, GRID, ENDPOINTS);
  client.cancel();

  assert.equal(workers[0].terminated, true);
  workers[0].emit('message', { data: response(requestId, 1) });
  assert.equal(results.length, 0);
});

test('ignores duplicate and mismatched identity results', () => {
  assert.equal(
    isCurrentResult({ requestId: 1, revision: 1 }, { requestId: 1, revision: 1 }),
    true,
  );
  assert.equal(
    isCurrentResult({ requestId: 1, revision: 1 }, { requestId: 2, revision: 1 }),
    false,
  );
  assert.equal(
    isCurrentResult({ requestId: 1, revision: 1 }, { requestId: 1, revision: 2 }),
    false,
  );
  assert.equal(isCurrentResult({ requestId: 1, revision: 1 }, null), false);

  const { client, workers, results } = setup();
  const requestId = client.request(1, GRID, ENDPOINTS);
  workers[0].emit('message', { data: response(requestId, 1) });
  workers[0].emit('message', { data: response(requestId, 1) });
  assert.equal(results.length, 1, 'a duplicate response is not emitted twice');
});

test('rejects malformed worker messages and responses', () => {
  assert.equal(isRouteMessage(null), false);
  assert.equal(isRouteMessage({ kind: 'route', request: { grid: {} } }), false);
  assert.equal(isRouteResponse({ requestId: 1, revision: 1, status: 'ok', cost: 1 }), false);
  assert.equal(
    isRouteResponse({ requestId: 1, revision: 1, status: 'ok', cost: 1, path: [] }),
    true,
  );
  assert.equal(
    isRouteResponse({ requestId: 1, revision: 1, status: 'ok', cost: 1, path: [0] }),
    false,
  );
  assert.equal(
    isRouteResponse({ requestId: 1, revision: 1, status: 'ok', cost: Number.NaN, path: [] }),
    false,
  );
  assert.equal(
    isRouteResponse({
      requestId: 1,
      revision: 1,
      status: 'error',
      cost: 1,
      path: [0, 0],
      error: 'fail',
    }),
    false,
  );
  assert.equal(
    isRouteResponse({ requestId: 1, revision: 1, status: 'ok', cost: 1, path: [], error: 'x' }),
    false,
  );
  assert.deepEqual(
    recoverIdentity({ request: { requestId: 3, revision: 4 } }),
    { requestId: 3, revision: 4 },
  );
  assert.equal(recoverIdentity({ request: { requestId: '3', revision: 4 } }), null);
});

test('reuses an idle worker without duplicating listeners', () => {
  const { client, workers, results } = setup();
  const first = client.request(1, GRID, ENDPOINTS);
  workers[0].emit('message', { data: response(first, 1) });
  assert.equal(workers[0].terminated, false);

  const second = client.request(2, GRID, ENDPOINTS);
  assert.equal(workers.length, 1, 'idle worker is reused');
  assert.equal(workers[0].addListenerCalls, 2, 'message and error listeners added once');
  workers[0].emit('message', { data: response(second, 2) });
  assert.equal(results.length, 2, 'one listener handles each response once');
});

test('cancels and rethrows when postMessage cannot clone the request', () => {
  const workers: FakeWorker[] = [];
  const failures: RouteFailure[] = [];
  const client = new RoutingWorkerClient(
    () => {
      const worker = new FakeWorker();
      worker.throwOnPost = true;
      workers.push(worker);
      return worker;
    },
    () => undefined,
    (failure) => failures.push(failure),
  );
  assert.throws(() => client.request(1, GRID, ENDPOINTS), /clone failed/);
  assert.equal(workers[0].terminated, true);
  assert.equal(failures.length, 0);
});

test('reports worker failures with context', () => {
  const { client, workers, errors } = setup();
  client.request(1, GRID, ENDPOINTS);
  workers[0].emit('error', { message: 'wasm load failed' });
  assert.deepEqual(errors, [
    { requestId: 1, revision: 1, message: 'routing worker failed: wasm load failed' },
  ]);
});

test('rejects an invalid grid before starting a worker', () => {
  const { client, workers } = setup();
  assert.throws(
    () =>
      client.request(
        1,
        { width: 2, height: 2, costs: [] as unknown as Uint32Array },
        ENDPOINTS,
      ),
    /Uint32Array/,
  );
  assert.equal(workers.length, 0);
});

test('rejects values that would narrow or wrap at the Wasm u32 boundary', () => {
  const { client, workers } = setup();
  const invalid = [-1, 0x1_0000_0000, Number.MAX_SAFE_INTEGER, 0.5, NaN, Infinity];
  for (const value of invalid) {
    assert.throws(() => client.request(1, GRID, { ...ENDPOINTS, start: { x: value, y: 0 } }));
    assert.throws(() => client.request(value, GRID, ENDPOINTS));
    const request = { requestId: 1, revision: 1, grid: GRID, ...ENDPOINTS };
    assert.equal(isRouteMessage({ kind: 'route', request: { ...request, revision: value } }), false);
    assert.equal(isRouteMessage({ kind: 'route', request: { ...request, requestId: value } }), false);
    assert.equal(isRouteMessage({
      kind: 'route', request: { ...request, goal: { x: 0, y: value } },
    }), false);
  }
  assert.throws(() => client.request(0, GRID, ENDPOINTS));
  assert.equal(workers.length, 0, 'invalid inputs never start or transfer to a worker');
  client.request(0xffff_ffff, GRID, ENDPOINTS);
  assert.equal(workers.length, 1, 'maximum u32 revision is valid');
});

test('maps Wasm outcomes to explicit worker responses', () => {
  const identity = { requestId: 3, revision: 4 };
  const ok = {
    is_ok: () => true,
    cost: () => 5,
    path: () => Uint32Array.from([0, 0, 1, 1]),
    error_message: () => '',
  };
  assert.deepEqual(outcomeResponse(identity, ok), {
    ...identity,
    status: 'ok',
    cost: 5,
    path: [0, 0, 1, 1],
  });

  const failed = {
    is_ok: () => false,
    cost: () => 0,
    path: () => new Uint32Array(),
    error_message: () => 'no route connects the requested cells',
  };
  assert.equal(outcomeResponse(identity, failed).status, 'error');
  assert.equal(errorResponse(identity, 'rejected').error, 'rejected');
  assert.equal(failureResponse(identity, new Error('boom')).error, 'wasm routing failed: boom');
});
