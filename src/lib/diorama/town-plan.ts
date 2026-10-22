// Where every part of every house goes, as instance matrices grouped by batch key (wall kind,
// roof shape and tone, chimney). Pure and free of the engine, so the loader Worker computes it
// and the frame loop only concatenates and uploads. Two levels of detail:
// - near: storey by storey, jettied upper floors, roof, dormer and chimney, with the chimney tops
//   and street doors that smoke and lanterns hang from;
// - far: one wall box the full wall height and the roof, for houses too far to show more.

import {
  instanceBounds, unionBounds, type Bounds,
} from '../engine/math/instance-bounds.ts';
import { shareOf } from '../engine/math/rng.ts';
import { planHouse, STOREY_M, type HousePlan } from './house-plan.ts';
import { roofTones, type Rgb } from './roof-palette.ts';
import type { SliceHouse } from './slice-data.ts';

/** Land sits 1 m above the water plane (tools/assets/src/slice.ts). */
export const GROUND_Y = 1;
const EAVE_OVERHANG = 1.12;
const GABLE_OVERHANG = 1.06;
/** Roof rise as a share of the span: steep, like the reference art. */
const GABLE_PITCH = 0.85;
const HIP_PITCH = 0.6;
const CHIMNEY_SIZE: Triple = [0.7, 2.4, 0.7];
const DORMER_SIZE: Triple = [1.5, 1.3, 1.2];
/** Street lanterns hang this high beside the door. */
const LANTERN_HEIGHT_M = 2.6;
/** Salt for which side of the ridge a chimney stands on, chosen by house id. */
const CHIMNEY_SIDE_SALT = 0xc41d;

export type Triple = [number, number, number];
export type Detail = 'near' | 'far';

/** A point on a house (chimney top, street door) with the house's id, for per-house choices. */
export interface MarkerPoint {
  x: number;
  y: number;
  z: number;
  id: number;
}

/** Instance matrices (column-major, 16 floats each) by batch key. */
export type Batches = Record<string, Float32Array>;

export interface TownPlan {
  batches: Batches;
  /** World box of each batch's instances. */
  bounds: Record<string, Bounds>;
  /** Roof tone colours, indexed by the tone in a roof key. */
  tones: string[];
  chimneyTops: MarkerPoint[];
  fronts: MarkerPoint[];
}

export interface TownPlanSpec {
  /** City-wide roof tone centres (index.json). Without them, tones come from these houses. */
  roofCentres?: Rgb[];
  detail: Detail;
}

type Draft = Map<string, number[]>;
type Placed = {
  house: SliceHouse;
  plan: HousePlan;
  tone: number;
};
type Markers = {
  chimneyTops: MarkerPoint[];
  fronts: MarkerPoint[];
};
/** A part placed in the house's frame: offset across and along it, and its size. */
type Part = {
  at: Triple;
  size: Triple;
};

/** World position of a point given in the house's local frame (x across, z along the depth). */
function local(house: SliceHouse, at: Triple): Triple {
  const [c, s] = [Math.cos(house.rotation_radians), Math.sin(house.rotation_radians)];
  const [x, y, z] = at;
  return [house.center.x_m + c * x + s * z, y, house.center.z_m - s * x + c * z];
}

/** Appends the matrix of a part turned with its house about the vertical axis. */
function push(draft: Draft, key: string, transform: { house: SliceHouse; part: Part }) {
  const { house, part } = transform;
  const [c, s] = [Math.cos(house.rotation_radians), Math.sin(house.rotation_radians)];
  const [x, y, z] = local(house, part.at);
  const [sx, sy, sz] = part.size;
  const list = draft.get(key) ?? draft.set(key, []).get(key)!;
  list.push(c * sx, 0, -s * sx, 0, 0, sy, 0, 0, s * sz, 0, c * sz, 0, x, y, z, 1);
}

const wallKind = (plan: HousePlan) => (plan.stone ? 'stone' : 'timber');
const pitchOf = (plan: HousePlan) => (plan.roof === 'gable' ? GABLE_PITCH : HIP_PITCH);
const roofDepth = ({ house, plan }: Placed) =>
  house.depth_m + (plan.storeys > 1 ? 2 * plan.jetty : 0);

function addStoreys(draft: Draft, placed: Placed) {
  const { house, plan } = placed;
  for (let storey = 0; storey < plan.storeys; storey += 1) {
    const depth = house.depth_m + (storey > 0 ? 2 * plan.jetty : 0);
    const y = GROUND_Y + storey * STOREY_M + STOREY_M / 2;
    push(draft, wallKind(plan), { house, part: { at: [0, y, 0],
      size: [house.width_m, STOREY_M, depth] } });
  }
}

function addShell(draft: Draft, placed: Placed) {
  const { house, plan } = placed;
  push(draft, wallKind(plan), { house, part: { at: [0, GROUND_Y + plan.wallHeight / 2, 0],
    size: [house.width_m, plan.wallHeight, house.depth_m] } });
}

function addRoof(draft: Draft, placed: Placed) {
  const { house, plan, tone } = placed;
  const size: Triple = [house.width_m * EAVE_OVERHANG, house.width_m * pitchOf(plan),
    roofDepth(placed) * GABLE_OVERHANG];
  push(draft, `${plan.roof}:${tone}`, { house,
    part: { at: [0, GROUND_Y + plan.wallHeight, 0], size } });
}

function addChimney(draft: Draft, placed: Placed, markers: Markers) {
  const { house, plan } = placed;
  if (!plan.chimney) return;
  const side = shareOf(house.id, CHIMNEY_SIDE_SALT) < 0.5 ? 1 : -1;
  const y = GROUND_Y + plan.wallHeight + house.width_m * pitchOf(plan) * 0.55;
  const at: Triple = [side * house.width_m * 0.2, y, roofDepth(placed) * 0.2];
  push(draft, 'chimney', { house, part: { at, size: CHIMNEY_SIZE } });
  const [x, , z] = local(house, at);
  markers.chimneyTops.push({ x, y: y + CHIMNEY_SIZE[1] / 2, z, id: house.id });
}

function addDormer(draft: Draft, placed: Placed) {
  const { house, plan, tone } = placed;
  if (!plan.dormer) return;
  const z = -(roofDepth(placed) / 2 - DORMER_SIZE[2]);
  const y = GROUND_Y + plan.wallHeight + DORMER_SIZE[1] / 2;
  push(draft, wallKind(plan), { house, part: { at: [0, y, z], size: DORMER_SIZE } });
  const size: Triple = [DORMER_SIZE[0] * 1.2, 0.9, DORMER_SIZE[2] * 1.3];
  push(draft, `gable:${tone}`, { house, part: { at: [0, y + DORMER_SIZE[1] / 2, z], size } });
}

function addFront(placed: Placed, markers: Markers) {
  if (!placed.house.frontage) return;
  const [x, , z] = local(placed.house, [0, 0, -(roofDepth(placed) / 2 + 0.25)]);
  markers.fronts.push({ x, y: GROUND_Y + LANTERN_HEIGHT_M, z, id: placed.house.id });
}

type Builder = (draft: Draft, placed: Placed, markers: Markers) => void;

/** The parts each detail level builds, in order. */
const BUILDERS: Record<Detail, Builder[]> = {
  near: [addStoreys, addRoof, addChimney, addDormer, (_, placed, markers) =>
    addFront(placed, markers)],
  far: [addShell, addRoof],
};

const sealed = (draft: Draft): Batches =>
  Object.fromEntries([...draft].map(([key, list]) => [key, Float32Array.from(list)]));

const boundsOf = (batches: Batches): Record<string, Bounds> =>
  Object.fromEntries(Object.entries(batches).map(([key, data]) => [key, instanceBounds(data)]));

/** Every house's parts at the given detail. O(houses). */
export function planTown(houses: SliceHouse[], spec: TownPlanSpec): TownPlan {
  const palette = roofTones(houses, spec.roofCentres);
  const draft: Draft = new Map();
  const markers: Markers = { chimneyTops: [], fronts: [] };
  const builders = BUILDERS[spec.detail];
  houses.forEach((house, index) => {
    const placed = { house, plan: planHouse(house), tone: palette.labels[index] };
    for (const build of builders) build(draft, placed, markers);
  });
  const batches = sealed(draft);
  return { batches, bounds: boundsOf(batches), tones: palette.colours, ...markers };
}

/** One batch key over many plans: their instance arrays in order, uncopied. */
export interface LayerPart {
  parts: Float32Array[];
  /** Floats over all parts. */
  floats: number;
  bounds: Bounds;
}

type Group = {
  parts: Float32Array[];
  boxes: Bounds[];
};

/** The plans' instances grouped by key, in plan order, with joint bounds. O(plans · keys). */
export function layerParts(plans: TownPlan[]): Record<string, LayerPart> {
  const grouped = new Map<string, Group>();
  for (const plan of plans) {
    for (const [key, data] of Object.entries(plan.batches)) {
      const group = grouped.get(key) ?? grouped.set(key, { parts: [], boxes: [] }).get(key)!;
      group.parts.push(data);
      group.boxes.push(plan.bounds[key]);
    }
  }
  return Object.fromEntries([...grouped].map(([key, group]) => [key, {
    parts: group.parts,
    floats: group.parts.reduce((sum, data) => sum + data.length, 0),
    bounds: unionBounds(group.boxes),
  }]));
}
