// Builds the browser API context. fetch is wrapped because calling it as a method of the context
// object would throw an illegal invocation.
import type { Id } from '../../generated/contracts.ts';
import type { ApiContext } from '../../lib/api/client.ts';

export function createApiContext(identity: Id): ApiContext {
  return { identity, fetch: (input, init) => globalThis.fetch(input, init) };
}

export function withSignal(context: ApiContext, signal: AbortSignal): ApiContext {
  return { ...context, signal };
}
