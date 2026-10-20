// Wire contract between the routing worker client and its dedicated worker.

export interface GridPoint {
  x: number;
  y: number;
}

export interface RoutingGrid {
  width: number;
  height: number;
  costs: Uint32Array;
}

export interface RouteEndpoints {
  start: GridPoint;
  goal: GridPoint;
}

export interface RouteIdentity {
  requestId: number;
  revision: number;
}

export interface RoutingRequest extends RouteIdentity {
  grid: RoutingGrid;
  start: GridPoint;
  goal: GridPoint;
}

export type RouteStatus = 'ok' | 'error';

export interface RouteResponse extends RouteIdentity {
  status: RouteStatus;
  cost: number;
  /** Flat [x0, y0, x1, y1, ...] path; empty on failure. */
  path: number[];
  error?: string;
}

export interface RouteMessage {
  kind: 'route';
  request: RoutingRequest;
}

export const ROUTING_WORKER_PROTOCOL_VERSION = 1;

/** A result is usable only for the latest request and map revision. */
export function isCurrentResult(
  result: RouteIdentity,
  current: RouteIdentity | null,
): boolean {
  if (current === null) return false;
  return result.requestId === current.requestId && result.revision === current.revision;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isGrid(value: unknown): value is RoutingGrid {
  if (!isRecord(value)) return false;
  return (
    Number.isInteger(value.width) &&
    Number.isInteger(value.height) &&
    value.costs instanceof Uint32Array
  );
}

export function isPoint(value: unknown): value is GridPoint {
  if (!isRecord(value)) return false;
  return Number.isInteger(value.x) && Number.isInteger(value.y);
}

/** Best-effort identity for rejecting a malformed request without hanging. */
export function recoverIdentity(value: unknown): RouteIdentity | null {
  if (!isRecord(value) || !isRecord(value.request)) return null;
  const request = value.request;
  if (!Number.isInteger(request.requestId) || !Number.isInteger(request.revision)) {
    return null;
  }
  return { requestId: request.requestId as number, revision: request.revision as number };
}

export function isRouteMessage(value: unknown): value is RouteMessage {
  if (!isRecord(value) || value.kind !== 'route' || !isRecord(value.request)) return false;
  const request = value.request as Partial<RoutingRequest>;
  return (
    Number.isInteger(request.requestId) &&
    Number.isInteger(request.revision) &&
    isGrid(request.grid) &&
    isPoint(request.start) &&
    isPoint(request.goal)
  );
}

function isPath(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length % 2 === 0 &&
    value.every((item) => Number.isInteger(item) && item >= 0)
  );
}

function isOkResponse(value: Record<string, unknown>): boolean {
  return (
    Number.isInteger(value.cost) &&
    (value.cost as number) >= 0 &&
    isPath(value.path) &&
    value.error === undefined
  );
}

function isErrorResponse(value: Record<string, unknown>): boolean {
  return (
    value.cost === 0 &&
    Array.isArray(value.path) &&
    value.path.length === 0 &&
    typeof value.error === 'string' &&
    value.error.length > 0
  );
}

export function isRouteResponse(value: unknown): value is RouteResponse {
  if (!isRecord(value)) return false;
  if (!Number.isInteger(value.requestId) || !Number.isInteger(value.revision)) return false;
  if (value.status === 'ok') return isOkResponse(value);
  if (value.status === 'error') return isErrorResponse(value);
  return false;
}
