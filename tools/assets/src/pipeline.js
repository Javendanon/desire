/** Offline pipeline: manifest to .glb plus an acceptance report. No network, no inference. */
import fs from 'node:fs';
import path from 'node:path';

import { buildReport } from './check.js';
import { encodeGlb } from './glb.js';
import { parseGlb } from './gltf-read.js';
import { readManifest } from './io.js';
import { buildScene } from './scene.js';
import { checkTextures } from './textures.js';

const REPORT_NAME = 'report.json';
const PENDING_SUFFIX = '.pending';
const STALE_SUFFIX = '.stale';

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function failureReport(id, checks, error) {
  return { id: id ?? null, pass: false, checks, error };
}

function invalidReport(manifest, errors) {
  const checks = errors.map((message, index) => {
    return { id: `manifest.${index}`, pass: false, detail: message };
  });
  return failureReport(manifest?.id, checks);
}

function quarantine(artifactPath) {
  if (!fs.existsSync(artifactPath)) return null;
  const stalePath = `${artifactPath}${STALE_SUFFIX}`;
  fs.rmSync(stalePath, { force: true });
  fs.renameSync(artifactPath, stalePath);
  return stalePath;
}

function stage(spec) {
  const { manifest, scene, artifactPath, sourceDir } = spec;
  const pendingPath = `${artifactPath}${PENDING_SUFFIX}`;
  fs.rmSync(pendingPath, { force: true });
  fs.writeFileSync(pendingPath, encodeGlb(scene, manifest));
  const gltf = parseGlb(fs.readFileSync(pendingPath));
  const textures = checkTextures(manifest, sourceDir);
  const bytes = fs.statSync(pendingPath).size;
  return { pendingPath, gltf, textures, bytes };
}

function finishArtifact(spec) {
  const { pendingPath, report } = spec;
  report.artifact.written = report.pass;
  if (report.pass) {
    fs.renameSync(pendingPath, report.artifact.path);
    return report;
  }
  fs.rmSync(pendingPath, { force: true });
  const stale = quarantine(report.artifact.path);
  if (stale) report.artifact.stale_path = stale;
  return report;
}

function buildArtifact(spec) {
  const { manifest, scene, artifactPath, sourceDir } = spec;
  const pendingPath = `${artifactPath}${PENDING_SUFFIX}`;
  try {
    const staged = stage({ manifest, scene, artifactPath, sourceDir });
    const report = buildReport({ manifest, scene, gltf: staged.gltf, textures: staged.textures,
      bytes: staged.bytes, artifactPath });
    return finishArtifact({ pendingPath: staged.pendingPath, report });
  } catch (cause) {
    fs.rmSync(pendingPath, { force: true });
    const stale = quarantine(artifactPath);
    const report = failureReport(scene.id, [], cause.message);
    if (stale) report.stale_path = stale;
    return report;
  }
}

/** Validates, builds, writes report.json and keeps the .glb only when every check passes. */
export function buildAsset({ manifestPath, outDir }) {
  const targetDir = outDir ?? path.dirname(manifestPath);
  fs.mkdirSync(targetDir, { recursive: true });
  const reportPath = path.join(targetDir, REPORT_NAME);
  const { manifest, errors } = readManifest(manifestPath);
  if (errors.length > 0) {
    const report = invalidReport(manifest, errors);
    writeJson(reportPath, report);
    return { report, artifactPath: null, reportPath, bytes: 0 };
  }
  const scene = buildScene(manifest);
  const artifactPath = path.join(targetDir, `scene-${scene.id}.glb`);
  const sourceDir = path.dirname(manifestPath);
  const report = buildArtifact({ manifest, scene, artifactPath, sourceDir });
  writeJson(reportPath, report);
  const written = report.artifact?.written === true;
  return {
    report,
    artifactPath: written ? artifactPath : null,
    reportPath,
    bytes: written ? report.artifact.bytes : 0,
  };
}
