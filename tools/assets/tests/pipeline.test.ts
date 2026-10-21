import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import { outputPath } from '../src/output.ts';
import { buildAsset } from '../src/pipeline.ts';
import { readPackage } from '../src/package-io.ts';
import type { Manifest } from '../src/types.ts';
import { sampleManifestPath } from './helpers.ts';

type BuildResult = ReturnType<typeof buildAsset>;

function tempDir(context: TestContext, prefix = 'desire-asset-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  context.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const build = (context: TestContext) =>
  buildAsset({ manifestPath: sampleManifestPath(), outDir: tempDir(context) });

/** Narrows to a report that reached the acceptance checks, so it carries every section. */
function checkedReport(result: BuildResult) {
  const { report } = result;
  assert.ok('package' in report, `report ${report.id} stopped before the acceptance checks`);
  return report;
}

function writtenPackage(result: BuildResult): string {
  assert.ok(result.packagePath, 'the build wrote a package');
  return result.packagePath;
}

function brokenManifest(dir: string, edit: (manifest: Manifest) => void) {
  const manifest = JSON.parse(fs.readFileSync(sampleManifestPath(), 'utf8')) as Manifest;
  edit(manifest);
  const file = path.join(dir, 'broken.json');
  fs.writeFileSync(file, JSON.stringify(manifest));
  return file;
}

test('the sample builds into a navigable map package with all checks green', (context) => {
  const { report } = build(context);
  assert.deepEqual(report.checks.filter((check) => !check.pass), []);
  assert.equal(report.pass, true);
});

test('the report records scale, fidelity, package and navigation', (context) => {
  const report = checkedReport(build(context));
  assert.equal(report.scale.checks[0].pass, true);
  assert.deepEqual(report.fidelity, { verified: 0, interpretation: 1, synthetic: 7, unknown: 2 });
  assert.deepEqual([report.package.sectors, report.package.chunks, report.package.buildings],
    [7, 7, 8]);
  assert.equal(report.navigation.pass, true);
  assert.equal(report.navigation.waypoints.length, 3);
  assert.deepEqual(report.unknown_places, ['chandlers-row', 'tide-stairs']);
});

test('the published package reads back through map.json and its chunk URIs', (context) => {
  const written = readPackage(writtenPackage(build(context)));
  assert.equal(written.sectors.length, written.map.chunks.length);
  assert.equal(written.costs.length, written.map.nav.width * written.map.nav.height);
});

test('a failing rebuild quarantines the previous package', (context) => {
  const outDir = tempDir(context);
  const first = writtenPackage(buildAsset({ manifestPath: sampleManifestPath(), outDir }));
  const broken = brokenManifest(outDir, (manifest) => {
    manifest.scale_checks[0].expected_m = 300;
  });
  const second = buildAsset({ manifestPath: broken, outDir });
  assert.equal(second.report.pass, false);
  assert.equal(second.packagePath, null);
  assert.equal(fs.existsSync(first), false, 'a consumer cannot load the old package');
  assert.ok(fs.existsSync(`${first}.stale`));
  assert.equal(checkedReport(second).artifact.stale_path, 'map-sample-harbor.stale');
});

test('invalid-manifest rebuilds also quarantine the previous package', (context) => {
  const outDir = tempDir(context);
  const first = writtenPackage(buildAsset({ manifestPath: sampleManifestPath(), outDir }));
  const broken = brokenManifest(outDir, (manifest) => {
    Reflect.deleteProperty(manifest, 'calibration');
  });
  assert.equal(buildAsset({ manifestPath: broken, outDir }).report.pass, false);
  assert.equal(fs.existsSync(first), false);
  assert.ok(fs.existsSync(`${first}.stale`));
});

test('the package and its report are written next to each other', (context) => {
  const result = build(context);
  assert.ok(fs.existsSync(path.join(writtenPackage(result), 'map.json')));
  assert.ok(fs.existsSync(result.reportPath));
  assert.ok(result.bytes > 1000, `package bytes ${result.bytes}`);
  const written = JSON.parse(fs.readFileSync(result.reportPath, 'utf8'));
  assert.deepEqual([written.id, written.pass, written.artifact.path],
    ['sample-harbor', true, 'map-sample-harbor']);
});

test('traversal identities never overwrite or quarantine outside files', (context) => {
  const root = tempDir(context, 'desire-traversal-');
  const outDir = path.join(root, 'out');
  fs.mkdirSync(outDir);
  const victim = path.join(root, 'victim');
  fs.mkdirSync(victim);
  const manifestPath = brokenManifest(root, (manifest) => {
    manifest.id = 'x/../../victim';
  });
  const result = buildAsset({ manifestPath, outDir });
  assert.equal(result.report.pass, false);
  assert.equal(result.packagePath, null);
  assert.ok(fs.existsSync(victim));
  assert.equal(fs.existsSync(`${victim}.stale`), false);
});

test('output containment rejects traversal and symlinks, including staging and quarantine', (context) => {
  const root = tempDir(context, 'desire-output-');
  const outDir = path.join(root, 'out');
  fs.mkdirSync(outDir);
  const victim = path.join(root, 'victim');
  fs.writeFileSync(victim, 'unchanged');
  assert.throws(() => outputPath(outDir, '../victim'), /escapes directory/);
  for (const suffix of ['', '.pending', '.stale']) {
    const name = `map-test${suffix}`;
    fs.symlinkSync(victim, path.join(outDir, name));
    assert.throws(() => outputPath(outDir, name), /symlink/);
  }
  assert.equal(fs.readFileSync(victim, 'utf8'), 'unchanged');
});

test('a malformed manifest writes a failing report and leaves no package', (context) => {
  const outDir = tempDir(context);
  const brokenPath = path.join(outDir, 'broken.json');
  fs.writeFileSync(brokenPath, JSON.stringify({ schema: 'desire.asset-scene/2', places: {} }));
  const { report, packagePath } = buildAsset({ manifestPath: brokenPath, outDir });
  assert.equal(report.pass, false);
  assert.equal(packagePath, null);
  assert.ok(fs.existsSync(path.join(outDir, 'report.json')));
  assert.deepEqual(fs.readdirSync(outDir).filter((name) => name.startsWith('map-')), []);
});

test('a waypoint walled in by a building fails the build instead of shipping', (context) => {
  const outDir = tempDir(context);
  const broken = brokenManifest(outDir, (manifest) => {
    manifest.waypoints.push({ id: 'inside-tower', x_m: 37.5, z_m: 45 });
  });
  const result = buildAsset({ manifestPath: broken, outDir });
  const report = checkedReport(result);
  assert.equal(report.pass, false);
  assert.match(JSON.stringify(report.checks), /navigation\.waypoints/);
  assert.equal(result.packagePath, null);
  assert.equal(report.artifact.written, false);
  assert.deepEqual(fs.readdirSync(outDir).filter((name) => name.endsWith('.pending')), []);
});
