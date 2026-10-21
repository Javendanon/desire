/** Row-major raster operations on masks and class grids. Pure, typed arrays only. */

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

function fillComponent(mask: Uint8Array, size: RasterSize, labels: Int32Array, start: number) {
  const id = labels[start];
  const stack = [start];
  let count = 0;
  while (stack.length > 0) {
    const index = stack.pop()!;
    count += 1;
    for (const next of neighbours4(index, size)) {
      if (mask[next] === 0 || labels[next] >= 0) continue;
      labels[next] = id;
      stack.push(next);
    }
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

function dilateRows(mask: Uint8Array, size: RasterSize, radius: number): Uint8Array {
  const { width } = size;
  const rows = new Uint8Array(mask.length);
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] === 0) continue;
    const x = index % width;
    const rowStart = index - x;
    const from = rowStart + Math.max(0, x - radius);
    rows.fill(1, from, rowStart + Math.min(width - 1, x + radius) + 1);
  }
  return rows;
}

function dilateColumns(rows: Uint8Array, size: RasterSize, radius: number): Uint8Array {
  const { width, height } = size;
  const out = new Uint8Array(rows.length);
  for (let index = 0; index < rows.length; index += 1) {
    if (rows[index] === 0) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    for (let row = Math.max(0, y - radius); row <= Math.min(height - 1, y + radius); row += 1) {
      out[row * width + x] = 1;
    }
  }
  return out;
}

/** Square dilation by `radius` pixels, separable: rows then columns. O(pixels · radius). */
export function dilate(mask: Uint8Array, size: RasterSize, radius: number): Uint8Array {
  return dilateColumns(dilateRows(mask, size, radius), size, radius);
}

function windowWinner(classes: Uint8Array, size: RasterSize, index: number, radius: number) {
  const counts = new Map<number, number>();
  const x = index % size.width;
  const y = Math.floor(index / size.width);
  for (let row = Math.max(0, y - radius); row <= Math.min(size.height - 1, y + radius); row += 1) {
    for (let col = Math.max(0, x - radius); col <= Math.min(size.width - 1, x + radius); col += 1) {
      const value = classes[row * size.width + col];
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  let best = classes[index];
  for (const [value, count] of counts) {
    const bestCount = counts.get(best) ?? 0;
    if (count > bestCount || (count === bestCount && value < best)) best = value;
  }
  return best;
}

/** Majority filter over a square window. Ties go to the lower class id. O(pixels · r²). */
export function majority(classes: Uint8Array, size: RasterSize, radius: number): Uint8Array {
  if (radius <= 0) return classes.slice();
  const out = new Uint8Array(classes.length);
  for (let index = 0; index < classes.length; index += 1) {
    out[index] = windowWinner(classes, size, index, radius);
  }
  return out;
}

/** Square erosion: a pixel survives when its whole window is set. Complement of dilation. */
export function erode(mask: Uint8Array, size: RasterSize, radius: number): Uint8Array {
  const grown = dilate(Uint8Array.from(mask, (value) => (value === 0 ? 1 : 0)), size, radius);
  return Uint8Array.from(grown, (value) => (value === 0 ? 1 : 0));
}
