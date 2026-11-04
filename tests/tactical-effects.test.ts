import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EFFECTS_STORAGE_KEY,
  PARTICLE_BUDGET,
  loadParticlesEnabled,
  planParticles,
  saveParticlesEnabled,
  type EffectsStorage,
} from '../src/features/encounters/effects.ts';

function memoryStorage(initial: string | null = null): EffectsStorage & { value: string | null } {
  return {
    value: initial,
    getItem() {
      return this.value;
    },
    setItem(_key, value) {
      this.value = value;
    },
  };
}

const failingStorage: EffectsStorage = {
  getItem() {
    throw new Error('storage denied');
  },
  setItem() {
    throw new Error('storage denied');
  },
};

test('no particles when they are disabled or the system asks for reduced motion', () => {
  assert.deepEqual(planParticles({ enabled: false, reducedMotion: false }, 3), []);
  assert.deepEqual(planParticles({ enabled: true, reducedMotion: true }, 3), []);
});

test('no particles without a source to attach them to', () => {
  assert.deepEqual(planParticles({ enabled: true, reducedMotion: false }, 0), []);
});

test('particles scale with their sources and never exceed the budget', () => {
  const settings = { enabled: true, reducedMotion: false };
  const one = planParticles(settings, 1);
  assert.ok(one.length > 0 && one.length <= PARTICLE_BUDGET);
  assert.equal(planParticles(settings, 1000).length, PARTICLE_BUDGET);
});

test('a particle plan is deterministic, unique and stays inside its box', () => {
  const settings = { enabled: true, reducedMotion: false };
  const plan = planParticles(settings, 1000);
  assert.deepEqual(plan, planParticles(settings, 1000));
  assert.equal(new Set(plan.map((particle) => particle.id)).size, plan.length);
  for (const particle of plan) {
    assert.ok(particle.leftPercent >= 0 && particle.leftPercent < 100);
    assert.ok(particle.delayMs >= 0);
  }
});

test('the particle preference defaults to on and reads only explicit stored values', () => {
  assert.equal(loadParticlesEnabled(memoryStorage(null)), true);
  assert.equal(loadParticlesEnabled(memoryStorage('off')), false);
  assert.equal(loadParticlesEnabled(memoryStorage('on')), true);
  assert.equal(loadParticlesEnabled(memoryStorage('corrupt')), true);
});

test('the particle preference round-trips through its storage key', () => {
  const storage = memoryStorage();
  assert.equal(saveParticlesEnabled(storage, false), true);
  assert.equal(storage.value, 'off');
  assert.equal(loadParticlesEnabled(storage), false);
  assert.ok(EFFECTS_STORAGE_KEY.length > 0);
});

test('a blocked storage reports the failure and falls back without throwing', (context) => {
  const warn = context.mock.method(console, 'warn', () => undefined);
  assert.equal(loadParticlesEnabled(failingStorage), true);
  assert.equal(saveParticlesEnabled(failingStorage, false), false);
  assert.equal(warn.mock.callCount(), 2);
});
