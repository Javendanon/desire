import assert from 'node:assert/strict';
import test from 'node:test';

import { rollPhase } from '../src/lib/diorama/ships.ts';

// The fleet is rebuilt whenever sectors come and go: a ship must keep its roll.
test('a ship rolls on a phase of its own berth, whatever else is moored', () => {
  const berth = { x_m: 1520.5, z_m: 3104.25, heading_radians: 1.2 };
  const other = { x_m: 1530.5, z_m: 3104.25, heading_radians: 1.2 };
  assert.equal(rollPhase(berth), rollPhase({ ...berth }));
  assert.notEqual(rollPhase(berth), rollPhase(other));
  assert.ok(rollPhase(berth) >= 0 && rollPhase(berth) < Math.PI * 2);
});
