/** Manifest loading and validation boundary; the only file access of the pipeline. */
import fs from 'node:fs';

import { validateManifest } from './manifest.ts';
import type { Manifest } from './types.ts';

/** Reads a manifest file and returns its parsed data together with validation errors. */
type ManifestRead = { manifest: Manifest | null; errors: string[] };

export function readManifest(manifestPath: string): ManifestRead {
  const raw = fs.readFileSync(manifestPath, 'utf8');
  let manifest: Manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (cause) {
    return { manifest: null, errors: [`${manifestPath}: invalid JSON (${String(cause)})`] };
  }
  try {
    const { errors } = validateManifest(manifest);
    return { manifest, errors };
  } catch (cause) {
    return { manifest, errors: [`${manifestPath}: validation failed (${String(cause)})`] };
  }
}
