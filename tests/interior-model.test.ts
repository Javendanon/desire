import test from 'node:test';
import assert from 'node:assert/strict';

import planJson from '../content/maps/waterdeep/trollskull/floor-plan.json' with { type: 'json' };
import catalogJson from '../content/props/catalog.json' with { type: 'json' };
import type { FloorPlan, PropCatalog } from '../src/generated/contracts.ts';
import { buildScene, type Shape } from '../tools/interior/src/scene.ts';
import { propShapes } from '../tools/interior/src/props.ts';
import { MATERIALS } from '../tools/interior/src/materials.ts';

const plan = planJson as FloorPlan;
const catalog = catalogJson as PropCatalog;
const scene = buildScene(plan);
const GROUND = 'planta-baja';
/** Distances are compared to the millimetre. */
const EPSILON = 1e-3;
/** Doors leave this much clear height under the lintel. */
const DOOR_HEIGHT_M = 2.1;

function floorShapes(id: string): Shape[] {
  const floor = scene.floors.find((candidate) => candidate.id === id);
  assert.ok(floor, `floor ${id}`);
  return floor.shapes;
}

function named(shapes: Shape[], prefix: string): Shape[] {
  return shapes.filter((shape) => shape.name.startsWith(prefix));
}

test('every floor of the plan becomes one model with floors and walls', () => {
  assert.deepEqual(
    scene.floors.map((floor) => floor.id),
    plan.floors.map((floor) => floor.id),
  );
  for (const floor of scene.floors) {
    assert.ok(named(floor.shapes, 'suelo-').length > 0, `${floor.id} has floor slabs`);
    assert.ok(named(floor.shapes, 'muro-').length > 0, `${floor.id} has walls`);
  }
});

test('a door leaves a walkable gap: only a lintel stands above door height', () => {
  const shapes = floorShapes(GROUND);
  const lintel = named(shapes, 'dintel-puerta-principal');
  assert.equal(lintel.length, 1);
  const [door] = lintel;
  assert.equal(door.kind, 'box');
  const bottom = door.center[1] - door.size[1] / 2;
  assert.ok(Math.abs(bottom - DOOR_HEIGHT_M) < EPSILON, 'the opening is 2.1 m tall');
  const walls = named(shapes, 'muro-');
  assert.equal(walls.some((wall) => wall.name.includes('puerta-principal')), false);
});

test('a window keeps a sill, a lintel and a pane of glass', () => {
  const shapes = floorShapes(GROUND);
  for (const part of ['alfeizar', 'dintel', 'vidrio']) {
    assert.equal(named(shapes, `${part}-ventana-norte`).length, 1, part);
  }
  const [glass] = named(shapes, 'vidrio-ventana-norte');
  assert.equal(glass.material, 'glass');
});

test('walls sit on the floor elevation and rise to the floor height', () => {
  const floor = plan.floors.find((candidate) => candidate.id === 'primer-piso');
  assert.ok(floor);
  for (const wall of named(floorShapes(floor.id), 'muro-')) {
    assert.equal(wall.kind, 'box');
    const bottom = wall.center[1] - wall.size[1] / 2;
    assert.ok(Math.abs(bottom - floor.elevation_m) < EPSILON, wall.name);
    assert.ok(Math.abs(wall.size[1] - floor.height_m) < EPSILON, wall.name);
  }
});

test('stairs climb from the lower floor to the upper one', () => {
  const steps = named(floorShapes(GROUND), 'escalera-escalera-taberna');
  assert.ok(steps.length >= 8, 'a flight of steps');
  const tops = steps.map((step) => (step.kind === 'box' ? step.center[1] + step.size[1] / 2 : 0));
  const firstFloor = plan.floors.find((floor) => floor.id === 'primer-piso');
  assert.ok(firstFloor);
  const reach = Math.max(...tops);
  const label = 'the last step reaches the first floor';
  assert.ok(Math.abs(reach - firstFloor.elevation_m) < EPSILON, label);
});

test('the slide follows its path from the turret to the alley, held up by posts', () => {
  const { slide } = scene;
  assert.ok(slide, 'the plan has a slide');
  const link = plan.links.find((candidate) => candidate.kind === 'slide');
  assert.deepEqual(slide.points, link?.path.map((point) => [point.x, point.y, point.z]));
  assert.ok(slide.posts.length >= 4, 'posts hold the spiral');
  for (const post of slide.posts) {
    assert.equal(post.kind, 'cylinder');
    assert.ok(post.center[1] - post.height / 2 >= -EPSILON, 'posts stand on the ground');
  }
});

test('every material a shape uses is defined', () => {
  const used = new Set(scene.floors.flatMap((floor) => floor.shapes.map((s) => s.material)));
  for (const kind of catalog.props) {
    for (const shape of propShapes(kind, plan.cell_size_m)) used.add(shape.material);
  }
  for (const material of used) assert.ok(material in MATERIALS, material);
});

test('every catalogue kind has a low-poly model that fits its footprint', () => {
  for (const prop of catalog.props) {
    const shapes = propShapes(prop, plan.cell_size_m);
    assert.ok(shapes.length > 0, prop.kind);
    assert.ok(
      shapes.some((shape) => shape.material === 'variant'),
      `${prop.kind} has a recolourable part`,
    );
    for (const shape of shapes) {
      const half = shape.kind === 'box' ? shape.size[0] / 2 : shape.radius;
      assert.ok(shape.center[0] - half >= -EPSILON, `${prop.kind}/${shape.name} west`);
      assert.ok(shape.center[0] + half <= prop.width * plan.cell_size_m + EPSILON, shape.name);
      const depth = shape.kind === 'box' ? shape.size[2] / 2 : shape.radius;
      assert.ok(shape.center[2] - depth >= -EPSILON, `${prop.kind}/${shape.name} north`);
      assert.ok(shape.center[2] + depth <= prop.depth * plan.cell_size_m + EPSILON, shape.name);
    }
  }
});

function only(shapes: Shape[], prefix: string): Shape {
  const [shape, ...rest] = named(shapes, prefix);
  assert.ok(shape && rest.length === 0, prefix);
  return shape;
}

const CELL = plan.cell_size_m;
/** Window sill and glass top, from tools/interior/src/shell.ts. */
const WINDOW = { sill: 0.9, top: 2 };
/** Squares east and south of the plan origin where the checked openings sit, edge centres. */
const MAIN_DOOR_EDGE = { x: 2, z: 6.5 };
const LIBRARY_WINDOW_EDGE = { x: 9, z: 3.5 };

test('walls and openings sit on the edge the plan names, offset by the floor origin', () => {
  // Main door: west edge of ground square (2, 6), so x = 2 squares and z = 6.5 squares.
  const door = only(floorShapes(GROUND), 'dintel-puerta-principal');
  assert.ok(Math.abs(door.center[0] - MAIN_DOOR_EDGE.x * CELL) < EPSILON, 'x');
  assert.ok(Math.abs(door.center[2] - MAIN_DOOR_EDGE.z * CELL) < EPSILON, 'z');
  // Second floor starts one square further south (origin_y = 1).
  const window = only(floorShapes('segundo-piso'), 'vidrio-ventana-biblioteca');
  const secondFloor = plan.floors.find((floor) => floor.id === 'segundo-piso');
  assert.ok(secondFloor);
  const edgeZ = (secondFloor.origin_y + LIBRARY_WINDOW_EDGE.z) * CELL;
  assert.ok(Math.abs(window.center[0] - LIBRARY_WINDOW_EDGE.x * CELL) < EPSILON, 'east edge');
  assert.ok(Math.abs(window.center[2] - edgeZ) < EPSILON, 'row 3 plus the floor origin');
});

test('windows have a sill up to 0.9 m and glass up to 2 m', () => {
  const shapes = floorShapes(GROUND);
  const sill = only(shapes, 'alfeizar-ventana-norte');
  const glass = only(shapes, 'vidrio-ventana-norte');
  assert.equal(sill.kind, 'box');
  assert.equal(glass.kind, 'box');
  if (sill.kind !== 'box' || glass.kind !== 'box') return;
  assert.ok(Math.abs(sill.center[1] + sill.size[1] / 2 - WINDOW.sill) < EPSILON, 'sill top');
  assert.ok(Math.abs(glass.center[1] + glass.size[1] / 2 - WINDOW.top) < EPSILON, 'glass top');
});

test('slabs sit just under each floor surface', () => {
  for (const floor of plan.floors) {
    for (const slab of named(floorShapes(floor.id), 'suelo-')) {
      assert.equal(slab.kind, 'box');
      if (slab.kind !== 'box') continue;
      const top = slab.center[1] + slab.size[1] / 2;
      assert.ok(Math.abs(top - floor.elevation_m) < EPSILON, slab.name);
    }
  }
});

test('the trapdoor puts a hatch on the tavern floor and a ladder in the cellar', () => {
  assert.equal(named(floorShapes(GROUND), 'portilla-portilla-sotano').length, 1);
  assert.ok(named(floorShapes('sotano'), 'escala-portilla-sotano').length > 2);
  assert.equal(named(floorShapes('sotano'), 'portilla-').length, 0);
});
