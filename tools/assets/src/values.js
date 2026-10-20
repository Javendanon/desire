/** Shared scalar predicates for manifest validation. */

export const finite = (value) => typeof value === 'number' && Number.isFinite(value);

export const positive = (value) => finite(value) && value > 0;

export const filled = (value) => typeof value === 'string' && value.trim().length > 0;
