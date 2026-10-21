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

/**
 * A well-mixed unsigned 32-bit hash of an integer id and a salt (a splitmix-style finaliser).
 * Per-item choices that must not depend on list order, such as a house's look, draw from it.
 */
export function hashId(id: number, salt: number): number {
  let h = (Math.imul(id | 0, 0x9e3779b1) ^ Math.imul(salt | 0, 0x85ebca77)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** `hashId` as a share in [0, 1). */
export const shareOf = (id: number, salt: number) => hashId(id, salt) / 4294967296;
