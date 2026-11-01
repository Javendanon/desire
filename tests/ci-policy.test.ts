// Required frontend checks must include the regression suite in CI and the local policy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const RUNNER = new URL('../tools/ci/browser-smoke.mjs', import.meta.url);

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
  const scripts = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts;
  assert.ok(scripts['test:browser'], 'package.json has no test:browser script');
  const runner = readFileSync(RUNNER, 'utf8');
  assert.match(runner, /tests\/browser\/waterdeep-smoke\.mjs/,
    'the browser runner must execute the Waterdeep scene smoke test');
  const smoke = readFileSync(new URL('../tests/browser/waterdeep-smoke.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(smoke, /map-memory|sweepSectors|MEMORY_BUDGET/,
    'the required browser gate must not run the sector sweep or memory audit');
  assert.match(smoke, /dispatchMouseEvent/);
  assert.match(smoke, /visualViewport/);
});

// Every module the runner imports must exist, or the required CI step dies on ERR_MODULE_NOT_FOUND.
test('the modules imported by the browser runner exist', () => {
  const runner = readFileSync(RUNNER, 'utf8');
  const localImports = [...runner.matchAll(/from\s+'\.\/([^']+)'/g)].map((hit) => hit[1]);
  assert.ok(localImports.length > 0, 'the runner imports no local module');
  for (const name of localImports) {
    assert.ok(existsSync(new URL(name, RUNNER)), `the runner imports a missing module: ${name}`);
  }
});
