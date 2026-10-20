import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clampPolar,
  dampRig,
  introDuration,
  rigPosition,
  sampleIntro,
  type IntroKey,
  type Rig,
} from '../src/lib/engine/math/camera-rig.ts';
import {
  axialToWorld,
  hexDistance,
  hexesWithin,
  nearestIndex,
} from '../src/lib/engine/math/hex.ts';
import { closestSphere, hitHorizontalPlane } from '../src/lib/engine/math/ray.ts';
import { createRandom } from '../src/lib/engine/math/rng.ts';

const rig = (x: number, radius: number, polar = 1, azimuth = 0): Rig => ({
  target: { x, y: 0, z: 0 },
  radius,
  polar,
  azimuth,
});

test('the same seed gives the same sequence, a different seed another one', () => {
  const a = createRandom(7);
  const b = createRandom(7);
  const c = createRandom(8);
  const first = [a(), a(), a()];
  assert.deepEqual(first, [b(), b(), b()]);
  assert.notDeepEqual(first, [c(), c(), c()]);
  assert.ok(first.every((v) => v >= 0 && v < 1));
});

test('hex distance counts steps on the axial grid', () => {
  assert.equal(hexDistance({ q: 0, r: 0 }, { q: 2, r: -1 }), 2);
  assert.equal(hexDistance({ q: -1, r: 3 }, { q: -1, r: 3 }), 0);
  assert.equal(hexesWithin(2).length, 19);
});

test('neighbouring pointy-top hexes are sqrt(3) * size apart', () => {
  const a = axialToWorld({ q: 0, r: 0 }, 2);
  const b = axialToWorld({ q: 1, r: 0 }, 2);
  assert.ok(Math.abs(Math.hypot(b.x - a.x, b.z - a.z) - 2 * Math.sqrt(3)) < 1e-9);
});

test('nearest cell skips excluded cells', () => {
  const cells = [
    { x: 0, z: 0 },
    { x: 5, z: 0 },
  ];
  assert.equal(nearestIndex(cells, { x: 1, z: 0 }), 0);
  assert.equal(nearestIndex(cells, { x: 1, z: 0 }, new Set([0])), 1);
  assert.equal(nearestIndex(cells, { x: 1, z: 0 }, new Set([0, 1])), -1);
});

test('looking straight down puts the camera right above the target', () => {
  const p = rigPosition({ target: { x: 3, y: 1, z: -2 }, radius: 10, polar: 0, azimuth: 1 });
  assert.ok(Math.abs(p.x - 3) < 1e-9 && Math.abs(p.y - 11) < 1e-9 && Math.abs(p.z + 2) < 1e-9);
});

test('damping halves the gap after one half-life and jumps with half-life 0', () => {
  const halfway = dampRig(rig(0, 10), rig(10, 20), 0.5, 0.5);
  assert.ok(Math.abs(halfway.target.x - 5) < 1e-9);
  assert.ok(Math.abs(halfway.radius - 15) < 1e-9);
  assert.equal(dampRig(rig(0, 10), rig(10, 20), 0.016, 0).target.x, 10);
});

test('damping is frame-rate independent', () => {
  let small = rig(0, 10);
  for (let i = 0; i < 10; i++) small = dampRig(small, rig(10, 10), 0.1, 0.5);
  const big = dampRig(rig(0, 10), rig(10, 10), 1, 0.5);
  assert.ok(Math.abs(small.target.x - big.target.x) < 1e-9);
});

test('the intro path starts, passes through and ends on its keys', () => {
  const keys: IntroKey[] = [
    { ...rig(0, 24, 1.45), at: 0 },
    { ...rig(10, 30, 1.26), at: 4 },
    { ...rig(20, 118, 0.98), at: 8 },
  ];
  assert.equal(sampleIntro(keys, -1).radius, 24);
  assert.equal(sampleIntro(keys, 4).radius, 30);
  assert.equal(sampleIntro(keys, 2).target.x, 5);
  assert.equal(sampleIntro(keys, 99).radius, 118);
  assert.equal(introDuration(keys), 8);
});

test('the scene camera cannot go under the horizon or straight down', () => {
  assert.equal(clampPolar(2), 1.36);
  assert.equal(clampPolar(0.2), 0.85);
});

test('a ray from above hits the ground plane, a ray pointing up does not', () => {
  const down = { origin: { x: 0, y: 10, z: 0 }, direction: { x: 0, y: -1, z: 0 } };
  assert.deepEqual(hitHorizontalPlane(down, 2), { x: 0, y: 2, z: 0 });
  const up = { origin: { x: 0, y: 10, z: 0 }, direction: { x: 0, y: 1, z: 0 } };
  assert.equal(hitHorizontalPlane(up, 2), null);
});

test('the closest sphere along the ray wins', () => {
  const ray = { origin: { x: 0, y: 0, z: -10 }, direction: { x: 0, y: 0, z: 1 } };
  const targets = [
    { id: 'far', center: { x: 0, y: 0, z: 5 }, radius: 1 },
    { id: 'near', center: { x: 0, y: 0, z: 0 }, radius: 1 },
    { id: 'aside', center: { x: 5, y: 0, z: -5 }, radius: 1 },
  ];
  assert.equal(closestSphere(ray, targets), 'near');
  assert.equal(closestSphere(ray, [targets[2]]), null);
});
