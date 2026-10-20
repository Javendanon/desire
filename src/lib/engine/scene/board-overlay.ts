// The hex grid on the deck and the cells a piece can reach. Discs light up for reachable and
// hovered cells; the outlines are immediate-mode lines drawn while the scene level is shown.

import * as pc from 'playcanvas';

import { hexCorners } from '../math/hex.ts';
import type { Cell } from '../plan/board.ts';
import { geometryMesh } from '../render/kit.ts';

const OUTLINE = new pc.Color(0.95, 0.9, 0.77, 0.28);

function overlayMaterial(opacity: number): pc.StandardMaterial {
  const m = new pc.StandardMaterial();
  m.diffuse = new pc.Color(0, 0, 0);
  m.emissive = new pc.Color().fromString('#f3e6c4');
  m.opacity = opacity;
  m.blendType = pc.BLEND_NORMAL;
  m.depthWrite = false;
  m.useLighting = false;
  m.update();
  return m;
}

export class BoardOverlay {
  readonly root = new pc.Entity('board');
  private readonly discs: pc.Entity[] = [];
  private readonly lines: pc.Vec3[] = [];
  private readonly reachMaterial = overlayMaterial(0.28);
  private readonly hoverMaterial = overlayMaterial(0.6);

  constructor(device: pc.GraphicsDevice, cells: readonly Cell[], cellSize: number, deckY: number) {
    const disc = geometryMesh(
      device,
      new pc.CylinderGeometry({
        radius: cellSize * 0.9,
        height: 0.02,
        capSegments: 6,
      }),
    );
    for (const cell of cells) {
      const entity = new pc.Entity('cell');
      entity.addComponent('render', {
        meshInstances: [new pc.MeshInstance(disc, this.reachMaterial)],
      });
      entity.setLocalPosition(cell.x, deckY + 0.03, cell.z);
      entity.setLocalEulerAngles(0, 30, 0);
      entity.enabled = false;
      this.root.addChild(entity);
      this.discs.push(entity);
      const corners = hexCorners(cell, cellSize * 0.97);
      corners.forEach((corner, k) => {
        const next = corners[(k + 1) % corners.length];
        this.lines.push(
          new pc.Vec3(corner.x, deckY + 0.025, corner.z),
          new pc.Vec3(next.x, deckY + 0.025, next.z),
        );
      });
    }
  }

  /** Light up `reach`, the hovered cell is brighter. Pass an empty list to clear. */
  paint(reach: readonly number[], hover: number | null): void {
    const lit = new Set(reach);
    this.discs.forEach((disc, index) => {
      disc.enabled = lit.has(index);
      const instance = disc.render?.meshInstances[0];
      if (instance) instance.material = index === hover ? this.hoverMaterial : this.reachMaterial;
    });
  }

  drawGrid(app: pc.AppBase): void {
    app.drawLines(this.lines, OUTLINE, true);
  }

  destroy(): void {
    this.root.destroy();
  }
}
