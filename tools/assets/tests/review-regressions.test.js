import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { evaluateScaleChecks } from '../src/calibration.ts';
import { readManifest } from '../src/io.ts';
import { validateManifest } from '../src/manifest.ts';
import { navigate } from '../src/nav.ts';
import { buildAsset } from '../src/pipeline.ts';
import { checkTextures } from '../src/textures.ts';
import { fixturePath, sampleManifestPath, samplePath } from './helpers.js';

const base = () => readManifest(sampleManifestPath()).manifest;

function fixture(context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desire-review-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  fs.mkdirSync(source);
  const manifest = base();
  const manifestPath = path.join(source, 'asset.json');
  return { root, source, manifest, manifestPath };
}

test('truncated and header-only WebP images cannot ship', (context) => {
  const { source, manifest, manifestPath } = fixture(context);
  manifest.textures[0].path = 'broken.webp';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const imagePath = path.join(path.dirname(sampleManifestPath()), 'textures/paving.webp');
  const sample = fs.readFileSync(imagePath);
  const headerOnly = Buffer.alloc(30);
  headerOnly.write('RIFF', 0);
  headerOnly.writeUInt32LE(22, 4);
  headerOnly.write('WEBPVP8X', 8);
  headerOnly.writeUInt32LE(10, 16);
  headerOnly.writeUIntLE(15, 24, 3);
  headerOnly.writeUIntLE(15, 27, 3);
  for (const data of [sample.subarray(0, 30), headerOnly]) {
    fs.writeFileSync(path.join(source, 'broken.webp'), data);
    const result = buildAsset({ manifestPath });
    assert.equal(result.report.pass, false);
    assert.equal(result.artifactPath, null);
  }
});

test('KTX2 is rejected until a verified BasisU encoder/decoder contract exists', () => {
  const manifest = base();
  manifest.textures[0].mime = 'image/ktx2';
  assert.match(validateManifest(manifest).errors.join('\n'), /compressed/);
});

test('texture symlinks cannot embed outside material', (context) => {
  const { root, source, manifest, manifestPath } = fixture(context);
  const outside = path.join(root, 'outside.webp');
  fs.copyFileSync(path.join(path.dirname(sampleManifestPath()), 'textures/paving.webp'), outside);
  const before = fs.readFileSync(outside);
  fs.symlinkSync(outside, path.join(source, 'linked.webp'));
  manifest.textures[0].path = 'linked.webp';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const result = buildAsset({ manifestPath });
  assert.equal(result.report.pass, false);
  assert.equal(result.artifactPath, null);
  assert.deepEqual(fs.readFileSync(outside), before);
});

test('invalid PBR factors are rejected at the JSON boundary', () => {
  for (const value of ['not-a-number', -0.1, 1.1, null]) {
    const manifest = base();
    manifest.materials[0].metallic = value;
    manifest.materials[0].roughness = value;
    const errors = validateManifest(manifest).errors.join('\n');
    assert.match(errors, /metallic/);
    assert.match(errors, /roughness/);
  }
});

test('malformed sections and null waypoints return validation errors instead of throwing', () => {
  for (const patch of [{ materials: {} }, { textures: {} }, { waypoints: [null] }]) {
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

test('oversized textures are rejected before their contents are read', (context) => {
  const { source, manifest } = fixture(context);
  manifest.textures[0].path = 'large.webp';
  fs.writeFileSync(path.join(source, 'large.webp'), Buffer.alloc(262145));
  const [result] = checkTextures(manifest, source);
  assert.equal(result.pass, false);
  assert.match(result.detail, /budget/);
});

test('a texture whose decoded raster exceeds one mebibyte still publishes', (context) => {
  const { source, manifest, manifestPath } = fixture(context);
  fs.copyFileSync(fixturePath('detail-640.webp'), path.join(source, 'detail.webp'));
  manifest.textures[0] = { ...manifest.textures[0], path: 'detail.webp', width_px: 640,
    height_px: 640 };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const [texture] = checkTextures(manifest, source);
  assert.doesNotMatch(texture.detail, /unavailable/);
  assert.equal(texture.pass, true);
  assert.equal(buildAsset({ manifestPath }).report.pass, true);
});

const FAKE_PNG_2X2 = String.raw`printf '\211PNG\r\n\032\n\000\000\000\015IHDR` +
  String.raw`\000\000\000\002\000\000\000\002'`;
const WRITE_TARGET = 'out=""; prev=""; for arg in "$@"; do if [ "$prev" = "-o" ];' +
  ' then out="$arg"; fi; prev="$arg"; done';

/** Put a scripted dwebp first on PATH, or an empty PATH to simulate a missing decoder. */
function scriptedDecoder(context, body) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'desire-fake-dwebp-'));
  const previous = process.env.PATH;
  if (body !== null) {
    const script = `#!/bin/sh\ncat >/dev/null\n${body}\n`;
    fs.writeFileSync(path.join(bin, 'dwebp'), script, { mode: 0o755 });
  }
  process.env.PATH = body === null ? bin : `${bin}:${previous}`;
  context.after(() => {
    process.env.PATH = previous;
    fs.rmSync(bin, { recursive: true, force: true });
  });
}

/** A valid WebP plus the manifest that declares its real resolution. */
function decodedFixture(context) {
  const { source, manifest } = fixture(context);
  fs.copyFileSync(fixturePath('detail-640.webp'), path.join(source, 'detail.webp'));
  manifest.textures[0] = { ...manifest.textures[0], path: 'detail.webp', width_px: 640,
    height_px: 640 };
  return { source, manifest };
}

function checkWithScript(context, body) {
  scriptedDecoder(context, body);
  const { source, manifest } = decodedFixture(context);
  return checkTextures(manifest, source)[0];
}

test('a decoder that writes a different raster fails the texture check', (context) => {
  const texture = checkWithScript(context, `${WRITE_TARGET}\n${FAKE_PNG_2X2} > "$out"`);
  assert.equal(texture.pass, false);
  assert.match(texture.detail, /decoded raster does not match the declared resolution/);
});

test('a decoder that writes a non-image fails the texture check', (context) => {
  const texture = checkWithScript(context, `${WRITE_TARGET}\nprintf 'not-a-png' > "$out"`);
  assert.equal(texture.pass, false);
  assert.match(texture.detail, /decoded raster is not a PNG image/);
});

test('a decoder that writes nothing fails with context instead of throwing', (context) => {
  const texture = checkWithScript(context, 'exit 0');
  assert.equal(texture.pass, false);
  assert.match(texture.detail, /decoded raster cannot be read/);
});

test('a missing decoder is reported as such, not as a bad texture', (context) => {
  const texture = checkWithScript(context, null);
  assert.equal(texture.pass, false);
  assert.match(texture.detail, /dwebp decoder unavailable or failed/);
});

test('the committed sample report is reproducible and path-independent', (context) => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desire-sample-report-'));
  context.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
  const { report } = buildAsset({ manifestPath: sampleManifestPath(), outDir });
  const committed = JSON.parse(fs.readFileSync(samplePath('report.json'), 'utf8'));
  assert.deepEqual(report, committed);
  assert.equal(committed.artifact.path, 'scene-sample-harbor.glb');
  assert.equal(path.isAbsolute(committed.artifact.path), false);
  assert.equal(fs.existsSync(path.join(outDir, committed.artifact.path)), true);
});

test('spawn and waypoint share closed ground boundary semantics', () => {
  const ground = { origin_x_m: 0, origin_z_m: 0, width_m: 10, height_m: 10 };
  const spawn = { x_m: 10, z_m: 5 };
  const report = navigate({ ground, blockers: [], spawn, waypoints: [{ id: 'edge', ...spawn }] });
  assert.equal(report.pass, true);
});

test('scale acceptance uses unrounded distances', () => {
  const manifest = base();
  const check = { ...manifest.scale_checks[0], expected_m: 225.0004, tolerance_m: 1 };
  assert.equal(evaluateScaleChecks(manifest.calibration, [check])[0].pass, false);
});
