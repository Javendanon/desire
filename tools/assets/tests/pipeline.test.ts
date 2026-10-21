import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { outputPath } from '../src/output.ts';
import { parseGlb } from '../src/gltf-read.ts';
import { buildAsset } from '../src/pipeline.ts';
import { sampleManifestPath } from './helpers.ts';

type BuildResult = ReturnType<typeof buildAsset>;

const build = () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desire-asset-'));
  return buildAsset({ manifestPath: sampleManifestPath(), outDir });
};

/** Narrows to a report that reached the acceptance checks, so it carries every section. */
function checkedReport(result: BuildResult) {
  const { report } = result;
  assert.ok('lod' in report, `report ${report.id} stopped before the acceptance checks`);
  return report;
}

function writtenArtifact(result: BuildResult): string {
  assert.ok(result.artifactPath, 'the build wrote an artifact');
  return result.artifactPath;
}

test('the sample scene builds into a navigable artifact with all checks green', () => {
  const { report } = build();
  const failed = report.checks.filter((check) => !check.pass);
  assert.deepEqual(failed, [], 'no failing acceptance check');
  assert.equal(report.pass, true);
});

test('the report records scale, fidelity, collision, textures and navigation', () => {
  const report = checkedReport(build());
  assert.equal(report.scale.checks.length, 1);
  assert.equal(report.scale.checks[0].pass, true);
  assert.deepEqual(report.fidelity, {
    verified: 0,
    interpretation: 1,
    synthetic: 7,
    unknown: 2,
  });
  assert.equal(report.lod.lod0_nodes, 8);
  assert.equal(report.lod.lod1_nodes, 1);
  assert.ok(report.lod.lod1_triangles > 0);
  assert.equal(report.collision.separate, true);
  assert.equal(report.collision.materialless, true);
  assert.deepEqual(report.textures.map((texture) => texture.pass), [true]);
  assert.equal(report.navigation.pass, true);
  assert.equal(report.navigation.waypoints.length, 3);
  assert.deepEqual(report.unknown_places.sort(), ['chandlers-row', 'tide-stairs']);
});

test('--out produces a portable textured artifact without source sidecars', () => {
  const json = parseGlb(fs.readFileSync(writtenArtifact(build()))).json;
  const images = json.images ?? [];
  assert.ok(images.length > 0);
  assert.ok(images.every((image) => image.bufferView !== undefined && !image.uri));
  assert.ok(images.every((image) => image.extras.width_px > 0 && image.extras.height_px > 0));
  assert.ok(json.materials[0].pbrMetallicRoughness.baseColorTexture);
});

test('a failing rebuild quarantines the previous artifact', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desire-asset-'));
  fs.cpSync(path.join(path.dirname(sampleManifestPath()), 'textures'),
    path.join(outDir, 'textures'), { recursive: true });
  const first = buildAsset({ manifestPath: sampleManifestPath(), outDir });
  assert.equal(first.artifactPath !== null, true);
  const manifest = JSON.parse(fs.readFileSync(sampleManifestPath(), 'utf8'));
  manifest.scale_checks[0].expected_m = 300;
  const brokenPath = path.join(outDir, 'broken.json');
  fs.writeFileSync(brokenPath, JSON.stringify(manifest));
  const second = buildAsset({ manifestPath: brokenPath, outDir });
  assert.equal(second.report.pass, false);
  const names = fs.readdirSync(outDir);
  assert.deepEqual(names.filter((name) => name.endsWith('.glb')), []);
  assert.ok(names.some((name) => name.endsWith('.glb.stale')), names.join(', '));
  assert.equal(checkedReport(second).artifact.stale_path !== undefined, true);
});

test('the artifact and its report are written next to each other', () => {
  const result = build();
  const { reportPath, bytes } = result;
  assert.ok(fs.existsSync(writtenArtifact(result)));
  assert.ok(fs.existsSync(reportPath));
  assert.ok(bytes > 1000, `artifact bytes ${bytes}`);
  const written = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.equal(written.id, 'sample-harbor');
  assert.equal(written.pass, true);
});

test('traversal identities never overwrite or quarantine outside files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desire-traversal-'));
  const outDir = path.join(root, 'out');
  fs.mkdirSync(path.join(outDir, 'scene-x'), { recursive: true });
  const victim = path.join(root, 'victim.glb');
  fs.writeFileSync(victim, 'keep this artifact');
  const manifest = JSON.parse(fs.readFileSync(sampleManifestPath(), 'utf8'));
  manifest.id = 'x/../../victim';
  const manifestPath = path.join(root, 'asset.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const result = buildAsset({ manifestPath, outDir });
  assert.equal(result.report.pass, false);
  assert.equal(result.artifactPath, null);
  assert.equal(fs.readFileSync(victim, 'utf8'), 'keep this artifact');
  assert.equal(fs.existsSync(`${victim}.stale`), false);
});

test('output containment rejects traversal and symlinks, including staging and quarantine', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desire-output-'));
  const outDir = path.join(root, 'out');
  fs.mkdirSync(outDir);
  const victim = path.join(root, 'victim');
  fs.writeFileSync(victim, 'unchanged');
  assert.throws(() => outputPath(outDir, '../victim'), /escapes directory/);
  for (const suffix of ['.glb', '.glb.pending', '.glb.stale', '.json']) {
    const name = `scene-test${suffix}`;
    fs.symlinkSync(victim, path.join(outDir, name));
    assert.throws(() => outputPath(outDir, name), /symlink/);
  }
  assert.equal(fs.readFileSync(victim, 'utf8'), 'unchanged');
});

test('invalid-manifest rebuilds quarantine the previous valid artifact', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desire-invalid-'));
  const firstArtifact = writtenArtifact(buildAsset({ manifestPath: sampleManifestPath(), outDir }));
  const manifest = JSON.parse(fs.readFileSync(sampleManifestPath(), 'utf8'));
  delete manifest.calibration;
  const manifestPath = path.join(outDir, 'invalid.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const second = buildAsset({ manifestPath, outDir });
  assert.equal(second.report.pass, false);
  assert.equal(fs.existsSync(firstArtifact), false);
  assert.ok(fs.existsSync(`${firstArtifact}.stale`));
});

test('a malformed manifest writes a failing report and leaves no artifact', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desire-asset-'));
  const brokenPath = path.join(outDir, 'broken.json');
  fs.writeFileSync(brokenPath, JSON.stringify({ schema: 'desire.asset-scene/1', places: {} }));
  const { report, artifactPath } = buildAsset({ manifestPath: brokenPath, outDir });
  assert.equal(report.pass, false);
  assert.equal(artifactPath, null);
  assert.ok(fs.existsSync(path.join(outDir, 'report.json')));
  assert.deepEqual(fs.readdirSync(outDir).filter((name) => name.endsWith('.glb')), []);
});

test('a manifest with a broken scale check fails the build instead of shipping', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desire-asset-'));
  fs.cpSync(path.join(path.dirname(sampleManifestPath()), 'textures'),
    path.join(outDir, 'textures'), { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(sampleManifestPath(), 'utf8'));
  manifest.scale_checks[0].expected_m = 300;
  const brokenPath = path.join(outDir, 'broken.json');
  fs.writeFileSync(brokenPath, JSON.stringify(manifest));
  const result = buildAsset({ manifestPath: brokenPath, outDir });
  const report = checkedReport(result);
  assert.equal(report.pass, false);
  assert.match(JSON.stringify(report.checks), /scale/);
  assert.equal(result.artifactPath, null);
  assert.equal(report.artifact.written, false);
});
