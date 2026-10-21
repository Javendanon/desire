/** Map-package fields of the manifest: D04 map version, sector size and building style. Pure. */
import { finite, positive } from './values.ts';
import type { Ground, MapVersionRef, Place } from './types.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** D04 `Revision`: a positive u32. */
const MAX_REVISION = 0xffff_ffff;
/** D13 has five roof tints (indices 0 to 4). */
export const ROOF_TINTS = 5;
export const MAX_SECTORS = 65_536;

export function validateMapVersion(version: MapVersionRef, errors: string[]) {
  if (version === null || typeof version !== 'object') {
    errors.push('map_version is required: the package belongs to one D04 map version');
    return;
  }
  for (const key of ['id', 'map_id'] as const) {
    if (typeof version[key] !== 'string' || !UUID.test(version[key])) {
      errors.push(`map_version: ${key} must be a lowercase UUID`);
    }
  }
  const { revision } = version;
  if (!Number.isInteger(revision) || revision < 1 || revision > MAX_REVISION) {
    errors.push('map_version: revision must be a positive u32');
  }
}

export function validateSectorSize(size: number, ground: Ground, errors: string[]) {
  if (!positive(size)) {
    errors.push('sector_size_m must be positive');
    return;
  }
  const sectors = Math.ceil(ground.width_m / size) * Math.ceil(ground.height_m / size);
  if (sectors > MAX_SECTORS) errors.push(`sector_size_m gives ${sectors} sectors, over the budget`);
}

export function validateStyle(place: Place, errors: string[]) {
  const style = place.style;
  if (style === null || typeof style !== 'object') {
    errors.push(`place ${place.id}: style with roof, tone and stone is required`);
    return;
  }
  if (!Number.isInteger(style.roof) || style.roof < 0 || style.roof >= ROOF_TINTS) {
    errors.push(`place ${place.id}: style.roof must be an integer from 0 to ${ROOF_TINTS - 1}`);
  }
  if (!Number.isInteger(style.tone) || !finite(style.tone) || style.tone < 0) {
    errors.push(`place ${place.id}: style.tone must be a non-negative integer`);
  }
  if (typeof style.stone !== 'boolean') errors.push(`place ${place.id}: style.stone must be boolean`);
}
