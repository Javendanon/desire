import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';

import planJson from '../content/maps/waterdeep/trollskull/floor-plan.json' with { type: 'json' };
import catalogJson from '../content/props/catalog.json' with { type: 'json' };
import type { FloorPlan, PropCatalog } from '../src/generated/contracts.ts';
import { buildInput } from '../tools/interior/src/build-input.ts';
import { meshBounds, readGlb, readGlbJson, vec3s } from '../tools/interior/src/glb.ts';
import { buildScene, type Shape } from '../tools/interior/src/scene.ts';

const plan = planJson as FloorPlan;
const catalog = catalogJson as PropCatalog;
const MODELS = new URL('../public/models/trollskull/', import.meta.url);
/** The whole manor, furniture included, must stay light enough to stream on a phone. */
const SIZE_BUDGET_BYTES = 8 * 1024 * 1024;
/** Blender writes positions as 32-bit floats. */
const TOLERANCE = 1e-3;

function glb(path: string) {
  return readGlbJson(readFileSync(new URL(path, MODELS)));
}

function wallBounds(shapes: Shape[]) {
  const walls = shapes.filter((shape) => shape.name.startsWith('muro-'));
  const extent = (shape: Shape, axis: number, sign: number) =>
    shape.center[axis] + (sign * (shape.kind === 'box' ? shape.size[axis] : 0)) / 2;
  const reduce = (sign: number, pick: (...values: number[]) => number) =>
    [0, 1, 2].map((axis) => pick(...walls.map((wall) => extent(wall, axis, sign))));
  return { min: reduce(-1, Math.min), max: reduce(1, Math.max) };
}

/** glTF is y-up like our shapes, so bounds compare axis by axis. */
function assertClose(actual: number[], expected: number[], label: string) {
  actual.forEach((value, axis) => {
    const message = `${label}[${axis}] ${value} ≠ ${expected[axis]}`;
    assert.ok(Math.abs(value - expected[axis]) < TOLERANCE, message);
  });
}

test('there is one model per floor, one for the slide and one per catalogue kind', () => {
  for (const floor of plan.floors) {
    const names = (glb(`${floor.id}.glb`).meshes ?? []).map((mesh) => mesh.name);
    assert.ok(names.includes(`${floor.id}-muros`), `${floor.id} walls`);
    assert.ok(names.includes(`${floor.id}-suelos`), `${floor.id} floors`);
  }
  assert.ok((glb('tobogan.glb').meshes ?? []).some((mesh) => mesh.name === 'tobogan'));
  for (const prop of catalog.props) {
    const materials = (glb(`props/${prop.kind}.glb`).materials ?? []).map((m) => m.name);
    assert.ok(materials.includes('variant'), `${prop.kind} keeps a recolourable material`);
  }
});

test('the committed models match the current floor plan', () => {
  const scene = buildScene(plan);
  for (const floor of scene.floors) {
    const built = meshBounds(glb(`${floor.id}.glb`), `${floor.id}-muros`);
    const expected = wallBounds(floor.shapes);
    assertClose(built.min, expected.min, `${floor.id} min`);
    assertClose(built.max, expected.max, `${floor.id} max`);
  }
});

test('the manor fits its size budget', () => {
  const files = (dir: URL): number[] =>
    readdirSync(dir).flatMap((name) => {
      const path = new URL(name, dir);
      return statSync(path).isDirectory() ? files(new URL(`${name}/`, dir)) : [statSync(path).size];
    });
  const total = files(MODELS).reduce((sum, size) => sum + size, 0);
  assert.ok(total < SIZE_BUDGET_BYTES, `${total} bytes`);
});

test('the committed models were built from exactly the current plan, catalogue and parts', () => {
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', MODELS), 'utf8'));
  assert.equal(manifest.scene_sha256, buildInput(plan, catalog).hash,
    'rebuild: see tools/interior/README.md');
});

/** Each primitive of the round table is one cylinder: check its normals against its own axis. */
function assertFacesOutward(positions: number[][], normals: number[][]) {
  const span = (axis: number) => positions.map((position) => position[axis]);
  const middle = (axis: number) => (Math.min(...span(axis)) + Math.max(...span(axis))) / 2;
  const [cx, cy, cz] = [middle(0), middle(1), middle(2)];
  positions.forEach(([x, y, z], index) => {
    const [nx, ny, nz] = normals[index];
    const onSide = Math.abs(ny) < 0.5;
    const outward = onSide ? nx * (x - cx) + nz * (z - cz) : ny * (y - cy);
    assert.ok(outward > -TOLERANCE, `vertex ${index} faces inward`);
  });
}

test('cylinders face outward, so round furniture is not culled away', () => {
  const file = readGlb(readFileSync(new URL('props/mesa_redonda.glb', MODELS)));
  const primitives = file.json.meshes?.[0]?.primitives ?? [];
  assert.ok(primitives.length > 0);
  for (const { attributes } of primitives) {
    assert.ok(attributes.NORMAL !== undefined, 'the exporter writes normals');
    assertFacesOutward(vec3s(file, attributes.POSITION), vec3s(file, attributes.NORMAL));
  }
});
