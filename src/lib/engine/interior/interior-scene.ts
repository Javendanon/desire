// The built interior: one root per floor holding its shell and its furniture, plus the slide. Only
// the active floor and the floors under it are shown, so the camera looks down into the active one.
import * as pc from 'playcanvas';

import type { FloorPlan, Prop, PropCatalog } from '../../../generated/contracts.ts';
import { furniturePose } from '../plan/interior-placement.ts';
import { InteriorAssets } from './interior-assets.ts';
import { TintCache } from './tints.ts';

/** Model names inside the asset set: one per floor id, the slide, and `prop:<kind>`. */
export const SLIDE_MODEL = 'tobogan';
export const propModel = (kind: string): string => `prop:${kind}`;
/** Pieces lower than this cast no shadow: they barely darken the floor and double draw calls. */
const SHADOW_MIN_HEIGHT_M = 1;

/** Every model an interior needs, as `name → url` under `base` (which ends with a slash). */
export function interiorModelUrls(plan: FloorPlan, catalog: PropCatalog, base: string) {
  const urls = new Map(plan.floors.map((floor) => [floor.id, `${base}${floor.id}.glb`]));
  urls.set(SLIDE_MODEL, `${base}${SLIDE_MODEL}.glb`);
  for (const prop of catalog.props) urls.set(propModel(prop.kind), `${base}${prop.model}`);
  return urls;
}

function castNoShadow(root: pc.Entity): void {
  for (const render of root.findComponents('render') as pc.RenderComponent[]) {
    render.castShadows = false;
  }
}

export class InteriorScene {
  readonly root = new pc.Entity('interior');
  private readonly floorRoots = new Map<string, pc.Entity>();
  private readonly tints = new TintCache();
  private readonly plan: FloorPlan;

  constructor(plan: FloorPlan, catalog: PropCatalog, assets: InteriorAssets) {
    this.plan = plan;
    const props = new Map(catalog.props.map((prop) => [prop.kind, prop]));
    for (const floor of plan.floors) this.root.addChild(this.buildFloor(floor, props, assets));
    if (assets.has(SLIDE_MODEL)) this.root.addChild(assets.instantiate(SLIDE_MODEL));
  }

  private buildFloor(floor: FloorPlan['floors'][number], props: Map<string, Prop>,
    assets: InteriorAssets): pc.Entity {
    const root = new pc.Entity(`piso-${floor.id}`);
    root.addChild(assets.instantiate(floor.id));
    for (const item of floor.furniture) {
      const prop = props.get(item.kind);
      if (!prop) continue;
      const piece = assets.instantiate(propModel(item.kind));
      if (prop.height_m < SHADOW_MIN_HEIGHT_M) castNoShadow(piece);
      const pose = furniturePose(this.plan, { floor, item, prop });
      piece.setLocalPosition(pose.position.x, pose.position.y, pose.position.z);
      piece.setLocalEulerAngles(0, pose.yawDegrees, 0);
      const tint = prop.variants.find((variant) => variant.id === item.variant)?.tint;
      if (tint) this.tints.apply(piece, tint);
      root.addChild(piece);
    }
    this.floorRoots.set(floor.id, root);
    return root;
  }

  /** Shows `floorId` and every floor below it, and hides the floors above. */
  setFloor(floorId: string): void {
    const active = this.plan.floors.find((floor) => floor.id === floorId);
    if (!active) throw new Error(`interior: no floor ${floorId}`);
    for (const floor of this.plan.floors) {
      const root = this.floorRoots.get(floor.id);
      if (root) root.enabled = floor.elevation_m <= active.elevation_m;
    }
  }

  destroy(): void {
    this.root.destroy();
    this.tints.destroy();
  }
}
