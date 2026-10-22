import assert from 'node:assert/strict';
import test from 'node:test';

import { keyDirection, wheelIntent } from '../src/lib/diorama/orbit.ts';

const wheel = (delta: Partial<{ ctrlKey: boolean; deltaMode: number; deltaX: number;
  deltaY: number; }>) => ({ ctrlKey: false, deltaMode: 0, deltaX: 0, deltaY: 0, ...delta });

test('a pinch zooms: the browser reports it as a wheel with ctrl held', () => {
  assert.equal(wheelIntent(wheel({ ctrlKey: true, deltaY: 3.5 })), 'zoom');
});

test('a mouse wheel zooms: whole notches, or lines', () => {
  assert.equal(wheelIntent(wheel({ deltaY: 100 })), 'zoom');
  assert.equal(wheelIntent(wheel({ deltaY: -120 })), 'zoom');
  assert.equal(wheelIntent(wheel({ deltaMode: 1, deltaY: 3 })), 'zoom');
});

test('a two-finger trackpad swipe pans: small or fractional deltas, or sideways', () => {
  assert.equal(wheelIntent(wheel({ deltaY: 4 })), 'pan');
  assert.equal(wheelIntent(wheel({ deltaY: 62.5 })), 'pan');
  assert.equal(wheelIntent(wheel({ deltaX: 100, deltaY: 100 })), 'pan');
});

test('held keys pan in screen directions, and opposite keys cancel', () => {
  assert.deepEqual(keyDirection(new Set(['KeyW'])), [0, -1]);
  assert.deepEqual(keyDirection(new Set(['ArrowRight', 'ArrowDown'])), [1, 1]);
  assert.deepEqual(keyDirection(new Set(['KeyA', 'KeyD'])), [0, 0]);
  assert.deepEqual(keyDirection(new Set(['KeyQ'])), [0, 0]);
});
