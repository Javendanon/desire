/**
 * Row-major raster operations on masks and class grids. Pure, typed arrays only, and no
 * allocation per pixel: these run over the whole 57.7 Mpx map, where a Map, an array or an
 * iterator per pixel costs tens of seconds (performance audit, 2026-10-21). Each operation reads
 * its input in as few passes as it needs: no inversions or copies in between. The Rust port
 * (crates/atlas/src/raster_ops.rs) follows the same design and gives the same results.
 */

export type RasterSize = {
  width: number;
  height: number;
};

/** Indices of the 4-connected neighbours of `index`, skipping the image border. */
export function neighbours4(index: number, size: RasterSize): number[] {
  const x = index % size.width;
  const y = Math.floor(index / size.width);
  const result: number[] = [];
  if (x > 0) result.push(index - 1);
  if (x < size.width - 1) result.push(index + 1);
  if (y > 0) result.push(index - size.width);
  if (y < size.height - 1) result.push(index + size.width);
  return result;
}

/** `1` where `test` holds, else `0`. A loop: `Uint8Array.from(src, mapper)` is ~45× slower. */
export function maskWhere(
  source: ArrayLike<number>,
  test: (value: number, index: number) => boolean,
): Uint8Array {
  const mask = new Uint8Array(source.length);
  for (let index = 0; index < source.length; index += 1) {
    if (test(source[index], index)) mask[index] = 1;
  }
  return mask;
}

/** `1` where the mask is `0` and the other way round. */
export const invert = (mask: Uint8Array) => maskWhere(mask, (value) => value === 0);

// --- Components ------------------------------------------------------------------------------

const INITIAL_STACK = 1 << 16;

/** Flood fill state shared by every component: one typed stack, grown and reused. */
class Labeller {
  readonly labels: Int32Array;
  private stack = new Int32Array(INITIAL_STACK);
  private top = 0;
  private readonly mask: Uint8Array;
  private readonly size: RasterSize;

  constructor(mask: Uint8Array, size: RasterSize) {
    this.mask = mask;
    this.size = size;
    this.labels = new Int32Array(mask.length).fill(-1);
  }

  isUnlabelled(index: number): boolean {
    return this.mask[index] !== 0 && this.labels[index] < 0;
  }

  /** Labels the component holding `start` with `id`. Returns its pixel count. */
  fill(start: number, id: number): number {
    this.claim(start, id);
    let count = 0;
    while (this.top > 0) {
      const index = this.stack[--this.top];
      count += 1;
      for (const next of neighbours4(index, this.size)) {
        if (this.isUnlabelled(next)) this.claim(next, id);
      }
    }
    return count;
  }

  private claim(index: number, id: number) {
    this.labels[index] = id;
    if (this.top === this.stack.length) {
      const grown = new Int32Array(this.stack.length * 2);
      grown.set(this.stack);
      this.stack = grown;
    }
    this.stack[this.top++] = index;
  }
}

/** 4-connected components of non-zero pixels, in scan order. Background keeps -1. O(pixels). */
export function components(mask: Uint8Array, size: RasterSize) {
  const labeller = new Labeller(mask, size);
  const sizes: number[] = [];
  for (let index = 0; index < mask.length; index += 1) {
    if (labeller.isUnlabelled(index)) sizes.push(labeller.fill(index, sizes.length));
  }
  return { labels: labeller.labels, sizes };
}

// --- Dilation and erosion --------------------------------------------------------------------

/**
 * What a square-window reach marks: pixels within the radius of a seed pixel get `hit`, the rest
 * `miss`. Dilation seeds on set pixels and marks 1. Erosion is the same pass with unset pixels as
 * seeds and the marks swapped, so it needs no inversion before or after.
 */
type Reach = {
  radius: number;
  /** 1: set pixels are seeds. 0: unset pixels are. */
  seed: number;
  hit: number;
  miss: number;
};

const FAR = 1 << 30;

/** Square dilation by `radius` pixels. O(pixels) whatever the radius. */
export const dilate = (mask: Uint8Array, size: RasterSize, radius: number) =>
  reach(mask, size, { radius, seed: 1, hit: 1, miss: 0 });

/** Square erosion: a pixel survives when its whole window is set. O(pixels). */
export const erode = (mask: Uint8Array, size: RasterSize, radius: number) =>
  reach(mask, size, { radius, seed: 0, hit: 0, miss: 1 });

/** Separable square reach: along every row, then along every column. Two passes. */
function reach(mask: Uint8Array, size: RasterSize, rule: Reach): Uint8Array {
  const rows = new Uint8Array(mask.length);
  for (let start = 0; start < mask.length; start += size.width) {
    reachRow(mask.subarray(start, start + size.width), rows.subarray(start), rule);
  }
  return reachColumns(rows, size, rule);
}

/** `1` where a seed lies within the radius on the same row: one sweep each way. */
function reachRow(row: Uint8Array, out: Uint8Array, rule: Reach) {
  const isSeed = (value: number) => (value !== 0 ? 1 : 0) === rule.seed;
  let last = -FAR;
  for (let x = 0; x < row.length; x += 1) {
    if (isSeed(row[x])) last = x;
    out[x] = x - last <= rule.radius ? 1 : 0;
  }
  last = FAR;
  for (let x = row.length - 1; x >= 0; x -= 1) {
    if (isSeed(row[x])) last = x;
    if (last - x <= rule.radius) out[x] = 1;
  }
}

type ColumnSweep = {
  rows: Uint8Array;
  out: Uint8Array;
  /** Per column, the last row passed whose row pass was reached. */
  last: Int32Array;
  width: number;
  rule: Reach;
};

/** The same along columns, all columns advancing together row by row (memory read in order). */
function reachColumns(rows: Uint8Array, size: RasterSize, rule: Reach): Uint8Array {
  const out = new Uint8Array(rows.length).fill(rule.miss);
  const sweep = { rows, out, last: new Int32Array(size.width), width: size.width, rule };
  sweep.last.fill(-FAR);
  for (let y = 0; y < size.height; y += 1) visitColumns(sweep, y);
  sweep.last.fill(FAR);
  for (let y = size.height - 1; y >= 0; y -= 1) visitColumns(sweep, y);
  return out;
}

function visitColumns(sweep: ColumnSweep, y: number) {
  const { rows, out, last, width, rule } = sweep;
  for (let x = 0, index = y * width; x < width; x += 1, index += 1) {
    if (rows[index] === 1) last[x] = y;
    if (Math.abs(y - last[x]) <= rule.radius) out[index] = rule.hit;
  }
}

// --- Majority filter -------------------------------------------------------------------------

type ClassGrid = {
  classes: Uint8Array;
  width: number;
};

/** The window's rows, first and last inclusive. */
type RowSpan = {
  from: number;
  to: number;
};

/** The class histogram of one output row's window, sliding along the row. */
class SlidingWindow {
  private readonly counts: Int32Array;
  private readonly grid: ClassGrid;
  private readonly from: number;
  private readonly to: number;

  constructor(grid: ClassGrid, rows: RowSpan, values: number) {
    this.grid = grid;
    this.from = rows.from;
    this.to = rows.to;
    this.counts = new Int32Array(values);
  }

  addColumn(x: number) {
    this.countColumn(x, 1);
  }

  dropColumn(x: number) {
    this.countColumn(x, -1);
  }

  /** The class with most votes. Ties go to the lower id, and the centre wins unless beaten. */
  winner(centre: number): number {
    let best = centre;
    for (let value = 0; value < this.counts.length; value += 1) {
      const count = this.counts[value];
      if (count > this.counts[best] || (count === this.counts[best] && value < best)) best = value;
    }
    return best;
  }

  private countColumn(x: number, delta: number) {
    const { classes, width } = this.grid;
    for (let row = this.from; row <= this.to; row += 1) {
      this.counts[classes[row * width + x]] += delta;
    }
  }
}

type MajorityPass = {
  classes: Uint8Array;
  size: RasterSize;
  radius: number;
  values: number;
  out: Uint8Array;
};

function largestValue(values: Uint8Array): number {
  let largest = 0;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] > largest) largest = values[index];
  }
  return largest;
}

/** Output row `y` of the majority filter: the window enters at the right, leaves at the left. */
function majorityRow(pass: MajorityPass, y: number) {
  const { classes, size, radius, out } = pass;
  const rows = { from: Math.max(0, y - radius), to: Math.min(size.height - 1, y + radius) };
  const window = new SlidingWindow({ classes, width: size.width }, rows, pass.values);
  for (let x = 0; x <= Math.min(size.width - 1, radius); x += 1) window.addColumn(x);
  for (let x = 0; x < size.width; x += 1) {
    if (x > 0 && x + radius < size.width) window.addColumn(x + radius);
    if (x > radius) window.dropColumn(x - radius - 1);
    out[y * size.width + x] = window.winner(classes[y * size.width + x]);
  }
}

/** Majority filter over a square window. Ties go to the lower class id. O(pixels · r). */
export function majority(classes: Uint8Array, size: RasterSize, radius: number): Uint8Array {
  if (radius <= 0) return classes.slice();
  const out = new Uint8Array(classes.length);
  const pass = { classes, size, radius, values: largestValue(classes) + 1, out };
  for (let y = 0; y < size.height; y += 1) majorityRow(pass, y);
  return out;
}
