import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import { evaluateScaleChecks } from '../src/calibration.ts';
import { validateManifest } from '../src/manifest.ts';
import { buildCostGrid, walkCostGrid } from '../src/nav.ts';
import { buildAsset } from '../src/pipeline.ts';
import { sampleManifest, sampleManifestPath, samplePath } from './helpers.ts';

const base = sampleManifest;

function listFiles(root: string): string[] {
  return fs.readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((name) => fs.statSync(path.join(root, name)).isFile())
    .sort();
}

function rebuildSample(context: TestContext) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desire-sample-'));
  context.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
  return { outDir, ...buildAsset({ manifestPath: sampleManifestPath(), outDir }) };
}

test('malformed sections and null waypoints return validation errors instead of throwing', () => {
  for (const patch of [{ places: {} }, { waypoints: {} }, { waypoints: [null] }]) {
    assert.ok(validateManifest({ ...base(), ...patch }).errors.length > 0);
  }
});

test('ground grid and scene sizes have preflight budgets', () => {
  const manifest = base();
  manifest.illustration.width_px = 1e9;
  assert.match(validateManifest(manifest).errors.join('\n'), /grid.*budget/);
  const crowded = base();
  crowded.places = Array.from({ length: 1025 }, (_, index) =>
    ({ ...crowded.places[0], id: `${index}` }));
  assert.match(validateManifest(crowded).errors.join('\n'), /places.*budget/);
});

test('the committed sample report is reproducible and path-independent', (context) => {
  const { report } = rebuildSample(context);
  const committed = JSON.parse(fs.readFileSync(samplePath('report.json'), 'utf8'));
  assert.deepEqual(report, committed);
  assert.equal(committed.artifact.path, 'map-sample-harbor');
  assert.equal(path.isAbsolute(committed.artifact.path), false);
});

test('the committed sample package is byte-identical to a fresh build', (context) => {
  const { outDir } = rebuildSample(context);
  const fresh = path.join(outDir, 'map-sample-harbor');
  const committed = samplePath('map-sample-harbor');
  assert.deepEqual(listFiles(fresh), listFiles(committed));
  for (const name of listFiles(committed)) {
    assert.ok(fs.readFileSync(path.join(fresh, name)).equals(
      fs.readFileSync(path.join(committed, name))), `${name} drifted from a fresh build`);
  }
});

test('spawn and waypoint share closed ground boundary semantics', () => {
  const ground = { origin_x_m: 0, origin_z_m: 0, width_m: 10, height_m: 10 };
  const spawn = { x_m: 10, z_m: 5 };
  const grid = buildCostGrid({ ground, solids: [] });
  const report = walkCostGrid({ ...grid, spawn, waypoints: [{ id: 'edge', ...spawn }] });
  assert.equal(report.pass, true);
});

test('scale acceptance uses unrounded distances', () => {
  const manifest = base();
  const check = { ...manifest.scale_checks[0], expected_m: 225.0004, tolerance_m: 1 };
  assert.equal(evaluateScaleChecks(manifest.calibration, [check])[0].pass, false);
});
