// Frame-time meter for the performance HUD: a ring of the most recent frame durations, summarised
// as fps, median, p95 and the share of frames over budget. A judder shows in p95 and in that
// share long before the median moves. Pure.

export interface Meter {
  frames: Float32Array;
  /** Frames recorded so far, capped at the window size. */
  count: number;
  next: number;
}

export interface MeterSummary {
  fps: number;
  /** The shortest frames: on a display that keeps up, its refresh interval. */
  p05: number;
  p50: number;
  p95: number;
  overBudget: number;
}

export function createMeter(window: number): Meter {
  return { frames: new Float32Array(window), count: 0, next: 0 };
}

export function recordFrame(meter: Meter, ms: number): void {
  meter.frames[meter.next] = ms;
  meter.next = (meter.next + 1) % meter.frames.length;
  meter.count = Math.min(meter.count + 1, meter.frames.length);
}

/** Nearest-rank percentile of sorted values. */
const percentile = (sorted: Float32Array, share: number) =>
  sorted[Math.max(0, Math.ceil(share * sorted.length) - 1)];

/** O(window · log window). */
export function meterSummary(meter: Meter, budgetMs: number): MeterSummary {
  if (meter.count === 0) return { fps: 0, p05: 0, p50: 0, p95: 0, overBudget: 0 };
  const sorted = meter.frames.slice(0, meter.count).sort();
  let total = 0;
  let over = 0;
  for (const ms of sorted) {
    total += ms;
    if (ms > budgetMs) over += 1;
  }
  return {
    fps: 1000 / (total / sorted.length),
    p05: percentile(sorted, 0.05),
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    overBudget: over / sorted.length,
  };
}
