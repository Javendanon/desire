import assert from 'node:assert/strict';
import test from 'node:test';

import { buildScene } from '../src/scene.ts';
import { sampleManifest } from './helpers.ts';

const scene = () => buildScene(sampleManifest());

test('the scene size comes from the calibrated illustration frame', () => {
  const built = scene();
  assert.equal(built.ground.width_m, 256);
  assert.equal(built.ground.height_m, 192);
});

test('solid places are placed in meters with the calibration transform', () => {
  const built = scene();
  const gate = built.solids.find((solid) => solid.id === 'quay-gate');
  assert.ok(gate, 'quay-gate has a declared height');
  assert.ok(Math.abs(gate.center.x_m - 235) < 1e-9, `x_m ${gate.center.x_m}`);
  assert.ok(Math.abs(gate.center.z_m - 175) < 1e-9, `z_m ${gate.center.z_m}`);
});

test('a place without a height stays out of the solid geometry', () => {
  const built = scene();
  const ids = built.solids.map((solid) => solid.id);
  assert.ok(!ids.includes('chandlers-row'), 'no height must not become a solid');
  assert.deepEqual(
    built.unknown.map((place) => place.id).sort(),
    ['chandlers-row', 'tide-stairs'],
  );
});

test('every solid carries its height provenance for the fidelity tally', () => {
  const built = scene();
  const evidences = new Set(built.solids.map((solid) => solid.height_evidence));
  assert.deepEqual([...evidences].sort(), ['interpretation', 'synthetic']);
  assert.equal(built.fidelity.unknown, built.unknown.length);
});

test('navigation anchors keep their declared plan coordinates', () => {
  const built = scene();
  assert.deepEqual(built.spawn, { x_m: 16, z_m: 16 });
  assert.deepEqual(built.waypoints.map((point) => point.id), ['fish-market', 'quay-gate', 'watch']);
});
