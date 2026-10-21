// Seeded pseudo-random numbers (mulberry32). Same seed, same scene: test layouts are reproducible.

export type Random = () => number;

export function createRandom(seed: number): Random {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform value in [min, max). */
export function between(random: Random, min: number, max: number): number {
  return min + random() * (max - min);
}

export function pick<T>(random: Random, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)];
}
