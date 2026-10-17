import test from 'node:test';
import assert from 'node:assert/strict';

import { cargarMotor, consultarSalud, healthMessage, parseHealth } from '../src/lib/health.ts';

const RESPUESTA_VALIDA = {
  service: 'desire-api',
  status: 'ok',
  scope: 'liveness',
  protocol_version: 1,
};

const NO_RECONOCIDA = 'Respuesta de servidor no reconocida';

function respuesta(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function buscarCon(cuerpo: unknown, status = 200): typeof fetch {
  return (async () => respuesta(cuerpo, status)) as unknown as typeof fetch;
}

test('rechaza respuestas que no son objetos', () => {
  for (const cuerpo of [null, undefined, 'ok', 42, true, []]) {
    assert.equal(parseHealth(cuerpo), null, `cuerpo inválido: ${String(cuerpo)}`);
    assert.equal(healthMessage(cuerpo), NO_RECONOCIDA);
  }
});

test('rechaza objetos sin los campos del contrato', () => {
  for (const cuerpo of [{}, { service: 'desire-api' }, { status: 'ok' }]) {
    assert.equal(parseHealth(cuerpo), null);
    assert.equal(healthMessage(cuerpo), NO_RECONOCIDA);
  }
});

test('rechaza servicio o estado distintos', () => {
  assert.equal(parseHealth({ ...RESPUESTA_VALIDA, service: 'otro' }), null);
  assert.equal(parseHealth({ ...RESPUESTA_VALIDA, status: 'degraded' }), null);
});

test('rechaza tipos de campo incorrectos', () => {
  assert.equal(parseHealth({ ...RESPUESTA_VALIDA, protocol_version: '1' }), null);
  assert.equal(parseHealth({ ...RESPUESTA_VALIDA, scope: 3 }), null);
});

test('acepta el contrato válido y conserva el mensaje conectado', () => {
  assert.deepEqual(parseHealth(RESPUESTA_VALIDA), RESPUESTA_VALIDA);
  assert.equal(healthMessage(RESPUESTA_VALIDA), 'Servidor Rust conectado');
});

test('acepta campos extra sin romper el contrato', () => {
  const extendido = { ...RESPUESTA_VALIDA, uptime_ms: 10 };
  assert.equal(parseHealth(extendido)?.service, 'desire-api');
  assert.equal(healthMessage(extendido), 'Servidor Rust conectado');
});

test('consultarSalud conecta con una respuesta válida', async () => {
  const mensaje = await consultarSalud(buscarCon(RESPUESTA_VALIDA), new AbortController().signal);
  assert.equal(mensaje, 'Servidor Rust conectado');
});

test('consultarSalud falla con el código HTTP en el mensaje', async () => {
  const buscar = buscarCon({ error: 'no' }, 503);
  await assert.rejects(() => consultarSalud(buscar, new AbortController().signal), /HTTP 503/);
});

test('consultarSalud no reconoce un cuerpo inválido', async () => {
  const buscar = buscarCon({ hola: 1 });
  assert.equal(await consultarSalud(buscar, new AbortController().signal), NO_RECONOCIDA);
});

test('cargarMotor informa la versión importada', async () => {
  const mensaje = await cargarMotor(async () => ({ version: '2.23.2' }));
  assert.match(mensaje, /2\.23\.2/);
});

test('cargarMotor propaga el fallo de importación', async () => {
  await assert.rejects(() => cargarMotor(async () => {
    throw new Error('sin red');
  }));
});
