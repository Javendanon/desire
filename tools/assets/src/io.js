/** Manifest loading and validation boundary; the only file access of the pipeline. */
import fs from 'node:fs';

import { validateManifest } from './manifest.js';

/** Reads a manifest file and returns its parsed data together with validation errors. */
export function readManifest(manifestPath) {
  const raw = fs.readFileSync(manifestPath, 'utf8');
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (cause) {
    return { manifest: null, errors: [`${manifestPath}: invalid JSON (${cause.message})`] };
  }
  const { errors } = validateManifest(manifest);
  return { manifest, errors };
}
