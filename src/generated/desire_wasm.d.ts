
/**
 * Integer cell coordinate; x grows east, y grows south.
 */
export class GridPoint {
    free(): void;
    [Symbol.dispose](): void;
    constructor(x: number, y: number);
    x: number;
    y: number;
}

/**
 * Request identity used by the worker to discard obsolete results.
 */
export class RouteIdentity {
    free(): void;
    [Symbol.dispose](): void;
    constructor(request_id: number, revision: number);
    request_id: number;
    revision: number;
}

/**
 * Typed result or failure for one request identity.
 */
export class RouteOutcome {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    cost(): number;
    error_message(): string;
    is_ok(): boolean;
    /**
     * Flat `[x0, y0, x1, y1, ...]` path; empty on failure.
     */
    path(): Uint32Array;
    request_id(): number;
    revision(): number;
}

/**
 * Start and goal cells for one routing request.
 */
export class RouteSpan {
    free(): void;
    [Symbol.dispose](): void;
    constructor(start: GridPoint, goal: GridPoint);
}

/**
 * Owned grid buffer held for one or more route requests.
 */
export class RoutingGrid {
    free(): void;
    [Symbol.dispose](): void;
    constructor(width: number, height: number, costs: Uint32Array);
    /**
     * Plans one route; validation and search errors arrive as outcomes.
     */
    plan(identity: RouteIdentity, span: RouteSpan): RouteOutcome;
}

export function protocol_version(): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_get_gridpoint_x: (a: number) => number;
    readonly __wbg_get_gridpoint_y: (a: number) => number;
    readonly __wbg_get_routeidentity_request_id: (a: number) => number;
    readonly __wbg_get_routeidentity_revision: (a: number) => number;
    readonly __wbg_gridpoint_free: (a: number, b: number) => void;
    readonly __wbg_routeidentity_free: (a: number, b: number) => void;
    readonly __wbg_routeoutcome_free: (a: number, b: number) => void;
    readonly __wbg_routespan_free: (a: number, b: number) => void;
    readonly __wbg_routinggrid_free: (a: number, b: number) => void;
    readonly __wbg_set_gridpoint_x: (a: number, b: number) => void;
    readonly __wbg_set_gridpoint_y: (a: number, b: number) => void;
    readonly __wbg_set_routeidentity_request_id: (a: number, b: number) => void;
    readonly __wbg_set_routeidentity_revision: (a: number, b: number) => void;
    readonly gridpoint_new: (a: number, b: number) => number;
    readonly protocol_version: () => number;
    readonly routeidentity_new: (a: number, b: number) => number;
    readonly routeoutcome_cost: (a: number) => number;
    readonly routeoutcome_error_message: (a: number) => [number, number];
    readonly routeoutcome_is_ok: (a: number) => number;
    readonly routeoutcome_path: (a: number) => [number, number];
    readonly routeoutcome_request_id: (a: number) => number;
    readonly routeoutcome_revision: (a: number) => number;
    readonly routespan_new: (a: number, b: number) => number;
    readonly routinggrid_new: (a: number, b: number, c: number, d: number) => number;
    readonly routinggrid_plan: (a: number, b: number, c: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
