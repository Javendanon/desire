/** Offline pipeline: manifest to .glb plus an acceptance report. No network, no inference. */
import fs from 'node:fs';
import path from 'node:path';

import { buildReport } from './check.ts';
import { encodeGlb } from './glb.ts';
import { parseGlb } from './gltf-read.ts';
import { readManifest } from './io.ts';
import { safeAssetId } from './manifest.ts';
import { outputPath } from './output.ts';
import { buildScene } from './scene.ts';
import { prepareTextures } from './textures.ts';
import type { BuildReport } from './check.ts';
import type { Scene } from './scene.ts';
import type { Finding, Manifest } from './types.ts';

type ArtifactSpec = { manifest: Manifest; scene: Scene; artifactPath: string; sourceDir: string };
type FailureReport = { id: string | null; pass: false; checks: Finding[];
  error?: string; stale_path?: string; artifact?: never };
type Report = BuildReport | FailureReport;

const REPORT_NAME = 'report.json';
const PENDING_SUFFIX = '.pending';
const STALE_SUFFIX = '.stale';

function checkedPath(file: string) {
  return outputPath(path.dirname(file), path.basename(file));
}

function writeJson(file: string, value: unknown) {
  fs.writeFileSync(checkedPath(file), `${JSON.stringify(value, null, 2)}\n`);
}

function failureReport(id: string | null, checks: Finding[], error?: string): FailureReport {
  return { id: id ?? null, pass: false, checks, error };
}

function invalidReport(manifest: Manifest | null, errors: string[]) {
  const checks = errors.map((message, index) => {
    return { id: `manifest.${index}`, pass: false, detail: message };
  });
  return failureReport(manifest?.id ?? null, checks);
}

function quarantine(artifactPath: string) {
  checkedPath(artifactPath);
  if (!fs.existsSync(artifactPath)) return null;
  const stalePath = checkedPath(`${artifactPath}${STALE_SUFFIX}`);
  fs.rmSync(stalePath, { force: true });
  fs.renameSync(artifactPath, stalePath);
  return stalePath;
}

function stage(spec: ArtifactSpec) {
  const { manifest, scene, artifactPath, sourceDir } = spec;
  const pendingPath = checkedPath(`${artifactPath}${PENDING_SUFFIX}`);
  fs.rmSync(pendingPath, { force: true });
  const { images, checks: textures } = prepareTextures(manifest, sourceDir);
  const failed = textures.filter((texture) => !texture.pass);
  if (failed.length > 0) throw new Error(failed.map((texture) => texture.detail).join('; '));
  fs.writeFileSync(pendingPath, encodeGlb(scene, manifest, images));
  const gltf = parseGlb(fs.readFileSync(pendingPath));
  const bytes = fs.statSync(pendingPath).size;
  return { pendingPath, gltf, textures, bytes };
}

function finishArtifact(spec: { pendingPath: string; report: BuildReport }) {
  const { pendingPath, report } = spec;
  report.artifact.written = report.pass;
  if (report.pass) {
    fs.renameSync(checkedPath(pendingPath), checkedPath(report.artifact.path));
    return report;
  }
  fs.rmSync(pendingPath, { force: true });
  const stale = quarantine(report.artifact.path);
  if (stale) report.artifact.stale_path = stale;
  return report;
}

function buildArtifact(spec: ArtifactSpec): Report {
  const { manifest, scene, artifactPath, sourceDir } = spec;
  const pendingPath = checkedPath(`${artifactPath}${PENDING_SUFFIX}`);
  try {
    const staged = stage({ manifest, scene, artifactPath, sourceDir });
    const report = buildReport({ manifest, scene, gltf: staged.gltf, textures: staged.textures,
      bytes: staged.bytes, artifactPath });
    return finishArtifact({ pendingPath: staged.pendingPath, report });
  } catch (cause) {
    fs.rmSync(pendingPath, { force: true });
    const stale = quarantine(artifactPath);
    const report = failureReport(scene.id, [], String(cause));
    if (stale) report.stale_path = stale;
    return report;
  }
}

function rejectManifest(manifest: Manifest | null, errors: string[], targetDir: string) {
  const report = invalidReport(manifest, errors);
  if (safeAssetId(manifest?.id)) {
    const artifact = outputPath(targetDir, `scene-${manifest.id}.glb`);
    const stale = quarantine(artifact);
    if (stale) report.stale_path = stale;
  }
  return report;
}

type BuildOptions = { manifestPath: string; outDir?: string | null };

/** Validates, builds, writes report.json and keeps the .glb only when every check passes. */
export function buildAsset({ manifestPath, outDir }: BuildOptions) {
  const targetDir = outDir ?? path.dirname(manifestPath);
  fs.mkdirSync(targetDir, { recursive: true });
  const reportPath = outputPath(targetDir, REPORT_NAME);
  const { manifest, errors } = readManifest(manifestPath);
  if (errors.length > 0) {
    const report = rejectManifest(manifest, errors, targetDir);
    writeJson(reportPath, report);
    return { report, artifactPath: null, reportPath, bytes: 0 };
  }
  if (!manifest) throw new Error('validated manifest is missing');
  const scene = buildScene(manifest);
  const artifactPath = outputPath(targetDir, `scene-${scene.id}.glb`);
  const sourceDir = path.dirname(manifestPath);
  const report = buildArtifact({ manifest, scene, artifactPath, sourceDir });
  writeJson(reportPath, report);
  const written = report.artifact?.written === true;
  return {
    report,
    artifactPath: written ? artifactPath : null,
    reportPath,
    bytes: written ? report.artifact!.bytes : 0,
  };
}
