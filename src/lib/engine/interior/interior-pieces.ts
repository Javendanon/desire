// Miniatures inside an interior: each stands on a square of the FloorPlan and walks a route square
// by square. A slide leg follows the slide's own path at an even speed instead of a straight line.
import * as pc from 'playcanvas';

import type { FloorPlan } from '../../../generated/contracts.ts';
import type { Vec3Like } from '../math/camera-rig.ts';
import type { FloorCellRef } from '../plan/floor-index.ts';
import { cellCentre, slidePoint } from '../plan/interior-placement.ts';
import { routeLegs, type RouteLeg } from '../plan/interior-route.ts';
import { buildMiniature, MINIATURE_SCALE, type Look, type Side } from '../render/miniatures.ts';

export interface InteriorPieceSpec {
  id: string;
  look: Look;
  side: Side;
  cell: FloorCellRef;
}

interface Leg {
  at: (t: number) => Vec3Like;
  seconds: number;
}

interface Piece {
  root: pc.Entity;
  cell: FloorCellRef;
  legs: Leg[];
  elapsed: number;
}

/** Miniatures were sized for the 2.9 m hex board, so a 5 ft square needs them about half as big. */
const SQUARE_SCALE = 0.55;
const STEP_SECONDS = 0.35;
const STEP_LIFT = 0.25;
const SLIDE_SECONDS = 3.2;

function lerp(a: Vec3Like, b: Vec3Like, t: number): Vec3Like {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

export class InteriorPieces {
  readonly root = new pc.Entity('miniaturas');
  private readonly pieces = new Map<string, Piece>();
  private readonly device: pc.GraphicsDevice;
  private readonly plan: FloorPlan;

  constructor(device: pc.GraphicsDevice, plan: FloorPlan) {
    this.device = device;
    this.plan = plan;
  }

  /** Replaces every miniature with `specs`, each standing on its square. */
  set(specs: readonly InteriorPieceSpec[]): void {
    for (const piece of this.pieces.values()) piece.root.destroy();
    this.pieces.clear();
    for (const spec of specs) {
      const { root } = buildMiniature(this.device, spec.look, spec.side);
      const scale = MINIATURE_SCALE * SQUARE_SCALE;
      root.setLocalScale(scale, scale, scale);
      this.root.addChild(root);
      this.pieces.set(spec.id, { root, cell: spec.cell, legs: [], elapsed: 0 });
      this.place(root, cellCentre(this.plan, spec.cell));
    }
  }

  cellOf(id: string): FloorCellRef {
    return this.piece(id).cell;
  }

  isMoving(id: string): boolean {
    return this.piece(id).legs.length > 0;
  }

  /** Walks `id` along `route` (its own square first). With `instant`, it lands at once. */
  move(id: string, route: readonly FloorCellRef[], instant: boolean): void {
    const piece = this.piece(id);
    const target = route[route.length - 1];
    if (!target) return;
    piece.legs = instant ? [] : routeLegs(this.plan, route).map((leg) => this.leg(leg));
    piece.elapsed = 0;
    piece.cell = target;
    if (instant) this.place(piece.root, cellCentre(this.plan, target));
  }

  private leg({ link, from, to }: RouteLeg): Leg {
    if (link) return { at: (t) => slidePoint(link.path, t), seconds: SLIDE_SECONDS };
    const [a, b] = [cellCentre(this.plan, from), cellCentre(this.plan, to)];
    return {
      at: (t) => {
        const point = lerp(a, b, t);
        return { ...point, y: point.y + Math.sin(Math.PI * t) * STEP_LIFT };
      },
      seconds: STEP_SECONDS,
    };
  }

  /** Advances every moving miniature by `dt` seconds. */
  update(dt: number): void {
    for (const piece of this.pieces.values()) this.advance(piece, dt);
  }

  private advance(piece: Piece, dt: number): void {
    const [leg] = piece.legs;
    if (!leg) return;
    piece.elapsed += dt;
    const t = Math.min(1, piece.elapsed / leg.seconds);
    this.place(piece.root, leg.at(t));
    if (t < 1) return;
    piece.legs.shift();
    piece.elapsed = 0;
  }

  private place(root: pc.Entity, point: Vec3Like): void {
    root.setLocalPosition(point.x, point.y, point.z);
  }

  private piece(id: string): Piece {
    const piece = this.pieces.get(id);
    if (!piece) throw new Error(`interior: no miniature ${id}`);
    return piece;
  }

  destroy(): void {
    this.root.destroy();
    this.pieces.clear();
  }
}
