/**
 * A uniform grid over the plane for "which placed boxes could touch this one" queries. It turns
 * the "check against everything placed so far" scans in lot placement and ship spacing from
 * O(n²) into O(n · neighbours). A query returns every box whose cells it shares, touching edges
 * included, so pruning with it never changes an exact overlap test's answer. The Rust twin is
 * crates/atlas/src/spatial.rs.
 */

/** An axis-aligned box in the plane: `[x, z]` corners, metres or pixels. */
export type Box = {
  min: [number, number];
  max: [number, number];
};

/** The box around a set of points. */
export function boxAround(points: [number, number][]): Box {
  const min: [number, number] = [Infinity, Infinity];
  const max: [number, number] = [-Infinity, -Infinity];
  for (const [x, z] of points) {
    min[0] = Math.min(min[0], x);
    min[1] = Math.min(min[1], z);
    max[0] = Math.max(max[0], x);
    max[1] = Math.max(max[1], z);
  }
  return { min, max };
}

export class SpatialGrid {
  private readonly cells = new Map<string, number[]>();
  private readonly cell: number;

  /** A grid of square cells `cell` wide. Near the size of the boxes it holds is best. */
  constructor(cell: number) {
    this.cell = cell;
  }

  /** The cells a box covers, its edges included. */
  private *span(box: Box): Generator<string> {
    const index = (value: number) => Math.floor(value / this.cell);
    for (let row = index(box.min[1]); row <= index(box.max[1]); row += 1) {
      for (let column = index(box.min[0]); column <= index(box.max[0]); column += 1) {
        yield `${column},${row}`;
      }
    }
  }

  insert(box: Box, id: number): void {
    for (const key of this.span(box)) {
      const ids = this.cells.get(key);
      if (ids) ids.push(id);
      else this.cells.set(key, [id]);
    }
  }

  /** Ids of the boxes sharing a cell with `box`. One that spans several cells may repeat. */
  *near(box: Box): Generator<number> {
    for (const key of this.span(box)) yield* this.cells.get(key) ?? [];
  }
}
