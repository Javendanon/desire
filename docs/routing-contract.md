# Routing worker contract v1 · D12

Status: implemented in `crates/core/src/routing`, `crates/wasm` and
`src/lib/routing`. The production worker and generated Wasm glue pass the
isolated browser checks. See [D12 verification](reports/d12.md) for commands,
measurements and limits. Application travel controls remain D14-owned.

## Purpose and boundary

D12 computes a deterministic four-neighbour path over a non-negative integer
cost grid. The caller owns the map format. This contract does **not** define a
new grid, scene, tile or asset format; it consumes a cost buffer derived from
the map selected by D04/D13 and returns cell coordinates. Camera, renderer, GPU
work and travel authorization remain outside D12.

The pure core is `desire_core::routing`. The Wasm boundary exposes the same
calculation to the dedicated worker. The renderer is not moved to Rust, and a
busy GPU is not fixed by this worker.

## Grid input

- `width`, `height`: positive integers; `width * height <= 1_048_576` cells (4 MiB).
- `costs`: flat row-major `Uint32Array` with exactly `width * height` entries.
- `0xFFFF_FFFF` (`BLOCKED_CELL`) marks an obstacle and is not traversable.
- Every other value, including `0`, is a non-negative traversal cost.
- x grows east/right and y grows south/down. Coordinates are unsigned `u32`
  cell indices. Out-of-grid coordinates produce an explicit bounds error.
  Values outside `0..0xFFFF_FFFF` never enter Wasm.
- Route cost is the sum of destination cell costs. The start cell is not
  charged; a route from a cell to itself costs `0`.
- A total cost above `u32` is an explicit `CostOverflow` error, not a wrap.

The client validates the dimensions, buffer length and cell limit **before**
`slice()` or worker creation. Invalid inputs throw a contextual `TypeError`.
The worker repeats validation before Wasm loading or `RoutingGrid` construction.
Direct invalid messages return an error when their identity is recoverable.
Valid requests copy the caller buffer before transfer, so the caller keeps its
own `Uint32Array`.

## Identity, revision and stale results

TypeScript wire shape:

```ts
interface RoutingRequest {
  requestId: number; // positive u32 assigned by RoutingWorkerClient
  revision: number;  // map version revision from D04, positive u32
  grid: { width: number; height: number; costs: Uint32Array };
  start: { x: number; y: number };
  goal: { x: number; y: number };
}

interface RouteResponse {
  requestId: number;
  revision: number;
  status: 'ok' | 'error';
  cost: number;
  path: number[]; // flat [x0, y0, x1, y1, ...]; empty on error
  error?: string;
}
```

- `requestId` is monotonic per `RoutingWorkerClient` instance, within positive
  `u32`. Identity values outside `1..0xFFFF_FFFF` throw a `RangeError` before
  transfer. After ID exhaustion, create a new client. IDs never wrap.
- `revision` is the map revision that produced the cost buffer.
- A response is current only when both `requestId` and `revision` match the
  latest request. Everything else is discarded without calling the result
  callback.
- A new request terminates an in-flight worker and reuses an idle one.
  `cancel()` always terminates. This is the cancellation mechanism: the
  synchronous Wasm search blocks its own message loop, so a cooperative cancel
  message would not run until the search finished.
- Duplicate responses are ignored. Responses from a terminated worker are
  ignored even if they arrive late.

## Copies and memory bounds

For one request:

1. The client copies `costs` with `slice()` so the caller buffer stays usable.
2. The copied `ArrayBuffer` is transferred to the worker (no structured-clone
   copy of the cost array).
3. `wasm-bindgen` copies the typed array into Wasm memory for the search.
4. The path is copied back out as a `Uint32Array` and converted to a plain
   number array for `postMessage`.
5. The worker frees `RouteOutcome` in `finally` after response extraction,
   including error outcomes. It also frees the grid, span, identity and points.

No Wasm view is retained in JavaScript, so later Wasm memory growth cannot
invalidate a `Uint32Array`. Transfer sizes are bounded by the grid limit and
the path length: at most `4 * cells` input bytes plus `8 * path_points` output
bytes, before JavaScript object overhead.

At the 1,048,576-cell limit the search also allocates about 8.4 MB of `u64`
distances, 4.2 MB of `u32` parents, 1 MB of expanded flags and a frontier heap
whose size depends on duplicate entries. Termination of the worker releases the
Wasm memory. D14 should keep per-cell costs in a practical range (for example
`<= 1000`); the core enforces only non-negative `u32` and the total-cost bound.

## Errors

The Rust core returns typed variants instead of panicking:

`EmptyGrid`, `GridTooLarge`, `BufferLengthMismatch`, `InvalidRevision`,
`StartOutOfBounds`, `GoalOutOfBounds`, `StartBlocked`, `GoalBlocked`, `NoPath`,
`CostOverflow`, `InvalidSearchState`.

`InvalidSearchState` is an internal invariant for corrupt search state, not an
expected client input error. The worker maps the rest to `status: 'error'` with
an English `error` message that keeps the coordinates or buffer sizes. A
malformed request still receives a response when its identity can be recovered;
otherwise it is logged. A malformed response is reported to the client with the
active identity. Unexpected Wasm load/search exceptions are also returned as
explicit errors with the original detail.

## Determinism

The search is A* over four neighbours. The heuristic is Manhattan distance
scaled by the grid's minimum traversable cost, which is admissible for
non-negative costs. Priority ties use estimate, then heuristic, then cell index.
The same grid, endpoints, request ID and revision therefore produce the same
path and cost.

## D14 integration contract

D14 owns travel commands, authorization, narrative time and cancellation
policy. For each routing request D14 must:

1. Take the current D04 map revision and build the cost buffer from the map
   version already selected by D13.
2. Call `RoutingWorkerClient.request(revision, grid, { start, goal })` and keep
   its `requestId`.
3. Treat `RouteResponse.path` as cell indices, not metres. D14 converts cells to
   world positions with the D04 calibration/scene transform and keeps travel
   distance/time separate from route cost.
4. Ignore any response that does not match the active scene, request and map
   revision. On map change, call `cancel()` before issuing a new request.
5. Keep the renderer loop running while the worker runs. Whether to show a
   busy indicator belongs to D14's UI, not to this calculation contract. This
   worker does not own the frame loop or GPU resources.

D14 must not infer that a successful route authorizes movement. It must still
validate the command against session state on the server.

## Browser verification

Run `pnpm build:wasm`, then `node tools/routing/browser-check.mjs` with
`playwright-core` available. `PLAYWRIGHT_MODULE` selects a local module path.
`CHROME_PATH` selects a Chromium executable. The harness builds a separate Vite
entry under `outputs/`, then tests the bundled production worker in a browser.
No application renderer or camera code changes.

The checks compare end-to-end worker latency against the existing TypeScript
reference on the same 64×64 input. They measure Wasm initialization, worker
startup, main-thread copy, transfer latency and worker computation separately.
The probe records signed cross-context timings. Near-zero transfer values can
be negative because browser clocks round independently (about 0.2 ms uncertainty).

The harness also verifies explicit invalid-input errors, outcome cleanup,
stable memory during reuse, cancellation and a trusted click plus animation
frames during a pending maximum-size search. The report records the results.
These checks do not establish performance for D14's final application UI or GPU.
The TS reference uses quadratic Dijkstra while Rust uses A*. No general Wasm
speedup is claimed from this comparison.

There is no watchdog timeout: a worker that dies without an `error` event leaves
the request pending. Add one when that failure is observed in a browser.
