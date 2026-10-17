// Contract for the /api/health response and its logic, with injected I/O.
export interface HealthResponse {
  service: string;
  status: string;
  scope: string;
  protocol_version: number;
}

export interface Engine {
  version: string;
}

const EXPECTED_SERVICE = 'desire-api';
const EXPECTED_STATUS = 'ok';

function isRecord(body: unknown): body is Record<string, unknown> {
  return typeof body === 'object' && body !== null;
}

export function parseHealth(body: unknown): HealthResponse | null {
  if (!isRecord(body)) return null;
  if (body.service !== EXPECTED_SERVICE) return null;
  if (body.status !== EXPECTED_STATUS) return null;
  if (typeof body.scope !== 'string') return null;
  if (typeof body.protocol_version !== 'number') return null;
  return {
    service: body.service,
    status: body.status,
    scope: body.scope,
    protocol_version: body.protocol_version,
  };
}

export function healthMessage(body: unknown): string {
  return parseHealth(body) ? 'Servidor Rust conectado' : 'Respuesta de servidor no reconocida';
}

export async function checkHealth(fetchImpl: typeof fetch, signal: AbortSignal): Promise<string> {
  const response = await fetchImpl('/api/health', { signal });
  if (!response.ok) throw new Error(`API no disponible (HTTP ${response.status})`);
  return healthMessage(await response.json());
}

export async function loadEngine(importEngine: () => Promise<Engine>): Promise<string> {
  const engine = await importEngine();
  return `PlayCanvas ${engine.version} importado · GPU aún no comprobada`;
}
