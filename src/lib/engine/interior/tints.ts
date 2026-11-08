// Recolours the `variant` material of a furniture model with its catalogue colour. One tinted copy
// per colour is shared by every piece that uses it, so twenty chairs cost one material.
import * as pc from 'playcanvas';

/** The material name the interior build gives to the recolourable part of a piece. */
export const VARIANT_MATERIAL = 'variant';

export class TintCache {
  private readonly tinted = new Map<string, pc.StandardMaterial>();

  /** Swaps every `variant` material under `root` for its copy tinted `color` (#rrggbb). */
  apply(root: pc.Entity, color: string): void {
    for (const render of root.findComponents('render') as pc.RenderComponent[]) {
      for (const instance of render.meshInstances) {
        if (instance.material?.name === VARIANT_MATERIAL) {
          instance.material = this.tint(instance.material as pc.StandardMaterial, color);
        }
      }
    }
  }

  private tint(base: pc.StandardMaterial, color: string): pc.StandardMaterial {
    const cached = this.tinted.get(color);
    if (cached) return cached;
    const copy = base.clone();
    copy.name = `${VARIANT_MATERIAL}-${color}`;
    copy.diffuse = new pc.Color().fromString(color);
    copy.update();
    this.tinted.set(color, copy);
    return copy;
  }

  destroy(): void {
    for (const material of this.tinted.values()) material.destroy();
    this.tinted.clear();
  }
}
