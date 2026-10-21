import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { BLOCKED_CELL, FREE_CELL_COST } from '../src/map-types.ts';
import { buildCostGrid, MAX_NAV_CELLS, walkCostGrid } from '../src/nav.ts';
import type { Solid } from '../src/types.ts';

const ground = { origin_x_m: 0, origin_z_m: 0, width_m: 100, height_m: 100 };
const spawn = { x_m: 5, z_m: 5 };

function wall(spec: Partial<Solid>): Solid {
  return {
    id: 'wall', name: 'Wall', center: { x_m: 50, z_m: 50 }, width_m: 4, depth_m: 100,
    rotation_radians: 0, height_m: 5, height_evidence: 'synthetic',
    style: { roof: 0, tone: 0, stone: true }, provenance: ['test'], ...spec,
  };
}

function walk(solids: Solid[], waypoints: { id: string; x_m: number; z_m: number }[]) {
  const grid = buildCostGrid({ ground, solids, cell_m: 1 });
  return walkCostGrid({ ...grid, spawn, waypoints });
}

test('the cost grid uses the D12 encoding: row-major u32, blocked sentinel, unit cost', () => {
  const { dims, costs } = buildCostGrid({ ground, solids: [wall({})], cell_m: 1 });
  assert.deepEqual([dims.width, dims.height], [100, 100]);
  assert.equal(costs.length, 100 * 100);
  assert.equal(costs[0], FREE_CELL_COST);
  assert.equal(costs[50 * 100 + 50], BLOCKED_CELL, 'row 50, column 50 lies inside the wall');
});

test('open ground reaches every waypoint', () => {
  const report = walk([], [{ id: 'far', x_m: 90, z_m: 90 }]);
  assert.equal(report.pass, true);
  assert.equal(report.reachable_ratio, 1);
});

test('a full-span wall keeps a waypoint unreachable', () => {
  const report = walk([wall({})], [{ id: 'behind', x_m: 90, z_m: 90 }]);
  assert.equal(report.waypoints[0].reachable, false);
  assert.equal(report.pass, false);
});

test('a thin full-span wall still separates its sides', () => {
  const thin = wall({ center: { x_m: 10.05, z_m: 50 }, width_m: 0.1 });
  const report = walk([thin], [{ id: 'across', x_m: 11, z_m: 5.5 }]);
  assert.equal(report.waypoints[0].reachable, false);
});

test('a rotated building blocks its real footprint, not its bounding box', () => {
  const diagonal = wall({
    center: { x_m: 50, z_m: 50 }, width_m: 40, depth_m: 2, rotation_radians: Math.PI / 4,
  });
  const { dims, costs } = buildCostGrid({ ground, solids: [diagonal], cell_m: 1 });
  assert.equal(costs[50 * dims.width + 50], BLOCKED_CELL);
  assert.equal(costs[36 * dims.width + 64], BLOCKED_CELL, 'north-east arm, engine rotation');
  assert.equal(costs[64 * dims.width + 64], FREE_CELL_COST, 'bounding-box corner stays free');
});

test('grids above the D12 routing limit are rejected before allocation', () => {
  const huge = { origin_x_m: 0, origin_z_m: 0, width_m: 2000, height_m: 2000 };
  assert.throws(() => buildCostGrid({ ground: huge, solids: [], cell_m: 1 }), /cell budget/);
});

test('the navigation cell budget matches the D12 Rust MAX_GRID_CELLS', () => {
  const rust = readFileSync(
    new URL('../../../crates/core/src/routing/grid.rs', import.meta.url), 'utf8');
  const match = /pub const MAX_GRID_CELLS: u32 = ([\d_]+);/.exec(rust);
  assert.ok(match, 'MAX_GRID_CELLS declaration not found');
  assert.equal(MAX_NAV_CELLS, Number(match[1].replaceAll('_', '')));
});
