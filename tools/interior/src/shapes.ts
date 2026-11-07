// The primitives the Blender build understands, in glTF axes: x east, y up, z south, metres.

export type Vec3 = readonly [number, number, number];

export interface Box {
  kind: 'box';
  name: string;
  material: string;
  center: Vec3;
  size: Vec3;
}

export interface Cylinder {
  kind: 'cylinder';
  name: string;
  material: string;
  center: Vec3;
  radius: number;
  height: number;
}

export type Shape = Box | Cylinder;

/** What a shape is called and what it is made of. */
export interface Label {
  name: string;
  material: string;
}

export interface CylinderSize {
  radius: number;
  height: number;
}

/** A box resting on `at[1]`, centred on (x, z). */
export function standingBox({ name, material }: Label, at: Vec3, size: Vec3): Box {
  return {
    kind: 'box',
    name,
    material,
    center: [at[0], at[1] + size[1] / 2, at[2]],
    size,
  };
}

/** A vertical cylinder resting on `at[1]`, centred on (x, z). */
export function standingCylinder(
  { name, material }: Label,
  at: Vec3,
  size: CylinderSize,
): Cylinder {
  return {
    kind: 'cylinder',
    name,
    material,
    center: [at[0], at[1] + size.height / 2, at[2]],
    radius: size.radius,
    height: size.height,
  };
}
