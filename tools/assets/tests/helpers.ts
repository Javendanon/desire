import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readManifest } from '../src/io.ts';
import type { Manifest } from '../src/types.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path of the tools/assets tree. */
export const toolsRoot = path.resolve(here, '..');

export const sampleId = 'sample-harbor';

export const sampleDir = () => path.join(toolsRoot, 'samples', sampleId);

export const sampleManifestPath = () => path.join(sampleDir(), 'asset.json');

/** Resolve a path declared inside the sample manifest. */
export const samplePath = (relative: string) => path.join(sampleDir(), relative);

/** Resolve a committed test fixture that is not part of the sample asset. */
export const fixturePath = (name: string) => path.join(toolsRoot, 'tests', 'fixtures', name);

/** A fresh, mutable copy of the valid sample manifest. */
export function sampleManifest(): Manifest {
  const { manifest, errors } = readManifest(sampleManifestPath());
  assert.ok(manifest, `sample manifest must parse: ${errors.join('; ')}`);
  return manifest;
}
