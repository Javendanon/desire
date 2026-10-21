// Test-only instrumentation around the production worker; never used by the UI.
export {};

const boot = performance.now();
const wasm = await import('#routing-wasm');
const loadStart = performance.now();
const cold = self.name === 'cold-validation';
const memory = cold ? undefined : (await wasm.default()).memory;
const wasmLoadMs = performance.now() - loadStart;
let receivedAt = 0;
let inboundMs = 0;
let computeMs = 0;
let outcomesFreed = 0;
let plans = 0;
let inputCopies = 0;
const scope = self as unknown as {
  postMessage(data: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
};
const clock = () => performance.timeOrigin + performance.now();
const post = scope.postMessage.bind(scope);
const plan = wasm.RoutingGrid.prototype.plan;
const free = wasm.RouteOutcome.prototype.free;
const set = Uint32Array.prototype.set;

Uint32Array.prototype.set = function (source, offset) {
  if (memory && this.buffer === memory.buffer) inputCopies += 1;
  return set.call(this, source, offset);
};

wasm.RoutingGrid.prototype.plan = function (...args) {
  const start = performance.now();
  try {
    plans += 1;
    return plan.apply(this, args);
  } finally {
    computeMs = performance.now() - start;
  }
};
wasm.RouteOutcome.prototype.free = function () {
  outcomesFreed += 1;
  return free.call(this);
};
scope.addEventListener('message', (event) => {
  receivedAt = clock();
  inboundMs = receivedAt - event.data.sentAt;
  computeMs = 0;
});
scope.postMessage = (data) => post({
  ...(data as object),
  probe: {
    inboundMs, computeMs, workerMs: clock() - receivedAt,
    sentAt: clock(), memoryBytes: memory?.buffer.byteLength ?? 0,
    plans, outcomesFreed, inputCopies,
    wasmFetches: performance.getEntriesByType('resource')
      .filter((entry) => entry.name.endsWith('.wasm')).length,
  },
});
await import('../../src/lib/routing/routing.worker.ts');
post({ ready: true, wasmLoadMs, bootMs: performance.now() - boot });
