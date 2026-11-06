import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadSuites } from './browser-suites.mjs';

function fixture(names, files = []) {
  const dir = mkdtempSync(join(tmpdir(), 'suites-'));
  for (const file of files) writeFileSync(join(dir, file), '');
  const list = join(dir, 'gate-suites.json');
  writeFileSync(list, JSON.stringify(names));
  return { dir, list };
}

test('listed suites resolve in order', () => {
  const { dir, list } = fixture(['a-smoke.mjs', 'b-smoke.mjs'], ['a-smoke.mjs', 'b-smoke.mjs']);
  assert.deepEqual(loadSuites(list, dir), [join(dir, 'a-smoke.mjs'), join(dir, 'b-smoke.mjs')]);
});

test('an empty list, a missing file or a path escape fails loudly', () => {
  const empty = fixture([]);
  assert.throws(() => loadSuites(empty.list, empty.dir), /at least one suite/);
  const missing = fixture(['gone.mjs']);
  assert.throws(() => loadSuites(missing.list, missing.dir), /does not exist/);
  const escape = fixture(['../outside.mjs']);
  assert.throws(() => loadSuites(escape.list, escape.dir), /invalid suite name/);
});

test('the repository list names only existing suites', () => {
  assert.ok(loadSuites().length >= 1);
});
