/** Offline pipeline: manifest to a map package plus an acceptance report. No network. */
import fs from 'node:fs';
import path from 'node:path';

import { buildReport, type BuildReport } from './check.ts';
import { readManifest } from './io.ts';
import { safeAssetId } from './manifest.ts';
import { outputPath } from './output.ts';
import { buildPackage } from './package.ts';
import { readPackage, writePackage } from './package-io.ts';
import { buildScene } from './scene.ts';
import type { Finding, Manifest } from './types.ts';

type FailureReport = {
  id: string | null;
  pass: false;
  checks: Finding[];
  error?: string;
  stale_path?: string;
  artifact?: never;
};
type Report = BuildReport | FailureReport;
type BuildOptions = {
  manifestPath: string;
  outDir?: string | null;
};

const REPORT_NAME = 'report.json';
const PENDING_SUFFIX = '.pending';
const STALE_SUFFIX = '.stale';

export const packageName = (id: string) => `map-${id}`;

function writeJson(file: string, value: unknown) {
  fs.writeFileSync(outputPath(path.dirname(file), path.basename(file)),
    `${JSON.stringify(value, null, 2)}\n`);
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

/** Moves a published package aside so a consumer can never load a failed build's predecessor. */
function quarantine(targetDir: string, name: string) {
  const published = outputPath(targetDir, name);
  if (!fs.existsSync(published)) return null;
  const stale = outputPath(targetDir, `${name}${STALE_SUFFIX}`);
  fs.rmSync(stale, { recursive: true, force: true });
  fs.renameSync(published, stale);
  return path.basename(stale);
}

function publish(targetDir: string, name: string, pending: string) {
  const published = outputPath(targetDir, name);
  fs.rmSync(published, { recursive: true, force: true });
  fs.renameSync(pending, published);
}

function buildPackageDir(manifest: Manifest, targetDir: string): Report {
  const name = packageName(manifest.id);
  const pending = outputPath(targetDir, `${name}${PENDING_SUFFIX}`);
  fs.rmSync(pending, { recursive: true, force: true });
  try {
    const scene = buildScene(manifest);
    const artifact = writePackage(pending, buildPackage(scene, manifest));
    const written = readPackage(pending);
    const report = buildReport({ manifest, scene, written, artifact: { ...artifact, path: name } });
    report.artifact.written = report.pass;
    if (report.pass) publish(targetDir, name, pending);
    else {
      fs.rmSync(pending, { recursive: true, force: true });
      const stale = quarantine(targetDir, name);
      if (stale) report.artifact.stale_path = stale;
    }
    return report;
  } catch (cause) {
    fs.rmSync(pending, { recursive: true, force: true });
    const report = failureReport(manifest.id, [], String(cause));
    const stale = quarantine(targetDir, name);
    if (stale) report.stale_path = stale;
    return report;
  }
}

function rejectManifest(manifest: Manifest | null, errors: string[], targetDir: string) {
  const report = invalidReport(manifest, errors);
  if (safeAssetId(manifest?.id)) {
    const stale = quarantine(targetDir, packageName(manifest.id));
    if (stale) report.stale_path = stale;
  }
  return report;
}

/** Validates, builds, writes report.json and keeps the package only when every check passes. */
export function buildAsset({ manifestPath, outDir }: BuildOptions) {
  const targetDir = outDir ?? path.dirname(manifestPath);
  fs.mkdirSync(targetDir, { recursive: true });
  const reportPath = outputPath(targetDir, REPORT_NAME);
  const { manifest, errors } = readManifest(manifestPath);
  const report = errors.length > 0 || !manifest
    ? rejectManifest(manifest, errors, targetDir)
    : buildPackageDir(manifest, targetDir);
  writeJson(reportPath, report);
  const written = report.artifact?.written === true;
  return {
    report,
    packagePath: written ? outputPath(targetDir, report.artifact!.path) : null,
    reportPath,
    bytes: written ? report.artifact!.bytes : 0,
  };
}
