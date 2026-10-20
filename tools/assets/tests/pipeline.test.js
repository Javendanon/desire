import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { parseGlb } from '../src/gltf-read.js';
import { buildAsset } from '../src/pipeline.js';
import { sampleManifestPath } from './helpers.js';

const build = async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desire-asset-'));
  const result = await buildAsset({ manifestPath: sampleManifestPath(), outDir });
  return result;
};

test('the sample scene builds into a navigable artifact with all checks green', async () => {
  const { report } = await build();
  const failed = report.checks.filter((check) => !check.pass);
  assert.deepEqual(failed, [], 'no failing acceptance check');
  assert.equal(report.pass, true);
});

test('the report records scale, fidelity, collision, textures and navigation', async () => {
  const { report } = await build();
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

test('--out produces a portable textured artifact without source sidecars', async () => {
  const { artifactPath } = await build();
  const json = parseGlb(fs.readFileSync(artifactPath)).json;
  assert.ok(json.images.length > 0);
  assert.ok(json.images.every((image) => image.bufferView !== undefined && !image.uri));
  assert.ok(json.images.every((image) => image.extras.width_px > 0 && image.extras.height_px > 0));
  assert.ok(json.materials[0].pbrMetallicRoughness.baseColorTexture);
});

test('a failing rebuild quarantines the previous artifact', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desire-asset-'));
  const first = await buildAsset({ manifestPath: sampleManifestPath(), outDir });
  assert.equal(first.artifactPath !== null, true);
  const manifest = JSON.parse(fs.readFileSync(sampleManifestPath(), 'utf8'));
  manifest.scale_checks[0].expected_m = 300;
  const brokenPath = path.join(outDir, 'broken.json');
  fs.writeFileSync(brokenPath, JSON.stringify(manifest));
  const second = await buildAsset({ manifestPath: brokenPath, outDir });
  assert.equal(second.report.pass, false);
  const names = fs.readdirSync(outDir);
  assert.deepEqual(names.filter((name) => name.endsWith('.glb')), []);
  assert.ok(names.some((name) => name.endsWith('.glb.stale')), names.join(', '));
  assert.equal(second.report.artifact.stale_path !== undefined, true);
});

test('the artifact and its report are written next to each other', async () => {
  const { artifactPath, reportPath, bytes } = await build();
  assert.ok(fs.existsSync(artifactPath));
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

test('invalid-manifest rebuilds quarantine the previous valid artifact', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desire-invalid-'));
  const first = buildAsset({ manifestPath: sampleManifestPath(), outDir });
  assert.ok(first.artifactPath);
  const manifest = JSON.parse(fs.readFileSync(sampleManifestPath(), 'utf8'));
  delete manifest.calibration;
  const manifestPath = path.join(outDir, 'invalid.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const second = buildAsset({ manifestPath, outDir });
  assert.equal(second.report.pass, false);
  assert.equal(fs.existsSync(first.artifactPath), false);
  assert.ok(fs.existsSync(`${first.artifactPath}.stale`));
});

test('a malformed manifest writes a failing report and leaves no artifact', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desire-asset-'));
  const brokenPath = path.join(outDir, 'broken.json');
  fs.writeFileSync(brokenPath, JSON.stringify({ schema: 'desire.asset-scene/1', places: {} }));
  const { report, artifactPath } = await buildAsset({ manifestPath: brokenPath, outDir });
  assert.equal(report.pass, false);
  assert.equal(artifactPath, null);
  assert.ok(fs.existsSync(path.join(outDir, 'report.json')));
  assert.deepEqual(fs.readdirSync(outDir).filter((name) => name.endsWith('.glb')), []);
});

test('a manifest with a broken scale check fails the build instead of shipping', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desire-asset-'));
  const manifest = JSON.parse(fs.readFileSync(sampleManifestPath(), 'utf8'));
  manifest.scale_checks[0].expected_m = 300;
  const brokenPath = path.join(outDir, 'broken.json');
  fs.writeFileSync(brokenPath, JSON.stringify(manifest));
  const { report, artifactPath } = await buildAsset({ manifestPath: brokenPath, outDir });
  assert.equal(report.pass, false);
  assert.match(JSON.stringify(report.checks), /scale/);
  assert.equal(artifactPath, null);
  assert.equal(report.artifact.written, false);
});
