/** Height policy: evidence, rationale and bounds. An unknown height is never replaced. */
import { filled, positive } from './values.js';

export const EVIDENCE = new Set(['verified', 'interpretation', 'synthetic']);
export const MAX_HEIGHT_M = 400;

function validateHeightPresence(place, errors) {
  if (place.height_m !== null && place.height_m !== undefined) return true;
  if (place.height_evidence) {
    errors.push(`place ${place.id}: height_evidence without height_m`);
  }
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

/** Validates one declared height; unknown heights pass and stay unknown. */
export function validateHeight(place, errors) {
  if (validateHeightPresence(place, errors)) validateHeightEvidence(place, errors);
}
