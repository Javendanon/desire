// The browser gate must fail closed: a Vite child that exited cannot be covered by whatever else
// answers on the same port.
import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForServer } from './dev-server.mjs';

const ok = async () => ({ ok: true });
const fast = { attempts: 2, delayMs: 0 };
const base = 'http://127.0.0.1:1';
const running = { exitCode: null, signalCode: null };

test('a server that exited fails even when the port answers', async () => {
  await assert.rejects(
    waitForServer({ exitCode: 1, signalCode: null }, base, { ...fast, fetchPage: ok }),
    /dev server exited with code 1/,
  );
});

test('a running server resolves once the page answers', async () => {
  let calls = 0;
  const fetchPage = async () => {
    calls += 1;
    if (calls === 1) throw new TypeError('fetch failed');
    return { ok: true };
  };
  await waitForServer(running, base, { ...fast, fetchPage });
  assert.equal(calls, 2);
});

test('a server that never answers is reported, not retried forever', async () => {
  await assert.rejects(
    waitForServer(running, base, { ...fast, fetchPage: async () => ({ ok: false }) }),
    /did not answer on http:\/\/127\.0\.0\.1:1/,
  );
});

test('unexpected fetch errors are not swallowed', async () => {
  await assert.rejects(
    waitForServer(running, base,
      { ...fast, fetchPage: async () => { throw new Error('boom'); } }),
    /boom/,
  );
});
