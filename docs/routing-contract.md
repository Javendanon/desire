# Routing worker contract v1 · D12

Status: implemented in `crates/core/routing`, `crates/wasm` and
`src/lib/routing`; browser/Wasm execution is **not verified** in this
environment because the `wasm32-unknown-unknown` target and `wasm-pack` are
missing. D14 may integrate the contract below after those tools run.

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
- x grows east/right; y grows south/down. Coordinates are cell indices.
- Route cost is the sum of destination cell costs. The start cell is not
  charged; a route from a cell to itself costs `0`.
- A total cost above `u32` is an explicit `CostOverflow` error, not a wrap.

The worker copies the caller buffer before transfer, so the caller keeps using
its own `Uint32Array`. Validation happens in the worker and returns an outcome;
it does not throw for a bad grid.

## Identity, revision and stale results

TypeScript wire shape:

```ts
interface RoutingRequest {
  requestId: number; // positive u32 assigned by RoutingWorkerClient
  revision: number;  // map version revision from D04, positive
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

- `requestId` is monotonic per `RoutingWorkerClient` instance.
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
5. The Wasm `RoutingGrid` is freed immediately after the search.

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

## Measurement status

Measured in this environment:

| Measurement | Value | Scope |
| --- | --- | --- |
| Native core compute | 0.05–0.22 ms across five 20-run samples | Release build, 256×256 open grid; search only |
| Input transfer | 262,144 bytes | Same grid, 4 bytes per cell |
| Output transfer | 4,088 bytes | 511 path points, 8 bytes per point |
| Route cost parity | Rust 7 = TypeScript 7 | Shared 6×4 fixture with a blocked cell and a zero-cost cell |

There is no watchdog timeout: a worker that dies without an `error` event leaves
the request pending. Add one when that failure is observed in a browser.

Not measured: Wasm load time, browser worker startup, postMessage latency, UI
frame time or GPU behaviour. Those need `wasm-pack` and a browser run. The
0.05–0.22 ms range is search time only; worker startup, the two cost copies and the
Wasm instance setup are outside it and may dominate a single short route. No
speedup is claimed; only algorithmic cost parity with the independent
TypeScript reference was verified. The worker entry itself was not executed
because the generated Wasm module is absent.
