import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateScaleChecks, pixelToPlan, planGround } from '../src/calibration.js';

const calibration = (overrides = {}) => ({
  origin_px_x: 0,
  origin_px_y: 0,
  meters_per_pixel: 0.25,
  rotation_radians: 0,
  ...overrides,
});

test('pixels map to the D04 frame: x east, z south', () => {
  const plan = pixelToPlan(calibration(), { u: 400, v: 80 });
  assert.deepEqual(plan, { x_m: 100, z_m: 20 });
});

test('the pixel origin is subtracted before scaling', () => {
  const plan = pixelToPlan(calibration({ origin_px_x: 40, origin_px_y: 20 }), { u: 60, v: 60 });
  assert.deepEqual(plan, { x_m: 5, z_m: 10 });
});

test('a quarter turn maps image down into negative x', () => {
  const plan = pixelToPlan(calibration({ rotation_radians: Math.PI / 2 }), { u: 0, v: 400 });
  assert.ok(Math.abs(plan.x_m + 100) < 1e-9, `x_m ${plan.x_m}`);
  assert.ok(Math.abs(plan.z_m) < 1e-9, `z_m ${plan.z_m}`);
});

test('a calibration origin shifts the ground rectangle, not just its corner', () => {
  const illustration = { width_px: 1024, height_px: 768 };
  const ground = planGround(illustration, calibration({ origin_px_x: 256, origin_px_y: 192 }));
  assert.deepEqual(ground, {
    origin_x_m: -64,
    origin_z_m: -48,
    width_m: 256,
    height_m: 192,
  });
});

test('a scale check within tolerance passes and reports the measured distance', () => {
  const checks = [{
    id: 'quay',
    from_px: { u: 0, v: 0 }, to_px: { u: 400, v: 0 }, expected_m: 100,
  }];
  const [result] = evaluateScaleChecks(calibration(), checks);
  assert.equal(result.computed_m, 100);
  assert.equal(result.pass, true);
  assert.ok(Math.abs(result.delta_m) < 1e-9);
});

test('a scale check outside tolerance fails instead of rounding to green', () => {
  const checks = [{
    id: 'quay',
    from_px: { u: 0, v: 0 },
    to_px: { u: 400, v: 0 },
    expected_m: 120,
    tolerance_m: 1,
  }];
  const [result] = evaluateScaleChecks(calibration(), checks);
  assert.equal(result.pass, false);
  assert.equal(result.computed_m, 100);
  assert.equal(result.delta_m, -20);
});
