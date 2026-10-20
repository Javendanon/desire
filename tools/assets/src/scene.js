/** Turns a validated manifest into a metric scene: solids, unknown places and fidelity. */
import { pixelToPlan } from './calibration.js';

const hasHeight = (place) => typeof place.height_m === 'number';

function toSolid(place, calibration) {
  const center = pixelToPlan(calibration, place.pixel);
  return {
    id: place.id,
    name: place.name,
    center,
    width_m: place.footprint_m.width_m,
    depth_m: place.footprint_m.depth_m,
    height_m: place.height_m,
    height_evidence: place.height_evidence,
    material: place.material,
  };
}

function toUnknown(place, calibration) {
  const center = pixelToPlan(calibration, place.pixel);
  return { id: place.id, name: place.name, center, material: place.material };
}

function tally(solids, unknown) {
  const fidelity = { verified: 0, interpretation: 0, synthetic: 0, unknown: unknown.length };
  for (const solid of solids) fidelity[solid.height_evidence] += 1;
  return fidelity;
}

function groundOf(illustration, calibration) {
  return {
    width_m: illustration.width_px * calibration.meters_per_pixel,
    height_m: illustration.height_px * calibration.meters_per_pixel,
  };
}

/** Builds the metric scene. Heights come only from declared data, never from a default. */
export function buildScene(manifest) {
  const { calibration, illustration } = manifest;
  const solids = manifest.places.filter(hasHeight).map((place) => toSolid(place, calibration));
  const unknown = manifest.places.filter((place) => !hasHeight(place))
    .map((place) => toUnknown(place, calibration));
  return {
    id: manifest.id,
    label: manifest.label,
    ground: { ...groundOf(illustration, calibration), material: manifest.ground.material },
    solids,
    unknown,
    spawn: { x_m: manifest.spawn.x_m, z_m: manifest.spawn.z_m },
    waypoints: manifest.waypoints.map(({ id, x_m, z_m }) => ({ id, x_m, z_m })),
    materials: manifest.materials,
    textures: manifest.textures,
    fidelity: tally(solids, unknown),
  };
}
