// Reduces the browser's network flag and the API liveness probe to one connection state.
import { parseHealth } from '../lib/health.ts';

export type ConnectionState = 'checking' | 'online' | 'offline' | 'server_down';

const HEALTH_PATH = '/api/health';

export async function probeServer(fetchImpl: typeof fetch, signal: AbortSignal): Promise<boolean> {
  const response = await fetchImpl(HEALTH_PATH, { signal });
  if (!response.ok) return false;
  return parseHealth(await response.json()) !== null;
}

export function connectionState(
  browserOnline: boolean,
  serverReachable: boolean | null,
): ConnectionState {
  if (!browserOnline) return 'offline';
  if (serverReachable === null) return 'checking';
  return serverReachable ? 'online' : 'server_down';
}
