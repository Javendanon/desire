// Writes the Blender build input for the Trollskull plan: every floor's shapes, the slide and one
// low-poly model per catalogue kind. Usage: node tools/interior/derive.ts <out.json>
import { readFileSync, writeFileSync } from 'node:fs';

import type { FloorPlan, PropCatalog } from '../../src/generated/contracts.ts';
import { validateFloorPlan } from '../../src/lib/engine/plan/floor-validation.ts';
import { buildInput } from './src/build-input.ts';

const PLAN = 'content/maps/waterdeep/trollskull/floor-plan.json';
const CATALOG = 'content/props/catalog.json';

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

const out = process.argv[2];
if (!out) throw new Error('usage: node tools/interior/derive.ts <out.json>');
const plan = readJson<FloorPlan>(PLAN);
const catalog = readJson<PropCatalog>(CATALOG);
const problems = validateFloorPlan(plan, catalog);
if (problems.length > 0) throw new Error(`floor plan is not valid:\n${problems.join('\n')}`);
writeFileSync(out, JSON.stringify(buildInput(plan, catalog)));
console.log(`wrote ${out}`);
