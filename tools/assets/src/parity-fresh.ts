/**
 * Freshness of `fixtures/parity.json`. Mercator frame pixels may differ by under 1e-6 px:
 * arm64 and amd64 V8 disagree in `tan`/`cos`/`log` by about 1e-8 px, and the Rust parity
 * test uses this same bound. Every other field is exact, so a real pipeline change still fails.
 */

const FRAME_TOLERANCE_PX = 1e-6;
const FRAME_PIXELS = 'vectors.frame_pixels';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Null when the golden is fresh. Otherwise the path of the first value that moved. */
export function parityDrift(committed: Uint8Array, generated: Uint8Array): string | null {
  if (sameBytes(committed, generated)) return null;
  const left = parseJson(committed);
  const right = parseJson(generated);
  if ('error' in left) return left.error;
  if ('error' in right) return right.error;
  return drift(left.value, right.value, '');
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && Buffer.compare(left, right) === 0;
}

/** Malformed JSON is drift: the parse error is the reason, not a thrown stack trace. */
function parseJson(bytes: Uint8Array): { value: Json } | { error: string } {
  try {
    return { value: JSON.parse(Buffer.from(bytes).toString('utf8')) as Json };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'not json' };
  }
}

function drift(left: Json, right: Json, path: string): string | null {
  if (path === FRAME_PIXELS) return pixelDrift(left, right);
  if (Array.isArray(left) || Array.isArray(right)) return arrayDrift(left, right, path);
  if (isRecord(left) && isRecord(right)) return recordDrift(left, right, path);
  return left === right ? null : path || 'root';
}

function isRecord(value: Json): value is { [key: string]: Json } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function arrayDrift(left: Json, right: Json, path: string): string | null {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return path || 'root';
  }
  for (let index = 0; index < left.length; index += 1) {
    const found = drift(left[index], right[index], `${path}.${index}`);
    if (found) return found;
  }
  return null;
}

function recordDrift(
  left: { [key: string]: Json },
  right: { [key: string]: Json },
  path: string,
): string | null {
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length || keys.some((key) => !Object.hasOwn(right, key))) {
    return path || 'root';
  }
  for (const key of keys) {
    const found = drift(left[key], right[key], path ? `${path}.${key}` : key);
    if (found) return found;
  }
  return null;
}

function pixelDrift(left: Json, right: Json): string | null {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return FRAME_PIXELS;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (!pairWithin(left[index], right[index])) return `${FRAME_PIXELS}.${index}`;
  }
  return null;
}

function pairWithin(left: Json, right: Json): boolean {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== 2 || right.length !== 2) {
    return false;
  }
  return [0, 1].every((axis) => within(left[axis], right[axis]));
}

function within(left: Json, right: Json): boolean {
  return typeof left === 'number' && typeof right === 'number'
    && Math.abs(left - right) < FRAME_TOLERANCE_PX;
}
