// Everything the Blender build makes for one FloorPlan: a model per floor (shell plus the links it
// carries) and the slide. Pure data, written to JSON for `build.py`.
import type { FloorPlan } from '../../../src/generated/contracts.ts';
import { linkParts, slideSpec, type SlideSpec } from './links.ts';
import { MATERIALS, type MaterialSpec } from './materials.ts';
import type { Shape } from './shapes.ts';
import { floorShell } from './shell.ts';

export type { Shape } from './shapes.ts';

export interface FloorModel {
  id: string;
  shapes: Shape[];
}

export interface BuildScene {
  plan: string;
  floors: FloorModel[];
  slide: SlideSpec | null;
  materials: Readonly<Record<string, MaterialSpec>>;
}

/** One model per floor plus the slide. O(cells + links). */
export function buildScene(plan: FloorPlan): BuildScene {
  const links = linkParts(plan);
  const floors = plan.floors.map((floor) => ({
    id: floor.id,
    shapes: [
      ...floorShell(plan, floor),
      ...links.filter((part) => part.floor === floor.id).flatMap((part) => part.shapes),
    ],
  }));
  return { plan: plan.id, floors, slide: slideSpec(plan), materials: MATERIALS };
}
