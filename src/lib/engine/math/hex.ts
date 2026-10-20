// Pointy-top hexagons in axial coordinates (q, r), laid out on the ground plane (x, z).

export interface Axial {
  q: number;
  r: number;
}

export interface Point2 {
  x: number;
  z: number;
}

/** Centre of hex (q, r) for hexes of circumradius `size`. */
export function axialToWorld(cell: Axial, size: number): Point2 {
  return {
    x: size * Math.sqrt(3) * (cell.q + cell.r / 2),
    z: size * 1.5 * cell.r,
  };
}

/** Number of steps between two hexes. */
export function hexDistance(a: Axial, b: Axial): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** Every axial cell within `radius` steps of the origin. O(radius²). */
export function hexesWithin(radius: number): Axial[] {
  const cells: Axial[] = [];
  for (let q = -radius; q <= radius; q++) {
    const low = Math.max(-radius, -q - radius);
    const high = Math.min(radius, -q + radius);
    for (let r = low; r <= high; r++) cells.push({ q, r });
  }
  return cells;
}

/** Index of the cell whose centre is closest to `point`, skipping `excluded`. O(cells). */
export function nearestIndex(
  cells: readonly Point2[],
  point: Point2,
  excluded: ReadonlySet<number> = new Set(),
): number {
  let best = -1;
  let bestDistance = Infinity;
  cells.forEach((cell, index) => {
    if (excluded.has(index)) return;
    const distance = Math.hypot(cell.x - point.x, cell.z - point.z);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

/** Corner points of a pointy-top hexagon, for drawing outlines. */
export function hexCorners(center: Point2, size: number): Point2[] {
  return Array.from({ length: 6 }, (_, k) => {
    const angle = Math.PI / 6 + (k * Math.PI) / 3;
    return {
      x: center.x + size * Math.cos(angle),
      z: center.z + size * Math.sin(angle),
    };
  });
}
