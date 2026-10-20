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

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function invalidReport(manifest, errors) {
  return {
    id: manifest?.id ?? null,
    pass: false,
    checks: errors.map((message, index) => {
      return { id: `manifest.${index}`, pass: false, detail: message };
    }),
    errors,
  };
}

/** Validates, builds the scene, writes scene-<id>.glb and report.json, then checks the artifact. */
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
  fs.writeFileSync(artifactPath, encodeGlb(scene, manifest));
  const gltf = parseGlb(fs.readFileSync(artifactPath));
  const textures = checkTextures(manifest, path.dirname(manifestPath));
  const bytes = fs.statSync(artifactPath).size;
  const report = buildReport({ manifest, scene, gltf, textures, bytes, artifactPath });
  writeJson(reportPath, report);
  return { report, artifactPath, reportPath, bytes };
}
