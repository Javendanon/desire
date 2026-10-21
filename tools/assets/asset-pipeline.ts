#!/usr/bin/env node
/** CLI: build one illustration manifest into a map package and its acceptance report. */
import path from 'node:path';

import { buildAsset } from './src/pipeline.ts';

const EXIT_FAIL = 2;

function parseArgs(argv: string[]) {
  const args: {
    manifestPath: string | null;
    outDir: string | null;
  } = {
    manifestPath: null, outDir: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--manifest') args.manifestPath = argv[index += 1] ?? null;
    else if (flag === '--out') args.outDir = argv[index += 1] ?? null;
  }
  return args;
}

function usage() {
  return 'usage: node tools/assets/asset-pipeline.ts --manifest <asset.json> [--out <dir>]';
}

function main(argv: string[]) {
  const { manifestPath, outDir } = parseArgs(argv);
  if (!manifestPath) {
    console.error(usage());
    process.exitCode = EXIT_FAIL;
    return;
  }
  const { report, packagePath, reportPath } = buildAsset({ manifestPath, outDir });
  const failed = report.checks.filter((check) => !check.pass);
  const status = report.pass ? 'PASS' : 'FAIL';
  console.log(`${report.id ?? manifestPath}: ${status} (${path.basename(reportPath)})`);
  if (packagePath) console.log(`package ${packagePath}`);
  for (const check of failed) console.error(`  FAIL ${check.id}: ${check.detail}`);
  process.exitCode = report.pass ? 0 : EXIT_FAIL;
}

main(process.argv.slice(2));
