/** Seeded pseudo-random numbers (mulberry32): the same seed always gives the same city. */
const UINT32 = 2 ** 32;
const MULBERRY_INCREMENT = 0x6d2b79f5;

/** Returns a generator of floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + MULBERRY_INCREMENT) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / UINT32;
  };
}

export const between = (random: () => number, [min, max]: [number, number]) =>
  min + random() * (max - min);
