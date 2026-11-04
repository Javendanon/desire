// Development identity for the x-desire-user seam. It is not authentication and grants nothing
// by itself: the server decides every permission, and D10 replaces this seam.
import type { Id } from '../generated/contracts.ts';

export const IDENTITY_KEY = 'desire.dev-identity';

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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

export function resolveDevIdentity(storage: IdentityStorage, createId: () => Id): Id {
  const stored = readStored(storage);
  if (stored) return stored;
  const created = createId();
  store(storage, created);
  return created;
}
