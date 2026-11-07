// Reduces the browser's network flag and the API liveness probe to one connection state.
import { parseHealth } from '../lib/health.ts';
import { LatestLoader } from './latest-loader.ts';

export type ConnectionState = 'checking' | 'online' | 'offline' | 'server_down';

const HEALTH_PATH = '/api/health';
const HEALTH_KEY = 'health';

export async function probeServer(fetchImpl: typeof fetch, signal: AbortSignal): Promise<boolean> {
  const response = await fetchImpl(HEALTH_PATH, { signal });
  if (!response.ok) return false;
  return parseHealth(await response.json()) !== null;
}

/**
 * Probes the API one request at a time. The interval and the browser's "online" event can ask for
 * a probe while another is still pending. The newer one aborts the older, so a slow stale answer
 * can never overwrite a fresher one.
 */
export class ServerMonitor {
  private readonly loader: LatestLoader<string, boolean>;

  constructor(
    fetchImpl: typeof fetch,
    publish: (reachable: boolean) => void,
    timeoutMs: number,
  ) {
    this.loader = new LatestLoader<string, boolean>(
      (_key, signal) =>
        probeServer(fetchImpl, AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])),
      (state) => {
        if (state.status === 'ready') publish(state.value);
        if (state.status === 'failed') {
          console.warn('Could not query /api/health', state.error);
          publish(false);
        }
      },
    );
  }

  check(): void {
    this.loader.open(HEALTH_KEY);
  }

  dispose(): void {
    this.loader.dispose();
  }
}

export function connectionState(
  browserOnline: boolean,
  serverReachable: boolean | null,
): ConnectionState {
  if (!browserOnline) return 'offline';
  if (serverReachable === null) return 'checking';
  return serverReachable ? 'online' : 'server_down';
}
