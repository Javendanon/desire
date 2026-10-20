import path from 'node:path';

import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path of the tools/assets tree. */
export const toolsRoot = path.resolve(here, '..');

export const sampleId = 'sample-harbor';

export const sampleDir = () => path.join(toolsRoot, 'samples', sampleId);

export const sampleManifestPath = () => path.join(sampleDir(), 'asset.json');

/** Resolve a path declared inside the sample manifest. */
export const samplePath = (relative) => path.join(sampleDir(), relative);

/** Resolve a committed test fixture that is not part of the sample asset. */
export const fixturePath = (name) => path.join(toolsRoot, 'tests', 'fixtures', name);
