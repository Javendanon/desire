/** Pure material and texture policy at the authored JSON boundary. */
import { filled, finite, positive } from './values.ts';
import type { Material, Texture } from './types.ts';

export const COMPRESSED_MIME = new Set(['image/webp']);
export const MAX_TEXTURE_BYTES = 256 * 1024;
export const MAX_TEXTURE_PIXELS = 4096 * 4096;
const BASE_COLOR_CHANNELS = 4;
const COLOR_RANGE = { min: 0, max: 1 };
const REMOTE_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

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

function validatePbrFactors(material: Material, errors: string[]) {
  for (const key of ['metallic', 'roughness'] as const) {
    const factor = material[key];
    if (!finite(factor) || factor < COLOR_RANGE.min || factor > COLOR_RANGE.max) {
      errors.push(`material ${material.id}: ${key} must be finite and in [0, 1]`);
    }
  }
}

function validateMaterial(material: Material, textureIds: Set<string>, errors: string[]) {
  if (material === null || typeof material !== 'object') {
    errors.push('material: every entry must be an object');
    return;
  }
  if (!filled(material.id)) errors.push('material: id is required');
  validateColor(material, errors);
  validatePbrFactors(material, errors);
  if (material.texture !== undefined && !textureIds.has(material.texture)) {
    errors.push(`material ${material.id}: unknown texture ${material.texture}`);
  }
}

/** O(materials). Malformed entries fail without interrupting remaining diagnostics. */
export function validateMaterials(
  materials: Material[], textureIds: Set<string>, errors: string[],
) {
  const ids = new Set<string>();
  for (const material of materials) {
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

function validateTextureResolution(texture: Texture, errors: string[]) {
  if (!Number.isInteger(texture.width_px) || !positive(texture.width_px)
    || !Number.isInteger(texture.height_px) || !positive(texture.height_px)) {
    const detail = 'width_px and height_px require positive integer dimensions';
    errors.push(`texture ${texture.id}: ${detail}`);
  }
  if (texture.width_px * texture.height_px > MAX_TEXTURE_PIXELS) {
    errors.push(`texture ${texture.id}: resolution exceeds the pixel budget`);
  }
}

function escapesAssetDir(value: string) {
  return value.startsWith('/') || value.includes('..');
}

function validateTexture(texture: Texture, errors: string[]) {
  if (texture === null || typeof texture !== 'object') {
    errors.push('texture: every entry must be an object');
    return;
  }
  const where = `texture ${texture.id}`;
  if (!COMPRESSED_MIME.has(texture.mime)) {
    errors.push(`${where}: ${texture.mime} is not a supported compressed image; use image/webp`);
  }
  validateTextureResolution(texture, errors);
  if (!positive(texture.max_bytes) || texture.max_bytes > MAX_TEXTURE_BYTES) {
    errors.push(`${where}: max_bytes must be 0 < b <= ${MAX_TEXTURE_BYTES}`);
  }
  if (!filled(texture.path) || escapesAssetDir(texture.path)) {
    errors.push(`${where}: path must be relative and stay inside the asset directory`);
  } else if (REMOTE_SCHEME.test(texture.path)) {
    errors.push(`${where}: remote texture urls are not allowed`);
  }
}

/** O(textures). Bytes, containment and decoding are checked separately by the I/O stage. */
export function validateTextures(textures: Texture[], errors: string[]) {
  const ids = new Set<string>();
  for (const texture of textures) {
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
