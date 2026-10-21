/** Shared scalar predicates for manifest validation. */

export const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export const positive = (value: unknown): value is number => finite(value) && value > 0;

export const filled = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
