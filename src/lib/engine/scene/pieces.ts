// Miniatures on the board: where each one stands, how it is carried to a new cell, how it tips
// over when it falls, plus the turn gem and the selection ring. Per-frame work, no UI.

import * as pc from 'playcanvas';

import type { Vec3Like } from '../math/camera-rig.ts';
import type { SphereTarget } from '../math/ray.ts';
import type { Point2 } from '../math/hex.ts';
import type { Cell } from '../plan/board.ts';
import { material, part } from '../render/kit.ts';
import {
  buildMiniature,
  MINIATURE_SCALE,
  type Look,
  type Miniature,
  type Side,
} from '../render/miniatures.ts';

export interface PieceSpec {
  id: string;
  side: Side;
  look: Look;
  fallen: boolean;
  /** Preferred starting point relative to the scene centre, snapped to the nearest free cell. */
  at: Point2;
}

interface Carry {
  from: Vec3Like;
  to: Point2;
  progress: number;
}

interface Piece extends Miniature {
  spec: PieceSpec;
  tilt: number;
  carry: Carry | null;
}

const CARRY_SECONDS = 0.7;
const CARRY_LIFT = 1.3;
const FALLEN_TILT = -83;

export class PieceSet {
  readonly root = new pc.Entity('pieces');
  private readonly pieces = new Map<string, Piece>();
  private readonly gem: pc.Entity;
  private readonly ring: pc.Entity;
  private readonly device: pc.GraphicsDevice;
  private readonly deckY: number;
  private turnId = '';
  private selectedId = '';

  constructor(device: pc.GraphicsDevice, deckY: number) {
    this.device = device;
    this.deckY = deckY;
    const lantern = material({
      color: '#e0aa4f',
      emissive: '#e0aa4f',
      emissiveIntensity: 3,
    });
    this.gem = new pc.Entity('turn-gem');
    part(this.gem, {
      type: 'cone',
      material: lantern,
      position: [0, 0.18, 0],
      scale: [0.36, 0.36, 0.36],
    });
    part(this.gem, {
      type: 'cone',
      material: lantern,
      position: [0, -0.18, 0],
      scale: [0.36, 0.36, 0.36],
      rotation: [180, 0, 0],
    });
    this.root.addChild(this.gem);
    const chalk = material({
      color: '#f3e6c4',
      emissive: '#f3e6c4',
      emissiveIntensity: 1.5,
    });
    this.ring = part(this.root, {
      type: 'torus',
      material: chalk,
      position: [0, 0, 0],
      scale: [2.4, 0.4, 2.4],
    });
  }

  setPieces(
    specs: readonly PieceSpec[],
    cells: readonly Cell[],
    placement: ReadonlyMap<string, number>,
  ): void {
    for (const piece of this.pieces.values()) piece.root.destroy();
    this.pieces.clear();
    for (const spec of specs) {
      const mini = buildMiniature(this.device, spec.look, spec.side);
      const cell = cells[placement.get(spec.id) ?? 0];
      mini.root.setLocalPosition(cell.x, this.deckY, cell.z);
      mini.root.setLocalEulerAngles(0, spec.side === 'ally' ? 90 : -90, 0);
      this.root.addChild(mini.root);
      const piece: Piece = { ...mini, spec, tilt: spec.fallen ? FALLEN_TILT : 0, carry: null };
      this.pieces.set(spec.id, piece);
    }
  }

  setFallen(id: string, fallen: boolean): void {
    const piece = this.pieces.get(id);
    if (piece) piece.spec = { ...piece.spec, fallen };
  }

  setTurn(id: string): void {
    this.turnId = id;
  }

  setSelected(id: string): void {
    this.selectedId = id;
  }

  /** Lift the miniature, carry it to the cell and set it down. */
  carry(id: string, cell: Cell): void {
    const piece = this.pieces.get(id);
    if (!piece) throw new Error(`carry: no piece "${id}"`);
    const from = piece.root.getLocalPosition();
    piece.carry = {
      from: { x: from.x, y: this.deckY, z: from.z },
      to: cell,
      progress: 0,
    };
  }

  position(id: string): Vec3Like | null {
    const piece = this.pieces.get(id);
    if (!piece) return null;
    const p = piece.root.getPosition();
    return { x: p.x, y: p.y, z: p.z };
  }

  /** Bounding spheres for picking. */
  targets(): SphereTarget[] {
    return [...this.pieces.keys()].map((id) => {
      const p = this.position(id) as Vec3Like;
      return {
        id,
        center: { x: p.x, y: p.y + MINIATURE_SCALE * 0.6, z: p.z },
        radius: MINIATURE_SCALE * 0.7,
      };
    });
  }

  update(dt: number, time: number, visible: boolean): void {
    this.root.enabled = visible;
    for (const piece of this.pieces.values()) this.animate(piece, dt);
    const turn = this.position(this.turnId);
    this.gem.enabled = turn !== null;
    if (turn) {
      this.gem.setPosition(turn.x, turn.y + 3.1 + Math.sin(time * 2.4) * 0.14, turn.z);
      this.gem.setLocalEulerAngles(0, time * 57, 0);
    }
    const selected = this.position(this.selectedId);
    this.ring.enabled = selected !== null;
    if (selected) this.ring.setPosition(selected.x, selected.y + 0.12, selected.z);
  }

  private animate(piece: Piece, dt: number): void {
    const goalTilt = piece.spec.fallen ? FALLEN_TILT : 0;
    piece.tilt += (goalTilt - piece.tilt) * Math.min(1, dt * 7);
    piece.figure.setLocalEulerAngles(piece.tilt, 0, 0);
    const carry = piece.carry;
    if (!carry) return;
    carry.progress = Math.min(1, carry.progress + dt / CARRY_SECONDS);
    const t = carry.progress;
    const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    const x = carry.from.x + (carry.to.x - carry.from.x) * eased;
    const z = carry.from.z + (carry.to.z - carry.from.z) * eased;
    piece.root.setLocalPosition(x, this.deckY + Math.sin(Math.PI * t) * CARRY_LIFT, z);
    if (t >= 1) piece.carry = null;
  }

  destroy(): void {
    this.root.destroy();
    this.pieces.clear();
  }
}
