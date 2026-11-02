// Transport for the versioned campaign API. DTOs come from the generated contracts,
// never from a second hand-written schema.
import type { Id } from '../../generated/contracts.ts';

export const API_BASE = '/api/v1';

export interface Page<T> {
  items: T[];
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface ApiProblem {
  code: string;
  message: string;
  request_id: string;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly problem: ApiProblem;

  constructor(status: number, problem: ApiProblem) {
    super(problem.message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.problem = problem;
  }
}

export interface ApiContext {
  fetch: typeof fetch;
  identity: Id;
  signal?: AbortSignal;
  baseUrl?: string;
}

export interface PageQuery {
  limit?: number;
  offset?: number;
}

export async function request<T>(
  context: ApiContext,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const response = await context.fetch(`${context.baseUrl ?? ''}${API_BASE}${path}`, {
    method,
    signal: context.signal,
    headers: {
      'x-desire-user': context.identity,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new ApiRequestError(response.status, await readProblem(response));
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function collectionPath(base: string, page?: PageQuery): string {
  const query = new URLSearchParams();
  if (page?.limit !== undefined) query.set('limit', String(page.limit));
  if (page?.offset !== undefined) query.set('offset', String(page.offset));
  const suffix = query.toString();
  return suffix ? `${base}?${suffix}` : base;
}

export function resourcePath(base: string, id: Id): string {
  return `${base}/${encodeURIComponent(id)}`;
}

async function readProblem(response: Response): Promise<ApiProblem> {
  try {
    const body = (await response.json()) as Partial<ApiProblem>;
    if (typeof body.code === 'string' && typeof body.message === 'string') {
      return {
        code: body.code,
        message: body.message,
        request_id: typeof body.request_id === 'string' ? body.request_id : '',
      };
    }
  } catch {
    // Non-JSON rejections still become ApiRequestError; the status carries the fact.
  }
  return { code: 'unknown', message: `HTTP ${response.status}`, request_id: '' };
}
