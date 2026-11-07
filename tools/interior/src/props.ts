// Low-poly furniture for every catalogue kind. The parts live as data in `prop-parts.json`: origin
// at the footprint's north-west corner, x east, z south, y up from the floor. `x`, `z`, `w` and
// `d` are fractions of the footprint, `y`, `h` and `r` are metres. The part with material
// `variant` is the one the engine tints with the catalogue variant.
import type { Prop } from '../../../src/generated/contracts.ts';
import partsJson from '../prop-parts.json' with { type: 'json' };
import { standingBox, standingCylinder, type Shape } from './shapes.ts';

interface PartBase {
  name: string;
  material: string;
  x: number;
  z: number;
  y: number;
  h: number;
}

interface BoxPart extends PartBase {
  kind: 'box';
  w: number;
  d: number;
}

interface CylinderPart extends PartBase {
  kind: 'cylinder';
  r: number;
}

type Part = BoxPart | CylinderPart;

interface PartTable {
  /** A plain block for kinds without a model, so a new catalogue entry still shows up. */
  fallback: Part[];
  kinds: Record<string, Part[]>;
}

const PARTS = partsJson as PartTable;

interface Footprint {
  w: number;
  d: number;
}

function boxShape(part: BoxPart, size: Footprint): Shape {
  return standingBox(part, [part.x * size.w, part.y, part.z * size.d],
    [part.w * size.w, part.h, part.d * size.d]);
}

function cylinderShape(part: CylinderPart, size: Footprint): Shape {
  return standingCylinder(part, [part.x * size.w, part.y, part.z * size.d],
    { radius: part.r, height: part.h });
}

function toShape(part: Part, size: Footprint): Shape {
  return part.kind === 'box' ? boxShape(part, size) : cylinderShape(part, size);
}

/** Shapes of one catalogue piece in its own footprint, for squares of `cell` metres. O(parts). */
export function propShapes(prop: Prop, cell: number): Shape[] {
  const size = { w: prop.width * cell, d: prop.depth * cell };
  return (PARTS.kinds[prop.kind] ?? PARTS.fallback).map((part) => toShape(part, size));
}
