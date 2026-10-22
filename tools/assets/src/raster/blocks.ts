/**
 * City blocks: the land between streets, traced into polygons. Courtyards and gardens stay inside
 * their block (they are a separate layer). Only open holes larger than a threshold are kept.
 *
 * Boundaries follow pixel edges between a component and its background, always with the
 * component on the same hand, so outer rings and holes come out with opposite winding. Where two
 * blocks touch only at a corner, the component label picks the path. Pure.
 */
import type { PixelPoint } from './polyline.ts';
import { components, maskWhere, type RasterSize } from './raster-ops.ts';
import { simplifyRing } from './simplify.ts';
import { Surface } from './surface.ts';

export type Block = {
  outer: PixelPoint[];
  holes: PixelPoint[][];
  areaPx: number;
};
export type TraceOptions = {
  minAreaPx: number;
  tolerancePx: number;
  /** Holes smaller than this are classification noise and join their block. */
  minHoleAreaPx?: number;
};
type Side = {
  neighbour: PixelPoint;
  from: PixelPoint;
  to: PixelPoint;
};
type Edge = {
  from: number;
  to: number;
  label: number;
  direction: number;
  used: boolean;
};

const NOT_BLOCK = new Set<number>([Surface.Street, Surface.Water, Surface.Pier]);
/** Edge directions: right, down, left, up (y grows down). */
const DIRECTIONS: PixelPoint[] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
/** At a corner shared by one block, prefer turning right, then straight, then left. */
const TURN_PREFERENCE = [1, 0, 3];

/** Urban pixels that are not street, water or pier: the land blocks are made of. */
export function blockMask(classes: Uint8Array, urban: Uint8Array): Uint8Array {
  return maskWhere(classes, (value, index) => urban[index] === 1 && !NOT_BLOCK.has(value));
}

/**
 * The four sides of a pixel: the neighbour that makes it a boundary, and the edge's corners
 * relative to the pixel's top-left, in the order that keeps the block on the same hand.
 */
const SIDES: Side[] = [
  { neighbour: [0, -1], from: [0, 0], to: [1, 0] },
  { neighbour: [1, 0], from: [1, 0], to: [1, 1] },
  { neighbour: [0, 1], from: [1, 1], to: [0, 1] },
  { neighbour: [-1, 0], from: [0, 1], to: [0, 0] },
];

function pushEdge(outgoing: Map<number, Edge[]>, edge: Edge) {
  const list = outgoing.get(edge.from);
  if (list) list.push(edge);
  else outgoing.set(edge.from, [edge]);
}

/** Boundary edges of every labelled pixel, keyed by their start vertex. O(perimeter). */
function boundaryEdges(labels: Int32Array, size: RasterSize) {
  const { width, height } = size;
  const vertex = (x: number, y: number) => y * (width + 1) + x;
  const background = (x: number, y: number) =>
    x < 0 || y < 0 || x >= width || y >= height || labels[y * width + x] < 0;
  const outgoing = new Map<number, Edge[]>();
  labels.forEach((label, index) => {
    if (label < 0) return;
    const x = index % width;
    const y = Math.floor(index / width);
    SIDES.forEach(({ neighbour: [dx, dy], from, to }, direction) => {
      if (!background(x + dx, y + dy)) return;
      const edge = { from: vertex(x + from[0], y + from[1]), to: vertex(x + to[0], y + to[1]) };
      pushEdge(outgoing, { ...edge, label, direction, used: false });
    });
  });
  return outgoing;
}

function nextEdge(outgoing: Map<number, Edge[]>, current: Edge): Edge | undefined {
  const candidates = (outgoing.get(current.to) ?? [])
    .filter((edge) => !edge.used && edge.label === current.label);
  for (const turn of TURN_PREFERENCE) {
    const wanted = (current.direction + turn) % DIRECTIONS.length;
    const match = candidates.find((edge) => edge.direction === wanted);
    if (match) return match;
  }
  return candidates[0];
}

/** Follows unused edges from `start` until the loop closes. Returns vertex indices. */
function followLoop(outgoing: Map<number, Edge[]>, start: Edge): number[] {
  const loop: number[] = [];
  let edge: Edge | undefined = start;
  while (edge && !edge.used) {
    edge.used = true;
    loop.push(edge.from);
    edge = nextEdge(outgoing, edge);
  }
  return loop;
}

const signedArea = (ring: PixelPoint[]) => ring.reduce((sum, [x, y], index) => {
  const [nx, ny] = ring[(index + 1) % ring.length];
  return sum + x * ny - nx * y;
}, 0) / 2;

function loopsByLabel(outgoing: Map<number, Edge[]>, width: number) {
  const loops = new Map<number, PixelPoint[][]>();
  for (const edges of outgoing.values()) {
    for (const edge of edges) {
      if (edge.used) continue;
      const ring = followLoop(outgoing, edge).map((vertex): PixelPoint =>
        [vertex % (width + 1), Math.floor(vertex / (width + 1))]);
      const list = loops.get(edge.label);
      if (list) list.push(ring);
      else loops.set(edge.label, [ring]);
    }
  }
  return loops;
}

function toBlock(rings: PixelPoint[][], areaPx: number, options: TraceOptions): Block {
  const ordered = [...rings].sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
  const minHole = options.minHoleAreaPx ?? 0;
  const holes = ordered.slice(1).filter((ring) => Math.abs(signedArea(ring)) >= minHole);
  return {
    outer: simplifyRing(ordered[0], options.tolerancePx),
    holes: holes.map((ring) => simplifyRing(ring, options.tolerancePx)),
    areaPx,
  };
}

/** Traces each 4-connected component of `mask` into a block. O(pixels + perimeter). */
export function traceBlocks(mask: Uint8Array, size: RasterSize, options: TraceOptions): Block[] {
  const { labels, sizes } = components(mask, size);
  const kept = new Int32Array(labels.length);
  for (let index = 0; index < labels.length; index += 1) {
    const label = labels[index];
    kept[index] = label >= 0 && sizes[label] >= options.minAreaPx ? label : -1;
  }
  const loops = loopsByLabel(boundaryEdges(kept, size), size.width);
  return [...loops].map(([label, rings]) => toBlock(rings, sizes[label], options));
}
