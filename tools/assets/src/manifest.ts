/** Validation of the offline asset scene manifest; pure, no file or network access. */
import { planGround } from './calibration.ts';
import { EVIDENCE, validateHeight } from './heights.ts';
import { filled, finite, positive } from './values.ts';
import type {
  Calibration, Ground, Illustration, Manifest, Material, Pixel, Place, Plan,
  Provenance, ScaleCheck, Texture,
} from './types.ts';

export const SCHEMA = 'desire.asset-scene/1';
export const COMPRESSED_MIME = new Set(['image/webp', 'image/ktx2']);
export const MAX_FOOTPRINT_M = 200;
export const MAX_TEXTURE_BYTES = 262144;
const BASE_COLOR_CHANNELS = 4;
const COLOR_RANGE = { min: 0, max: 1 };
const REMOTE_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const SUPPORTED_ROTATION_RAD = 0;

const ASSET_ID_MAX_LENGTH = 64;
export const safeAssetId = (id: unknown): id is string =>
  typeof id === 'string' && id.length <= ASSET_ID_MAX_LENGTH
  && /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id);

function validateProvenance(provenance: Provenance, where: string, errors: string[]) {
  if (provenance === null || typeof provenance !== 'object') {
    errors.push(`${where}: provenance is required`);
    return;
  }
  if (!EVIDENCE.has(provenance.evidence)) {
    errors.push(`${where}: provenance.evidence must be one of ${[...EVIDENCE].join(', ')}`);
  }
  if (!filled(provenance.source)) errors.push(`${where}: provenance.source is required`);
  if (!filled(provenance.attribution)) errors.push(`${where}: provenance.attribution is required`);
}

function validateSections(manifest: Manifest, errors: string[]) {
  for (const key of ['places', 'materials', 'textures', 'waypoints'] as const) {
    if (!Array.isArray(manifest[key])) errors.push(`${key} must be an array`);
  }
  if (!filled(manifest.ground?.material)) errors.push('ground: material is required');
}

function validateHeader(manifest: Manifest, errors: string[]) {
  if (manifest.schema !== SCHEMA) errors.push(`schema must be ${SCHEMA}`);
  if (!safeAssetId(manifest.id)) {
    errors.push('id must be filename-safe (1-64 letters, digits, _ or -)');
  }
  if (!filled(manifest.label)) errors.push('label is required');
  if (manifest.network_allowed === true) {
    errors.push('network_allowed: the pipeline is offline; remote material needs authorization');
  }
  validateSections(manifest, errors);
}

function validateIllustration(illustration: Illustration, errors: string[]) {
  if (illustration === null || typeof illustration !== 'object') {
    errors.push('illustration is required');
    return;
  }
  if (!positive(illustration.width_px) || !positive(illustration.height_px)) {
    errors.push('illustration: width_px and height_px must be positive');
  }
  if (!filled(illustration.license)) errors.push('illustration: license is required');
  validateProvenance(illustration.provenance, 'illustration', errors);
}

function validateCalibration(calibration: Calibration, errors: string[]) {
  if (calibration === null || typeof calibration !== 'object') {
    errors.push('calibration is required; scale cannot be guessed');
    return;
  }
  if (!positive(calibration.meters_per_pixel)) {
    errors.push('calibration: meters_per_pixel must be positive');
  }
  if (!finite(calibration.origin_px_x) || !finite(calibration.origin_px_y)) {
    errors.push('calibration: origin_px_x and origin_px_y must be finite');
  }
  if (calibration.rotation_radians !== SUPPORTED_ROTATION_RAD) {
    errors.push('calibration: rotation_radians must be 0; ground and nav grid are axis-aligned');
  }
  validateProvenance(calibration.provenance, 'calibration', errors);
}

function validateScalePoint(point: Partial<Pixel>, where: string, errors: string[]) {
  if (!finite(point?.u) || !finite(point?.v)) errors.push(`${where}: needs finite u and v`);
}

function validateScaleCheck(check: ScaleCheck, errors: string[]) {
  if (check === null || typeof check !== 'object') {
    errors.push('scale_check: every entry must be an object');
    return;
  }
  validateScalePoint(check.from_px ?? {}, `scale_check ${check.id} from_px`, errors);
  validateScalePoint(check.to_px ?? {}, `scale_check ${check.id} to_px`, errors);
  if (!positive(check.expected_m)) {
    errors.push(`scale_check ${check.id}: expected_m must be positive`);
  }
}

function validateScaleChecks(checks: ScaleCheck[], errors: string[]) {
  if (!Array.isArray(checks) || checks.length === 0) {
    errors.push('scale_checks: at least one measured reference distance is required');
    return;
  }
  for (const check of checks) validateScaleCheck(check, errors);
}

function validateFootprint(place: Place, errors: string[]) {
  const { width_m: width, depth_m: depth } = place.footprint_m ?? {};
  if (!positive(width) || !positive(depth)) {
    errors.push(`place ${place.id}: footprint_m width_m and depth_m must be positive`);
    return;
  }
  if (width > MAX_FOOTPRINT_M || depth > MAX_FOOTPRINT_M) {
    errors.push(`place ${place.id}: footprint_m over ${MAX_FOOTPRINT_M} m;`
      + ' an interpretation cannot invent a block');
  }
}

function validatePlaceLinks(place: Place, materialIds: Set<string>, errors: string[]) {
  if (!materialIds.has(place.material)) {
    errors.push(`place ${place.id}: unknown material ${place.material}`);
  }
  if (!Array.isArray(place.provenance) || place.provenance.length === 0) {
    errors.push(`place ${place.id}: provenance tags are required`);
  }
}

function validatePixel(place: Place, frame: Illustration, errors: string[]) {
  const { u, v } = place.pixel ?? {};
  if (!finite(u) || !finite(v)) {
    errors.push(`place ${place.id}: pixel needs finite u and v`);
    return;
  }
  const outside = u < 0 || v < 0 || u > frame.width_px || v > frame.height_px;
  if (outside) errors.push(`place ${place.id}: pixel outside the illustration frame`);
}

type PlaceContext = {
  materialIds: Set<string>; frame: Illustration; seen: Set<string>; errors: string[];
};

function validatePlace(place: Place, context: PlaceContext) {
  const { materialIds, frame, seen, errors } = context;
  if (place === null || typeof place !== 'object') {
    errors.push('place: every entry must be an object');
    return;
  }
  if (!filled(place.id)) {
    errors.push('place: id is required');
    return;
  }
  if (seen.has(place.id)) errors.push(`duplicate place id ${place.id}`);
  seen.add(place.id);
  if (!filled(place.name)) errors.push(`place ${place.id}: name is required`);
  validatePixel(place, frame, errors);
  validateFootprint(place, errors);
  validatePlaceLinks(place, materialIds, errors);
  validateHeight(place, errors);
}

function validateColor(material: Material, errors: string[]) {
  const color = material.base_color ?? [];
  const shaped = Array.isArray(color) && color.length === BASE_COLOR_CHANNELS;
  const inRange = shaped && color.every((channel) => {
    return finite(channel) && channel >= COLOR_RANGE.min && channel <= COLOR_RANGE.max;
  });
  if (!shaped || !inRange) {
    const message = `material ${material.id}: base_color needs ${BASE_COLOR_CHANNELS} channels`;
    errors.push(`${message} in range`);
  }
}

function validateMaterial(material: Material, textureIds: Set<string>, errors: string[]) {
  if (material === null || typeof material !== 'object') {
    errors.push('material: every entry must be an object');
    return;
  }
  if (!filled(material.id)) errors.push('material: id is required');
  validateColor(material, errors);
  if (material.texture !== undefined && !textureIds.has(material.texture)) {
    errors.push(`material ${material.id}: unknown texture ${material.texture}`);
  }
}

function validateMaterials(materials: Material[], textureIds: Set<string>, errors: string[]) {
  const ids = new Set<string>();
  for (const material of materials ?? []) {
    if (material === null || typeof material !== 'object') {
      validateMaterial(material, textureIds, errors);
      continue;
    }
    if (ids.has(material.id)) errors.push(`duplicate material id ${material.id}`);
    ids.add(material.id);
    validateMaterial(material, textureIds, errors);
  }
  return ids;
}

function validateTexture(texture: Texture, errors: string[]) {
  if (texture === null || typeof texture !== 'object') {
    errors.push('texture: every entry must be an object');
    return;
  }
  const where = `texture ${texture.id}`;
  if (!COMPRESSED_MIME.has(texture.mime)) {
    errors.push(`${where}: ${texture.mime} is not compressed; use image/webp or image/ktx2`);
  }
  if (!Number.isInteger(texture.width_px) || !positive(texture.width_px)
    || !Number.isInteger(texture.height_px) || !positive(texture.height_px)) {
    errors.push(`${where}: width_px and height_px must be positive integer resolution`);
  }
  if (!positive(texture.max_bytes) || texture.max_bytes > MAX_TEXTURE_BYTES) {
    errors.push(`${where}: max_bytes must be 0 < b <= ${MAX_TEXTURE_BYTES}`);
  }
  if (!filled(texture.path) || escapesAssetDir(texture.path)) {
    errors.push(`${where}: path must be relative and stay inside the asset directory`);
  } else if (REMOTE_SCHEME.test(texture.path)) {
    errors.push(`${where}: remote texture urls are not allowed`);
  }
}

function validateTextures(textures: Texture[], errors: string[]) {
  const ids = new Set<string>();
  for (const texture of textures ?? []) {
    if (texture === null || typeof texture !== 'object') {
      validateTexture(texture, errors);
      continue;
    }
    if (!filled(texture.id)) errors.push('texture: id is required');
    if (ids.has(texture.id)) errors.push(`duplicate texture id ${texture.id}`);
    ids.add(texture.id);
    validateTexture(texture, errors);
  }
  return ids;
}

function escapesAssetDir(value: string) {
  return value.startsWith('/') || value.includes('..');
}

function groundExtent(manifest: Manifest) {
  const { illustration, calibration } = manifest;
  const width = illustration?.width_px;
  const height = illustration?.height_px;
  if (!(positive(width) && positive(height) && positive(calibration?.meters_per_pixel))) {
    return null;
  }
  return planGround(illustration, calibration);
}

function validateAnchor(spec: {
  where: string; point: Plan; extent: Ground | null; errors: string[];
}) {
  const { where, point, extent, errors } = spec;
  const { x_m: x, z_m: z } = point ?? {};
  if (!finite(x) || !finite(z)) {
    errors.push(`${where}: x_m and z_m must be finite`);
    return;
  }
  if (extent === null) return;
  const east = extent.origin_x_m + extent.width_m;
  const south = extent.origin_z_m + extent.height_m;
  const outside = x < extent.origin_x_m || z < extent.origin_z_m || x > east || z > south;
  if (outside) errors.push(`${where}: outside the calibrated ground`);
}

function validateAnchors(manifest: Manifest, errors: string[]) {
  const waypoints = Array.isArray(manifest.waypoints) ? manifest.waypoints : [];
  if (waypoints.length === 0) errors.push('waypoints: at least one navigation anchor is required');
  const extent = groundExtent(manifest);
  validateAnchor({ where: 'spawn', point: manifest.spawn, extent, errors });
  for (const waypoint of waypoints) {
    validateAnchor({ where: `waypoint ${waypoint.id}`, point: waypoint, extent, errors });
  }
}

/** Returns every contract violation; an empty list means the manifest can build. */
export function validateManifest(value: unknown): { errors: string[] } {
  const errors: string[] = [];
  if (value === null || typeof value !== 'object') {
    return { errors: ['manifest must be an object'] };
  }
  // This cast permits defensive field checks; callers must reject any returned errors.
  const manifest = value as Manifest;
  validateHeader(manifest, errors);
  validateIllustration(manifest.illustration, errors);
  validateCalibration(manifest.calibration, errors);
  validateScaleChecks(manifest.scale_checks, errors);
  validateAnchors(manifest, errors);
  const textureIds = validateTextures(manifest.textures, errors);
  const materialIds = validateMaterials(manifest.materials, textureIds, errors);
  if (manifest.ground?.material && !materialIds.has(manifest.ground.material)) {
    errors.push(`ground: unknown material ${manifest.ground.material}`);
  }
  const places = Array.isArray(manifest.places) ? manifest.places : [];
  const hasHeight = places.some((place) => typeof place?.height_m === 'number');
  if (places.length > 0 && !hasHeight) {
    errors.push('places: at least one declared height is required to build geometry');
  }
  const frame = manifest.illustration ?? {};
  const context = { materialIds, frame, seen: new Set<string>(), errors };
  for (const place of places) validatePlace(place, context);
  return { errors };
}
