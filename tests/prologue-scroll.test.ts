// The prologue's scroll math and its mount/destroy contract. No DOM library: the controller
// talks to the small `ScrollSurface`/`PrologueScene` interfaces, so a plain object stands in for
// a scrolling element and records what the controller writes.
import test from 'node:test';
import assert from 'node:assert/strict';

import { sceneCentres, sceneOpacity } from '../src/features/prologue/scroll-plan.ts';
import {
  mountScrollPrologue,
  type PrologueScene,
  type ScrollSurface,
} from '../src/features/prologue/scroll-prologue.ts';

interface FakeSurface extends ScrollSurface {
  listenerCount(): number;
  emitScroll(): void;
}

function fakeSurface(clientHeight: number): FakeSurface {
  const listeners = new Set<() => void>();
  return {
    scrollTop: 0,
    clientHeight,
    addEventListener(type, listener) {
      assert.equal(type, 'scroll');
      listeners.add(listener);
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener);
    },
    listenerCount: () => listeners.size,
    emitScroll: () => listeners.forEach((listener) => listener()),
  };
}

function fakeScene(): PrologueScene & { opacity(): number; transform(): string } {
  const root = { style: { opacity: '', transform: '' } };
  const still = { style: { opacity: '', transform: '' } };
  return {
    root,
    still,
    opacity: () => Number(root.style.opacity),
    transform: () => still.style.transform,
  };
}

function spyAnimationFrames(): { calls: number; restore(): void } {
  const original = globalThis.requestAnimationFrame;
  let calls = 0;
  globalThis.requestAnimationFrame = ((() => {
    calls += 1;
    return 0;
  }) as unknown) as typeof requestAnimationFrame;
  return {
    get calls() {
      return calls;
    },
    restore: () => {
      globalThis.requestAnimationFrame = original;
    },
  };
}

test('only the scene nearest the scroll offset is fully opaque', () => {
  const centres = sceneCentres(3, 800);
  assert.deepEqual(centres, [0, 800, 1600]);
  assert.equal(sceneOpacity(0, centres[0], 800), 1);
  assert.equal(sceneOpacity(800, centres[1], 800), 1);
  assert.equal(sceneOpacity(400, centres[0], 800), 0.5);
  assert.equal(sceneOpacity(1200, centres[1], 800), 0.5);
});

test('opacity is clamped and survives a zero-height surface', () => {
  assert.equal(sceneOpacity(-900, 0, 800), 0);
  assert.equal(sceneOpacity(900, 0, 800), 0);
  assert.equal(sceneOpacity(0, 0, 0), 1);
  assert.deepEqual(sceneCentres(0, 800), []);
  assert.deepEqual(sceneCentres(1, 800), [0]);
});

test('mounting paints every scene without starting an animation loop', () => {
  const frames = spyAnimationFrames();
  try {
    const surface = fakeSurface(800);
    const scenes = [fakeScene(), fakeScene(), fakeScene()];
    const handle = mountScrollPrologue(surface, scenes);

    assert.deepEqual(scenes.map((scene) => scene.opacity()), [1, 0, 0]);
    assert.match(scenes[0].transform(), /^scale\(1\.[0-9]{3}\)$/);
    assert.equal(frames.calls, 0, 'a still image must not keep an animation frame alive');

    surface.scrollTop = 800;
    surface.emitScroll();
    assert.deepEqual(scenes.map((scene) => scene.opacity()), [0, 1, 0]);
    assert.equal(surface.listenerCount(), 1);
    handle.destroy();
  } finally {
    frames.restore();
  }
});

test('destroy detaches the scroll listener and is safe to repeat', () => {
  const surface = fakeSurface(800);
  const scenes = [fakeScene(), fakeScene()];
  const handle = mountScrollPrologue(surface, scenes);

  handle.destroy();
  handle.destroy();
  assert.equal(surface.listenerCount(), 0);

  surface.scrollTop = 800;
  surface.emitScroll();
  assert.equal(scenes[0].opacity(), 1, 'a detached controller stops writing styles');
});

test('reduced motion and an empty prologue attach nothing at all', () => {
  const reduced = fakeSurface(800);
  const scenes = [fakeScene(), fakeScene()];
  mountScrollPrologue(reduced, scenes, { reducedMotion: true }).destroy();
  assert.equal(reduced.listenerCount(), 0);
  assert.equal(scenes[0].root.style.opacity, '');
  assert.equal(scenes[0].still?.style.transform, '');

  const empty = fakeSurface(800);
  mountScrollPrologue(empty, []).destroy();
  assert.equal(empty.listenerCount(), 0);
});
