import assert from 'node:assert/strict';
import test from 'node:test';

import { navigate } from '../src/nav.js';

const ground = { origin_x_m: 0, origin_z_m: 0, width_m: 100, height_m: 100 };
const spawn = { x_m: 5, z_m: 5 };

test('open ground reaches every waypoint', () => {
  const waypoints = [{ id: 'far', x_m: 90, z_m: 90 }];
  const report = navigate({ ground, blockers: [], spawn, waypoints });
  assert.equal(report.pass, true);
  assert.equal(report.waypoints[0].reachable, true);
  assert.ok(report.reachable_ratio > 0.9);
});

test('a full-height wall keeps a waypoint unreachable', () => {
  const wall = { min_x: 48, max_x: 52, min_z: 0, max_z: 100 };
  const report = navigate({
    ground,
    blockers: [wall],
    spawn,
    waypoints: [{ id: 'behind-wall', x_m: 90, z_m: 90 }],
  });
  assert.equal(report.waypoints[0].reachable, false);
  assert.equal(report.pass, false);
});

test('blocked cells are counted so the report is auditable', () => {
  const wall = { min_x: 48, max_x: 52, min_z: 0, max_z: 100 };
  const report = navigate({ ground, blockers: [wall], spawn, waypoints: [] });
  assert.ok(report.blocked_cells >= 4, `blocked ${report.blocked_cells}`);
  assert.equal(report.free_cells + report.blocked_cells, report.total_cells);
});
