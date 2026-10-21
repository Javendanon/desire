import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { MAX_GRID_CELLS } from '../src/lib/routing/protocol.ts';

const RUST_GRID = new URL('../crates/core/src/routing/grid.rs', import.meta.url);
const RUST_LIMIT = /pub const MAX_GRID_CELLS: u32 = ([\d_]+);/;

function rustMaxGridCells(): number {
  const match = RUST_LIMIT.exec(readFileSync(RUST_GRID, 'utf8'));
  assert.ok(match, `MAX_GRID_CELLS declaration not found in ${RUST_GRID.pathname}`);
  return Number(match[1].replaceAll('_', ''));
}

// The client rejects before copying, so drift would copy grids the core refuses
// or refuse grids the core accepts.
test('client grid limit matches the Rust core limit', () => {
  assert.equal(MAX_GRID_CELLS, rustMaxGridCells());
});
