// Development identity for the x-desire-user seam. It is not authentication and grants nothing
// by itself: the server decides every permission, and D10 replaces this seam.
import type { Id } from '../generated/contracts.ts';

export const IDENTITY_KEY = 'desire.dev-identity';

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// RFC 9562 layout: which bits mark the version and variant, and where the hex groups end.
const UUID_BYTES = 16;
const VERSION_BYTE = 6;
const VARIANT_BYTE = 8;
const LOW_NIBBLE = 0x0f;
const VERSION_4 = 0x40;
const VARIANT_MASK = 0x3f;
const VARIANT_RFC4122 = 0x80;
const UUID_GROUP_ENDS: readonly number[] = [8, 12, 16, 20, 32];

export type IdentityStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Touches localStorage only on use: merely reading the property can throw when it is denied. */
export const browserStorage: IdentityStorage = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
};

function readStored(storage: IdentityStorage): Id | null {
  try {
    const stored = storage.getItem(IDENTITY_KEY);
    return stored && CANONICAL_UUID.test(stored) ? stored : null;
  } catch (error) {
    console.warn('Could not read the development identity', error);
    return null;
  }
}

function store(storage: IdentityStorage, identity: Id): void {
  try {
    storage.setItem(IDENTITY_KEY, identity);
  } catch (error) {
    // The session still works; only reopening the browser loses access to its campaigns.
    console.warn('Could not persist the development identity', error);
  }
}

/**
 * A random v4 UUID. crypto.randomUUID exists only in secure contexts, so it would leave a blank
 * page on a device reaching the dev server over plain HTTP.
 */
export function createDevIdentity(): Id {
  const bytes = crypto.getRandomValues(new Uint8Array(UUID_BYTES));
  bytes[VERSION_BYTE] = (bytes[VERSION_BYTE] & LOW_NIBBLE) | VERSION_4;
  bytes[VARIANT_BYTE] = (bytes[VARIANT_BYTE] & VARIANT_MASK) | VARIANT_RFC4122;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  const groups = UUID_GROUP_ENDS.map((end, index) => {
    const start = index === 0 ? 0 : UUID_GROUP_ENDS[index - 1];
    return hex.slice(start, end);
  });
  return groups.join('-');
}

export function resolveDevIdentity(storage: IdentityStorage, createId: () => Id): Id {
  const stored = readStored(storage);
  if (stored) return stored;
  const created = createId();
  store(storage, created);
  return created;
}
