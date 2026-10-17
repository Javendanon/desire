// Contrato de la respuesta /api/health y su lógica, con la I/O inyectada.
export interface HealthResponse {
  service: string;
  status: string;
  scope: string;
  protocol_version: number;
}

export interface Motor {
  version: string;
}

const SERVICIO_ESPERADO = 'desire-api';
const ESTADO_ESPERADO = 'ok';

function esRegistro(cuerpo: unknown): cuerpo is Record<string, unknown> {
  return typeof cuerpo === 'object' && cuerpo !== null;
}

export function parseHealth(cuerpo: unknown): HealthResponse | null {
  if (!esRegistro(cuerpo)) return null;
  if (cuerpo.service !== SERVICIO_ESPERADO) return null;
  if (cuerpo.status !== ESTADO_ESPERADO) return null;
  if (typeof cuerpo.scope !== 'string') return null;
  if (typeof cuerpo.protocol_version !== 'number') return null;
  return {
    service: cuerpo.service,
    status: cuerpo.status,
    scope: cuerpo.scope,
    protocol_version: cuerpo.protocol_version,
  };
}

export function healthMessage(cuerpo: unknown): string {
  return parseHealth(cuerpo) ? 'Servidor Rust conectado' : 'Respuesta de servidor no reconocida';
}

export async function consultarSalud(buscar: typeof fetch, signal: AbortSignal): Promise<string> {
  const response = await buscar('/api/health', { signal });
  if (!response.ok) throw new Error(`API no disponible (HTTP ${response.status})`);
  return healthMessage(await response.json());
}

export async function cargarMotor(importar: () => Promise<Motor>): Promise<string> {
  const motor = await importar();
  return `PlayCanvas ${motor.version} importado · GPU aún no comprobada`;
}
