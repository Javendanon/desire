// Turns any request failure into a kind and a message the player can act on.
import { t, type MessageKey } from '../../app/messages.ts';
import { ApiRequestError } from '../../lib/api/client.ts';

export type FailureKind =
  | 'offline'
  | 'unreachable'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'invalid'
  | 'server';

export interface FailureReport {
  kind: FailureKind;
  message: string;
  /** Lets a report be matched to the server log line of the same request. */
  requestId: string | null;
}

const STATUS_KINDS: Readonly<Record<number, FailureKind>> = {
  400: 'invalid',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
};

const MESSAGE_KEYS: Readonly<Record<FailureKind, MessageKey>> = {
  offline: 'failure.offline',
  unreachable: 'failure.unreachable',
  unauthenticated: 'failure.unauthenticated',
  forbidden: 'failure.forbidden',
  not_found: 'failure.not_found',
  conflict: 'failure.conflict',
  invalid: 'failure.invalid',
  server: 'failure.server',
};

export function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function classify(error: unknown, online: boolean): FailureKind {
  if (error instanceof ApiRequestError) return STATUS_KINDS[error.status] ?? 'server';
  if (!online) return 'offline';
  // fetch rejects with TypeError when no response arrived at all.
  return error instanceof TypeError ? 'unreachable' : 'server';
}

export function describeFailure(error: unknown, online: boolean): FailureReport {
  const kind = classify(error, online);
  const requestId = error instanceof ApiRequestError ? error.problem.request_id : '';
  return { kind, message: t(MESSAGE_KEYS[kind]), requestId: requestId || null };
}
