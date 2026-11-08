// Lantern-coloured tiles on the squares a miniature can reach, so the player sees where a click
// will move it. Rebuilt whenever move mode changes; tiny compared with the house.
import * as pc from 'playcanvas';

import type { FloorPlan } from '../../../generated/contracts.ts';
import type { FloorCellRef } from '../plan/floor-index.ts';
import { cellCentre } from '../plan/interior-placement.ts';
import { material, part } from '../render/kit.ts';

/** A reached square is drawn a little inside its edges and just above the floor. */
const TILE_SHARE = 0.86;
const TILE_LIFT = 0.03;
/** Lit squares tint the floor without hiding its wood. */
const TILE_OPACITY = 0.28;

export class MoveOverlay {
  readonly root = new pc.Entity('alcance');
  private readonly plan: FloorPlan;
  private readonly lantern = material({
    color: '#e0aa4f',
    emissive: '#e0aa4f',
    emissiveIntensity: 0.25,
  });

  constructor(plan: FloorPlan) {
    this.plan = plan;
    this.lantern.opacity = TILE_OPACITY;
    this.lantern.blendType = pc.BLEND_NORMAL;
    this.lantern.depthWrite = false;
    this.lantern.update();
  }

  show(cells: readonly FloorCellRef[]): void {
    this.clear();
    const size = this.plan.cell_size_m * TILE_SHARE;
    for (const cell of cells) {
      const at = cellCentre(this.plan, cell);
      const tile = part(this.root, {
        type: 'plane',
        material: this.lantern,
        position: [at.x, at.y + TILE_LIFT, at.z],
        scale: [size, 1, size],
      });
      if (tile.render) tile.render.castShadows = false;
    }
  }

  clear(): void {
    for (const child of [...this.root.children]) child.destroy();
  }

  destroy(): void {
    this.root.destroy();
    this.lantern.destroy();
  }
}
