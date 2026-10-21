// HOLDOUT: not visible to the implementing agent (excluded from its worktree by sparse-checkout)
// and run only in CI. See docs/app-tests-plan.md. Do not reference these cases in card prompts.
import test from 'node:test';
import assert from 'node:assert/strict';

import { checkHealth, parseHealth } from '../../src/lib/health.ts';

const VALID = { service: 'desire-api', status: 'ok', scope: 'liveness', protocol_version: 1 };

test('contract values are compared exactly, not loosely', () => {
  assert.equal(parseHealth({ ...VALID, service: 'Desire-API' }), null);
  assert.equal(parseHealth({ ...VALID, status: 'OK' }), null);
  assert.equal(parseHealth({ ...VALID, service: 'desire-api ' }), null);
});

test('an array is not a health response', () => {
  assert.equal(parseHealth([VALID]), null);
});

test('a body that is not JSON makes checkHealth fail instead of reporting connected', async () => {
  const htmlFromAProxy = async () => new Response('<html>502 Bad Gateway</html>', { status: 200 });
  const signal = new AbortController().signal;
  await assert.rejects(() => checkHealth(htmlFromAProxy as typeof fetch, signal));
});
