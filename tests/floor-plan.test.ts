import test from 'node:test';
import assert from 'node:assert/strict';

import planJson from '../content/maps/waterdeep/trollskull/floor-plan.json' with { type: 'json' };
import catalogJson from '../content/props/catalog.json' with { type: 'json' };
import type { FloorPlan, PropCatalog } from '../src/generated/contracts.ts';
import {
  buildFloorBoard,
  findPath,
  isWalkable,
  reachable,
  type FloorCellRef,
} from '../src/lib/engine/plan/floor-board.ts';
import { floorEdges } from '../src/lib/engine/plan/floor-edges.ts';
import { validateFloorPlan } from '../src/lib/engine/plan/floor-validation.ts';
import { cellKey } from '../src/lib/engine/plan/floor-index.ts';

const plan = planJson as FloorPlan;
const catalog = catalogJson as PropCatalog;
const GROUND = 'planta-baja';

function at(floor: string, x: number, y: number): FloorCellRef {
  return { floor, x, y };
}

// Named squares of the Trollskull plan (floor-local coordinates), so each test reads as a place.
const PLACE = {
  kitchenFloor: at(GROUND, 3, 12),
  kitchenByTable: at(GROUND, 4, 12),
  kitchenTable: at(GROUND, 4, 11),
  kitchenEast: at(GROUND, 5, 11),
  pantryDoor: at(GROUND, 6, 11),
  tavernSouth: at(GROUND, 3, 10),
  tavernAboveKitchen: at(GROUND, 5, 10),
  tavernCornerAboveKitchen: at(GROUND, 4, 10),
  sideAlley: at(GROUND, 2, 9),
  tavernBySideDoor: at(GROUND, 3, 9),
  tavernStairs: at(GROUND, 3, 7),
  firstFloorStairs: at('primer-piso', 3, 7),
  turretLadder: at('segundo-piso', 0, 0),
  turretTopLadder: at('cuspide-torreta', 0, 0),
  trapdoor: at(GROUND, 7, 7),
  cellarStairs: at('sotano', 4, 3),
  slideStart: at('cuspide-torreta', 1, 1),
  slideExit: at(GROUND, 0, 6),
  barWest: at(GROUND, 6, 6),
  barEast: at(GROUND, 7, 6),
  barStool: at(GROUND, 5, 6),
  tavernOpen: at(GROUND, 3, 3),
  tavernOpenDiagonal: at(GROUND, 4, 4),
  tavernCentre: at(GROUND, 4, 5),
  mainDoor: at(GROUND, 2, 6),
  porch: at(GROUND, 1, 4),
} as const;

/** A spiral, not a straight chute: the slide path keeps many points. */
const MIN_SLIDE_POINTS = 10;

function same(a: FloorCellRef, b: FloorCellRef): boolean {
  return cellKey(a) === cellKey(b);
}

function oneStep(board: ReturnType<typeof buildFloorBoard>, from: FloorCellRef) {
  return reachable(board, from, 1);
}

function withDoor(id: string, open: boolean): FloorPlan {
  const copy = structuredClone(plan);
  for (const floor of copy.floors) {
    for (const door of floor.doors) if (door.id === id) door.open = open;
  }
  return copy;
}

test('the Trollskull plan and catalogue validate without problems', () => {
  assert.deepEqual(validateFloorPlan(plan, catalog), []);
});

test('a wall blocks a move between rooms that share no door', () => {
  const board = buildFloorBoard(plan, catalog);
  const blockedByTable = oneStep(board, PLACE.kitchenByTable).has(cellKey(PLACE.kitchenTable));
  assert.equal(blockedByTable, false, 'the table fills its square');
  assert.equal(oneStep(board, PLACE.kitchenEast).has(cellKey(PLACE.tavernAboveKitchen)), false);
  const path = findPath(board, PLACE.kitchenFloor, PLACE.tavernSouth);
  assert.ok(path, 'the tavern is reachable through the pantry');
  assert.ok(path.some((cell) => same(cell, PLACE.pantryDoor)), 'it goes through the door');
});

test('a closed door blocks the way and an open one lets it through', () => {
  const alley = PLACE.sideAlley;
  const tavern = cellKey(PLACE.tavernBySideDoor);
  assert.equal(oneStep(buildFloorBoard(plan, catalog), alley).has(tavern), false);
  const opened = buildFloorBoard(withDoor('puerta-lateral', true), catalog);
  assert.equal(oneStep(opened, alley).has(tavern), true);
});

test('stairs, ladders and the trapdoor change floor in one move', () => {
  const board = buildFloorBoard(plan, catalog);
  const pairs: [FloorCellRef, FloorCellRef][] = [
    [PLACE.tavernStairs, PLACE.firstFloorStairs],
    [PLACE.turretLadder, PLACE.turretTopLadder],
    [PLACE.trapdoor, PLACE.cellarStairs],
  ];
  for (const [from, to] of pairs) {
    const label = `${cellKey(from)} ↔ ${cellKey(to)}`;
    assert.equal(oneStep(board, from).has(cellKey(to)), true, label);
    assert.equal(oneStep(board, to).has(cellKey(from)), true, label);
  }
});

test('the slide drops from the turret to the alley in one move and never climbs back', () => {
  const board = buildFloorBoard(plan, catalog);
  const turret = PLACE.slideStart;
  const alley = PLACE.slideExit;
  assert.equal(oneStep(board, turret).has(cellKey(alley)), true);
  assert.equal(oneStep(board, alley).has(cellKey(turret)), false);
  const slide = plan.links.find((link) => link.kind === 'slide');
  assert.ok(slide && slide.path.length > MIN_SLIDE_POINTS, 'the slide carries its spiral path');
  assert.ok(slide.path[0].y > slide.path[slide.path.length - 1].y, 'it goes down');
});

test('blocking furniture fills its squares and light furniture does not', () => {
  const board = buildFloorBoard(plan, catalog);
  assert.equal(isWalkable(board, PLACE.barWest), false, 'bar');
  assert.equal(isWalkable(board, PLACE.barEast), false, 'the bar is two squares wide');
  assert.equal(isWalkable(board, PLACE.barStool), true, 'a stool can be stepped past');
});

test('a diagonal step never cuts through a wall corner', () => {
  const board = buildFloorBoard(plan, catalog);
  // The kitchen and the tavern are split by a wall, so the tavern corner is not a diagonal away.
  const corner = cellKey(PLACE.tavernCornerAboveKitchen);
  assert.equal(oneStep(board, PLACE.kitchenEast).has(corner), false);
  // Inside one room the diagonal is a single step, as in D&D.
  const diagonal = cellKey(PLACE.tavernOpenDiagonal);
  assert.equal(oneStep(board, PLACE.tavernOpen).has(diagonal), true);
});

test('the edges the model draws come from the same data', () => {
  const edges = floorEdges(plan, GROUND);
  const kinds = new Set(edges.map((edge) => edge.kind));
  assert.deepEqual([...kinds].sort(), ['door', 'wall', 'window']);
  const onGround = (edge: { x: number; y: number }) => ({ ...edge, floor: GROUND });
  const main = edges.find((edge) => edge.kind === 'door' && same(onGround(edge), PLACE.mainDoor));
  assert.ok(main, 'the main door is an opening in the west wall');
  const porchToAlley = edges.find(
    (edge) => edge.side === 'w' && same(onGround(edge), PLACE.porch),
  );
  assert.equal(porchToAlley, undefined, 'two outdoor areas have no wall between them');
  const ids = edges.map((edge) => `${edge.x},${edge.y},${edge.side}`);
  assert.equal(new Set(ids).size, ids.length, 'every shared edge is drawn once');
});

test('validation explains what is wrong with a broken plan', () => {
  const broken = structuredClone(plan);
  const ground = broken.floors.find((floor) => floor.id === GROUND);
  assert.ok(ground);
  ground.doors.push({ id: 'puerta-en-medio', edge: { x: 4, y: 4, side: 'n' }, open: true });
  ground.furniture.push({ id: 'trono', kind: 'trono', x: 4, y: 5, rotation: 0, variant: 'oro' });
  ground.rooms.push({ ...ground.rooms[0], id: 'duplicada' });
  ground.furniture.push({ ...PLACE.barWest, id: 'barril-encima', kind: 'barril', rotation: 0,
    variant: 'natural' });
  broken.links.push({ ...broken.links[0], id: 'rota', to: { floor: 'primer-piso', x: 40, y: 40 } });
  const problems = validateFloorPlan(broken, catalog).join('\n');
  assert.match(problems, /puerta-en-medio/);
  assert.match(problems, /trono/);
  assert.match(problems, /duplicada/);
  assert.match(problems, /barril-encima se superpone con otro mueble/);
  assert.match(problems, /rota/);
});

test('with every door open, every room of the house can be reached from the tavern', () => {
  const opened = structuredClone(plan);
  for (const floor of opened.floors) for (const door of floor.doors) door.open = true;
  const board = buildFloorBoard(opened, catalog);
  const reached = reachable(board, PLACE.tavernCentre, Number.POSITIVE_INFINITY);
  const unreachable = opened.floors.flatMap((floor) =>
    floor.rooms
      .filter((room) =>
        room.cells.every((rect) => {
          const cells = Array.from({ length: rect.w * rect.h }, (_, i) =>
            at(floor.id, rect.x + (i % rect.w), rect.y + Math.floor(i / rect.w)),
          );
          return cells.every((cell) => !reached.has(cellKey(cell)));
        }),
      )
      .map((room) => `${floor.id}/${room.id}`),
  );
  assert.deepEqual(unreachable, []);
});

/** Two indoor rooms side by side (west column A, east column B), joined only at the north edge. */
function twoRooms(join: 'opening' | 'closed-door'): FloorPlan {
  const room = (id: string, x: number) => ({
    id,
    name: id,
    kind: 'interior' as const,
    cells: [{ x, y: 0, w: 1, h: 2, chamfer: false }],
    floor_material: 'wood_plank' as const,
    wall_material: 'plaster' as const,
    tint: null,
  });
  const edge = { x: 0, y: 0, side: 'e' as const };
  const joined = join === 'opening';
  return {
    id: 'fixture',
    name: 'fixture',
    cell_size_m: 1.524,
    source: 'test',
    links: [],
    floors: [
      {
        id: 'f',
        name: 'f',
        elevation_m: 0,
        height_m: 3,
        origin_x: 0,
        origin_y: 0,
        rooms: [room('a', 0), room('b', 1)],
        doors: joined ? [] : [{ id: 'door', edge, open: false }],
        windows: [],
        openings: joined ? [{ id: 'gap', edge }] : [],
        furniture: [],
      },
    ],
  };
}

test('a diagonal needs both detours, whichever side is walled', () => {
  const board = buildFloorBoard(twoRooms('opening'), catalog);
  const cell = (x: number, y: number) => ({ floor: 'f', x, y });
  // North-west to south-east: the east-then-south detour works, the south-then-east one is walled.
  assert.equal(oneStep(board, cell(0, 0)).has(cellKey(cell(1, 1))), false);
  // South-west to north-east: the north-then-east detour works, the east-then-north one is walled.
  assert.equal(oneStep(board, cell(0, 1)).has(cellKey(cell(1, 0))), false);
  assert.equal(oneStep(board, cell(0, 0)).has(cellKey(cell(1, 0))), true, 'through the opening');
  const closed = buildFloorBoard(twoRooms('closed-door'), catalog);
  assert.equal(oneStep(closed, cell(0, 0)).has(cellKey(cell(1, 0))), false, 'closed door');
  assert.equal(oneStep(closed, cell(0, 1)).has(cellKey(cell(1, 0))), false, 'no corner cut');
});

test('validation catches marks with no wall, doubled marks, sealed doors and blocked links', () => {
  const broken = structuredClone(plan);
  const ground = broken.floors.find((floor) => floor.id === GROUND);
  assert.ok(ground);
  ground.doors.push({ id: 'puerta-al-aire', edge: { ...PLACE.porch, side: 'w' }, open: true });
  ground.windows.push({ id: 'ventana-en-paso', edge: { x: 6, y: 8, side: 'n' } });
  const mainDoor = ground.doors.find((door) => door.id === 'puerta-principal');
  assert.ok(mainDoor);
  ground.furniture.push({ ...mainDoor.edge, id: 'barril-en-puerta', kind: 'barril', rotation: 0,
    variant: 'natural' });
  broken.links.push({ ...broken.links[0], id: 'escalera-a-la-barra', to: PLACE.barWest });
  broken.links.push({ ...broken.links[0], id: 'escalera-al-vacio',
    to: { floor: 'piso-inexistente', x: 0, y: 0 } });
  const problems = validateFloorPlan(broken, catalog).join('\n');
  assert.match(problems, /puerta-al-aire necesita un muro/);
  assert.match(problems, /tiene dos marcas/);
  assert.match(problems, /un mueble tapa puerta-principal/);
  assert.match(problems, /escalera-a-la-barra une casillas que no existen o están ocupadas/);
  assert.match(problems, /escalera-al-vacio apunta al piso inexistente piso-inexistente/);
});
