// Pure mapping from a Wasm outcome to the worker wire response.

import type { RouteIdentity, RouteResponse } from './protocol.ts';

/** Structural subset of the generated Wasm `RouteOutcome` class. */
export interface WasmRouteOutcome {
  is_ok(): boolean;
  cost(): number;
  path(): Uint32Array;
  error_message(): string;
}

export function errorResponse(identity: RouteIdentity, message: string): RouteResponse {
  return { ...identity, status: 'error', cost: 0, path: [], error: message };
}

export function outcomeResponse(
  identity: RouteIdentity,
  outcome: WasmRouteOutcome,
): RouteResponse {
  if (!outcome.is_ok()) return errorResponse(identity, outcome.error_message());
  return {
    ...identity,
    status: 'ok',
    cost: outcome.cost(),
    path: Array.from(outcome.path()),
  };
}

export function failureResponse(identity: RouteIdentity, error: unknown): RouteResponse {
  const detail = error instanceof Error ? error.message : String(error);
  return errorResponse(identity, `wasm routing failed: ${detail}`);
}
