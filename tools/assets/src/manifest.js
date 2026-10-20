/** Validation of the offline asset scene manifest; pure, no file or network access. */

export const SCHEMA = 'desire.asset-scene/1';
export const EVIDENCE = new Set(['verified', 'interpretation', 'synthetic']);
export const COMPRESSED_MIME = new Set(['image/webp', 'image/ktx2']);
export const MAX_FOOTPRINT_M = 200;
export const MAX_HEIGHT_M = 400;
export const MAX_TEXTURE_BYTES = 262144;
const BASE_COLOR_CHANNELS = 4;
const COLOR_RANGE = { min: 0, max: 1 };
const REMOTE_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const positive = (value) => finite(value) && value > 0;
const filled = (value) => typeof value === 'string' && value.trim().length > 0;

function validateProvenance(provenance, where, errors) {
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

function validateHeader(manifest, errors) {
  if (manifest.schema !== SCHEMA) errors.push(`schema must be ${SCHEMA}`);
  if (!filled(manifest.id)) errors.push('id is required');
  if (!filled(manifest.label)) errors.push('label is required');
  if (manifest.network_allowed === true) {
    errors.push('network_allowed: the pipeline is offline; remote material needs authorization');
  }
}

function validateIllustration(illustration, errors) {
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

function validateCalibration(calibration, errors) {
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
  if (!finite(calibration.rotation_radians)) {
    errors.push('calibration: rotation_radians must be finite');
  }
  validateProvenance(calibration.provenance, 'calibration', errors);
}

function validateScalePoint(point, where, errors) {
  if (!finite(point?.u) || !finite(point?.v)) errors.push(`${where}: needs finite u and v`);
}

function validateScaleCheck(check, errors) {
  validateScalePoint(check.from_px ?? {}, `scale_check ${check.id} from_px`, errors);
  validateScalePoint(check.to_px ?? {}, `scale_check ${check.id} to_px`, errors);
  if (!positive(check.expected_m)) {
    errors.push(`scale_check ${check.id}: expected_m must be positive`);
  }
}

function validateScaleChecks(checks, errors) {
  if (!Array.isArray(checks) || checks.length === 0) {
    errors.push('scale_checks: at least one measured reference distance is required');
    return;
  }
  for (const check of checks) validateScaleCheck(check, errors);
}

function validateHeightPresence(place, errors) {
  if (place.height_m !== null && place.height_m !== undefined) return true;
  if (place.height_evidence) errors.push(`place ${place.id}: height_evidence without height_m`);
  return false;
}

function validateHeightEvidence(place, errors) {
  const where = `place ${place.id}`;
  if (!positive(place.height_m) || place.height_m > MAX_HEIGHT_M) {
    errors.push(`${where}: height_m must be 0 < h <= ${MAX_HEIGHT_M}`);
  }
  if (!EVIDENCE.has(place.height_evidence)) {
    errors.push(`${where}: height_evidence must be explicit`);
    return;
  }
  if (place.height_evidence === 'verified' && !filled(place.source_ref)) {
    errors.push(`${where}: verified height needs a source_ref`);
  } else if (place.height_evidence !== 'verified' && !filled(place.rationale)) {
    errors.push(`${where}: ${place.height_evidence} height needs a rationale`);
  }
}

function validateHeight(place, errors) {
  if (validateHeightPresence(place, errors)) validateHeightEvidence(place, errors);
}

function validateFootprint(place, errors) {
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

function validatePlaceLinks(place, materialIds, errors) {
  if (!materialIds.has(place.material)) {
    errors.push(`place ${place.id}: unknown material ${place.material}`);
  }
  if (!Array.isArray(place.provenance) || place.provenance.length === 0) {
    errors.push(`place ${place.id}: provenance tags are required`);
  }
}

function validatePlace(place, context) {
  const { materialIds, seen, errors } = context;
  if (!filled(place.id)) {
    errors.push('place: id is required');
    return;
  }
  if (seen.has(place.id)) errors.push(`duplicate place id ${place.id}`);
  seen.add(place.id);
  if (!filled(place.name)) errors.push(`place ${place.id}: name is required`);
  if (!finite(place.pixel?.u) || !finite(place.pixel?.v)) {
    errors.push(`place ${place.id}: pixel needs finite u and v`);
  }
  validateFootprint(place, errors);
  validatePlaceLinks(place, materialIds, errors);
  validateHeight(place, errors);
}

function validateColor(material, errors) {
  const color = material.base_color ?? [];
  const shaped = color.length === BASE_COLOR_CHANNELS;
  const inRange = color.every((channel) => {
    return finite(channel) && channel >= COLOR_RANGE.min && channel <= COLOR_RANGE.max;
  });
  if (!shaped || !inRange) {
    const message = `material ${material.id}: base_color needs ${BASE_COLOR_CHANNELS} channels`;
    errors.push(`${message} in range`);
  }
}

function validateMaterial(material, textureIds, errors) {
  if (!filled(material.id)) errors.push('material: id is required');
  validateColor(material, errors);
  if (material.texture !== undefined && !textureIds.has(material.texture)) {
    errors.push(`material ${material.id}: unknown texture ${material.texture}`);
  }
}

function validateMaterials(materials, textureIds, errors) {
  const ids = new Set();
  for (const material of materials ?? []) {
    if (ids.has(material.id)) errors.push(`duplicate material id ${material.id}`);
    ids.add(material.id);
    validateMaterial(material, textureIds, errors);
  }
  return ids;
}

function validateTexture(texture, errors) {
  const where = `texture ${texture.id}`;
  if (!COMPRESSED_MIME.has(texture.mime)) {
    errors.push(`${where}: ${texture.mime} is not compressed; use image/webp or image/ktx2`);
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

function validateTextures(textures, errors) {
  const ids = new Set();
  for (const texture of textures ?? []) {
    if (!filled(texture.id)) errors.push('texture: id is required');
    if (ids.has(texture.id)) errors.push(`duplicate texture id ${texture.id}`);
    ids.add(texture.id);
    validateTexture(texture, errors);
  }
  return ids;
}

function escapesAssetDir(value) {
  return value.startsWith('/') || value.includes('..');
}

function validateAnchors(manifest, errors) {
  const spawn = manifest.spawn ?? {};
  if (!finite(spawn.x_m) || !finite(spawn.z_m)) errors.push('spawn: x_m and z_m must be finite');
  for (const waypoint of manifest.waypoints ?? []) {
    if (!finite(waypoint.x_m) || !finite(waypoint.z_m)) {
      errors.push(`waypoint ${waypoint.id}: x_m and z_m must be finite`);
    }
  }
}

/** Returns every contract violation; an empty list means the manifest can build. */
export function validateManifest(manifest) {
  const errors = [];
  if (manifest === null || typeof manifest !== 'object') {
    return { errors: ['manifest must be an object'] };
  }
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
  const context = { materialIds, seen: new Set(), errors };
  for (const place of manifest.places ?? []) validatePlace(place, context);
  return { errors };
}
