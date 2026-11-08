// How a miniature travels each step of a route: an ordinary step between neighbouring squares, or a
// ride along the slide when the step follows the slide link in its own direction.
import type { FloorLink, FloorPlan } from '../../../generated/contracts.ts';
import type { FloorCellRef } from './floor-index.ts';

export type LegKind = 'step' | 'slide';

export interface RouteLeg {
  kind: LegKind;
  from: FloorCellRef;
  to: FloorCellRef;
  /** The slide's path, for a slide leg. */
  link: FloorLink | null;
}

function same(a: FloorCellRef, b: FloorCellRef): boolean {
  return a.floor === b.floor && a.x === b.x && a.y === b.y;
}

function slideFrom(plan: FloorPlan, from: FloorCellRef, to: FloorCellRef): FloorLink | null {
  const ride = (link: FloorLink) =>
    link.kind === 'slide' && same(link.from, from) && same(link.to, to);
  return plan.links.find(ride) ?? null;
}

/** One leg per step of `route` (whose first square is the start). O(steps · links). */
export function routeLegs(plan: FloorPlan, route: readonly FloorCellRef[]): RouteLeg[] {
  return route.slice(1).map((to, index) => {
    const from = route[index];
    const link = slideFrom(plan, from, to);
    return { kind: link ? 'slide' : 'step', from, to, link };
  });
}
