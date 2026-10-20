import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clampRadius,
  clampTarget,
  MAX_POLAR,
  MIN_POLAR,
  MIN_RADIUS,
  orbitGoal,
  panGoal,
  startGoal,
  zoomGoal,
} from '../src/lib/engine/scene/map-camera.ts';
import { createGrid } from '../src/lib/engine/plan/sectors.ts';
import type { MapDefinition } from '../src/lib/engine/plan/map-definition.ts';

const bounds = { minX: 0, minZ: 0, maxX: 3600, maxZ: 7100 };
const map: MapDefinition = {
  id: 'test-map',
  name: 'Test map',
  seed: 1,
  grid: createGrid(250, bounds),
  bounds,
  coast: [],
  sector: () => ({ buildings: [] }),
  places: [],
  controlPoints: [],
  streets: [],
  isLand: () => true,
  landSpans: () => [[0, 3600]],
};

test('the start goal frames the whole map from the middle', () => {
  const goal = startGoal(map);
  assert.deepEqual(goal.target, { x: 1800, y: 0, z: 3550 });
  assert.equal(goal.radius, 1800);
  assert.ok(goal.polar > MIN_POLAR && goal.polar < MAX_POLAR);
});

test('panning moves the focus and never leaves the map bounds', () => {
  const goal = startGoal(map);
  panGoal(goal, map, 200, 100);
  assert.notDeepEqual(goal.target, { x: 1800, y: 0, z: 3550 });
  panGoal(goal, map, 100000, 100000);
  assert.deepEqual(goal.target, { x: 0, y: 0, z: 0 });
});

test('clamping a target keeps it inside the map frame', () => {
  const target = { x: -50, y: 0, z: 99999 };
  clampTarget(map, target);
  assert.deepEqual(target, { x: 0, y: 0, z: 7100 });
});

test('zoom steps shrink and grow the radius inside the allowed range', () => {
  const goal = startGoal(map);
  zoomGoal(goal, map, 1);
  assert.ok(goal.radius < 1800);
  zoomGoal(goal, map, -1);
  assert.ok(Math.abs(goal.radius - 1800) < 0.001);
  zoomGoal(goal, map, 100);
  assert.equal(goal.radius, MIN_RADIUS);
  assert.ok(clampRadius(map, 1e9) > 7100);
});

test('orbit turns the camera but keeps the polar angle usable', () => {
  const goal = startGoal(map);
  orbitGoal(goal, 100, -10000);
  assert.ok(goal.azimuth < 0);
  assert.equal(goal.polar, MAX_POLAR);
  orbitGoal(goal, 0, 10000);
  assert.equal(goal.polar, MIN_POLAR);
});
