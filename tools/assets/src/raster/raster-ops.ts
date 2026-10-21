/**
 * Row-major raster operations on masks and class grids. Pure, typed arrays only, and no
 * allocation per pixel: these run over the whole 57.7 Mpx map, where a Map, an array or an
 * iterator per pixel costs tens of seconds (performance audit, 2026-10-21).
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

const INITIAL_STACK = 1 << 16;

/** Flood fill from `start` with a typed stack that doubles when full. Returns the pixel count. */
function fillComponent(mask: Uint8Array, size: RasterSize, labels: Int32Array, start: number) {
  const { width } = size;
  const id = labels[start];
  const last = mask.length - width;
  let stack = new Int32Array(INITIAL_STACK);
  let top = 0;
  stack[top++] = start;
  let count = 0;
  const visit = (next: number) => {
    if (mask[next] === 0 || labels[next] >= 0) return;
    labels[next] = id;
    stack[top++] = next;
  };
  while (top > 0) {
    const index = stack[--top];
    count += 1;
    if (top + 4 > stack.length) {
      const grown = new Int32Array(stack.length * 2);
      grown.set(stack);
      stack = grown;
    }
    const x = index % width;
    if (x > 0) visit(index - 1);
    if (x < width - 1) visit(index + 1);
    if (index >= width) visit(index - width);
    if (index < last) visit(index + width);
  }
  return count;
}

/** 4-connected components of non-zero pixels. Background keeps label -1. O(pixels). */
export function components(mask: Uint8Array, size: RasterSize) {
  const labels = new Int32Array(mask.length).fill(-1);
  const sizes: number[] = [];
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] === 0 || labels[index] >= 0) continue;
    labels[index] = sizes.length;
    sizes.push(fillComponent(mask, size, labels, index));
  }
  return { labels, sizes };
}

const FAR = 1 << 30;

/** One row, both ways: marks pixels within `radius` of a set pixel of that row. */
type RowSweep = {
  mask: Uint8Array;
  out: Uint8Array;
  start: number;
  width: number;
};

function sweepRow(sweep: RowSweep, radius: number) {
  const { mask, out, start, width } = sweep;
  let seen = -FAR;
  for (let x = 0; x < width; x += 1) {
    if (mask[start + x]) seen = x;
    if (x - seen <= radius) out[start + x] = 1;
  }
  seen = FAR;
  for (let x = width - 1; x >= 0; x -= 1) {
    if (mask[start + x]) seen = x;
    if (seen - x <= radius) out[start + x] = 1;
  }
}

function dilateRows(mask: Uint8Array, size: RasterSize, radius: number): Uint8Array {
  const rows = new Uint8Array(mask.length);
  for (let y = 0; y < size.height; y += 1) {
    sweepRow({ mask, out: rows, start: y * size.width, width: size.width }, radius);
  }
  return rows;
}

/**
 * One pass along every column at once, row by row (cache-friendly): `seen` holds, per column,
 * the last row with a set pixel in the direction of travel.
 */
type ColumnSweep = {
  rows: Uint8Array;
  out: Uint8Array;
  seen: Int32Array;
  width: number;
};

function sweepColumnsAt(sweep: ColumnSweep, y: number, radius: number) {
  const { rows, out, seen, width } = sweep;
  for (let x = 0, index = y * width; x < width; x += 1, index += 1) {
    if (rows[index]) seen[x] = y;
    if (Math.abs(y - seen[x]) <= radius) out[index] = 1;
  }
}

function dilateColumns(rows: Uint8Array, size: RasterSize, radius: number): Uint8Array {
  const { width, height } = size;
  const sweep = { rows, out: new Uint8Array(rows.length), seen: new Int32Array(width), width };
  sweep.seen.fill(-FAR);
  for (let y = 0; y < height; y += 1) sweepColumnsAt(sweep, y, radius);
  sweep.seen.fill(FAR);
  for (let y = height - 1; y >= 0; y -= 1) sweepColumnsAt(sweep, y, radius);
  return sweep.out;
}

/**
 * Square dilation by `radius` pixels, separable: rows then columns. Each pass tracks the nearest
 * set pixel, so the cost is O(pixels) whatever the radius.
 */
export function dilate(mask: Uint8Array, size: RasterSize, radius: number): Uint8Array {
  return dilateColumns(dilateRows(mask, size, radius), size, radius);
}

/** Square erosion: a pixel survives when its whole window is set. Complement of dilation. */
export function erode(mask: Uint8Array, size: RasterSize, radius: number): Uint8Array {
  return invert(dilate(invert(mask), size, radius));
}

function largestValue(values: Uint8Array): number {
  let largest = 0;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] > largest) largest = values[index];
  }
  return largest;
}

type ClassGrid = {
  classes: Uint8Array;
  width: number;
};

/** One column of the sliding window: column `x` between rows `from` and `to`. */
type WindowColumn = {
  x: number;
  from: number;
  to: number;
};

/** Adds `delta` to the histogram for every pixel of one window column. */
function countColumn(counts: Int32Array, grid: ClassGrid, column: WindowColumn, delta: number) {
  for (let row = column.from; row <= column.to; row += 1) {
    counts[grid.classes[row * grid.width + column.x]] += delta;
  }
}

/** The class with most votes. Ties go to the lower id, and the centre wins unless beaten. */
function winner(counts: Int32Array, centre: number): number {
  let best = centre;
  let bestCount = counts[centre];
  for (let value = 0; value < counts.length; value += 1) {
    const count = counts[value];
    if (count > bestCount || (count === bestCount && value < best)) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Majority filter over a square window. Ties go to the lower class id. A class histogram slides
 * along each row, adding the entering column and dropping the leaving one. O(pixels · r).
 */
export function majority(classes: Uint8Array, size: RasterSize, radius: number): Uint8Array {
  if (radius <= 0) return classes.slice();
  const { width, height } = size;
  const out = new Uint8Array(classes.length);
  const counts = new Int32Array(largestValue(classes) + 1);
  const grid = { classes, width };
  for (let y = 0; y < height; y += 1) {
    const from = Math.max(0, y - radius);
    const to = Math.min(height - 1, y + radius);
    counts.fill(0);
    for (let x = 0; x <= Math.min(width - 1, radius); x += 1) {
      countColumn(counts, grid, { x, from, to }, 1);
    }
    for (let x = 0; x < width; x += 1) {
      if (x > 0 && x + radius < width) countColumn(counts, grid, { x: x + radius, from, to }, 1);
      if (x > radius) countColumn(counts, grid, { x: x - radius - 1, from, to }, -1);
      out[y * width + x] = winner(counts, classes[y * width + x]);
    }
  }
  return out;
}
