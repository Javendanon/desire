import test from 'node:test';
import assert from 'node:assert/strict';

import planJson from '../content/maps/waterdeep/trollskull/floor-plan.json' with { type: 'json' };
import catalogJson from '../content/props/catalog.json' with { type: 'json' };
import type { FloorPlan, PropCatalog } from '../src/generated/contracts.ts';
import { sampleCameraPath, type CameraKey } from '../src/lib/engine/math/camera-path.ts';
import {
  cellCentre,
  furniturePose,
  slidePoint,
  worldToCell,
} from '../src/lib/engine/plan/interior-placement.ts';
import { footprintCells } from '../src/lib/engine/math/square.ts';
import { routeLegs } from '../src/lib/engine/plan/interior-route.ts';

const plan = planJson as FloorPlan;
const catalog = catalogJson as PropCatalog;
const CELL = plan.cell_size_m;
const EPSILON = 1e-6;
const GROUND = 'planta-baja';
/** A square's centre is half a square in from its corner. */
const HALF = 0.5;

function close(actual: number, expected: number, label: string) {
  assert.ok(Math.abs(actual - expected) < EPSILON, `${label}: ${actual} ≠ ${expected}`);
}

test('a square centre sits at its floor elevation, shifted by the floor origin', () => {
  for (const cell of [
    { floor: GROUND, x: 2, y: 6 },
    { floor: 'segundo-piso', x: 3, y: 6 },
  ]) {
    const floor = plan.floors.find((candidate) => candidate.id === cell.floor);
    assert.ok(floor);
    const centre = cellCentre(plan, cell);
    close(centre.x, (floor.origin_x + cell.x + HALF) * CELL, `${cell.floor} x`);
    close(centre.y, floor.elevation_m, `${cell.floor} y`);
    close(centre.z, (floor.origin_y + cell.y + HALF) * CELL, `${cell.floor} z`);
  }
});

test('a point on a floor maps back to the square it falls in', () => {
  for (const cell of [
    { floor: GROUND, x: 4, y: 5 },
    { floor: 'segundo-piso', x: 6, y: 3 },
  ]) {
    const centre = cellCentre(plan, cell);
    assert.deepEqual(worldToCell(plan, cell.floor, centre), { x: cell.x, y: cell.y });
  }
});

test('turned furniture covers exactly the squares the plan gives it', () => {
  const props = new Map(catalog.props.map((prop) => [prop.kind, prop]));
  const ground = plan.floors.find((floor) => floor.id === GROUND);
  assert.ok(ground);
  for (const rotation of [0, 90, 180, 270]) {
    const item = { id: 'mesa', kind: 'mesa_larga', x: 3, y: 4, rotation, variant: 'natural' };
    const prop = props.get(item.kind);
    assert.ok(prop);
    const pose = furniturePose(plan, { floor: ground, item, prop });
    const turn = (-rotation * Math.PI) / 180;
    // Where the far corner of the model's own footprint lands after the turn.
    const corners = [
      [0, 0],
      [prop.width * CELL, prop.depth * CELL],
    ].map(([x, z]) => ({
      x: pose.position.x + x * Math.cos(turn) + z * Math.sin(turn),
      z: pose.position.z - x * Math.sin(turn) + z * Math.cos(turn),
    }));
    const covered = footprintCells(item, { x: prop.width, y: prop.depth }, rotation);
    const minX = Math.min(...covered.map((cell) => cell.x)) * CELL;
    const maxX = (Math.max(...covered.map((cell) => cell.x)) + 1) * CELL;
    const minZ = Math.min(...covered.map((cell) => cell.y)) * CELL;
    const maxZ = (Math.max(...covered.map((cell) => cell.y)) + 1) * CELL;
    close(Math.min(...corners.map((c) => c.x)), minX, `${rotation} west`);
    close(Math.max(...corners.map((c) => c.x)), maxX, `${rotation} east`);
    close(Math.min(...corners.map((c) => c.z)), minZ, `${rotation} north`);
    close(Math.max(...corners.map((c) => c.z)), maxZ, `${rotation} south`);
    close(pose.yawDegrees, -rotation, `${rotation} yaw`);
  }
});

test('the slide is sampled by distance along its path, from top to bottom', () => {
  const slide = plan.links.find((link) => link.kind === 'slide');
  assert.ok(slide);
  const start = slidePoint(slide.path, 0);
  const end = slidePoint(slide.path, 1);
  close(start.y, slide.path[0].y, 'starts at the top');
  close(end.y, slide.path[slide.path.length - 1].y, 'ends at the bottom');
  const heights = Array.from({ length: 21 }, (_, i) => slidePoint(slide.path, i / 20).y);
  heights.slice(1).forEach((height, i) => assert.ok(height <= heights[i] + EPSILON, `step ${i}`));
});

test('a camera path eases between keys and holds its ends', () => {
  const keys: CameraKey[] = [
    { position: { x: 0, y: 10, z: 0 }, target: { x: 0, y: 0, z: 0 } },
    { position: { x: 10, y: 4, z: 0 }, target: { x: 5, y: 0, z: 5 } },
    { position: { x: 10, y: 4, z: 10 }, target: { x: 5, y: 3, z: 5 } },
  ];
  assert.deepEqual(sampleCameraPath(keys, 0), keys[0]);
  assert.deepEqual(sampleCameraPath(keys, 1), keys[2]);
  const [before, after, middle, quarter] = [-1, 2, HALF, HALF / 2];
  assert.deepEqual(sampleCameraPath(keys, before), keys[0], 'held before the start');
  assert.deepEqual(sampleCameraPath(keys, after), keys[2], 'held after the end');
  assert.deepEqual(sampleCameraPath(keys, middle), keys[1]);
  const halfway = (keys[0].position.x + keys[1].position.x) / 2;
  close(sampleCameraPath(keys, quarter).position.x, halfway, 'halfway to the second key');
});

test('a route rides the slide only on the slide step, and only downwards', () => {
  const turret = { floor: 'cuspide-torreta', x: 1, y: 1 };
  const alley = { floor: GROUND, x: 0, y: 6 };
  const next = { floor: GROUND, x: 0, y: 7 };
  const down = routeLegs(plan, [turret, alley, next]);
  assert.deepEqual(down.map((leg) => leg.kind), ['slide', 'step']);
  assert.ok(down[0].link && down[0].link.path.length > 0, 'the slide leg carries the path');
  assert.deepEqual(routeLegs(plan, [alley, turret]).map((leg) => leg.kind), ['step']);
  assert.deepEqual(routeLegs(plan, [turret]), []);
});
