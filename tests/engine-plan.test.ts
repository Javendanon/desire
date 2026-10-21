import test from 'node:test';
import assert from 'node:assert/strict';

import { hexDistance } from '../src/lib/engine/math/hex.ts';
import {
  buildBoard,
  placePieces,
  reachableCells,
  SCENE_BOARD,
  stepToward,
} from '../src/lib/engine/plan/board.ts';
import { isLand, planCity, TEST_CITY, TEST_CITY_LABEL } from '../src/lib/engine/plan/test-city.ts';

const plan = planCity();

test('the test city is deterministic for a seed', () => {
  const again = planCity();
  assert.equal(again.buildings.length, plan.buildings.length);
  assert.deepEqual(again.spot, plan.spot);
  assert.notEqual(planCity({ ...TEST_CITY, seed: 99 }).buildings.length, 0);
});

test('the test city says it is not the real cartography', () => {
  assert.match(TEST_CITY_LABEL, /no es la cartografía/);
});

test('every tile and building stands on land, never in the sea or the harbour basin', () => {
  assert.ok(plan.tiles.length > 100);
  assert.ok(plan.tiles.every((t) => isLand(t.x, t.z)));
  assert.ok(plan.buildings.every((b) => b.y > -0.5));
});

test('the scene spot is a harbour tile and is kept clear of buildings', () => {
  const spotTile = plan.tiles.find((t) => t.x === plan.spot.x && t.z === plan.spot.z);
  assert.equal(spotTile?.district, 'harbor');
  const fromSpot = (b: { x: number; z: number }): number =>
    Math.hypot(b.x - plan.spot.x, b.z - plan.spot.z);
  const nearest = Math.min(...plan.buildings.map(fromSpot));
  assert.ok(nearest > 7, `closest building is ${nearest.toFixed(1)} from the spot`);
});

test('the graveyard has tombs instead of houses and the hill has a keep', () => {
  assert.ok(plan.tombs.length > 0);
  assert.ok(plan.keep.base > 3, 'the keep sits on the raised hill');
});

test('wall pieces only stand on land', () => {
  assert.ok(plan.walls.length > 10);
  assert.ok(plan.walls.every((w) => isLand(w.x, w.z)));
});

test('an unknown district is an explicit error', () => {
  assert.throws(() => planCity({ ...TEST_CITY, harbor: 'atlantis' }), /atlantis/);
});

const board = buildBoard({ center: { x: 0, z: 0 }, ...SCENE_BOARD });
const pieces = placePieces(board, [
  { id: 'hero', at: { x: -4, z: 0 } },
  { id: 'ally', at: { x: -4, z: 0 } },
  { id: 'foe', at: { x: 4, z: 0 } },
]);

test('the board fits the deck and pieces never share a cell', () => {
  assert.ok(board.length >= 20, `only ${board.length} cells for five pieces and their moves`);
  const inside = (c: { x: number; z: number }): boolean =>
    Math.abs(c.x) <= SCENE_BOARD.halfWidth && Math.abs(c.z) <= SCENE_BOARD.halfDepth;
  assert.ok(board.every(inside));
  assert.equal(new Set(pieces.values()).size, 3);
});

test('reach excludes occupied cells and respects the step limit', () => {
  const reach = reachableCells({ cells: board, placement: pieces }, { id: 'hero', steps: 2 });
  const occupied = [pieces.get('ally'), pieces.get('foe')];
  assert.ok(reach.length > 0);
  assert.ok(reach.every((i) => !occupied.includes(i)));
  assert.ok(reach.every((i) => hexDistance(board[i], board[pieces.get('hero')!]) <= 2));
});

test('an approaching piece gets closer to its goal and never lands on it', () => {
  const goal = pieces.get('hero')!;
  const before = hexDistance(board[pieces.get('foe')!], board[goal]);
  const next = stepToward({ cells: board, placement: pieces }, { id: 'foe', steps: 3 }, goal);
  assert.ok(hexDistance(board[next], board[goal]) < before);
  assert.notEqual(next, goal);
});
