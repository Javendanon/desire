import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import { sampleManifestPath, toolsRoot } from './helpers.ts';

const CLI = path.join(toolsRoot, 'asset-pipeline.ts');
const EXIT_FAIL = 2;

function outDir(context: TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desire-cli-'));
  context.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function runCli(args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
}

test('the CLI exits 0 and writes the package and report for the sample', (context) => {
  const out = outDir(context);
  const run = runCli(['--manifest', sampleManifestPath(), '--out', out]);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /sample-harbor: PASS \(report\.json\)/);
  assert.ok(fs.existsSync(path.join(out, 'report.json')));
  assert.ok(fs.existsSync(path.join(out, 'map-sample-harbor', 'map.json')));
});

test('the CLI exits 2, names the failing check and still writes the report', (context) => {
  const out = outDir(context);
  const manifest = JSON.parse(fs.readFileSync(sampleManifestPath(), 'utf8'));
  delete manifest.calibration;
  const broken = path.join(out, 'broken.json');
  fs.writeFileSync(broken, JSON.stringify(manifest));
  const run = runCli(['--manifest', broken, '--out', out]);
  assert.equal(run.status, EXIT_FAIL);
  assert.match(run.stderr, /FAIL manifest\.\d+: .*calibration/);
  const report = JSON.parse(fs.readFileSync(path.join(out, 'report.json'), 'utf8'));
  assert.equal(report.pass, false);
});

test('the CLI exits 2 with usage when the manifest flag is missing', () => {
  const run = runCli([]);
  assert.equal(run.status, EXIT_FAIL);
  assert.match(run.stderr, /usage: node tools\/assets\/asset-pipeline\.ts --manifest/);
});

test('a missing manifest file fails with context instead of a stack trace', (context) => {
  const out = outDir(context);
  const missing = path.join(out, 'absent.json');
  const run = runCli(['--manifest', missing, '--out', out]);
  assert.equal(run.status, EXIT_FAIL);
  assert.match(run.stderr, new RegExp(`cannot read manifest ${missing.replaceAll('/', '\\/')}`));
  assert.doesNotMatch(run.stderr, /\n\s+at /, 'no uncaught stack trace');
});
