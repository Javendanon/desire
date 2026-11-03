// API transport uses the generated error DTO and page metadata shared with Rust.
import type { ApiError, Id } from '../../generated/contracts.ts';
import type pageEnvelope from '../../../contracts/api-page.json';

export const API_BASE = '/api/v1';

// Metadata is pinned by the same envelope fixture checked by Rust serialization tests.
export type Page<T> = Omit<typeof pageEnvelope, 'items'> & { items: T[] };
export type ApiProblem = ApiError;

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

export interface ApiRequest {
  method: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export async function request<T>(context: ApiContext, options: ApiRequest): Promise<T> {
  const { method, path, body, headers = {} } = options;
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
