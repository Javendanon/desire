// The complete input of one Blender build and its fingerprint. The build writes the fingerprint to
// `manifest.json` next to the models, so a test can tell when the committed models are stale.
import { createHash } from 'node:crypto';

import type { FloorPlan, PropCatalog } from '../../../src/generated/contracts.ts';
import { propShapes } from './props.ts';
import { buildScene, type BuildScene, type Shape } from './scene.ts';

export interface PropModel {
  kind: string;
  shapes: Shape[];
}

export interface BuildInput extends BuildScene {
  props: PropModel[];
  /** sha256 of everything above, as compact JSON. */
  hash: string;
}

/** Everything the build makes, with its fingerprint. O(cells + links + props). */
export function buildInput(plan: FloorPlan, catalog: PropCatalog): BuildInput {
  const props = catalog.props.map((prop) => ({
    kind: prop.kind,
    shapes: propShapes(prop, plan.cell_size_m),
  }));
  const content = { ...buildScene(plan), props };
  const hash = createHash('sha256').update(JSON.stringify(content)).digest('hex');
  return { ...content, hash };
}
