import assert from 'node:assert/strict';
import test from 'node:test';

import { createMeter, meterSummary, recordFrame } from '../src/lib/diorama/perf-meter.ts';
import { parseQuality, QUALITY } from '../src/lib/diorama/quality.ts';

test('the meter reports fps, median, p95 and the share of frames over budget', () => {
  const meter = createMeter(10);
  for (const ms of [16, 16, 16, 16, 16, 16, 16, 16, 33, 50]) recordFrame(meter, ms);
  const summary = meterSummary(meter, 16.7);
  assert.equal(summary.p50, 16);
  assert.equal(summary.p95, 50);
  assert.equal(summary.overBudget, 0.2);
  assert.equal(Math.round(summary.fps), Math.round(1000 / 21.1));
});

test('the meter keeps only the most recent window of frames', () => {
  const meter = createMeter(3);
  for (const ms of [100, 100, 100, 10, 10, 10]) recordFrame(meter, ms);
  assert.equal(meterSummary(meter, 16.7).p95, 10);
});

test('an empty meter reports nothing over budget', () => {
  assert.deepEqual(meterSummary(createMeter(4), 16.7), { fps: 0, p50: 0, p95: 0, overBudget: 0 });
});

test('quality presets step down pixels, antialiasing, occlusion and bloom', () => {
  assert.equal(parseQuality(null), 'high');
  assert.equal(parseQuality('low'), 'low');
  assert.equal(parseQuality('ultra'), 'high');
  const [high, medium, low] = [QUALITY.high, QUALITY.medium, QUALITY.low];
  assert.ok(high.pixelRatio > medium.pixelRatio && medium.pixelRatio > low.pixelRatio);
  assert.ok(high.msaa >= medium.msaa && medium.msaa >= low.msaa);
  assert.equal(low.ssao, false);
  assert.equal(low.bloom, false);
});
