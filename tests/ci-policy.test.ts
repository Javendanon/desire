// Required frontend checks must include the regression suite in CI and the local policy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('frontend-check executes frontend tests and reference verification in both gates', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const frontendJob = workflow.split('  frontend-check:')[1]?.split('\n  rust-fmt:')[0];
  assert.ok(frontendJob, 'keep the required frontend-check job name');
  const policy = JSON.parse(readFileSync(new URL('../merge-policy.json', import.meta.url), 'utf8'));
  const localGate = policy.gates.find((gate: { name: string }) => gate.name === 'frontend-check');
  assert.equal(localGate?.optional, false);
  for (const command of ['test:frontend', 'test:browser', 'verify:waterdeep']) {
    assert.ok(frontendJob.includes(`corepack pnpm run ${command}`), `CI omits ${command}`);
    assert.ok(localGate.cmd.includes(`corepack pnpm run ${command}`), `local omits ${command}`);
  }
});

test('the browser scene regressions are reachable from the required frontend script', () => {
  const scripts = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts;
  assert.ok(scripts['test:browser'], 'package.json has no test:browser script');
  const runner = readFileSync(
    new URL('../tools/ci/browser-smoke.mjs', import.meta.url), 'utf8');
  assert.match(runner, /tests\/browser\/waterdeep-smoke\.mjs/,
    'the browser runner must execute the Waterdeep scene smoke test');
});
