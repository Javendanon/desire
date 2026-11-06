// Optional decorative particles: a bounded plan and a device-only preference. No DOM here.

export interface EffectSettings {
  enabled: boolean;
  reducedMotion: boolean;
}

export interface Particle {
  id: number;
  leftPercent: number;
  delayMs: number;
}

export type EffectsStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Hard ceiling on animated elements on screen, whatever the encounter contains. */
export const PARTICLE_BUDGET = 12;
export const EFFECTS_STORAGE_KEY = 'desire.tactical.particles';

const PARTICLES_PER_SOURCE = 4;
/** Coprime with 100, so successive particles spread out across the box without repeating. */
const SCATTER_STEP_PERCENT = 37;
const STAGGER_MS = 210;
const STORED_OFF = 'off';
const STORED_ON = 'on';

/** Empty unless motion is allowed and enabled. O(budget). */
export function planParticles(settings: EffectSettings, sources: number): Particle[] {
  if (!settings.enabled || settings.reducedMotion) return [];
  const count = Math.min(PARTICLE_BUDGET, Math.max(0, sources) * PARTICLES_PER_SOURCE);
  return Array.from({ length: count }, (_, index) => ({
    id: index,
    leftPercent: (index * SCATTER_STEP_PERCENT) % 100,
    delayMs: index * STAGGER_MS,
  }));
}

const UNAVAILABLE_STORAGE: EffectsStorage = {
  getItem: () => null,
  setItem: () => {
    throw new Error('browser storage is unavailable');
  },
};

/** A browser can refuse the storage object itself, which must not stop the page from booting. */
export function openEffectsStorage(open: () => EffectsStorage): EffectsStorage {
  try {
    return open();
  } catch (error) {
    console.warn('Browser storage is unavailable', error);
    return UNAVAILABLE_STORAGE;
  }
}

/** Defaults to on: blocked storage only loses the preference, so it warns and carries on. */
export function loadParticlesEnabled(storage: EffectsStorage): boolean {
  try {
    return storage.getItem(EFFECTS_STORAGE_KEY) !== STORED_OFF;
  } catch (error) {
    console.warn('Could not read the particle preference', error);
    return true;
  }
}

/** Returns false when the choice could not be kept, so it only lasts this session. */
export function saveParticlesEnabled(storage: EffectsStorage, enabled: boolean): boolean {
  try {
    storage.setItem(EFFECTS_STORAGE_KEY, enabled ? STORED_ON : STORED_OFF);
    return true;
  } catch (error) {
    console.warn('Could not save the particle preference', error);
    return false;
  }
}
