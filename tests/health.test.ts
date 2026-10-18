import test from 'node:test';
import assert from 'node:assert/strict';

import { checkHealth, healthMessage, loadEngine, parseHealth } from '../src/lib/health.ts';

const VALID_RESPONSE = {
  service: 'desire-api',
  status: 'ok',
  scope: 'liveness',
  protocol_version: 1,
};

const UNRECOGNIZED = 'Unrecognized server response';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fetchWith(body: unknown, status = 200): typeof fetch {
  return (async () => response(body, status)) as unknown as typeof fetch;
}

test('rejects non-object responses', () => {
  for (const body of [null, undefined, 'ok', 42, true, []]) {
    assert.equal(parseHealth(body), null, `invalid body: ${String(body)}`);
    assert.equal(healthMessage(body), UNRECOGNIZED);
  }
});

test('rejects objects without the contract fields', () => {
  for (const body of [{}, { service: 'desire-api' }, { status: 'ok' }]) {
    assert.equal(parseHealth(body), null);
    assert.equal(healthMessage(body), UNRECOGNIZED);
  }
});

test('rejects a different service or status', () => {
  assert.equal(parseHealth({ ...VALID_RESPONSE, service: 'other' }), null);
  assert.equal(parseHealth({ ...VALID_RESPONSE, status: 'degraded' }), null);
});

test('rejects wrong field types', () => {
  assert.equal(parseHealth({ ...VALID_RESPONSE, protocol_version: '1' }), null);
  assert.equal(parseHealth({ ...VALID_RESPONSE, scope: 3 }), null);
});

test('accepts the valid contract and keeps the connected message', () => {
  assert.deepEqual(parseHealth(VALID_RESPONSE), VALID_RESPONSE);
  assert.equal(healthMessage(VALID_RESPONSE), 'Rust server connected');
});

test('accepts extra fields without breaking the contract', () => {
  const extended = { ...VALID_RESPONSE, uptime_ms: 10 };
  assert.equal(parseHealth(extended)?.service, 'desire-api');
  assert.equal(healthMessage(extended), 'Rust server connected');
});

test('checkHealth connects with a valid response', async () => {
  const message = await checkHealth(fetchWith(VALID_RESPONSE), new AbortController().signal);
  assert.equal(message, 'Rust server connected');
});

test('checkHealth fails with the HTTP code in the message', async () => {
  const fetchImpl = fetchWith({ error: 'no' }, 503);
  await assert.rejects(() => checkHealth(fetchImpl, new AbortController().signal), /HTTP 503/);
});

test('checkHealth does not recognize an invalid body', async () => {
  const fetchImpl = fetchWith({ hola: 1 });
  assert.equal(await checkHealth(fetchImpl, new AbortController().signal), UNRECOGNIZED);
});

test('loadEngine reports the imported version', async () => {
  const message = await loadEngine(async () => ({ version: '2.23.2' }));
  assert.match(message, /2\.23\.2/);
});

test('loadEngine propagates the import failure', async () => {
  await assert.rejects(() => loadEngine(async () => {
    throw new Error('sin red');
  }));
});
