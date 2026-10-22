import assert from 'node:assert/strict';
import test from 'node:test';

import {
  keyDirection, panGoal, turnGoal, wheelIntent, wheelStep,
} from '../src/lib/diorama/orbit.ts';

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

// At azimuth 0 the camera sits south (+z) of its target and looks north (-z); right is +x.
const rig = () => ({ target: { x: 0, y: 1, z: 0 }, radius: 100, polar: 1, azimuth: 0 });

test('dragging the ground down brings what lies ahead into view: the target moves forward', () => {
  const goal = rig();
  panGoal(goal, 0, 10);
  assert.ok(goal.target.z < 0, `z ${goal.target.z}`);
  assert.ok(Math.abs(goal.target.x) < 1e-9);
});

test('dragging the ground right moves the target left', () => {
  const goal = rig();
  panGoal(goal, 10, 0);
  assert.ok(goal.target.x < 0, `x ${goal.target.x}`);
  assert.ok(Math.abs(goal.target.z) < 1e-9);
});

test('zoom stays between the street and the whole city', () => {
  const goal = rig();
  wheelStep(goal, wheel({ deltaY: 100000 }));
  assert.equal(goal.radius, 900);
  wheelStep(goal, wheel({ deltaY: -100000 }));
  assert.equal(goal.radius, 25);
});

test('turning never tips the camera under the ground or over the top', () => {
  const goal = rig();
  turnGoal(goal, 0, -10000);
  assert.equal(goal.polar, 1.32);
  turnGoal(goal, 0, 10000);
  assert.equal(goal.polar, 0.3);
});

test('a two-finger swipe up moves the ground up with the fingers: the target comes back', () => {
  const goal = rig();
  wheelStep(goal, wheel({ deltaY: 6.5 }));
  assert.ok(goal.target.z > 0, `z ${goal.target.z}`);
});
