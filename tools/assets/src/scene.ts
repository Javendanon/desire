/** Turns a validated manifest into a metric scene: solids, unknown places and fidelity. */
import { pixelToPlan, planGround } from './calibration.ts';
import type { Calibration, Manifest, Place, Solid } from './types.ts';

export type Scene = ReturnType<typeof buildScene>;

type SolidPlace = Place & {
  height_m: number;
  height_evidence: Solid['height_evidence'];
};
const hasHeight = (place: Place): place is SolidPlace => typeof place.height_m === 'number';

function toSolid(place: SolidPlace, calibration: Calibration): Solid {
  return {
    id: place.id,
    name: place.name,
    center: pixelToPlan(calibration, place.pixel),
    width_m: place.footprint_m.width_m,
    depth_m: place.footprint_m.depth_m,
    rotation_radians: place.rotation_radians ?? 0,
    height_m: place.height_m,
    height_evidence: place.height_evidence,
    style: place.style,
    provenance: place.provenance,
  };
}

function toUnknown(place: Place, calibration: Calibration) {
  return {
    id: place.id,
    name: place.name,
    center: pixelToPlan(calibration, place.pixel),
    provenance: place.provenance,
  };
}

function tally(solids: Solid[], unknown: { length: number }) {
  const fidelity = { verified: 0, interpretation: 0, synthetic: 0, unknown: unknown.length };
  for (const solid of solids) fidelity[solid.height_evidence] += 1;
  return fidelity;
}

/** Builds the metric scene. Heights come only from declared data, never from a default. */
export function buildScene(manifest: Manifest) {
  const { calibration, illustration } = manifest;
  const solids = manifest.places.filter(hasHeight).map((place) => toSolid(place, calibration));
  const unknown = manifest.places.filter((place) => !hasHeight(place))
    .map((place) => toUnknown(place, calibration));
  return {
    id: manifest.id,
    label: manifest.label,
    ground: planGround(illustration, calibration),
    solids,
    unknown,
    spawn: { x_m: manifest.spawn.x_m, z_m: manifest.spawn.z_m },
    waypoints: manifest.waypoints.map(({ id, x_m, z_m }) => ({ id, x_m, z_m })),
    fidelity: tally(solids, unknown),
  };
}
